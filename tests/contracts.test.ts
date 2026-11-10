import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare, recency, review, type Brief, type Candidate, type Response } from "../src/qualification.ts";
import { normalize } from "../src/search.ts";

// Synthetic boundary inputs, not live provider captures or quality evidence.
// These tests call only local helpers; no provider CLI or classifier is invoked.
const source: Candidate = {
  id: "s1", title: "Public example", url: "https://example.org/article",
  text: "Public example text", date: "2026-11-09", kind: "search-result",
  verified: false, truncated: false, rawRef: "/private/raw.json",
};
const brief = (candidate: Candidate = source): Brief => ({
  question: "What changed?", since: "2026-11-04", until: "2026-11-11", sources: [candidate],
});
const inspection = (url?: string): NonNullable<Candidate["inspection"]> => ({
  status: "inspected", scope: "article", text: "Public inspected text", ...(url === undefined ? {} : { url }),
});
const invalidResponse: Response = {
  sourceId: "s1", pass: "ranking", startMs: 0, endMs: 1,
  result: { provider: "typesafe", model: "jev-latest", stopReason: "stop", answers: { qualification: { choice: "material" } } },
};
const rankingResponse: Response = {
  sourceId: "s1", pass: "ranking", startMs: 0, endMs: 1,
  result: {
    provider: "typesafe", model: "jev-latest", stopReason: "stop",
    answers: {
      contribution: { type: "score", score: 3, confidence: 0.8 },
      sufficiency: { type: "choice", choice: "adequate", confidence: 0.8, probabilities: { adequate: 0.8, limited: 0.1, unknown: 0.1 } },
      qualification: { type: "choice", choice: "material", confidence: 0.8, probabilities: { material: 0.8, not_observed: 0.1, insufficient_context: 0.1 } },
    },
  },
};

// Keep these tests serial: the artifact override is process-global.
describe("offline qualification contracts", () => {
  let cwd: string;
  let previousRoot: string | undefined;
  beforeEach(async () => {
    previousRoot = process.env.PI_RESEARCH_QUALIFICATION_DIR;
    cwd = await mkdtemp(join(tmpdir(), "pi-research-test-"));
    process.env.PI_RESEARCH_QUALIFICATION_DIR = join(cwd, "qualifications");
  });
  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.PI_RESEARCH_QUALIFICATION_DIR;
    else process.env.PI_RESEARCH_QUALIFICATION_DIR = previousRoot;
    await rm(cwd, { recursive: true, force: true });
  });

  for (const url of [
    "https://user:dummy-password@example.org/article",
    "https://user@example.org/article",
    "file:///private/article",
    "javascript:alert(1)",
    "https://example.org/with space",
    "https://example.org/with\nnewline",
    "not-a-url",
  ]) {
    test(`rejects unsafe inspection URL: ${JSON.stringify(url)}`, async () => {
      await expect(prepare(brief({ ...source, inspection: inspection(url) }), cwd)).rejects.toThrow();
      expect(await readdir(cwd)).toEqual([]); // Reject before persisting the supplied URL.
    });
  }

  test("preserves safe inspection URLs and defaults omitted URLs to the source", async () => {
    for (const url of ["https://example.org/inspected?edition=public#section", undefined]) {
      const batch = await prepare(brief({ ...source, inspection: inspection(url) }), cwd);
      expect(batch.requests).toHaveLength(2);
      for (const request of batch.requests) expect(request.state.source.inspection.url).toBe(url ?? source.url);
      expect((await review(batch.batchId, [], cwd)).retained).toBe(1);
    }
  });

  test("preserves original source records but excludes rawRef from both classifier requests", async () => {
    const batch = await prepare(brief(), cwd);
    expect(batch.requests.map(r => r.pass)).toEqual(["ranking", "provenance"]);
    expect(JSON.stringify(batch.requests)).not.toContain(source.rawRef);
    expect(batch.items[0].source).toEqual(source);
    const saved = JSON.parse(await readFile(join(batch.artifactDir, "prepared.json"), "utf8"));
    expect(saved.items[0].source).toEqual(source);
  });

  test("missing responses retain sources as unknown, never zero relevance", async () => {
    const batch = await prepare(brief(), cwd);
    const view = await review(batch.batchId, [], cwd);
    expect(view.needsContextIds).toEqual(["s1"]);
    expect(view.needsEvidenceIds).toEqual(["s1"]);
    expect(view.items[0].score).toBeNull();
    expect(view.retained).toBe(1);
    expect(view.excluded).toBe(0);
  });

  test("invalid answers cannot populate the material-qualification index", async () => {
    const batch = await prepare(brief(), cwd);
    const view = await review(batch.batchId, [invalidResponse], cwd);
    expect(view.materialQualificationIds).toEqual([]);
    expect(view.needsContextIds).toEqual(["s1"]);
  });

  test("valid ranking survives unknown provenance and reviews never overwrite", async () => {
    const batch = await prepare(brief(), cwd);
    const first = await review(batch.batchId, [rankingResponse], cwd);
    const original = await readFile(first.reviewPath, "utf8");
    const second = await review(batch.batchId, [rankingResponse], cwd);
    expect(first.rankedIds).toEqual(["s1"]);
    expect(first.materialQualificationIds).toEqual(["s1"]);
    expect(first.needsEvidenceIds).toEqual(["s1"]);
    expect(first.items[0].score).toBe(3);
    expect(second.reviewPath).not.toBe(first.reviewPath);
    expect(await readFile(first.reviewPath, "utf8")).toBe(original);
  });

  test("otherwise valid answers from the wrong model remain unknown", async () => {
    const batch = await prepare(brief(), cwd);
    const response = { ...rankingResponse, result: { ...rankingResponse.result, model: "unexpected-model" } };
    const view = await review(batch.batchId, [response], cwd);
    expect(view.needsContextIds).toEqual(["s1"]);
    expect(view.materialQualificationIds).toEqual([]);
  });

  test("duplicate response identities are rejected", async () => {
    const batch = await prepare(brief(), cwd);
    await expect(review(batch.batchId, [rankingResponse, rankingResponse], cwd)).rejects.toThrow(/duplicate/);
  });

  test("oversized source remains available without classification", async () => {
    const candidate = { ...source, text: "x".repeat(9000) };
    const batch = await prepare(brief(candidate), cwd);
    expect(batch.requests).toHaveLength(0);
    expect(batch.unprocessed).toHaveLength(1);
    const view = await review(batch.batchId, [], cwd);
    expect(view.items[0].source).toEqual(candidate);
    expect(view.needsContextIds).toEqual(["s1"]);
    expect(view.retained).toBe(1);
    expect(view.excluded).toBe(0);
  });

  test("changed prepared request state is rejected", async () => {
    const batch = await prepare(brief(), cwd);
    const path = join(batch.artifactDir, "prepared.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.requests[0].state.source.text = "Changed after preparation";
    await writeFile(path, JSON.stringify(saved));
    await expect(review(batch.batchId, [], cwd)).rejects.toThrow(/differs/);
  });

  test("review rejects unsafe inspection URLs even in internally consistent saved sources", async () => {
    const batch = await prepare(brief(), cwd);
    const path = join(batch.artifactDir, "prepared.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    const unsafe = inspection("https://user:dummy-password@example.org/article");
    saved.brief.sources[0].inspection = unsafe;
    saved.items[0].source.inspection = unsafe;
    for (const request of saved.requests) request.state.source.inspection = unsafe;
    await writeFile(path, JSON.stringify(saved));
    await expect(review(batch.batchId, [], cwd)).rejects.toThrow(/credential-free/);
  });
});

test("timezone-free timestamps remain ambiguous", () => {
  const result = recency("2026-11-09T12:00:00", "2026-11-04", "2026-11-11", "2026-11-10T00:00:00Z");
  expect(result.precision).toBe("timezone-unknown");
  expect(result.windowRelation).toBe("unknown");
  expect(result.ageDays).toBeNull();
});

test("search normalization rejects credential-bearing URLs", () => {
  const data = { query: {}, web: { results: [{ url: "https://user:dummy-password@example.org", title: "Example", description: "Public text" }] } };
  expect(() => normalize("brave", data, "raw.json", 5, "run")).toThrow(/credential/);
});
