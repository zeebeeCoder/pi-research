# Source-provider primitives

`src/providers/index.ts` is the registry of four `SourceProvider` units. These
are source adapters, not chat-model providers registered with Pi. A caller uses
`research_search`; it never needs a skill-installed script or provider-specific
command construction.

## Ownership and composition

```text
research_search
  → validate SearchInput
  → select SourceProvider and resolve its packaged entrypoint
  → persist request; claim optional per-provider allowance atomically
  → run one bounded adapter process (no retries/fallback)
  → preserve raw output and diagnostics
  → project provider fields; validate common Source contract
  → persist completed / empty / failed envelope
```

| Unit | Owned mechanics | External transport |
|---|---|---|
| Brave | GET request, freshness bounds, raw `web.results` mapping | Brave Search API |
| Perplexity | Search-only POST, date-window hint, raw `results` mapping | Perplexity Search API |
| Grok | Native X command, exact-query/one-call stream audit, date filtering, `posts` mapping | Authenticated `grok` executable |
| AGY | Flash selection, exact-query/one-call stream audit, Google citation handling, `sources` mapping | Authenticated `agy` executable |

Each unit declares identity, transport, date semantics, evidence kind, raw JSON
pointer, command construction and record/field projection. `src/search.ts` owns
input validation, optional allowance claims, process cancellation/deadlines,
bounded stdout/stderr, common lead validation, raw provenance and result storage.
Qualification remains a separate primitive: `research_reduce` collects parallel
search outcomes and invokes Jev through Pi, then validates a lossless ranked view.
Search itself never classifies or inspects pages. Compose both tools in Codemode;
see the [research-method skill](../skills/research-method/SKILL.md).

**Input:** one provider, printable query (1–1800 chars, no leading flag), limit
1–5, optional real UTC day bounds with exclusive `until`.

**Output:** unchanged `SearchResult` / `Source` tool schema. Every accepted source
has an ID, raw JSON pointer, bounded title/text, credential-free HTTP(S) URL,
provider date when supplied, evidence kind, `verified: false`, and truncation
status. Raw content remains in private artifacts. Normalized leads are not proof
of factual truth or original authorship.

**Failure:** malformed/partial output, forbidden native tool use, missing
credentials/executable, deadlines and cancellation do not become usable sources.
A failed invocation still consumes a configured allowance. Local cancellation
cannot prove remote work/billing stopped. Claims only protect this orchestrator;
they are not a sandbox or global billing cap. Without `PI_RESEARCH_BUDGET_DIR`,
explicit user authorization remains a workflow requirement, not an enforced claim.

**Effects:** one packaged adapter invocation, private artifacts, and one provider
search request/native search attempt. No retry, provider substitution, credential
migration, login repair, new classifier calls or automatic fan-out. AGY preserves
its existing bounded HEAD resolution of known Google grounding citations; it does
not follow their destinations or fetch arbitrary source pages. Auditing native
streams rejects violations after observation; it is not a remote permission gate.

## Packaging and credentials

All executable integration code lives below `src/providers/`. Entry paths use
`import.meta.url`, not home-directory skill paths or the caller's cwd. Node >=20.3
runs the adapters. The package needs no runtime npm dependencies. Native Grok/AGY
executables remain declared provider transports, not copied vendor applications.

- Brave: `BRAVE_API_KEY` only, as in the installed Brave integration.
- Perplexity: `PERPLEXITY_API_KEY`, else the existing
  `~/.config/perplexity/.env` entry. No config file is bundled.
- Grok/AGY: existing native CLI authentication; trusted executable overrides
  `GROK_X_BIN` / `AGY_SEARCH_BIN` remain supported.
- Only the selected provider is required. No credential values enter command-line
  arguments or `request.json`.

HTTP adapters refuse redirects, cap response bodies at 2 MiB, apply a 50-second
local deadline (inside the orchestrator's 55 seconds), and report status-only HTTP
errors rather than echoing untrusted response bodies. Brave converts exclusive
`until` to the preceding inclusive day; one-sided ranges use 1970-01-01 or today's
UTC date for the missing boundary. Perplexity still treats dates only as query hints.

## Lift-and-shift provenance

The local integrations supplied for this migration were imported without credential/state files:

- Grok scout: unchanged source from `grok-x/scripts/grok-x.js`, including the
  structured-output repair recorded in `patches/`.
  SHA-256: `ade9eaca9f3b9194040f255babeb4bf0f64c34411cbad4aa6af0dc133c8ab9c6`.
- AGY scout: unchanged source from `agy-search/scripts/agy-search.js`.
  SHA-256: `a018f8415e61332c6ccbd391e2981bc157294c2a08bf5097e106a5a521154453`.
- Perplexity: lifted credential resolution and `/search` request from `pplx.ts`.
  Omitted unrelated chat, deep-research jobs and polling. Replaced process-wide
  error exits in the helper with exceptions and the bounded shared HTTP transport.
- Brave: adapted the installed `search.js` HTTP search operation. The previously
  assumed `scripts/brave-search.ts` was absent. Preserve the raw API envelope
  instead of terminal prose; omit page extraction and its DOM dependencies.
- Native scout tests and fake transports were imported alongside their source.
  Paths now resolve within this package; the Grok fake's prompt parser was updated
  to understand the already-applied structured-output prompt repair. Process-exit
  assertions now allow up to two seconds for OS reaping after cancellation rather
  than assuming immediate ESRCH when the scout process closes.

No external skill files are changed. Historical evaluation docs still describe
the original external-script spike; they are not new live compatibility evidence.

## Verification and limits

Run `bun run test`: local qualification contracts, HTTP request/response tests,
real orchestration with fake edge transports, and imported native audit/process
tests. Cases include all four successful provider paths, raw provenance,
concurrent claims, failed-call allowance retention, cancellation, malformed native
streams, wrong queries/tools/models, deadlines and resistant child processes.
Packaged entrypoints are also copied to an unrelated directory and exercised
without skill installations. None of these tests needs real API credentials or
invokes provider services.

This establishes package wiring and exercised contracts, not live authentication,
current upstream CLI/API compatibility, search quality, classifier effectiveness,
or remote billing behavior. A separately authorized live trial is still required.
