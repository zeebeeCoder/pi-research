# Discovery briefing and requested depth

## Observable workflow

1. Ordinary research discovers and qualifies leads, then returns a compact,
   explicitly snippet-based briefing with a proposed inspection set.
2. Model-release overviews default to Brave official-source discovery, Grok
   practitioner/counterevidence leads, and AGY YouTube leads. Explicit provider
   restrictions override that mix. Perplexity is available for reporting gaps.
3. Original-site/video inspection runs only when requested upfront or approved
   after the proposal: browser-tools/browser agent for websites, YouTube Chorus
   for transcripts/comments. No improvised scraping scripts.

Provider selection and inspection authorization are agent instructions, not a
network sandbox. The extension does not intercept all bash/browser calls. Live
provider selection and research quality require separate evaluation.

## Presentation contract

`research_reduce` still preserves the complete source-linked result, immutable
classifier responses and prepared/reviewed batches. Its public result is now a
projection from `src/briefing.ts`, including when an old saved run is replayed:

- At most 12 queue entries and 24,000 serialized JSON characters.
- No source bodies, full search envelopes, assessments or probability distributions.
- Contribution and independent context/evidence/caveat/concern signals.
- Separate limited-context count: limited relevance evidence stays ranked. Each
  row also preserves needsContext, qualification choice, ranking/provenance status
  and provenance labels; a false concern flag is never a substitute for known origin.
- Visible search failures, bounded diagnostic messages and unknown costs.
- Conservative URL grouping without deleting records. Only fragments and known
  `utm_*`, `gclid`, `fbclid` tracking keys are ignored. Other query parameters remain
  significant, so duplicate detection is intentionally incomplete.
- Counts of recognizable X post/YouTube video URLs, not claims of coverage quality,
  independent authorship, human identity or actual video inspection.

`research_sources` retrieves selected local snippets, 1–5 IDs or one explicit
pagination request. Excerpts are capped at 3000 characters each; the whole result
has the same 24,000-character ceiling. Oversize selection fails with instructions
to request fewer IDs; it never silently removes selected records. Excerpt and URL
truncation are explicit. Full source text is unchanged in the artifact.

Raw search records still cross into Codemode to compose reduction. Instructions
forbid printing those raw outcomes in ordinary research. Direct search summaries
omit snippet bodies. Bash/read and deferred legacy helpers remain capable of
accessing full files: this design prevents accidental normal-result dumps, not
purposeful bypasses by a generally authorized coding agent.

## Evidence stages

Saved discovery assessments are snapshots. Later browser/video evidence belongs
in a source-linked inspection register with reduction ID, source IDs, requested and
final URLs, retrieval time, focused passages, scope and access status. Do not imply
that an initial snippet classifier assessed subsequently inspected material.
This iteration does not add a browser engine or an inspection-storage tool.

## Qualification findings and deferred policy change

The saved Carbon run contained ten records and twenty Jev responses. All ten
provenance passes returned unknown; nine ranking contexts were limited; every
record was flagged as containing a material qualification. This single field
supports two concerns, not a new general accuracy claim:

- Missing provenance evidence may make that pass low-value. Mechanically skipping
  it could remove ten calls in this example, but needs an explicit new profile/
  scheduling policy and tests on richer X/profile evidence. It is **not changed**
  here: the existing two-pass profile and frozen historical results remain intact.
- The caveat signal appears insufficiently selective, including on a model-card
  index. The compact view warns when every record is flagged. Do not tighten a
  confidence threshold or retune the rubric to this one example without a held-out
  evaluation including explicit caveats, plain announcements, and sparse snippets.

## Verification

`tests/briefing.test.ts` covers compact-output ceilings, absence of raw records and
distributions, unknown/limited/concern separation, conservative URL grouping, actual
URL-kind counts, failure diagnostics, explicit local retrieval, truncation,
pagination, cancellation, identity checks and rejected traversal/ambiguous inputs.
Existing reduction and native provider suites remain unchanged.

Local ignored evidence under `.artifacts/discovery-briefing/` includes:

- `verification.json`: real Pi/QuickJS tool composition using offline Brave/Grok/AGY
  transports and fixture Jev; schema-validated outputs, four-way concurrency,
  replay and local retrieval without additional classifier calls.
- `carbon-replay.json`: replay of the real previously saved Carbon run, zero new
  model resolutions, ten retained records and byte-identical saved evidence. Compact
  JSON is about 6.8k characters versus the 58.5k-character saved full result. This
  is output-size evidence, not a measured token-cost or research-quality improvement.

A fresh-agent offline review in `.artifacts/discovery-boundary-check/REPORT.md`
executed the loaded local retrieval tool on three saved snippets and demonstrated
ordinary-stop versus upfront-depth routing as simulated scenarios. Its projection
findings (lost per-row context/provenance distinctions and split UTF-16 characters)
were fixed and regression-tested. The skill now explicitly documents a no-classifier
search-only branch rather than leaving the reducer recipe ambiguous.

No new live searches, classifier calls, browser actions or video captures are
required for these checks. A fresh-agent offline scenario can exercise instruction
following, but cannot establish live browser/video integration or enforce approval
against an agent deliberately using another tool.
