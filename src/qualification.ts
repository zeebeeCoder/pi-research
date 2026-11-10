import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Source } from "./search.ts";

type Evidence = { text: string; url: string };
export type Candidate = Source & {
  inspection?: { status: "inspected" | "inaccessible" | "not-inspected"; text: string; scope: string; url?: string };
  profileEvidence?: Evidence[];
};
export type Brief = { question: string; since: string; until: string; sources: Candidate[] };
export type Response = { sourceId: string; pass: string; result: any; startMs: number; endMs: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const root = (cwd: string) => resolve(process.env.PI_RESEARCH_QUALIFICATION_DIR || join(cwd, ".artifacts/qualifications"));
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: any) => typeof v === "number" && Number.isFinite(v);
const probability = (v: any) => finite(v) && v >= 0 && v <= 1;
export function realDay(v: string) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
function publicUrl(value: string) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || /[\x00-\x20\x7f]/.test(value)) throw new Error("Expected a credential-free HTTP(S) reference.");
  return u;
}

/** Metadata calculation, never an assertion about the true event/publication date. */
export function recency(raw: string | null, since: string, until: string, asOf: string) {
  const out: any = { suppliedDate: raw, basis: "unverified provider metadata; not event date", precision: "unknown", windowRelation: "unknown", ageDays: null, future: null };
  if (!raw || !realDay(raw.slice(0, 10))) return out;
  if (realDay(raw)) {
    out.precision = "day";
    out.windowRelation = raw < since ? "before" : raw >= until ? "after" : "within";
    out.future = raw > asOf.slice(0, 10);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    out.precision = Number.isFinite(Date.parse(raw + "Z")) ? "timezone-unknown" : "unknown";
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))) {
    const t = Date.parse(raw);
    out.precision = "instant";
    out.windowRelation = t < Date.parse(since) ? "before" : t >= Date.parse(until) ? "after" : "within";
    out.ageDays = (Date.parse(asOf) - t) / 86400000;
    out.future = t > Date.parse(asOf);
  }
  return out;
}

export async function prepare(brief: Brief, cwd: string) {
  const started = performance.now();
  const profile = JSON.parse(await readFile(new URL("../profiles/qualification-v3.json", import.meta.url), "utf8"));
  if (!brief.question?.trim() || brief.question.length > 1800 || !realDay(brief.since) || !realDay(brief.until) || brief.since >= brief.until) throw new Error("Supply a question and real ordered UTC calendar bounds.");
  if (!Array.isArray(brief.sources) || brief.sources.length < 1 || brief.sources.length > profile.policy.maxSources || new Set(brief.sources.map(s => s.id)).size !== brief.sources.length) throw new Error("Expected 1–15 unique source records.");
  const batchId = randomUUID(), asOf = new Date().toISOString();
  const artifactDir = join(root(cwd), batchId);
  const requests: any[] = [], unprocessed: any[] = [];
  const items = brief.sources.map((source) => {
    const u = publicUrl(source.url);
    for (const e of source.profileEvidence ?? []) publicUrl(e.url);
    const metadata = recency(source.date, brief.since, brief.until, asOf);
    // Explicit projection: no local paths, collector conclusions, hidden session data or raw traces sent to Jev.
    const state = {
      researchQuestion: brief.question,
      window: { since: brief.since, until: brief.until, untilExclusive: true, asOf },
      source: { id: source.id, title: source.title, url: source.url, host: u.hostname, text: source.text,
        date: source.date, kind: source.kind, verified: false, truncated: source.truncated,
        inspection: source.inspection ? { status: source.inspection.status, scope: source.inspection.scope, text: source.inspection.text, url: source.inspection.url ?? source.url } : { status: "not-inspected", scope: "unknown", text: "" },
        profileEvidence: source.profileEvidence ?? [],
        originNote: "Provider-reported lead. Retrieval mediation is separate from original authorship; source URL/name alone does not authenticate identity.",
      },
      recency: metadata,
    };
    if (JSON.stringify(state).length > profile.policy.maxStateChars) unprocessed.push({ sourceId: source.id, reason: "State exceeds 8000 characters; retained without silent truncation or classification." });
    else for (const [pass, questions] of Object.entries(profile.passes)) requests.push({ sourceId: source.id, pass, state, questions });
    return { source, recency: metadata };
  });
  const batch = { batchId, artifactDir, profile, profileHash: hash(profile), asOf, brief, items, requests, unprocessed };
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await save(join(artifactDir, "prepared.json"), batch);
  return { ...batch, preparationMs: performance.now() - started };
}

export function validateAnswers(result: any, questions: any): string[] {
  if (result?.stopReason !== "stop") return ["Incomplete classifier response: " + String(result?.stopReason ?? "unprocessed")];
  const errors: string[] = [];
  if (!object(result.answers)) return ["Missing answers object"];
  if (JSON.stringify(Object.keys(result.answers).sort()) !== JSON.stringify(Object.keys(questions).sort())) errors.push("Question IDs mismatch");
  for (const [id, q] of Object.entries<any>(questions)) {
    const a = result.answers[id];
    if (a?.type !== q.type) { errors.push(id + ": type mismatch"); continue; }
    if (!probability(a.confidence)) errors.push(id + ": invalid confidence");
    if (q.type === "score") {
      if (!finite(a.score) || a.score < 0 || a.score > q.criteria.length - 1) errors.push(id + ": invalid ordinal score");
    } else {
      const labels = Object.keys(q.criteria), p = a.probabilities;
      if (!labels.includes(a.choice) || !object(p) || JSON.stringify(Object.keys(p).sort()) !== JSON.stringify([...labels].sort())) { errors.push(id + ": labels/distribution mismatch"); continue; }
      const values = labels.map(k => p[k]);
      if (!values.every(probability)) errors.push(id + ": invalid probabilities");
      else {
        if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.02) errors.push(id + ": probability sum");
        if (p[a.choice] + 1e-6 < Math.max(...values)) errors.push(id + ": choice/probability disagreement");
      }
    }
  }
  if (result.answers.contribution?.score === 0 && result.answers.qualification?.choice === "material") errors.push("Zero contribution conflicts with material qualification");
  return errors;
}

/** Re-usable verification over saved real responses; never invokes a model. */
export async function review(batchId: string, responses: Response[], cwd: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId)) throw new Error("Invalid batch ID.");
  const artifactDir = join(root(cwd), batchId);
  const batch = JSON.parse(await readFile(join(artifactDir, "prepared.json"), "utf8"));
  if (batch.batchId !== batchId || hash(batch.profile) !== batch.profileHash) throw new Error("Prepared profile identity/hash mismatch.");
  const expected = new Set(batch.requests.map((r: any) => JSON.stringify([r.sourceId, r.pass])));
  const byKey = new Map<string, Response>();
  if (!Array.isArray(responses) || responses.length > batch.profile.policy.maxCalls) throw new Error("Response count outside frozen bound.");
  for (const r of responses) {
    const key = JSON.stringify([r.sourceId, r.pass]);
    if (!expected.has(key) || byKey.has(key)) throw new Error("Unexpected or duplicate response identity.");
    if (!finite(r.startMs) || !finite(r.endMs) || r.endMs < r.startMs) throw new Error("Invalid response timing.");
    byKey.set(key, r);
  }
  const items = batch.items.map((item: any, index: number) => {
    const assessments: any = {};
    for (const [pass, questions] of Object.entries(batch.profile.passes)) {
      const response = byKey.get(JSON.stringify([item.source.id, pass]));
      const errors = validateAnswers(response?.result, questions);
      if (response && (response.result?.provider !== batch.profile.model.provider || response.result?.model !== batch.profile.model.id)) errors.push("Unexpected classifier provider/model");
      assessments[pass] = { status: errors.length ? "unknown" : "valid", errors, result: response?.result ?? null };
    }
    const rank = assessments.ranking, prov = assessments.provenance;
    const a = rank.result?.answers, p = prov.result?.answers;
    const needsContext = rank.status !== "valid" || a?.sufficiency?.choice === "unknown" || a?.qualification?.choice === "insufficient_context";
    const needsEvidence = prov.status !== "valid" || p?.authenticity?.choice === "unknown" || p?.sourceCredibility?.choice === "unknown" || item.recency.windowRelation === "unknown";
    return { ...item, index, assessments, score: rank.status === "valid" ? a.contribution.score : null, needsContext, needsEvidence };
  });
  const rankedIds = items.filter((r: any) => !r.needsContext).sort((a: any, b: any) => b.score - a.score || a.index - b.index).map((r: any) => r.source.id);
  const needsContextIds = items.filter((r: any) => r.needsContext).map((r: any) => r.source.id);
  if (new Set([...rankedIds, ...needsContextIds]).size !== batch.items.length) throw new Error("Source preservation invariant failed.");
  const result = { batchId, artifactDir, profileVersion: batch.profile.version, profileHash: batch.profileHash,
    items, rankedIds, needsContextIds,
    needsEvidenceIds: items.filter((r: any) => r.needsEvidence).map((r: any) => r.source.id),
    materialQualificationIds: items.filter((r: any) => r.assessments.ranking.result?.answers?.qualification?.choice === "material").map((r: any) => r.source.id),
    concernIds: items.filter((r: any) => Object.values<any>(r.assessments.provenance.result?.answers ?? {}).some(a => a.choice === "concern")).map((r: any) => r.source.id),
    retained: items.length, excluded: 0, responseCount: responses.length, expectedResponses: batch.requests.length,
    interpretation: "Advisory judgments, not verified truth/identity. Unknown source evidence does not erase comparable topic scores. All source material retained; no automatic exclusion or weighted credibility score.",
  };
  const reviewPath = join(artifactDir, `review-${randomUUID()}.json`);
  await save(reviewPath, { ...result, responses });
  return { ...result, reviewPath };
}
