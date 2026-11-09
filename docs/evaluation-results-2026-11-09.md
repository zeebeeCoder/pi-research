# Live evaluation: concurrency, latency and Jev-assisted synthesis

**Result: the integration ran, but this pair did not demonstrate a reduction or
meaningful synthesis-efficiency benefit.** The frozen policy retained every source.
Do not retrofit the policy to claim a win.

Plan: [preregistered experiment](evaluation-plan-2026-11-09.md).
Profile: `eval/screening-profile.json`, SHA-256
`eae9448c68e73250cf1becd730bf6e9dfc47f2695e7a4f1466343af99c0085b9`.
It remained unchanged. AGY was excluded. No provider/classifier retries.

## 1. Concurrent source collection

| Provider | Observed call time | Outcome |
|---|---:|---|
| Brave | 1.008s | 5 leads |
| Perplexity search | 1.221s | 5 leads |
| Grok | 45.558s | Failed at native 45s deadline; one native search start, no final accounting |

- Three calls actually overlapped; peak observed concurrency **3**.
- First usable result: **1.008s**. Both successful web providers finished by **1.221s**.
- Entire batch settled in **45.558s**, dominated by Grok's timeout.
- Sum of individual durations: 47.787s; sum/batch ratio **1.049×**. This is a
  serial-duration proxy, NOT a measured serial control or causal speedup.
- Grok's earlier 11.2s recovery was not a latency/reliability guarantee. This new
  failure reached the child with structured diagnostics; unknown usage stayed unknown.

The collector attempted four original public pages: Guardian and Taipei Times
were accessible; Reuters returned401, NYT403. No official source was inspected.
Ten discovery records were preserved unchanged with two shared inspected excerpts.
There was no usable X commentary in this corpus.

## 2. Classifier and selection

Pi's existing TypeSafe Jev integration classified **10** public source-linked items,
with the two frozen questions (contribution; material qualification/counterevidence).

| Metric | Observed |
|---|---:|
| Batch wall time | **0.613s** |
| Peak observed concurrency | **4** |
| Individual call times | 0.158–0.265s |
| Sum of individual times | 2.050s |
| Valid typed responses / unknowns | 10 / 0 |
| Contribution labels | 7 direct, 3 context |
| Material-qualification labels | **10 / 10** |
| Selected / omitted | **10 / 0** |

The policy kept top6 plus **every** material qualification/unknown. Consequently
nothing was removed. Original versus ranked inputs were exactly **23,216 UTF-8
bytes** each. No context reduction occurred; only source ordering changed.
Safety-preserving retention is appropriate, but retaining everything cannot prove
discriminative selection or false-negative performance. Unknown routing was not
exercised by this particular classifier batch.

Reported classifier usage: 12,528 input +960 output tokens. Pi reported a **$0
price estimate**, not independent proof of free service/billing. Both request and
response identify `jev-latest`; no actual pinned version was exposed. Probabilities
were validated structurally, not treated as calibrated factual confidence.

## 3. Matched synthesis comparison

Two fresh children used the same inherited `openai-codex/gpt-6-astra`, high
reasoning, skill, question, source material and 600-word limit. They could not
search or fetch more pages. They ran concurrently, so resource contention and
sampling/cache variance remain possible. Neither reopened additional sources.

| Metric | Baseline (copper) | Jev-ranked (silver) |
|---|---:|---:|
| Sources initially supplied | 10 | 10 |
| Input file bytes | 23,216 | 23,216 |
| **Report saved** | **38.983s** | **39.112s** |
| Report word count | 528 | 515 |
| Input tokens through report (uncached / cache-read) | 8,790 /1,536 | 8,790 /1,536 |
| Output tokens through report | 1,406 | 1,377 |
| Report-stage cost estimate | $0.159736 | $0.158286 |
| Complete arm, including evaluation claim register | 119.277s | 117.754s |
| Complete-arm assistant messages | 4 | 4 |
| Complete-arm reported tokens, summed over turns incl. cache | 39,532 | 39,219 |
| Complete-arm cost estimate | $0.381328 | $0.373550 |
| Mechanical quote matches | 19/19 | 22/22 |
| Invalid source references / quote errors | 0 /0 | 0 /0 |

Writing the detailed claim register was **evaluation overhead**, not time needed
to save the research report. Separating it prevents calling a roughly39s report
a two-minute synthesis. More quotations are not inherently better quality.

### Quality review

A parent-agent reference checklist was saved **before** classification/reports.
This is a finite-corpus, non-blind agent review—not human-labelled ground truth,
independent factual verification, calibrated grading or human acceptance.

- Both reports cover **3/3** required topics with appropriate source attribution.
- Neither had a clear unsupported material assertion among its **9 registered
  factual-claim items**, reviewed against the captured evidence. These are claims
  *about reporting*, not proof of the allegations or underlying world facts.
- Baseline retains five of six qualification groups fully and one partially:
  continued imports/no total halt is explicit, but demand is not explicit in its
  report (present in its quoted register material).
- Ranked report retains all six, makes demand-versus-approval distinctions more
  explicit, and adds a qualified competitor/China counterpoint from commentary.
- Both preserve unresolved allegations/denial, board-assurance limits,
  future-contract-only scope, unconfirmed reporting, access failures and date
  ambiguity. Neither turns competitor implications into observed gains.

The ranked wording is somewhat richer on one qualification, but one pair with
unchanged material does **not** establish a meaningful classifier-caused quality
improvement. Mechanical quote matching is not semantic entailment or truth.
Classifier label accuracy, calibration and human review/correction effort were
not measured.

## 4. End-to-end accounting, without hiding overhead

Shared collector session: **220.138s**, 14 assistant messages, estimated **$0.966240**.
Search waiting was only45.558s of that; extraction, selection and model-written
corpus assembly consumed much of the rest. The collector corrected an oversized
local extraction without a new network request.

Measured stage-sum estimates, excluding parent orchestration/review/selection setup:

- Baseline report-ready: **259.121s** (collector + report).
- Screened report-ready: **259.863s** (collector + classifier + report).
- Screening path was **0.742s slower** on this accounting; not a causal estimate.
- Including both arms' claim-register work gives339.415s versus338.505s; that
  apparent reversal is evaluation-output variance, not a research-efficiency win.

The actual span from first collector session entry to last synthesis session
entry was **532.720s**, including parent inter-stage work/gaps. It excludes initial
setup and subsequent review. One parent codemode syntax error occurred before
any tools ran and was corrected; no provider/classifier allowance was retried.
No timing above represents independently accepted-answer or human-review time.

Known three-child model-cost estimate subtotal: **$1.721118**. All provider search
costs remained unknown; classifier zero price estimate is not a verified bill;
parent usage/review is omitted. **This is not total experiment cost.**

## 5. What to improve next (not implemented or newly authorized here)

1. **Avoid waiting for optional slow searches before using fast web results.**
   Brave/Perplexity were ready in~1.2s; waiting for Grok cost another~44s. Provider
   selection and deadline policy matter more than classifier throughput here.
2. **Assemble corpus records deterministically from structured results.** Avoid
   having the collector regenerate large source JSON through model output. Keep
   model work focused on query framing, selection and interpretation.
3. **Keep screening advisory for these small, already-focused batches.** This
   profile's preserve-all-qualifications rule left nothing to compress. A future
   diversity/redundancy-aware policy needs an explicitly reviewed coverage/caveat
   contract, a newly frozen profile and another approved trial—not silent tuning.
4. Repeat matched trials and obtain human review before claiming quality or
   efficiency gains. A noisier/larger corpus may reveal a different trade-off;
   this result cannot predict it.

## Evidence and reproduction of measurements

Local/private: `.artifacts/nvidia-eval-2026-11-09/`:

- `retrieval.json`, `corpus.json`, `pages/`, `searches/`
- `screening-profile.json`, `classifier-requests.json`, per-item classifier results,
  `classifier-results.json`, `selection.json`
- `reference-review.json`, `quality-review.json`, `integrity.json`, `metrics.json`
- `arms/{copper,silver}/{input.json,report.md,claims.json}`
- `children/{collector,copper,silver}/{session.jsonl,metadata.json}`

All three children were stopped only after transcript preservation. Ten raw
source pointers resolve; original extension fields match the collector corpus.
No original source or older experiment was overwritten. Three provider claims
and one classifier batch claim remain spent.

`node eval/measure.mjs` remeasures these saved real artifacts without network calls.
`eval/prepare-views.mjs` refuses to overwrite existing views. No fixtures or fake
providers were used. Reports and raw traces remain private rather than in Git.
