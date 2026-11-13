import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSources, reduce, type ReduceInput } from "../src/reduce.ts";
import type { SearchResult, Source } from "../src/search.ts";

const source = (n: number): Source => ({ id: `s${n}`, title: `Source ${n}`, url: `https://example.org/${n}`, text: "Public source text", date: "2026-11-09", kind: "search-result", verified: false, truncated: false, rawRef: `/private/search/raw.json#/${n}` });
const search = (sources: Source[], changes: Partial<SearchResult> = {}): SearchResult => ({ kind: "leads", provider: "brave", query: "example", status: sources.length ? "completed" : "empty", sources, omitted: 0, elapsedMs: 1, artifactDir: "/private/search", rawPath: "/private/search/raw.json", partialOutput: false, usage: null, reportedCostUsd: null, providerMeta: { integrationDiagnostics: { schemaWarning: "synthetic warning" } }, dateSemantics: "unverified", error: null, ...changes });
const input = (n = 1): ReduceInput => ({ question: "What changed?", since: "2026-11-04", until: "2026-11-11", outcomes: [{ status: "fulfilled", value: search(Array.from({ length: n }, (_, i) => source(i))) }] });
const answer = ({ state, questions }: any) => ({
  provider: "typesafe", model: "jev-latest", stopReason: "stop",
  answers: Object.fromEntries(Object.entries<any>(questions).map(([id, q]) => {
    if (q.type === "score") return [id, { type: "score", score: Number(state.source.id.slice(1)) % 5, confidence: 0.9 }];
    const choice = ({ sufficiency: "adequate", qualification: "not_observed", authenticity: "unknown", sourceCredibility: "unknown" } as any)[id];
    return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === choice ? 1 : 0])) }];
  })),
  usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
});

describe("offline collect/classify/review composition", () => {
  let cwd: string, previousRoot: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "research-reduce-"));
    previousRoot = process.env.PI_RESEARCH_REDUCTION_DIR;
    process.env.PI_RESEARCH_REDUCTION_DIR = join(cwd, "reductions");
  });
  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.PI_RESEARCH_REDUCTION_DIR;
    else process.env.PI_RESEARCH_REDUCTION_DIR = previousRoot;
    await rm(cwd, { recursive: true, force: true });
  });

  test("parallel search outcomes -> 20 sources across internal chunks -> global stable ranking", async () => {
    const brief = input(0);
    brief.outcomes = await Promise.allSettled([0, 5, 10, 15].map(async offset => search(Array.from({ length: 5 }, (_, n) => source(offset + n)))));
    let active = 0, peak = 0, calls = 0;
    const result = await reduce(brief, { cwd, classifier: async () => async request => {
      calls++; active++; peak = Math.max(peak, active);
      expect(JSON.stringify(request)).not.toContain("/private/");
      expect(request.state.researchQuestion).toBe(brief.question);
      expect(Object.keys(request.questions)).toEqual(request.questions.contribution ? ["contribution", "sufficiency", "qualification"] : ["authenticity", "sourceCredibility"]);
      await new Promise(resolve => setTimeout(resolve, Number(request.state.source.id.slice(1)) % 3));
      active--; return answer(request);
    } });
    expect(result.status).toBe("completed");
    expect(result.retained).toBe(20); expect(result.excluded).toBe(0);
    expect(calls).toBe(40); expect(peak).toBe(4);
    expect(result.batches).toHaveLength(2);
    expect(result.rankedIds.slice(0, 4)).toEqual(["s4", "s9", "s14", "s19"]);
    expect(result.items.map((i: any) => i.source)).toEqual(brief.outcomes.flatMap(o => o.status === "fulfilled" ? o.value.sources : []));
    expect(result.needsEvidenceIds).toHaveLength(20); // unknown is not low relevance
    expect(result.usage.totalTokens).toBe(440); expect(result.usageResponses).toBe(40);
    expect(result.searchOutcomes[0].result.providerMeta).toEqual((brief.outcomes[0] as any).value.providerMeta);
    expect(JSON.parse(await readFile(result.resultPath, "utf8"))).toEqual(result);
    expect((await readdir(result.artifactDir)).filter(f => /^response-/.test(f))).toHaveLength(40);
  });

  test("same input replays without model resolution or repeated spending", async () => {
    let calls = 0;
    const first = await reduce(input(), { cwd, classifier: async () => async r => { calls++; return answer(r); } });
    const bytes = await readFile(first.resultPath, "utf8");
    const second = await reduce(input(), { cwd, classifier: async () => { throw new Error("must not resolve"); } });
    expect(second.replayed).toBe(true); expect(second.reductionId).toBe(first.reductionId); expect(calls).toBe(2);
    expect(await readFile(first.resultPath, "utf8")).toBe(bytes);
  });

  test("routing tag preserves pre-tag replay and interrupted-claim identity", async () => {
    const brief = input();
    const first = await reduce(brief, { cwd, classifier: async () => async r => answer(r) });
    const legacyOutcomes = first.searchOutcomes.map(o => {
      if (o.status === "rejected") return o;
      const { kind, ...result } = o.result;
      return { ...o, result };
    });
    const legacyId = createHash("sha256").update(JSON.stringify({
      version: 1,
      input: { question: brief.question, since: brief.since, until: brief.until, outcomes: legacyOutcomes },
      profileHash: first.profileHash,
    })).digest("hex");
    expect(first.reductionId).toBe(legacyId);
    const legacy = { ...first, searchOutcomes: legacyOutcomes };
    await writeFile(first.resultPath, JSON.stringify(legacy));
    const bytes = await readFile(first.resultPath, "utf8");
    const options = { cwd, classifier: async () => { throw new Error("must not resolve for legacy evidence"); } };
    const replay = await reduce(brief, options);
    expect(replay.replayed).toBe(true);
    expect(replay.searchOutcomes).toEqual(legacyOutcomes);
    expect(await readFile(first.resultPath, "utf8")).toBe(bytes);
    await rm(first.resultPath);
    await expect(reduce(brief, options)).rejects.toThrow(/no automatic rerun/);
  });

  test("concurrent duplicate execution is claimed once", async () => {
    let calls = 0;
    const options = { cwd, classifier: async () => async (r: any) => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return answer(r); } };
    const results = await Promise.allSettled([reduce(input(), options), reduce(input(), options)]);
    expect(calls).toBe(2);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find(r => r.status === "rejected") as any).reason)).toContain("no automatic rerun");
  });

  test("empty field never resolves a classifier", async () => {
    const result = await reduce(input(0), { cwd, classifier: async () => { throw new Error("must not resolve"); } });
    expect(result.status).toBe("empty"); expect(result.classifierCalls).toBe(0); expect(result.usage).toBeNull();
  });

  test("failed and rejected searches remain visible alongside successful sources", async () => {
    const brief = input();
    brief.outcomes.push({ status: "fulfilled", value: search([], { status: "failed", error: "synthetic failure", reportedCostUsd: 0.01 }) }, { status: "rejected", reason: new Error("blocked") });
    const result = await reduce(brief, { cwd, classifier: async () => async r => answer(r) });
    expect(result.status).toBe("partial"); expect(result.failedSearches).toBe(2); expect(result.retained).toBe(1);
    expect(result.searchOutcomes[1].result.reportedCostUsd).toBe(0.01); expect(result.searchOutcomes[2].reason).toBe("blocked");
  });

  test("JSON-safe rejected reasons retain messages and structured diagnostics", async () => {
    const outcomes = (await Promise.allSettled([Promise.reject(new Error("blocked at boundary"))]))
      .map(o => o.status === "rejected" ? { ...o, reason: String(o.reason) } : o);
    const serialized = JSON.parse(JSON.stringify(outcomes));
    serialized.push({ status: "rejected", reason: { message: "structured failure", code: "OFFLINE" } });
    const result = await reduce({ ...input(0), outcomes: serialized }, { cwd, classifier: async () => { throw new Error("must not resolve"); } });
    expect(result.searchOutcomes[0].reason).toBe("Error: blocked at boundary");
    expect(result.searchOutcomes[1].reason).toBe("structured failure");
    expect(result.searchOutcomes[1].details).toEqual({ message: "structured failure", code: "OFFLINE" });
    expect(result.failedSearches).toBe(2);
  });

  test("classifier errors and malformed replies are unknown, not exclusions", async () => {
    let calls = 0;
    const result = await reduce(input(2), { cwd, classifier: async () => async r => {
      calls++;
      if (r.state.source.id === "s0") throw new Error("synthetic transport failure");
      return { ...answer(r), model: "wrong-model" };
    } });
    expect(calls).toBe(4); expect(result.status).toBe("partial"); expect(result.unknownPasses).toBe(4);
    expect(result.needsContextIds).toEqual(["s0", "s1"]); expect(result.rankedIds).toEqual([]);
    expect(result.items.every((i: any) => i.score === null)).toBe(true); expect(result.retained).toBe(2);
  });

  test("missing classifier yields a durable partial view without substitution", async () => {
    const result = await reduce(input(), { cwd, classifier: async () => { throw new Error("Jev unavailable"); } });
    expect(result.status).toBe("partial"); expect(result.classifierCalls).toBe(0);
    expect(result.classifierError).toBe("Jev unavailable"); expect(result.retained).toBe(1);
  });

  test("oversized source is retained without truncation or classifier calls", async () => {
    const brief = input(); (brief.outcomes[0] as any).value.sources[0].text = "x".repeat(9000);
    const result = await reduce(brief, { cwd, classifier: async () => { throw new Error("must not resolve"); } });
    expect(result.status).toBe("partial"); expect(result.classifierCalls).toBe(0);
    expect(result.items[0].source.text).toHaveLength(9000); expect(result.needsContextIds).toEqual(["s0"]);
  });

  test("cancellation stops scheduling, forwards signals, preserves partial evidence and never retries", async () => {
    const controller = new AbortController(); let calls = 0, forwarded: AbortSignal | undefined;
    const result = await reduce(input(10), { cwd, signal: controller.signal, classifier: async () => async (_r, signal) => {
      calls++; forwarded = signal;
      setTimeout(() => controller.abort(), 5);
      return await new Promise(() => {}); // deliberately uncooperative transport
    } });
    expect(calls).toBe(4); expect(forwarded?.aborted).toBe(true);
    expect(result.cancelled).toBe(true); expect(result.status).toBe("partial"); expect(result.retained).toBe(10);
    const cached = await reduce(input(10), { cwd, classifier: async () => { throw new Error("must not resolve"); } });
    expect(cached.replayed).toBe(true); expect(cached.classifierCalls).toBe(4);
  });

  test("later-chunk invalid source fails before ANY classification", async () => {
    const brief = input(16); (brief.outcomes[0] as any).value.sources[15].url = "https://user:password@example.org";
    let calls = 0;
    await expect(reduce(brief, { cwd, classifier: async () => { calls++; return async r => answer(r); } })).rejects.toThrow(/credential-free/);
    expect(calls).toBe(0);
    expect(await readdir(cwd)).toEqual([]); // unsafe references are not persisted
  });

  test("an interrupted claim without a published result never repeats paid calls", async () => {
    const first = await reduce(input(), { cwd, classifier: async () => async r => answer(r) });
    await rm(first.resultPath);
    await expect(reduce(input(), { cwd, classifier: async () => { throw new Error("must not resolve"); } })).rejects.toThrow(/no automatic rerun/);
  });

  test("invalid dates, over-limit fields and duplicate identities fail locally", () => {
    expect(() => collectSources({ ...input(), since: "2026-02-30" })).toThrow();
    expect(() => collectSources(input(61))).toThrow(/60/);
    const brief = input(); brief.outcomes.push(brief.outcomes[0]);
    expect(() => collectSources(brief)).toThrow(/unique/);
    expect(() => collectSources({ ...input(), outcomes: Array(25).fill({ status: "rejected", reason: "x" }) })).toThrow(/24/);
  });
});
