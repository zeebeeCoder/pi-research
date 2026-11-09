# Nvidia live subagent smoke — 2026-11-09

Implementation tested: `95ee0b8` (wrappers introduced in `5ed8f2e`).
Child: `nvidia-live` / `c1dea0`, inherited `openai-codex/gpt-6-astra`, high reasoning.
UTC transcript window: 19:39:18.942–19:42:15.696 (~177 seconds).
No global install, additional classifier, retry, or deep-research call.

## Observed results

| Provider | Path | Outcome | Leads | Local elapsed |
|---|---|---|---:|---:|
| Brave | Direct tool | Completed | 5 | 1.021s |
| Perplexity search | Codemode | Completed | 5 | 1.184s |
| Grok X | Codemode | Native wrapper rejected malformed records | 0 usable | 20.403s |
| AGY | Codemode | Native wrapper deadline | 0 | 45.544s |

The extension loaded, was discovered with `describeTool`, and returned structured
objects through codemode without parsing terminal prose. Success AND failure
envelopes reached the child. Four persistent claims match four provider
invocations. All ten source `rawRef` pointers resolve and match their source URLs.
A partial four-provider experiment was reported honestly, not as full success.

### Failure diagnosis from saved traces (no new provider calls)

- **AGY:** Native stderr requested authentication; trace contained
  `authentication failed or timed out`, no successful initialization/search.
  Thus this was an authentication/startup failure reaching the 45s deadline,
  NOT evidence that a real search needed more time. Requires human auth repair.
- **Grok:** Exactly one native semantic search completed, but final post objects
  used `id`, `username`, `timestamp`, `text`, etc. rather than the existing
  scout contract's `url`, `author`, `date`, `excerpt`. The existing guard rejected
  them. Do not weaken validation or silently manufacture accepted records.
  Any upstream wrapper repair and another live trial are separate follow-up work.

The current adapter returns generic exit errors plus artifact paths; deeper
failure details and failure-side usage require trace inspection. That limitation
is real and is not hidden by this successful failure-handling check.

## Research and cost review

The child attempted four original-page reads: three accessible, one HTTP 429;
no retries. Its report separates an official announcement from anonymously
sourced reporting, an official index listing, and inaccessible snippet-only
claims. Parent review checked the three saved accessible pages against the key
claims. This is agent review, not human acceptance or an independent fact audit.

Search envelopes reported unknown costs. Parent trace review recovered Grok's
reported **$0.046478**, despite rejected output. Child session usage reports
**$0.725262** as a cost estimate; not an invoice. Their known reported subtotal is
**$0.771740**, NOT total experiment cost: Brave, Perplexity, AGY and parent usage
are not included. The child reported 33,113 uncached input, 159,232 cache-read,
and 4,698 output tokens over nine assistant messages. Reading largely unfiltered
page text contributed substantial context; no efficiency gain is established.

## Preserved local evidence

Under `.artifacts/nvidia-live-2026-11-09/` (private, deliberately not in Git):

- `report.md` and `run-summary.json`: original child outputs, not overwritten.
- `searches/`: four requests/results, stdout/stderr, raw successful responses,
  and Grok/AGY native request/error/trace files.
- `pages/`: four fetched bodies plus extracted text and retrieval metadata.
- `child/session.jsonl`, `child/metadata.json`: copied BEFORE stopping the child.
- `review-integrity.json`: ten checked references, four claims, child usage,
  and SHA-256 hashes of the 46 original preserved files.

The child has been stopped. The allowance is spent; do not delete its claims or
silently choose a fresh directory. The report is a useful live contact surface,
not a comparison benchmark. Successful Grok/AGY compatibility, empty/cancellation
paths, repeatability, comparative quality/cost, and human acceptance remain open.
