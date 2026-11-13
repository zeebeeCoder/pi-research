import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clip, decodeReceipts, pageLimits, readPages, type Exec, type ReadPagesInput } from "../src/pages.ts";

// Synthetic transport receipts, not proof of Chrome/site compatibility.
const a = "https://example.org/a", b = "https://example.org/b";
const receipt = (url = a, content = "Article text with a [link](https://example.org/reference).") => ({
  sessionId: "session", jobId: `job-${url}`, url,
  outcome: { kind: "completed", value: {
    mode: "raw", format: "text", requestedUrl: url, url, title: "Article", tabId: 12,
    content, stats: { rootsRead: 1 }, readiness: { stable: true, attempts: 2 }, warnings: [] as string[],
  } },
});
const jsonl = (...values: unknown[]) => values.map(v => JSON.stringify(v)).join("\n") + "\n";
const fake = (stdout: string, extra: Partial<Awaited<ReturnType<Exec>>> = {}): Exec => async () => ({ stdout, stderr: "", code: 0, ...extra });

describe("optional page reading without changing discovery", () => {
  let cwd: string;
  const keys = ["PI_RESEARCH_PAGES_DIR", "PI_RESEARCH_REDUCTION_DIR", "PI_RESEARCH_SC_BIN", "PI_RESEARCH_SC_SOCKET"];
  let env: (string | undefined)[];
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "research-pages-"));
    env = keys.map(k => process.env[k]);
    for (const key of keys) delete process.env[key];
  });
  afterEach(async () => {
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
    await rm(cwd, { recursive: true, force: true });
  });

  test("one raw batch, argument arrays, configured transport; out-of-order receipts stay linked", async () => {
    process.env.PI_RESEARCH_SC_BIN = "/trusted/sc";
    process.env.PI_RESEARCH_SC_SOCKET = "/private/service.sock";
    const calls: any[] = [];
    const signal = new AbortController().signal;
    const result = await readPages({ pages: [{ url: a, sourceId: "source-a" }, { url: b, sourceId: "source-b" }] }, {
      cwd, signal, exec: async (...args) => { calls.push(args); return { stdout: jsonl(receipt(b, "B"), receipt(a, "A")), stderr: "", code: 0 }; },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["/trusted/sc", ["control", "capture", "--raw", "--format", "text", "--timeout", "120000", "--socket", "/private/service.sock", "--", a, b], { cwd, signal, timeout: pageLimits.timeoutMs, maxBuffer: pageLimits.maxBuffer }]);
    expect(result.status).toBe("completed");
    expect(result.kind).toBe("evidence");
    expect(result.records.map(r => [r.sourceId, r.excerpt])).toEqual([["source-a", "A"], ["source-b", "B"]]);
    expect(result.records[0].receiptRef).toEndWith("receipts.jsonl#L2");
    expect(await readFile(result.records[0].contentPath!, "utf8")).toBe("A");
    expect((await stat(result.artifactDir)).mode & 0o777).toBe(0o700);
    expect((await stat(result.records[0].contentPath!)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(result.resultPath, "utf8"))).toEqual(result);
  });

  test("preserves success beside a failure even when the batch exits nonzero", async () => {
    const failed = { sessionId: "s", jobId: "b", url: b, outcome: { kind: "failed", error: "ACCESS_CHALLENGE" }, details: { phase: "read" } };
    const raw = jsonl(failed, receipt());
    const result = await readPages({ pages: [{ url: a }, { url: b }] }, { cwd, exec: fake(raw, { code: 1, stderr: "diagnostic" }) });
    expect(result.status).toBe("partial");
    expect(result.kind).toBe("evidence");
    expect(result.records[0].status).toBe("completed");
    expect(result.records[1].error).toBe("ACCESS_CHALLENGE");
    expect(result.records[1].contentPath).toBeNull();
    expect(await readFile(join(result.artifactDir, "receipts.jsonl"), "utf8")).toBe(raw);
    expect(await readFile(join(result.artifactDir, "stderr.log"), "utf8")).toBe("diagnostic");
  });

  test("retains readiness/root-cap and cleanup warnings separately from captured text", async () => {
    const r = { ...receipt(), cleanupError: "Tab removal could not be confirmed." };
    r.outcome.value.readiness.stable = false;
    r.outcome.value.warnings = ["CONTENT_NOT_STABLE", "ROOT_CAP", ...Array.from({ length: 8 }, () => "w".repeat(500))];
    const result = await readPages({ pages: [{ url: a }] }, { cwd, exec: fake(jsonl(r), { code: 1 }) });
    expect(result.status).toBe("partial");
    const page = result.records[0];
    expect(page.status).toBe("completed");
    expect(page.stable).toBe(false);
    expect(page.cleanupError).toContain("not be confirmed");
    expect(page.warnings).toContain("ROOT_CAP");
    expect(page.warningsOmitted).toBe(6);
    expect(await readFile(join(result.artifactDir, "receipts.jsonl"), "utf8")).toContain("w".repeat(500));
  });

  test("records redirects without treating the requested URL as the final URL", async () => {
    const r = receipt(); r.outcome.value.url = b;
    const result = await readPages({ pages: [{ url: a }] }, { cwd, exec: fake(jsonl(r)) });
    expect(result.records[0].requestedUrl).toBe(a);
    expect(result.records[0].finalUrl).toBe(b);
  });

  test("failed SC acquisition and missing CLI are durable explicit failures, never retried", async () => {
    for (const exec of [fake("", { code: 1, stderr: "CONTROL_SERVICE_UNAVAILABLE: acquisition deadline exceeded" }), (async () => { throw new Error("spawn sc ENOENT"); }) as Exec]) {
      let calls = 0;
      const result = await readPages({ pages: [{ url: a }] }, { cwd, exec: async (...args) => { calls++; return exec(...args); } });
      expect(calls).toBe(1); expect(result.status).toBe("failed");
      expect(result.transport.error).toBeTruthy();
      expect(result.transport.error).not.toContain("No service was started");
      expect(result.records[0].error).toContain("No receipt");
      expect(result.records[0].excerpt).toBe("");
      expect(result.records[0].contentPath).toBeNull();
    }
  });

  test("cancelled, killed or truncated calls retain settled receipts without inventing missing results", async () => {
    const raw = jsonl(receipt()) + '{"url":';
    const result = await readPages({ pages: [{ url: a }, { url: b }] }, { cwd, exec: fake(raw, { code: 130, killed: true, truncated: true }) });
    expect(result.status).toBe("partial"); expect(result.transport.killed).toBe(true);
    expect(result.records[0].status).toBe("completed");
    expect(result.records[1].status).toBe("failed");
    expect(result.records[1].error).toContain("unconfirmed");
    expect(result.warnings.some(w => w.includes("Invalid JSON"))).toBe(true);
    const cancelled = await readPages({ pages: [{ url: a }] }, { cwd, exec: fake(jsonl({ sessionId: "s", jobId: "j", url: a, outcome: { kind: "cancelled" } }), { code: 1 }) });
    expect(cancelled.records[0].status).toBe("cancelled");
  });

  test("pre-abort has no disk or transport effects; mid-call abort is forwarded", async () => {
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    await expect(readPages({ pages: [{ url: a }] }, { cwd, signal: controller.signal, exec: async () => { calls++; throw Error("unreachable"); } })).rejects.toThrow();
    expect(calls).toBe(0); expect(await readdir(cwd)).toEqual([]);
    const next = new AbortController();
    const result = await readPages({ pages: [{ url: a }] }, { cwd, signal: next.signal, exec: async (_c, _a, opts) => {
      expect(opts.signal).toBe(next.signal); next.abort();
      return { stdout: "", stderr: "", code: 130, killed: true };
    } });
    expect(result.status).toBe("failed"); expect(result.transport.killed).toBe(true);
  });

  test("invalid URLs, duplicate targets and invalid associations fail before effects", async () => {
    const inputs: ReadPagesInput[] = [
      { pages: [] }, { pages: Array.from({ length: 7 }, (_, i) => ({ url: a + i })) },
      ...["file:///tmp/private", "javascript:alert(1)", "https://user:pass@example.org", "https://example.org/a b", "https://example.org/a\nb", "--help", "https://example.org/" + "x".repeat(2048)].map(url => ({ pages: [{ url }] })),
      { pages: [{ url: a }, { url: a }] }, { pages: [{ url: a }], reductionId: "../../private" },
    ];
    for (const input of inputs) await expect(readPages(input, { cwd, exec: async () => { throw Error("MUST NOT LAUNCH"); } })).rejects.not.toThrow("MUST NOT LAUNCH");
    expect(await readdir(cwd)).toEqual([]);
  });

  test("saved discovery association is checked and discovery bytes never change", async () => {
    const reductionId = "a".repeat(64), dir = join(cwd, ".artifacts/reductions", reductionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "result.json"), original = JSON.stringify({ reductionId, items: [{ source: { id: "s1", url: a } }] });
    await writeFile(path, original);
    for (const pages of [[{ url: a }], [{ url: b, sourceId: "s1" }], [{ url: a, sourceId: "missing" }]]) {
      await expect(readPages({ reductionId, pages }, { cwd, exec: fake("") })).rejects.toThrow(/must match/);
    }
    const result = await readPages({ reductionId, pages: [{ url: a, sourceId: "s1" }] }, { cwd, exec: fake(jsonl(receipt())) });
    expect(result.reductionId).toBe(reductionId); expect(result.evidenceStage).toBe("inspection");
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("malformed, empty, wrong-format and mismatched receipts never become text evidence", async () => {
    const mutations: ((r: any) => void)[] = [
      r => { delete r.jobId; }, r => { r.outcome.value.content = "  "; },
      r => { r.outcome.value.mode = "harvest"; }, r => { r.outcome.value.format = "json"; },
      r => { r.outcome.value.requestedUrl = b; }, r => { r.outcome.value.url = "file:///tmp/a"; },
      r => { r.outcome.value.readiness = {}; }, r => { r.outcome.value.warnings = null; },
    ];
    for (const mutate of mutations) {
      const r = receipt(); mutate(r);
      const result = await readPages({ pages: [{ url: a }] }, { cwd, exec: fake(jsonl(r)) });
      expect(result.status).toBe("failed"); expect(result.records[0].excerpt).toBe("");
      expect(result.records[0].contentPath).toBeNull();
    }
    const duplicate = await readPages({ pages: [{ url: a }] }, { cwd, exec: fake(jsonl(receipt(), receipt())) });
    expect(duplicate.records[0].error).toContain("Duplicate");
    expect(decodeReceipts(jsonl(receipt(b)), [{ url: a }]).issues).toHaveLength(1);
  });

  test("public output stays bounded while full text and receipts remain intact", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.org/${i}?` + "x".repeat(1900));
    const content = "\\\"".repeat(9000) + "😀";
    const raw = jsonl(...urls.map(u => receipt(u, content)));
    const result = await readPages({ pages: urls.map(url => ({ url })) }, { cwd, exec: fake(raw) });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(pageLimits.outputChars);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(pageLimits.outputBytes);
    const saved = JSON.parse(await readFile(result.resultPath, "utf8"));
    expect(saved.records.map((r: any) => r.requestedUrl)).toEqual(urls);
    expect(result.records.every(r => r.urlTruncated)).toBe(true);
    for (const page of result.records) {
      expect(page.excerpt.length).toBeLessThanOrEqual(3000);
      expect(page.excerptTruncated).toBe(true);
      expect(await readFile(page.contentPath!, "utf8")).toBe(content);
    }
    expect(await readFile(join(result.artifactDir, "receipts.jsonl"), "utf8")).toBe(raw);
    expect(clip("x😀", 2)).toBe("x");
  });

  test("multibyte excerpts respect the byte budget without splitting surrogate pairs", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => a + i);
    const text = "界".repeat(2999) + "😀" + "more".repeat(300);
    const result = await readPages({ pages: urls.map(url => ({ url })) }, { cwd, exec: fake(jsonl(...urls.map(u => receipt(u, text)))) });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(pageLimits.outputBytes);
    expect(result.records.some(r => r.excerpt.length < 2999)).toBe(true);
    expect(result.records.every(r => !/[\uD800-\uDBFF]$/.test(r.excerpt))).toBe(true);
    expect(await readFile(result.records[0].contentPath!, "utf8")).toBe(text);
  });

  test("explicit repeat captures get new artifacts, never overwrite historical snapshots", async () => {
    const input = { pages: [{ url: a }] };
    const first = await readPages(input, { cwd, exec: fake(jsonl(receipt(a, "old"))) });
    const bytes = await readFile(first.resultPath, "utf8");
    const second = await readPages(input, { cwd, exec: fake(jsonl(receipt(a, "new"))) });
    expect(first.captureId).not.toBe(second.captureId);
    expect(await readFile(first.resultPath, "utf8")).toBe(bytes);
    expect(await readFile(first.records[0].contentPath!, "utf8")).toBe("old");
  });
});
