# Spike: leads and evidence

Two generic routing categories, not a market-specific type hierarchy:

| Acquisition operation | Fixed result kind | Treatment |
| --- | --- | --- |
| `research_search` (any current provider) | `leads` | Existing reduce/qualify workflow |
| `research_read_pages` | `evidence` | Interpretation with capture limitations and provenance |
| `market_research` (Yahoo history, indicators, charts) | `evidence` | Market data-quality checks and interpretation, not lead ranking |
| Future discovery tools | `leads` | Normalize to the discovery contract, then qualify |

The operation owns the top-level `kind`, in its implementation and literal output
schema. It is not an input flag, a provider classification, a heuristic over the
text, or a claim made by the retrieved source. One provider can support different
operations. A hundred price bars are evidence; one search hit is still a lead.

The payload is unchanged: search still returns `sources`, page reading still
returns `records`, and each keeps its existing diagnostics and artifact paths.
There is no universal `items`/`payload` migration or `MarketArtifactRef` type.
Nested `source.kind` still means `search-result` / `model-extracted-lead`; it is
not the envelope's routing kind.

**Evidence does not mean verified fact.** `kind` describes the operation's output
category even when the result is partial or failed. Always inspect status, record
errors, freshness/readiness warnings and provenance. Routing does not turn a
failed fetch into usable evidence, or approve deeper inspection.

## The connection to qualification

```text
Operation produces its fixed kind
  → research_route (local, no model/network/filesystem calls)
      leads indices    → unchanged acquisition outcomes → research_reduce
      evidence indices → unchanged results → interpretation with limitations
      rejected indices → original failures → report gaps, no inferred kind
```

`research_route` accepts at most 24 settled acquisition outcomes and returns only
three arrays of **original zero-based indices**. Every valid outcome appears
exactly once. It does not copy, trim or rewrite payloads. Missing/unknown kinds
and malformed outcomes reject the whole routing call; nothing is silently dropped.
A rejected promise has no result, so its kind cannot be guessed from its reason.

`research_reduce` independently requires `kind: "leads"` for fulfilled inputs.
Its tool schema and core validator reject evidence before classifier resolution
or artifact writes. A `leads` tag alone is not sufficient: the existing normalized
search-result/source contract is still required. This spike does not open the
closed provider enum or add arbitrary market discovery adapters.

Normal discovery is unchanged: **search → reduce/qualify → snippets → brief**.
No routing call is necessary for a homogeneous batch of `research_search` calls;
include its rejected outcomes in reduction as before. The existing explicit
no-classifiers exception also remains unchanged.

Ranked summaries and selected snippets carry `kind: "leads"`, because ranking
and reading a saved snippet do not produce inspected evidence. They are downstream
views, not fresh acquisition batches: do not send them back through reduction.
Legacy prepare/review tools are intermediate qualification operations, not inputs
to this router.

## Mixed composition in Codemode

Use this only when BOTH discovery and the selected page inspection have already
been authorized. Routing never authorizes acquiring evidence. The two acquisitions
below can run in parallel because the page URL is already selected, not discovered
by the concurrent search.

```js
const outcomes = (await Promise.allSettled([
  tools.research_search({ provider: "brave", query, since, until, limit: 5 }),
  tools.research_read_pages({ pages: [{ url: alreadySelectedApprovedUrl }] }),
])).map(o => o.status === "rejected" ? { ...o, reason: String(o.reason) } : o);

const routes = await tools.research_route({ outcomes });
const discovery = routes.leads.length
  ? await tools.research_reduce({
      question, since, until,
      outcomes: routes.leads.map(index => outcomes[index]),
    })
  : null; // evidence-only work does not resolve a classifier

// Never print the raw mixed outcomes. These are bounded views/references;
// inspect the selected evidence's existing resultPath locally for more detail.
text({
  discovery,
  evidence: routes.evidence.map(index => {
    const result = outcomes[index].value;
    return { index, kind: result.kind, status: result.status, resultPath: result.resultPath };
  }),
  rejected: routes.rejected.map(index => ({ index, reason: outcomes[index].reason })),
});
```

Do not treat `discovery.status === "completed"` as success for the whole mixed
composition: an evidence acquisition may be partial/failed, or an unrelated call
may have rejected. Keep all three lanes visible. Unassigned rejections are not
misreported as failed searches. Evidence-specific presentation remains owned by
the evidence tool; no generic status enum or artifact schema is introduced here.

This is a contract for cooperating tools, **not a security sandbox**. A caller
can fabricate data or deliberately relabel it; the router does not authenticate
origin. Nor can it force an agent to call qualification before answering. What
is mechanically checked is the declared category, valid discovery input, and
routing without loss. Workflow guidance still owns the normal research ordering
and the explicit no-classifiers/depth exceptions.

## Compatibility

Fresh search/capture outputs add a fixed top-level tag; all prior fields remain.
Reload Pi before using `research_route` or consuming the new search outputs.
Untagged inputs are deliberately not inferred or automatically upgraded; do not
retry paid searches just to obtain the tag. Old saved artifacts remain readable
by their existing paths/IDs. Migration of old search envelopes is not part of
this spike.

The routing tag is excluded from reduction identity hashing. The same underlying
search evidence/profile still finds an existing pre-tag reduction or interrupted
claim: adding metadata cannot reopen a spent classification attempt. Cached
artifacts are not rewritten. Public projections label old reductions as leads
without reclassification.

## Reproduce the offline contact

```sh
bun run test

PI_RESEARCH_PI_PACKAGE=/path/to/installed/@earendil-works/pi-coding-agent \
  node tests/live/pages-contact.mjs --offline
```

The installed-loader contact now registers all eight tools, checks schemas, captures
a synthetic partial page batch through a fake SC executable, routes one lead
batch plus that evidence plus a rejection, and passes only leads to qualification.
It checks that direct evidence submission to reduction fails before model access,
that one source gets two stub classifier calls, and that replay makes no more calls.
The page's failure remains visible. No real model, provider, browser or service call
is made. Unit tests additionally cover all-provider tags, generic evidence payloads,
unknown tags, no-loss routing, evidence-only work, pre-tag replay and interrupted
claims.

This is an integration/contract spike, not evidence of market-data quality or
live research quality. The subsequent [market integration](market.md) lives inside
pi-research and preserves this boundary. Automatic acquisition, a generic plugin
framework, new qualification policy and a universal evidence schema remain out of scope.
