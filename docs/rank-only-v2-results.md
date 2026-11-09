# Jev rank-only v2 — 2026-11-09

**Promising ordering result, not proven synthesis improvement.** A finer ordinal
rubric brought the three pre-existing reference anchors to the first three
positions, without excluding any material. This is an in-sample pilot, not a
holdout or human-effort measurement.

## What ran

- Same ten public source records/states from the prior live Nvidia corpus; no
  fresh searches, page reads, synthesis children, model substitutions or retries.
- `eval/ranking-profile-v2.json` was frozen and committed before classification.
- Three questions: contribution score (expected ordinal index0–4), context
  sufficiency, and material qualification/counterevidence. Confidence is separate;
  neither score nor confidence is factual truth or calibrated credibility.
- Validate types/IDs, finite score/confidence/probabilities, expected labels and
  distributions, and obvious contradictions. Errors/unknowns have a separate
  visible lane; no silent conversion to low relevance.
- Sort comparable scores descending, original order for ties. Limited context is
  flagged but remains rankable. Keep a separate material-qualification index.
  All sources remain retrievable; no top-k exclusion.

## Observed

**10 assessments, 10 valid; 0.667s batch wall time; peak concurrency4.**
Context:2 adequate,8 limited,0 unknown. All10 retained; no sources excluded.
Every item again carried a material-qualification flag, but that no longer
prevents ordering: ranking and exclusion are separate decisions.

| Rank | Contribution /4 | Context | Material |
|---:|---:|---|---|
| 1 | 3.73 | Adequate | Guardian governance reporting and qualifications |
| 2 | 3.70 | Adequate | Taipei Times/AFP account of FT cloud-condition reporting |
| 3 | 3.47 | Limited | Reuters H200/import-approval discovery snippet |
| 4 | 3.08 | Limited | Tom's Hardware account of cloud-condition reporting |
| 5 | 2.74 | Limited | NYT export-review scrutiny discovery snippet |

Ranks1/2 are close; the0.03 gap is not meaningful precision or evidence of
stable superiority. Adequate means enough supplied context to judge contribution,
not verified truth. Reuters/NYT originals remain inaccessible in this snapshot.

## Fixed-reference ordering diagnostic

The reference checklist predates both classifiers' results and synthesis reports.
It identifies source anchors for governance, import constraints and cloud
conditions. This measures whether those particular sources appear early, not
all possible relevant evidence or whether a reader understands their caveats.

| Ordering | Reference anchors in first3 | Depth to reach all3 |
|---|---:|---:|
| Original provider order | 1/3 | 10 |
| Coarse v1 contribution buckets | 2/3 | 7 |
| Ordinal rank-only v2 | **3/3** | **3** |

Top5 has the same1/3,2/3,3/3 pattern. This is useful evidence for a reading queue,
not proof that only three sources should be read. The competitor/China
qualification in Breakingviews now sits at rank8 and remains flagged/retrievable;
other material can still matter. No actual reading-time, context-token saving,
or fresh synthesis-quality improvement was measured.

## Usage and limits

Reported usage:14,468 input +1,004 output =15,472 tokens. Pi reported a zero
price estimate; actual billing is not independently established. Request and
response expose only `jev-latest`, not a pinned model version.

V2 was designed after observing this corpus and v1, so this is **in-sample
iteration**, not a generalization test. No profile tuning occurred after seeing
v2 outputs. Unknown/error routing was not exercised in this batch. A new corpus,
repeated trials and human review are needed before an adoption or quality claim.

Ranking is still an evaluation composition using Pi's existing classifier;
there is no new registered ranking tool or default automatic classifier call.
All previous search/classifier allowances remain spent. AGY is parked. The new
90s Grok timeout was not exercised by this rank-only run.

## Evidence

- Profile commit: `07a3604`; view/metric script: `eval/prepare-ranking-v2.mjs`.
- Profile SHA-256: `fb0d3025b82bb1a3a2ae2f2b2e77fb94788d30df54899b676beca58825915dea`.
- Unchanged corpus SHA-256: `60082f97397af6c02bb172322df4c6872cce0f456f76d5b64b2436731a2afbbd`.
- Private artifacts: `.artifacts/nvidia-rank-v2-2026-11-09/` contains frozen
  profile, requests, individual responses, aggregate results, `ranked-view.json`,
  `ranking.md` and `metrics.json`. Original corpus and prior results untouched.
- `prepare-ranking-v2.mjs` uses saved real results, makes no network/model calls,
  and refuses to overwrite existing derived views.

Next candidate: expose this as an explicit advisory review queue within the
research method, then evaluate on a fresh corpus under a separately approved
allowance. Keep evidence-preservation rules separate from ordering, and don't
silently use a top-k view as proof that omitted material is irrelevant.
