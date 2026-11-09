# Three-provider and reducer evaluation — frozen before retrieval

User requested a fresh run with evaluation metrics, latency/concurrency and the
classifier reducer's contribution. This is a bounded experiment using existing
Pi classification, not a newly implemented extension reducer or adoption claim.
AGY remains parked.

## Budgets and ordering

1. One collector subagent launches Brave, Perplexity search and Grok concurrently:
   one invocation each, at most five leads, no retries. It inspects at most four
   original public pages (20s/2MiB/no redirects each) and preserves the entire corpus.
2. Freeze the question, profile and policy in `eval/screening-profile.json` BEFORE
   retrieval. One Jev classification per real source, max15, max4 concurrent,
   two questions, no retry/fallback. Only public source-linked material is shared.
   Moving `jev-latest` alias/version availability is recorded, not called pinned.
3. Two fresh synthesis subagents inherit the same model/reasoning. No searches or
   page reads in either arm; both use the identical shared captured evidence.
   - Baseline sees every source, original provider order, no classifier judgments.
   - Reducer sees top6 by contribution plus ALL material caveats/counterevidence,
     unknown/invalid/error cases. Low-ranked source IDs/titles/paths stay visible
     and retrievable. Extra inspection is logged, never silently forbidden.
4. Same question, maximum 600-word report and requested claim/source register.
   No extra models, nested children, or automatic research loops. Preserve both
   transcripts before stopping children. Keep reports separate to prevent leakage.

This changes input exposure deliberately; report it rather than claiming identical
input-token budgets. If safety/unknown lanes retain everything, that is a valid
negative reduction result. Native schema warnings and bot/syndication caveats
must remain visible in both arms.

## Metrics and interpretation

- Provider intervals and concurrent batch wall time; actual observed overlap.
  Sum of individual durations is a serial-duration PROXY, not a serial control run.
- Classification dispatch intervals, wall time, usage and reported cost; time
  includes local queueing where applicable. Validate all answer types/IDs/labels,
  finite probabilities/ranges and choice/distribution consistency.
- Input/view sizes, retained and omitted counts, unknown routing and which
  omitted material is re-opened; all raw data remains preserved.
- Each synthesis child's elapsed time, model turns, input/cache/output usage and
  reported cost estimate. Also shared collection cost and parent/classifier cost
  where available; incomplete totals remain explicitly incomplete.
- A finite, agent-reviewed reference checklist from the shared corpus is saved
  BEFORE reading classifier outputs/reports. Check both reports for material-fact
  support, source-reference integrity, coverage, uncertainty and relevant caveats.
  This is not human-labelled ground truth or an independent blinded human review.
- Compare pipeline stage sums: shared collection + synthesis versus shared
  collection + screening/selection + synthesis. Separate these estimates from
  wall-clock time spent orchestrating/reviewing both arms. Concurrency between
  arms may cause resource contention; one pair cannot establish causation.

No preset numeric adoption threshold or claim that speed offsets lost evidence.
One pair offers diagnostic observations, not statistical significance, calibrated
confidence, proven recall over the web, or proven synthesis superiority.

Artifacts: `.artifacts/nvidia-eval-2026-11-09/` (private, not committed).
