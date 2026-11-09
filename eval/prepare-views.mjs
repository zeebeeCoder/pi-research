#!/usr/bin/env node
// Evaluation-only transformation over the actual captured corpus. No API calls.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../.artifacts/nvidia-eval-2026-11-09');
const read = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
const save = async (name, value) => {
  const path = join(root, name);
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  // Do not silently overwrite an evaluation view that a child may have consumed.
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
};
const corpus = await read('corpus.json');
const profile = await read('screening-profile.json');
const classification = await read('classifier-results.json');
assert.equal(classification.profileVersion, profile.version);
assert.ok(corpus.sources.length <= profile.policy.maxCalls);
assert.equal(classification.outcomes.length, corpus.sources.length);
const byId = new Map(classification.outcomes.map(o => [o.id, o]));
assert.equal(byId.size, corpus.sources.length);
const rank = new Map(profile.policy.rank.map((label, i) => [label, i]));
const rows = corpus.sources.map((source, index) => {
  const assessment = byId.get(source.id);
  assert.ok(assessment, `Missing assessment ${source.id}`);
  const contribution = assessment.result?.answers?.contribution?.choice;
  const qualification = assessment.result?.answers?.qualification?.choice;
  const unknown = assessment.status !== 'valid' || contribution === 'insufficient_context' || qualification === 'insufficient_context';
  return { source, index, contribution, qualification, unknown, rank: rank.get(contribution) ?? 99 };
});
const ordered = [...rows].sort((a, b) => a.rank - b.rank || a.index - b.index);
const top = new Set(ordered.slice(0, profile.policy.baseTopK).map(r => r.source.id));
const kept = ordered.filter(r => top.has(r.source.id) || r.unknown || r.qualification === 'material');
const keptIds = new Set(kept.map(r => r.source.id));
const omitted = rows.filter(r => !keptIds.has(r.source.id));
for (const row of rows) await save(`sources/source-${row.index + 1}.json`, row.source);
const common = {
  question: profile.researchQuestion,
  utcWindow: { ...corpus.utcWindow, note: 'Experiment-chosen calendar envelope, not an exact rolling-seven-day filter. Dates/provider metadata require inspection.' },
  limitations: corpus.inspectionSummary.limitations,
};
const baseline = { ...common, sources: corpus.sources, additionalSources: [] };
const reduced = { ...common, sources: kept.map(r => r.source), additionalSources: omitted.map(r => ({ id: r.source.id, title: r.source.title, url: r.source.url, path: join(root, `sources/source-${r.index + 1}.json`) })) };
await save('arms/copper/input.json', baseline);
await save('arms/silver/input.json', reduced);
const asText = obj => JSON.stringify(obj, null, 2) + '\n';
const metrics = {
  createdAt: new Date().toISOString(),
  armMapping: { copper: 'baseline', silver: 'Jev-ranked/reduced view' },
  profileSha256: createHash('sha256').update(await readFile(join(root, 'screening-profile.json'))).digest('hex'),
  candidates: rows.length, selected: kept.length, omitted: omitted.length,
  unknown: rows.filter(r => r.unknown).length,
  materialQualifications: rows.filter(r => r.qualification === 'material').length,
  selectedIds: kept.map(r => r.source.id), omittedIds: omitted.map(r => r.source.id),
  baselineBytes: Buffer.byteLength(asText(baseline)), reducedBytes: Buffer.byteLength(asText(reduced)),
  baselineCharacters: asText(baseline).length, reducedCharacters: asText(reduced).length,
  sourceOrderChanged: JSON.stringify(corpus.sources.map(s => s.id)) !== JSON.stringify(kept.map(r => r.source.id)),
  selectionReasons: kept.map(r => ({ id: r.source.id, topK: top.has(r.source.id), materialQualification: r.qualification === 'material', unknown: r.unknown })),
  note: kept.length === rows.length ? 'No pruning occurred. Any arm difference is ordering/stochastic variation, not evidence of compression improvement.' : 'Initial exposure differs; omitted material remains retrievable.',
};
await save('selection.json', metrics);
console.log(JSON.stringify(metrics, null, 2));
