import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resultKind, routeResults } from "../src/results.ts";
import { reduce } from "../src/reduce.ts";
import { compactReduction, getSources } from "../src/briefing.ts";
import { readPages } from "../src/pages.ts";
import type { SearchResult } from "../src/search.ts";

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value });
const searchResult = (): SearchResult => ({
  kind: "leads", provider: "brave", query: "fixture", status: "completed",
  sources: [{ id: "s1", title: "Fixture lead", url: "https://example.org/a", text: "Discovery snippet, not captured text", date: null, kind: "search-result", verified: false, truncated: false, rawRef: "fixture.json#/0" }],
  omitted: 0, elapsedMs: 0, artifactDir: "fixture", rawPath: null, partialOutput: false,
  usage: null, reportedCostUsd: null, providerMeta: null, dateSemantics: "unverified", error: null,
});
const brief = { question: "What changed?", since: "2026-11-01", until: "2026-11-12" };

// Only transport/classifier edges are synthetic. The router, reduction, artifact
// storage, capture receipt validation and bounded views are production code.
describe("leads and evidence routing", () => {
  let cwd: string;
  const keys = ["PI_RESEARCH_REDUCTION_DIR", "PI_RESEARCH_PAGES_DIR", "PI_RESEARCH_SC_BIN", "PI_RESEARCH_SC_SOCKET"];
  let previous: (string | undefined)[];
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "research-result-kinds-"));
    previous = keys.map(key => process.env[key]);
    for (const key of keys) delete process.env[key];
  });
  afterEach(async () => {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await rm(cwd, { recursive: true, force: true });
  });

  test("routes by operation result kind, not provider, payload, count or success", () => {
    const outcomes = [
      fulfilled(searchResult()),
      fulfilled({ kind: "evidence", provider: "brave", records: Array(20).fill({ value: 42 }), status: "partial", warnings: ["stale"] }),
      { status: "rejected" as const, reason: "transport did not produce a result" },
      fulfilled({ ...searchResult(), status: "failed", sources: [], error: "provider failed", reportedCostUsd: 0.01 }),
      fulfilled({ kind: "evidence", status: "failed", error: "missing data" }),
    ];
    const before = JSON.stringify(outcomes);
    const route = routeResults(outcomes);
    expect(route).toEqual({ leads: [0, 3], evidence: [1, 4], rejected: [2] });
    expect([...route.leads, ...route.evidence, ...route.rejected].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(outcomes)).toBe(before);
    expect(JSON.stringify(route)).not.toContain("records");
  });

  test("empty and rejection-only batches stay explicit", () => {
    expect(routeResults([])).toEqual({ leads: [], evidence: [], rejected: [] });
    expect(routeResults([{ status: "rejected", reason: "offline" }])).toEqual({ leads: [], evidence: [], rejected: [0] });
  });

  test("missing, unknown and malformed envelopes fail closed without inferred kinds", () => {
    for (const value of [null, [], {}, { provider: "brave", sources: [] }, { kind: "fact" }, { kind: "leads,evidence" }]) {
      expect(() => resultKind(value)).toThrow();
      expect(() => routeResults([fulfilled(searchResult()), fulfilled(value)])).toThrow();
    }
    for (const outcomes of [null, [null], [{ status: "pending" }], [{ status: "rejected" }], Array(25).fill(fulfilled(searchResult()))]) {
      expect(() => routeResults(outcomes as any)).toThrow();
    }
  });

  test("evidence and untagged results are rejected before disk or classifier access", async () => {
    let modelAccess = 0;
    for (const value of [{ ...searchResult(), kind: "evidence" }, { kind: "evidence", records: [] }, { ...searchResult(), kind: undefined }]) {
      await expect(reduce({ ...brief, outcomes: [fulfilled(searchResult()), fulfilled(value as any)] }, {
        cwd, classifier: async () => { modelAccess++; throw new Error("must not resolve"); },
      })).rejects.toThrow();
      expect(await readdir(cwd)).toEqual([]);
    }
    expect(modelAccess).toBe(0);
  });

  test("a leads tag alone does not satisfy the existing search payload contract", async () => {
    await expect(reduce({ ...brief, outcomes: [fulfilled({ kind: "leads", records: [] } as any)] }, {
      cwd, classifier: async () => { throw new Error("must not resolve"); },
    })).rejects.toThrow(/normalized search results/);
    expect(await readdir(cwd)).toEqual([]);
  });

  test("mixed acquisition qualifies only leads and keeps captured evidence separate", async () => {
    const url = "https://example.org/a";
    const capture = await readPages({ pages: [{ url }] }, { cwd, exec: async () => ({ code: 0, stderr: "", stdout: JSON.stringify({
      sessionId: "s", jobId: "j", url,
      outcome: { kind: "completed", value: { mode: "raw", format: "text", requestedUrl: url, url, title: "Fixture page", content: "EVIDENCE_ONLY_PAYLOAD", readiness: { stable: false }, warnings: ["CONTENT_NOT_STABLE"] } },
    }) + "\n" }) });
    const evidenceBytes = await readFile(capture.resultPath, "utf8");
    const outcomes = [fulfilled(searchResult()), fulfilled(capture), { status: "rejected" as const, reason: "Unassigned acquisition failure" }];
    const routes = routeResults(outcomes);
    let calls = 0;
    const reduced = await reduce({ ...brief, outcomes: routes.leads.map(index => outcomes[index]) as PromiseSettledResult<SearchResult>[] }, {
      cwd, classifier: async () => async ({ state, questions }) => {
        calls++;
        expect(state.source.id).toBe("s1");
        expect(JSON.stringify(state)).not.toContain("EVIDENCE_ONLY_PAYLOAD");
        return { provider: "typesafe", model: "jev-latest", stopReason: "stop", answers: Object.fromEntries(Object.entries<any>(questions).map(([id, q]) => {
          if (q.type === "score") return [id, { type: "score", score: 3, confidence: 1 }];
          const choice = id === "sufficiency" ? "adequate" : id === "qualification" ? "not_observed" : "unknown";
          return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(label => [label, label === choice ? 1 : 0])) }];
        })) };
      },
    });
    expect(calls).toBe(2);
    expect(reduced.retained).toBe(1);
    expect(compactReduction(reduced).kind).toBe("leads");
    const snippets = await getSources({ reductionId: reduced.reductionId }, cwd);
    expect(snippets.kind).toBe("leads");
    expect(snippets.records[0].excerpt).toBe("Discovery snippet, not captured text");
    expect(outcomes[routes.evidence[0]]).toBe(outcomes[1]);
    expect(capture.kind).toBe("evidence");
    expect(capture.status).toBe("partial");
    expect(capture.records[0].warnings).toEqual(["CONTENT_NOT_STABLE"]);
    expect(await readFile(capture.resultPath, "utf8")).toBe(evidenceBytes);
    expect(routes.rejected).toEqual([2]);
    const replay = await reduce({ ...brief, outcomes: [fulfilled(searchResult())] }, { cwd, classifier: async () => { throw new Error("no retry"); } });
    expect(replay.replayed).toBe(true);
  });

  test("evidence-only composition has no reduction or model access", async () => {
    const outcomes = [fulfilled({ kind: "evidence", artifactPath: "/fixture/history.json", status: "completed" })];
    const routes = routeResults(outcomes);
    let calls = 0;
    if (routes.leads.length) {
      await reduce({ ...brief, outcomes: routes.leads.map(i => outcomes[i]) as any }, { cwd, classifier: async () => { calls++; throw new Error("must not resolve"); } });
    }
    expect(calls).toBe(0);
    expect(routes.evidence).toEqual([0]);
    expect(await readdir(cwd)).toEqual([]);
  });
});
