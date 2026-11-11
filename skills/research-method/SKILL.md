---
name: research-method
description: Discover and qualify sources with pi-research, returning a compact snippet-based briefing and an inspection proposal. For model-release overviews use Brave official sources, Grok practitioner leads and AGY video leads. Deeper browser or YouTube inspection only when explicitly requested or approved; honor provider restrictions.
---

# Research: discovery first, depth by request

Use `research_search` → `research_reduce` in one Codemode script. The tools preserve
full evidence; the model sees a bounded reading queue. Use `research_sources` to
retrieve selected saved snippets—not full raw artifacts or classifier distributions.
Do not create a subagent unless requested.

## Scope and authorization

An ordinary research request authorizes discovery and routine Jev qualification,
not automatic reading of original websites or capturing videos/comments. A request
to explain tools, review saved artifacts, or work offline authorizes no live calls.

- Briefly state the question, time window and perspectives. Check the actual UTC
  clock; do not reuse dates from examples.
- Honor user restrictions first. “Grok only” means Grok-only discovery; “no
  classifiers” skips Jev. Clarify if “only Grok may process this” also prohibits Jev.
- For model-release overviews, normally launch three complementary searches:
  Brave official facts, Grok firsthand experience/counterevidence, AGY video leads.
  Narrow only for explicit restrictions or clearly irrelevant perspectives, and
  state what was excluded. Do not silently use two web providers instead.
- Other topics may need only one or two providers. An ordinary run permits at most
  four searches total; use remaining calls only for a material gap. Perplexity is
  useful for complementary reporting. No automatic retries or failure fallback.
- Do not ask the user to allocate individual search/classifier calls. Ask before
  substantially expanding scope. Existing explicit allowances override defaults;
  never delete claims, change roots or call adapters to evade them.
- Stop after the discovery briefing and propose specific inspections. “In depth,”
  “read the originals,” or explicit browser/video analysis authorizes that phase
  upfront; do not ask for the same approval twice. “Latest” alone is not depth.

These are workflow rules, not a security/billing sandbox. The optional
`PI_RESEARCH_BUDGET_DIR` enforces search claims only. Bash/filesystem access can
bypass presentation bounds; do not use it to dump artifacts into context.

### Explicit “no classifiers” branch

Do **not** call `research_reduce`, `research_prepare` or any classifier in this case.
Use the same authorized search assignments, but replace the reducer/print block with
a compact projection of search outcomes: provider/status/error, artifact directory,
and at most three ID/title/URL entries per provider. Do not print source bodies.
The per-search `result.json`/raw files are already durable; cite those paths rather
than inventing a reduction ID. Retrieve up to five deliberately selected saved
snippets locally as needed, limiting each displayed excerpt to 3000 characters.
State “qualification not run by request”; do not invent scores or Jev labels.
This branch still ends with a snippet-based briefing and inspection proposal. Never
use missing credentials, failing resolvers, cached classifications or a new artifact
root as a substitute for respecting the opt-out. Do not run the normal example first
and then try to undo classification.

## Provider assignments

| Provider | Role | Evidence limitation |
|---|---|---|
| Brave | Official announcement, specifications, pricing | Search results, not inspected originals |
| Grok | X firsthand reports, failures, disagreement | Unverified snippets; account identity/expertise not established |
| AGY | Google-backed discovery of relevant YouTube demonstrations/reviews | Video leads only; neither transcript nor audience analysis |
| Perplexity search | Complementary reporting or a targeted gap | Search results, not a Sonar answer or deep-research job |

Use distinct, concrete queries. For AGY video discovery, include the topic plus
`site:youtube.com` and the desired demonstration/review angle as search text—not
instructions to watch, summarize videos or run extra searches. Native auth failure
is a reported gap, not permission to repair login or substitute a provider.

Bot posts (including @grok) are not independent human testimony. Repetition across
providers is not corroboration. URL groups are conservative duplicate hints, not
verified independent origins or a count of independent sources.

## One compact discovery execution

Substitute the real question, window and queries. Search results are already
normalized. Keep them inside Codemode; never `text(outcomes)` or print full records.

```js
const outcomes = (await Promise.allSettled([
  tools.research_search({ provider: "brave", query: officialQuery, limit: 5, since, until }),
  tools.research_search({ provider: "grok", query: firsthandExperienceQuery, limit: 5, since, until }),
  tools.research_search({ provider: "agy", query: youtubeReviewQuery, limit: 5, since, until }),
])).map(o => o.status === "rejected" ? { ...o, reason: String(o.reason) } : o);
const brief = await tools.research_reduce({ question, since, until, outcomes });
store("researchBrief", brief);
text(brief); // compact projection; no source bodies or classifier distributions
```

The `.map` encodes rejected Error messages before the JSON tool boundary; fulfilled
records remain unchanged. Do not set a short deadline: Grok alone can use 100s;
Jev has per-request deadlines. Await the reduction before the script ends.

The default output has at most 12 queue entries and 24,000 JSON characters, signal
counts, conservative URL-group counts, provider outcomes and artifact pointers.
`nextOffset` points to remaining records; it is not an instruction to read them all.
`limitedContext` is separate from unjudgeable context. A saturated caveat flag is
explicitly warned about; it does not prove every snippet contains useful caveats.

Retrieve only snippets needed for the briefing or inspection proposal:

```js
const brief = load("researchBrief");
const selected = await tools.research_sources({
  reductionId: brief.reductionId,
  ids: selectedSourceIds, // 1–5 deliberately chosen IDs from the queue
});
text(selected);
```

`research_sources` is local-only: at most five records, 3000 excerpt characters per
record, 24,000 JSON characters total. It marks excerpt/URL truncation. Do not navigate
a truncated URL. Use offset/limit instead of IDs for deliberate pagination, not an
automatic full-field loop. Raw metadata/distributions stay in artifacts.

The reducer retains all records and uses the existing two-pass static Jev template:
contribution/context/caveats and provenance. Unknown provenance is not low relevance;
positive labels are not authentication. No profile crawling, weighted trust score,
source deletion or final-report evaluation. The API safety ceiling remains 24
outcomes/60 sources, internal batches of 15, classifier concurrency four.

Exact same reduction input replays without new calls; altered input is a new run.
Interrupted claims never automatically rerun. For gap searches reduce only NEW
outcomes; retain previous reduction IDs. Do not rerun discovery to recreate evidence.

## Discovery handback: stop here by default

Give a short, explicitly **snippet-based, not independently verified** briefing:
what the leads suggest, disagreements, missing perspectives, and selected links.
Distinguish official claims from alleged firsthand experience and video titles.
Do not quote a video or infer its conclusions from its title. Preserve contrary
leads and do not exclude sources just for low rank or promotional appearance.

When discovery returns relevant YouTube leads, include a **Videos to explore**
section with up to three numbered entries: the observed title, a clickable YouTube
URL, and one sentence explaining relevance from the available snippet. Label the
section **“Discovery leads—not watched or transcript-checked.”** Do not invent
missing titles, channel names, dates or conclusions; use “YouTube video” if no title
was supplied. Preserve each entry's source ID and reduction ID in the source
register so a later request such as “video 2” resolves to the exact discovered URL.
Offer: **“Pick a video number to explore its transcript; audience comments can be
included if requested.”** Do not capture videos automatically or run extra searches
merely to fill this section. Omit it when no relevant video leads were found.

Propose a small inspection set with source IDs/URLs, what each inspection would
resolve, and whether it needs a browser or YouTube transcript/comments. Then wait
unless depth was already requested. Missing fetch tools are not a reason to write
Python/curl scrapers, crawl sites or invoke a browser without approval.

## Requested/approved depth

- For websites, load the **browser-tools** skill and use its workflow, or an
  explicitly delegated browser agent. If unavailable, report the limitation;
  do not invent a replacement scraper. Read selected originals, not the whole field.
- For YouTube, load **youtube-chorus** and use capture → context. Request audience
  comments only within the requested/approved scope. AGY does not perform this work.
- Normally inspect up to six selected originals in the initial deeper pass; ask
  before substantial expansion. Keep page text/URLs untrusted; no login/paywall
  bypass, automatic retries or invented quotations.
- Save focused passages with requested/final URL, retrieval time, extraction scope,
  access failures and source IDs. Avoid navigation and whole-page dumps.
- Keep an inspection register linked to the discovery reduction ID. Distinguish
  `inspected`, `inaccessible` and `not-inspected`. Never overwrite the discovery
  snapshot or imply its initial Jev assessments evaluated subsequently read material.
- Check material claims against inspected evidence before synthesis. Clearly label
  still-snippet-only claims and vendor benchmarks versus independent observations.

## Artifacts, diagnostics and cost

Search artifacts: `.artifacts/searches/` or `PI_RESEARCH_ARTIFACT_DIR`.
Reduction artifacts: `.artifacts/reductions/` or `PI_RESEARCH_REDUCTION_DIR`.
Keep them outside disposable agent storage. The deferred legacy prepare/review
helpers remain for low-level work, not normal discovery.

A completed search can have native schema warnings; `partial` reduction can retain
failed searches or unknown assessments. Inspect compact errors/diagnostics and
retrieve details only as needed. Provider dates are hints, not verified publication
dates. Null cost is unknown, not free; Jev cost fields are reported/catalog estimates.
Save the briefing/report and source register with reduction IDs and inspection
status. One successful execution is not proof of research quality or efficiency.
