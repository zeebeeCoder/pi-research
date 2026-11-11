import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefingLimits, compactReduction, getSources, urlKey } from "../src/briefing.ts";

const id = "a".repeat(64);
function fixture(count = 20) {
  const items = Array.from({ length: count }, (_, n) => ({
    source: { id: `s${n}`, title: `Title ${n}`, url: `https://example.org/${n}`, text: `SAVED SNIPPET ${n}`, date: "2026-11-11", kind: "search-result", verified: false, truncated: false, rawRef: `/private/raw.json#/${n}` },
    score: 4, needsContext: false, needsEvidence: true,
    assessments: {
      ranking: { status: "valid", result: { answers: { sufficiency: { choice: "limited", probabilities: { limited: 1 } }, qualification: { choice: "material" } } } },
      provenance: { status: "valid", result: { answers: { authenticity: { choice: "unknown" } } } },
    },
  }));
  return { reductionId: id, resultPath: "/private/result.json", status: "completed", replayed: false, items, rankedIds: items.map(i => i.source.id),
    retained: count, excluded: 0, searchOutcomes: [{ index: 0, status: "fulfilled", result: { provider: "brave", status: "completed", sources: items.map(i => i.source), omitted: 0, reportedCostUsd: null, error: null, providerMeta: { integrationDiagnostics: { schemaWarning: "Native warning", diagnosticError: null, privateTrace: "DO NOT EMIT" } } } }],
    classifierCalls: count * 2, unknownPasses: 0, classifierError: null, cancelled: false, usage: null, usageResponses: 0, elapsedMs: 1 };
}

describe("compact discovery boundary", () => {
  let cwd: string, previous: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "research-briefing-"));
    previous = process.env.PI_RESEARCH_REDUCTION_DIR;
    process.env.PI_RESEARCH_REDUCTION_DIR = join(cwd, "reductions");
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.PI_RESEARCH_REDUCTION_DIR;
    else process.env.PI_RESEARCH_REDUCTION_DIR = previous;
    await rm(cwd, { recursive: true, force: true });
  });
  async function save(result: any) {
    const root = join(process.env.PI_RESEARCH_REDUCTION_DIR!, id);
    await mkdir(root, { recursive: true });
    const path = join(root, "result.json");
    await writeFile(path, JSON.stringify(result)); return path;
  }

  test("printing the whole public reduction cannot dump records/distributions", () => {
    const original = fixture(60), before = JSON.stringify(original), brief = compactReduction(original), text = JSON.stringify(brief);
    expect(brief.queue).toHaveLength(12); expect(brief.queueTotal).toBe(60); expect(brief.nextOffset).toBe(12);
    expect(text.length).toBeLessThanOrEqual(briefingLimits.outputChars);
    for (const forbidden of ["SAVED SNIPPET", "probabilities", "assessments", "searchOutcomes", "DO NOT EMIT"]) expect(text).not.toContain(forbidden);
    expect(JSON.stringify(original)).toBe(before);
    expect(brief.signals.limitedContext).toBe(60); expect(brief.signals.needsContext).toBe(0);
    expect(brief.warnings.some(w => w.includes("does not discriminate"))).toBe(true);
    expect(brief.searches[0].diagnostics.schemaWarning).toBe("Native warning");
  });

  test("unknown and concern signals survive independently of ranking", () => {
    const result = fixture(2);
    result.items[0].needsContext = true; result.items[0].assessments.ranking.status = "unknown";
    result.items[1].assessments.provenance.result.answers.authenticity.choice = "concern";
    result.rankedIds = ["s1"];
    const brief = compactReduction(result);
    expect(brief.queue.map(r => r.id)).toEqual(["s1", "s0"]);
    expect(brief.signals.needsContext).toBe(1); expect(brief.signals.concerns).toBe(1);
    expect(brief.queue[1].context).toBe("unknown");
  });

  test("per-source insufficient context and unknown provenance survive compact projection", async () => {
    const result = fixture(2);
    result.items[0].needsContext = true;
    result.items[0].assessments.ranking.result.answers.sufficiency.choice = "adequate";
    result.items[0].assessments.ranking.result.answers.qualification.choice = "insufficient_context";
    result.items[0].assessments.provenance.status = "unknown";
    result.rankedIds = ["s1"];
    const row = compactReduction(result).queue.find(r => r.id === "s0")!;
    expect(row.context).toBe("adequate"); expect(row.needsContext).toBe(true);
    expect(row.qualification).toBe("insufficient_context"); expect(row.provenanceStatus).toBe("unknown");
    expect(row.authenticity).toBe("unknown");
    await save(result);
    expect((await getSources({ reductionId: id, ids: ["s0"] }, cwd)).records[0].needsContext).toBe(true);
  });

  test("title, URL and excerpt truncation never split surrogate pairs", async () => {
    const result = fixture(1), s = result.items[0].source;
    s.title = "a".repeat(239) + "😀";
    s.url = "https://example.org/" + "a".repeat(2028) + "😀";
    s.text = "a".repeat(2999) + "😀";
    const row = compactReduction(result).queue[0];
    expect(row.title!.isWellFormed()).toBe(true); expect(row.url!.isWellFormed()).toBe(true);
    await save(result);
    const record = (await getSources({ reductionId: id, ids: ["s0"] }, cwd)).records[0];
    expect(record.excerpt.isWellFormed()).toBe(true); expect(record.excerpt.length).toBeLessThanOrEqual(3000);
    expect(record.excerptTruncated).toBe(true);
  });

  test("URL groups retain duplicates and do not erase semantic parameters", () => {
    const result = fixture(3);
    result.items[0].source.url = "https://example.org/story?utm_source=web#one";
    result.items[1].source.url = "https://example.org/story#two";
    result.items[2].source.url = "https://example.org/story?version=2";
    const brief = compactReduction(result);
    expect(brief.retained).toBe(3); expect(brief.coverage.urlGroups).toBe(2);
    expect(brief.coverage.duplicateRecords).toBe(1); expect(brief.queue[1].duplicateOf).toBe("s0");
    expect(urlKey("https://example.org/?ref=edition")).not.toBe(urlKey("https://example.org/"));
  });

  test("failed/rejected outcomes and unknown costs remain visible", () => {
    const result: any = fixture(0);
    result.searchOutcomes.push({ index: 1, status: "rejected", reason: "blocked" });
    result.searchOutcomes[0].result.status = "failed"; result.searchOutcomes[0].result.error = "provider failed";
    const brief = compactReduction(result);
    expect(brief.searches[0].error).toBe("provider failed"); expect(brief.searches[1].error).toBe("blocked");
    expect(brief.searches[0].reportedCostUsd).toBeNull(); expect(brief.queue).toEqual([]);
  });

  test("coverage describes actual URL kinds, not provider intent", () => {
    const result = fixture(4);
    result.items[0].source.url = "https://x.com/person/status/123";
    result.items[1].source.url = "https://youtu.be/video123";
    result.items[2].source.url = "https://www.youtube.com/watch?v=video456";
    result.items[3].source.url = "https://www.youtube.com/@channel";
    expect(compactReduction(result).coverage.leadTypes).toEqual({ xPosts: 1, youtubeVideos: 2, other: 1 });
  });

  test("maximum outcome errors and diagnostics still fit the output ceiling", () => {
    const result: any = fixture(60), sample = result.searchOutcomes[0];
    sample.result.error = "error".repeat(3000);
    sample.result.providerMeta.integrationDiagnostics.schemaWarning = "warning".repeat(3000);
    sample.result.providerMeta.integrationDiagnostics.diagnosticError = "diagnostic".repeat(3000);
    result.searchOutcomes = Array.from({ length: 24 }, (_, index) => ({ ...sample, index }));
    expect(JSON.stringify(compactReduction(result)).length).toBeLessThanOrEqual(24000);
  });

  test("large titles/URLs reduce queue size rather than overflow context", () => {
    const result = fixture(60);
    result.items.forEach(i => { i.source.title = "t".repeat(5000); i.source.url += "?q=" + "a".repeat(6000); });
    const brief = compactReduction(result);
    expect(JSON.stringify(brief).length).toBeLessThanOrEqual(24000);
    expect(brief.queue.length).toBeLessThan(12); expect(brief.queue[0].urlTruncated).toBe(true);
    expect(brief.nextOffset).toBe(brief.queue.length);
  });

  test("explicit local retrieval is bounded, paginated, immutable and distribution-free", async () => {
    const original = fixture(20); original.items[1].source.text = "x".repeat(9000);
    const path = await save(original), before = await readFile(path, "utf8");
    const page = await getSources({ reductionId: id }, cwd);
    expect(page.records).toHaveLength(5); expect(page.nextOffset).toBe(5);
    expect(page.records[1].excerpt).toHaveLength(3000); expect(page.records[1].excerptTruncated).toBe(true);
    expect(page.records[1].providerTruncated).toBe(false);
    expect(page.records[1].evidenceStage).toBe("discovery");
    expect(JSON.stringify(page)).not.toContain("probabilities");
    const selected = await getSources({ reductionId: id, ids: ["s19", "s0"] }, cwd);
    expect(selected.records.map(r => r.id)).toEqual(["s19", "s0"]); expect(selected.nextOffset).toBeNull();
    expect((await getSources({ reductionId: id, offset: 18 }, cwd)).records).toHaveLength(2);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  test("rejects traversal, ambiguous selection, unknown IDs, excess records and cancellation", async () => {
    await save(fixture());
    for (const params of [
      { reductionId: "../escape" }, { reductionId: id, limit: 6 }, { reductionId: id, offset: -1 },
      { reductionId: id, ids: ["s0"], offset: 0 }, { reductionId: id, ids: ["missing"] },
      { reductionId: id, ids: ["s0", "s0"] }, { reductionId: id, ids: [] },
    ]) await expect(getSources(params, cwd)).rejects.toThrow();
    await expect(getSources({ reductionId: id }, cwd, AbortSignal.abort())).rejects.toThrow();
    const tampered = fixture(); tampered.reductionId = "b".repeat(64); await save(tampered);
    await expect(getSources({ reductionId: id }, cwd)).rejects.toThrow(/identity/);
  });
});
