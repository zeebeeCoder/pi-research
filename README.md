# pi-research

Local live-provider spike for Pi. Wraps the existing machine-local Brave,
Perplexity search, Grok X and AGY scout scripts; it does not replace their clients
or credential handling. No mocks, classifier models, or deep research.

Implementation is in progress. The first contact will be a research subagent
using real searches and preserving its report and provider artifacts locally.

## Boundaries

- Provider selection is explicit; no automatic fan-out, retries, or fallback.
- Brave/Perplexity return search results; Grok/AGY return model-extracted leads.
- Leads are untrusted, not verified facts. Read original sources before relying on them.
- Reported cost is recorded when available; unknown cost is not zero.
- Client termination is not a guarantee of remote cancellation or stopped billing.
- Private live artifacts stay under `.artifacts/` (ignored by Git).
- No global install or credential/config migration.
