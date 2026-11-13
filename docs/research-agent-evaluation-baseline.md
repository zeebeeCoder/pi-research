# Research-agent evaluation baseline

Captured from implementation and live research discussions, 12 November 2026.

## Purpose

Keep a shared reference for learning from real research runs: the user's intent,
the agent's sourcing and tool choices, qualification, inspection, and synthesis.
This evaluates the **run**, not just the final prose or individual sources.

This is knowledge for future iteration—not an implemented evaluator, scoring
formula, acceptance gate, mandatory checklist, or change to the research workflow.
Do not turn every possible refinement into a required improvement. Prefer changes
supported by recurring failures, clear bottlenecks, or demonstrated benefit.

## Properties to observe

| Property | Question | Evidence to inspect |
|---|---|---|
| Intent alignment | Did the agent preserve the question, scope and requested depth, or silently narrow them? | Original request, stated assumptions, research question, final coverage. |
| Purposeful sourcing | Did queries and providers address distinct evidence needs? | Query wording, provider assignments, source types, gaps and follow-up searches. |
| Reduction usefulness | Did qualification help decide what to inspect—not merely run successfully? | Ranked queue, discriminating versus saturated signals, actual selections and evidence gained. |
| Purposeful expansion | Did each original-page read address an identifiable uncertainty? | Selected source, reason for reading, passages retrieved, resulting answer or remaining gap. |
| Evidence progression | Did additional evidence change, sharpen or qualify the answer? | What was known from snippets versus what original-page inspection added. More text alone is not more depth. |
| Execution discipline | Were calls bounded and authorized, and failures preserved? | Tool arguments/results, capture scope, retries, side effects, cleanup and failure handling. |
| Context efficiency | Did retrieval deliver useful evidence without avoidable repetition or large dumps? | Calls, elapsed time, output sizes, overlapping reads and local reuse of saved captures. |
| Synthesis fidelity | Are claims traceable and appropriately qualified? | Citations/passages, source assertions versus inference, contradictions, snippet-only versus inspected evidence. |
| Stopping quality | Did the agent stop with a useful answer or honest blocker, without overstating coverage? | Unresolved questions, scope limits, stopping reason and proposed next step. |

These properties are related but not interchangeable. Fast execution does not
establish research quality; careful caveats do not repair missing evidence.
A successful page read does not establish a complete article or verified claim.

## Lessons already observed

### Selected-page reading added value without changing discovery

An earlier review of a separate research session found that the page reader
integrated successfully and identified no substantial orchestration issue that
justified changing the workflow. Treat that as a contact observation, not a
controlled demonstration of synthesis-quality or efficiency gains.

### Classification success did not demonstrate selection benefit

Our review distinguished valid Jev assessments from useful selection signals:
a saturated flag does not discriminate among the sources it labels. Correct
classification execution alone does not demonstrate incremental research value.
Assess that value against the actual selections and evidence gained.

### Bounded capture did not guarantee efficient follow-up reading

The page reader returns bounded excerpts, but follow-up local reads can still
repeat or flood context. Observe the whole retrieval sequence, not just the
individual tool's output limit. This is a review question, not a measured defect
established by the Feedly experiment.

### Technical capture success differed from application success

The first delegated Feedly snapshot returned a completed, stable capture whose
text said “Feedly failed to load.” The agent correctly stopped: no usable article
candidates, no classification, no invented clusters. This tested failure handling;
clustering and article expansion were **not tested** in that attempt.

A later manual background-tab capture, after page-load wait, did expose feed
content. Further waits of about 5 and 15 seconds did not change the page text.
Different capture paths and intervening state prevent attributing the earlier
failure to insufficient delay alone.

### Keyword matches needed source-context checks

A naive Google/Alphabet count matched Google News link destinations, not company
mentions in visible article text. A later NVIDIA-focused snapshot did contain
relevant entries; selected expansion separated leadership-risk reporting from
AI-demand commentary, while a third article failed DNS resolution. Captured-entry
counts, relevant stories and independent sources must remain distinct.

## How to record a future observation

Use the smallest useful finding:

- **Step / evidence:** transcript event, tool result, capture passage or artifact.
- **Observation:** what actually happened.
- **Consequence:** how it affected the research, if established.
- **Status:** supported, uncertain, or not tested.
- **Possible change:** only if the evidence warrants one; otherwise leave it open.

Do not invent numeric scores, aggregate unlike properties into a trust score, or
penalize a blocked run for downstream steps it could not test. Assess intent from
the user's request and explicit reasons—not imagined motives. Do not claim an
improvement over a baseline without a relevant comparison.

## Evidence pointers

The following are local, ignored artifacts and may not exist in another checkout:

- `.artifacts/reports/local-inference-2026-11-11.md`
- `.artifacts/reports/local-inference-2026-11-11-sources.json`
- `.artifacts/pages-implementation-contact.md`
- `.artifacts/feedly-alphabet-experiment/evaluation.md`
- `.artifacts/feedly-alphabet-experiment/observed-trace.json`
- `.artifacts/feedly-alphabet-experiment/delay-1794423949764/evaluation.md`
- `.artifacts/feedly-nvidia-1794483074171/report.md`

Keep these observations distinct from the historical classifier evaluations
linked in the README. Reviewing saved evidence does not authorize fresh paid
searches, classifiers, browser captures or retries.
