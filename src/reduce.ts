import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { SearchResult } from "./search.ts";
import { resultKind } from "./results.ts";
import { prepare, realDay, review, validatePublicReferences, type Candidate, type Response } from "./qualification.ts";

export type ReduceInput = {
  question: string; since: string; until: string;
  outcomes: PromiseSettledResult<SearchResult>[];
};
export type Classify = (request: { state: any; questions: any }, signal: AbortSignal) => Promise<any>;
export type ReduceOptions = {
  cwd: string; signal?: AbortSignal;
  // Resolved lazily: empty input and cached results require no model/auth access.
  classifier: () => Promise<Classify>;
};
export const reductionLimits = { outcomes: 24, sources: 60, concurrency: 4, requestTimeoutMs: 30_000 } as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const save = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const message = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Unspecified failure").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 800);

/** Collect already-normalized records; never rewrite content or promote failed output. */
export function collectSources(input: ReduceInput) {
  if (!input.question?.trim() || input.question.length > 1800 || !realDay(input.since) || !realDay(input.until) || input.since >= input.until) throw new Error("Supply a question and ordered real UTC bounds.");
  if (!Array.isArray(input.outcomes) || input.outcomes.length > reductionLimits.outcomes) throw new Error("At most 24 search outcomes per reduction.");
  const sources: Candidate[] = [], ids = new Set<string>();
  const outcomes = input.outcomes.map((outcome, index) => {
    if (outcome.status === "rejected") return {
      index, status: "rejected" as const, reason: message(outcome.reason),
      ...(outcome.reason && typeof outcome.reason === "object" && !(outcome.reason instanceof Error) ? { details: outcome.reason } : {}),
    };
    if (outcome.status !== "fulfilled") throw new Error("Expected Promise.allSettled search outcomes.");
    const result = outcome.value;
    if (resultKind(result) !== "leads") throw new Error("Qualification accepts leads only; keep evidence separate for interpretation.");
    if (!["completed", "empty", "failed"].includes(result.status) || !Array.isArray(result.sources)) throw new Error("Expected normalized search results, not a routing tag alone.");
    if (result.status === "failed" && result.sources.length) throw new Error("Failed search cannot supply usable sources.");
    for (const source of result.sources) {
      if (!source || typeof source.id !== "string" || !source.id || ids.has(source.id)) throw new Error("Source IDs must be nonempty and unique across outcomes.");
      if (source.verified !== false || typeof source.text !== "string" || typeof source.title !== "string" || typeof source.url !== "string" || typeof source.rawRef !== "string" || typeof source.truncated !== "boolean" || !["search-result", "model-extracted-lead"].includes(source.kind) || !(source.date === null || typeof source.date === "string")) throw new Error("Expected normalized, unverified source records.");
      validatePublicReferences(source);
      ids.add(source.id); sources.push(source);
    }
    return { index, status: "fulfilled" as const, result };
  });
  if (sources.length > reductionLimits.sources) throw new Error("At most 60 sources per reduction; no sources were classified or discarded.");
  const failedSearches = outcomes.filter(o => o.status === "rejected" || o.result?.status === "failed").length;
  return { sources, outcomes, failedSearches };
}

function addUsage(total: Usage | null, usage: Usage | undefined): Usage | null {
  if (!usage) return total;
  const next: Usage = total ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) next[key] += usage[key] ?? 0;
  for (const key of ["reasoning", "cacheWrite1h"] as const) if (usage[key] !== undefined) next[key] = (next[key] ?? 0) + usage[key]!;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) next.cost[key] += usage.cost?.[key] ?? 0;
  return next;
}

class ClassifierInterrupted extends Error {}

/** One attempt with cancellation/deadline; never schedule a retry after uncertain completion. */
async function classifyOnce(classify: Classify, request: { state: any; questions: any }, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, reductionLimits.requestTimeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([
      classify(request, controller.signal),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new ClassifierInterrupted("Classifier cancelled or timed out; remote billing may continue. No retry."));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

/** Search outcomes → static per-source Jev requests → validated, lossless ranked view.
 * Content-addressed directory is an atomic execution claim. Same input replays the
 * durable result; interrupted runs never silently rerun paid requests.
 */
export async function reduce(input: ReduceInput, options: ReduceOptions) {
  options.signal?.throwIfAborted();
  const collected = collectSources(input);
  const profile = JSON.parse(await readFile(new URL("../profiles/qualification-v3.json", import.meta.url), "utf8"));
  const profileHash = hash(profile);
  const preservedInput = { question: input.question, since: input.since, until: input.until, outcomes: collected.outcomes };
  // The routing tag is not new evidence. Keep pre-tag cache/claim identities so
  // upgrading the contract cannot silently repeat previously attempted paid work.
  const identityInput = { ...preservedInput, outcomes: collected.outcomes.map(outcome => {
    if (outcome.status === "rejected") return outcome;
    const { kind: _routingKind, ...result } = outcome.result;
    return { ...outcome, result };
  }) };
  const reductionId = hash({ version: 1, input: identityInput, profileHash });
  const root = resolve(process.env.PI_RESEARCH_REDUCTION_DIR || join(options.cwd, ".artifacts/reductions"));
  const artifactDir = join(root, reductionId), resultPath = join(artifactDir, "result.json");
  await mkdir(root, { recursive: true, mode: 0o700 });
  try { await mkdir(artifactDir, { mode: 0o700 }); }
  catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    try {
      const cached = JSON.parse(await readFile(resultPath, "utf8"));
      if (cached.reductionId !== reductionId || cached.profileHash !== profileHash) throw new Error("Saved reduction identity mismatch.");
      return { ...cached, replayed: true };
    } catch (cause: any) {
      if (cause.code !== "ENOENT") throw cause;
      throw new Error(`Reduction already started or interrupted; no automatic rerun. Inspect ${artifactDir}`);
    }
  }
  const started = performance.now();
  await save(join(artifactDir, "input.json"), preservedInput);
  const artifactRoot = join(artifactDir, "batches");
  const batches: Awaited<ReturnType<typeof prepare>>[] = [];
  // Validate and prepare ALL chunks before any paid calls. Larger fields use the
  // same frozen per-source template, not hand-written batch-specific questions.
  for (let offset = 0; offset < collected.sources.length; offset += profile.policy.maxSources) {
    batches.push(await prepare({ question: input.question, since: input.since, until: input.until, sources: collected.sources.slice(offset, offset + profile.policy.maxSources) }, options.cwd, { artifactRoot }));
  }
  if (batches.some(b => b.profileHash !== profileHash)) throw new Error("Qualification profile changed during preparation; no classifier calls made.");
  const requests = batches.flatMap((batch, batchIndex) => batch.requests.map(request => ({ ...request, batchIndex })));
  const responses: Response[][] = batches.map(() => []);
  let classify: Classify | undefined, classifierError: string | null = null;
  if (requests.length && !options.signal?.aborted) {
    try { classify = await options.classifier(); }
    catch (error) { classifierError = message(error); }
  }
  let cursor = 0, calls = 0, usage: Usage | null = null, usageResponses = 0;
  let storageFailed = false, interrupted = false;
  async function worker() {
    while (classify && !storageFailed && !interrupted && !options.signal?.aborted && cursor < requests.length) {
      const requestIndex = cursor++, request = requests[requestIndex], startMs = Date.now();
      let result: any;
      calls++;
      try { result = await classifyOnce(classify, { state: request.state, questions: request.questions }, options.signal); }
      catch (error) {
        if (error instanceof ClassifierInterrupted) { interrupted = true; classifierError = message(error); }
        result = { provider: profile.model.provider, model: profile.model.id, stopReason: "error", answers: {}, errorMessage: message(error) };
      }
      const response = { sourceId: request.sourceId, pass: request.pass, result, startMs, endMs: Date.now() };
      responses[request.batchIndex].push(response);
      if (result?.usage) { usage = addUsage(usage, result.usage); usageResponses++; }
      try { await save(join(artifactDir, `response-${requestIndex}.json`), response); }
      catch (error) { storageFailed = true; throw error; }
    }
  }
  const workers = await Promise.allSettled(Array.from({ length: Math.min(reductionLimits.concurrency, requests.length) }, worker));
  const failure = workers.find(w => w.status === "rejected");
  if (failure?.status === "rejected") throw new Error(`Cannot preserve classifier evidence; execution stopped, no automatic retry. ${message(failure.reason)} Artifacts: ${artifactDir}`);
  const views = [];
  for (let index = 0; index < batches.length; index++) views.push(await review(batches[index].batchId, responses[index], options.cwd, { artifactRoot }));
  const items = views.flatMap(v => v.items).map((item, index) => ({ ...item, index }));
  const rankedIds = items.filter(i => !i.needsContext).sort((a, b) => b.score - a.score || a.index - b.index).map(i => i.source.id);
  const unknownPasses = items.reduce((n, i) => n + Object.values<any>(i.assessments).filter(a => a.status !== "valid").length, 0);
  const status = collected.failedSearches || unknownPasses || options.signal?.aborted || classifierError ? "partial" : items.length ? "completed" : "empty";
  const result = {
    reductionId, artifactDir, resultPath, profileHash, profileVersion: profile.version,
    status, replayed: false, items, rankedIds,
    needsContextIds: views.flatMap(v => v.needsContextIds), needsEvidenceIds: views.flatMap(v => v.needsEvidenceIds),
    materialQualificationIds: views.flatMap(v => v.materialQualificationIds), concernIds: views.flatMap(v => v.concernIds),
    retained: items.length, excluded: 0, failedSearches: collected.failedSearches,
    searchOutcomes: collected.outcomes, classifierCalls: calls, expectedResponses: requests.length,
    unknownPasses, classifierError, cancelled: options.signal?.aborted ?? false,
    usage, usageResponses, elapsedMs: Math.round(performance.now() - started),
    batches: views.map(v => ({ batchId: v.batchId, reviewPath: v.reviewPath })),
    interpretation: "Rank-only reduction; all original sources retained. Advisory Jev judgments, not truth or authenticated credibility. Usage cost is a reported/catalog estimate, not verified billing. Remote work may continue after cancellation. No retries or fallback.",
  };
  // Atomic publication: concurrent replays cannot observe a partially written result.
  await save(join(artifactDir, "result.pending.json"), result);
  await rename(join(artifactDir, "result.pending.json"), resultPath);
  return result;
}
