import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const briefingLimits = { queue: 12, records: 5, excerptChars: 3000, outputChars: 24_000 } as const;
function clipped(value: unknown, max = 200) {
  if (typeof value !== "string") return null;
  const text = value.slice(0, max);
  // Keep the JSON/code-unit ceiling without splitting a UTF-16 surrogate pair.
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

/** Conservative URL grouping, not a claim of independent authorship or syndication. */
export function urlKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["gclid", "fbclid"].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}
function ordered(result: any): any[] {
  const byId = new Map<string, any>(result.items.map((i: any) => [i.source.id, i]));
  const ids = [...new Set<string>([...result.rankedIds, ...result.items.map((i: any) => i.source.id)])];
  return ids.map(id => byId.get(id)).filter(Boolean);
}
function flags(item: any) {
  const ranking = item.assessments.ranking;
  const answers = ranking.status === "valid" ? ranking.result?.answers : undefined;
  const provenance = item.assessments.provenance;
  return {
    context: answers?.sufficiency?.choice ?? "unknown",
    needsContext: item.needsContext,
    qualification: answers?.qualification?.choice ?? "unknown",
    rankingStatus: ranking.status,
    provenanceStatus: provenance.status,
    authenticity: provenance.status === "valid" ? provenance.result?.answers?.authenticity?.choice ?? "unknown" : "unknown",
    sourceCredibility: provenance.status === "valid" ? provenance.result?.answers?.sourceCredibility?.choice ?? "unknown" : "unknown",
    needsEvidence: item.needsEvidence,
    materialQualification: answers?.qualification?.choice === "material",
    concern: provenance.status === "valid" && Object.values<any>(provenance.result?.answers ?? {}).some(a => a.choice === "concern"),
  };
}
function row(item: any, duplicateOf: string | null = null) {
  return {
    id: item.source.id, title: clipped(item.source.title, 240), url: clipped(item.source.url, 2048),
    urlTruncated: item.source.url.length > 2048, score: item.score, kind: item.source.kind,
    ...flags(item), duplicateOf,
  };
}
function bounded<T>(result: T): T {
  if (JSON.stringify(result).length > briefingLimits.outputChars) throw new Error("Response exceeds compact output budget; request fewer source IDs or a smaller limit. Full evidence remains saved.");
  return result;
}

/** Model-facing projection. Never include full source records or classifier distributions. */
export function compactReduction(result: any) {
  const items = ordered(result), firstByUrl = new Map<string, string>();
  const rows = items.map(item => {
    const key = urlKey(item.source.url), duplicateOf = firstByUrl.get(key) ?? null;
    if (!duplicateOf) firstByUrl.set(key, item.source.id);
    return row(item, duplicateOf);
  });
  const queue = rows.slice(0, briefingLimits.queue);
  const leadTypes = { xPosts: 0, youtubeVideos: 0, other: 0 };
  for (const item of items) {
    const u = new URL(item.source.url), host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (["x.com", "twitter.com", "mobile.twitter.com"].includes(host) && /\/status\/\d+/.test(u.pathname)) leadTypes.xPosts++;
    else if ((host === "youtu.be" && u.pathname.length > 1) || (["youtube.com", "m.youtube.com"].includes(host) && ((u.pathname === "/watch" && u.searchParams.has("v")) || /^\/(shorts|live)\/.+/.test(u.pathname)))) leadTypes.youtubeVideos++;
    else leadTypes.other++;
  }
  const signals = {
    needsContext: items.filter(i => i.needsContext).length,
    limitedContext: rows.filter(r => r.context === "limited").length,
    needsEvidence: rows.filter(r => r.needsEvidence).length,
    materialQualification: rows.filter(r => r.materialQualification).length,
    concerns: rows.filter(r => r.concern).length,
  };
  const searches = result.searchOutcomes.map((o: any) => {
    if (o.status === "rejected") return { index: o.index, provider: null, status: "rejected", sources: 0, error: clipped(o.reason), omitted: 0, reportedCostUsd: null, diagnostics: null };
    const r = o.result, d = r.providerMeta?.integrationDiagnostics;
    return { index: o.index, provider: r.provider, status: r.status, sources: r.sources.length,
      error: clipped(r.error), omitted: r.omitted, reportedCostUsd: r.reportedCostUsd,
      diagnostics: d ? { schemaWarning: clipped(d.schemaWarning, 160), diagnosticError: clipped(d.diagnosticError, 160) } : null };
  });
  const summary = {
    kind: "leads" as const, reductionId: result.reductionId, status: result.status, replayed: result.replayed,
    evidenceStage: "discovery" as const, retained: result.retained, excluded: result.excluded,
    queue, queueTotal: rows.length, nextOffset: rows.length > queue.length ? queue.length : null,
    signals, coverage: { providers: [...new Set(searches.map((s: any) => s.provider).filter(Boolean))],
      urlGroups: firstByUrl.size, duplicateRecords: rows.length - firstByUrl.size, leadTypes,
      groupingBasis: "Exact URL except fragment and utm_*/gclid/fbclid. Not independent-origin verification; other query parameters remain distinct." },
    searches, classifierCalls: result.classifierCalls, unknownPasses: result.unknownPasses,
    classifierError: clipped(result.classifierError), cancelled: result.cancelled,
    usage: result.usage, usageResponses: result.usageResponses, elapsedMs: result.elapsedMs,
    resultPath: result.resultPath,
    warnings: ["Discovery-stage signals, not verified facts. Full records and distributions remain in the artifact.",
      ...(rows.length > 1 && signals.materialQualification === rows.length ? ["Every source was flagged as a material qualification; this signal does not discriminate within this field. Inspect evidence, not confidence alone."] : [])],
    nextAction: "Retrieve selected snippets with research_sources; provide a snippet-based briefing and propose deeper inspection. Browser/video inspection requires an explicit depth request or approval.",
  };
  // Keep valid URL/title entries intact rather than returning an oversized response.
  while (JSON.stringify(summary).length > briefingLimits.outputChars && queue.length) {
    queue.pop(); summary.nextOffset = queue.length;
  }
  return bounded(summary);
}

export type SourceRequest = { reductionId: string; ids?: string[]; offset?: number; limit?: number };
/** Local-only bounded source access. No fetching, classification or mutation. */
export async function getSources(request: SourceRequest, cwd: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(request.reductionId)) throw new Error("Invalid reduction ID.");
  const limit = request.limit ?? briefingLimits.records, offset = request.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > briefingLimits.records || !Number.isInteger(offset) || offset < 0) throw new Error("Use a nonnegative offset and limit 1–5.");
  if (request.ids && (request.offset !== undefined || request.limit !== undefined)) throw new Error("Select by IDs OR pagination, not both.");
  if (request.ids && (!request.ids.length || request.ids.length > briefingLimits.records || new Set(request.ids).size !== request.ids.length)) throw new Error("Supply 1–5 unique source IDs.");
  const root = resolve(process.env.PI_RESEARCH_REDUCTION_DIR || join(cwd, ".artifacts/reductions"));
  const resultPath = join(root, request.reductionId, "result.json");
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  signal?.throwIfAborted();
  if (result.reductionId !== request.reductionId) throw new Error("Saved reduction identity mismatch.");
  const items = ordered(result), byId = new Map(items.map(i => [i.source.id, i]));
  const selected = request.ids ? request.ids.map(id => {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown source ID: ${id}`);
    return item;
  }) : items.slice(offset, offset + limit);
  const firstByUrl = new Map<string, string>();
  for (const item of items) {
    const key = urlKey(item.source.url);
    if (!firstByUrl.has(key)) firstByUrl.set(key, item.source.id);
  }
  const records = selected.map(item => ({
    ...row(item, firstByUrl.get(urlKey(item.source.url)) === item.source.id ? null : firstByUrl.get(urlKey(item.source.url))!), date: clipped(item.source.date, 100), verified: false,
    excerpt: clipped(item.source.text, briefingLimits.excerptChars)!,
    providerTruncated: item.source.truncated,
    excerptTruncated: item.source.text.length > briefingLimits.excerptChars,
    rawRef: clipped(item.source.rawRef, 2048),
    evidenceStage: "discovery", // never claim that later inspection updated this snapshot
  }));
  return bounded({ kind: "leads" as const, reductionId: request.reductionId, resultPath, records, total: items.length,
    nextOffset: request.ids || offset + selected.length >= items.length ? null : offset + selected.length,
    interpretation: "Saved discovery snippets only. No original-page inspection or classifier distributions. Truncated URLs must be retrieved from the artifact before navigation. Later inspected evidence belongs in a separate source-linked register." });
}
