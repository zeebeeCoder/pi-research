# Integration-quality review — 2026-11-09

Scope: Brave, Perplexity search and Grok. AGY is parked at the user's request
until interactive authentication is possible. No new provider/model calls,
mock providers, copied fixtures, or offline scenario runner were introduced.
This is an inspection of real saved runs plus loading/build checks, not a fresh
end-to-end live trial of the changed code.

## Improvements

### Preserve failure accounting and native warnings

The first failed Grok run reported $0.046478 in its native end event but the tool
returned unknown cost. The successful recovery run also carried a native
excerpt-length schema warning that was absent from the compact result.

`src/diagnostics.ts` now reads bounded Grok accounting fields from the native
trace inside this call's own artifact directory. It does not accept a trace path
from source content, follow trace-file symlinks, or expose thought/text events.
The existing envelope now includes:

- `usage` and `reportedCostUsd` from the wrapper, with native accounting fallback
  even when the wrapper rejects output. Failed sources remain unusable.
- `providerMeta.integrationDiagnostics`: trace path, schema warning, native search
  starts, model turns, stop reason, accounting and any diagnostic-reading error.
- A bounded structured scout error message in `error`, rather than only an exit code.

No top-level tool parameters or output fields changed. Success still means
normalized leads, not full native-schema compliance. Missing/incomplete
accounting stays unknown; no guessed billing. Missing script installations now
produce a structured failure without spending the provider allowance. Cancellation
is checked again before launch; remote cancellation/billing is still not guaranteed.

### Improve source views without changing evidence

Brave's five real results supplied `page_age`, but every source previously showed
`date: null`. They also contained `<strong>` and encoded apostrophes. Compact
views now expose the provider date without inventing a timezone, remove Brave
presentation markup, and decode entities once. Perplexity/Grok plain text is not
HTML-decoded. Shortening is Unicode-safe and flagged for title/text. Raw files,
URLs, source IDs, kind and raw pointers stay intact; nothing becomes verified.

### Add the missing method layer

The packaged `research-method` skill covers framing, explicit allowances,
deliberate provider choice, warning/failure handling, original-source inspection,
non-destructive selection and concise handback. It calls out bot commentary,
syndication versus independent origins, homepage versus article dates,
inaccessible sources, cost unknowns and relevant counterevidence.

It does not authorize calls, add model-based grading, create a page-reader tool,
or replace the existing subagent lifecycle. The test launcher loads only this
skill explicitly alongside the extension/codemode and its existing bridge.

## Checks performed on real artifacts

- Original Grok failed trace: recovered reported $0.046478, usage and one native
  search start; parsed the actual malformed-record error.
- Recovery trace: recovered reported $0.041042, one native search start and the
  actual >220-character native schema warning.
- Re-inspected all 14 real source records (Brave 5, Perplexity 5, Grok 4): source
  IDs, URLs, kinds, `verified: false` and raw pointers were unchanged. All five
  Brave dates now match the saved `page_age`; its presentation markup is removed.
- Compared all 46 original experiment artifacts to their preserved SHA-256 hashes:
  none changed. New review outputs live separately under
  `.artifacts/integration-quality/`.
- Bun builds the extension. Pi loads the explicit extension + packaged skill
  without diagnostics; no model turn or provider call involved.

Evidence: `.artifacts/integration-quality/{diagnostics-review.json,
normalization-review.json,original-artifact-integrity.json,pi-load.stderr}`.
These files inspect existing live evidence; they do not masquerade as new live runs.

## Still unproven / next contact

A fresh human-approved three-provider child run is needed to validate the updated
end-to-end error/accounting presentation and skill use. No new search budget was
spent here. Injected failure/cancellation paths were not exercised; AGY remains
parked. The Grok schema-length warning is surfaced, not eliminated. Bot detection,
source independence and claim support remain explicit agent/human judgments,
not hidden automatic exclusions. Comparative quality, repeatability and efficiency
are not established.
