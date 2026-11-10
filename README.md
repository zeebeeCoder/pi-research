# pi-research

A local live-provider spike for Pi. `research_search` wraps the existing Brave,
Perplexity search, Grok X and AGY scout scripts. `research_prepare` and
`research_review` provide optional static qualification around Pi's existing Jev
integration. No new provider clients, offline fixtures, classifier SDK, evidence
database, or deep research.

## Load locally

```sh
# Explicit, single-process loading; no global install
pi -e ./extensions/research.ts --tools +codemode

# Or launch Pi in this trusted project: .pi/settings.json loads the package
pi --approve
```

The package includes `/skill:research-method` for question framing, provider
selection, source inspection, uncertainty and compact handback. It does not grant
a live allowance. Explicit-file loading can include it with
`--skill ./skills/research-method/SKILL.md`; project package loading discovers it.

Current focus: **Brave, Perplexity search and Grok**. AGY remains implemented but
parked until the human can complete authentication; no AGY call should be made
under the current quality-review work.

The package has no runtime npm dependencies. Pi provides its extension API/types.
Prerequisites: Bun, Node, and the four existing skills under
`~/.pi/agent/skills/{brave-search,perplexity-search,grok-x,agy-search}`. Their
existing credentials/authentication stay in place. This is a machine-local spike,
not a standalone portable distribution.

## Call it

```js
const result = await tools.research_search({
  provider: "brave", // brave | perplexity | grok | agy
  query: "Nvidia recent market developments",
  limit: 5,         // 1–5; default 5
  since: "2026-11-02",
  until: "2026-11-10"
});
text({ status: result.status, sources: result.sources, artifacts: result.artifactDir });
```

Use actual dates for each assignment. The example is the first spike's date window.
Each call selects ONE provider and performs ONE CLI invocation, without retries.
Call multiple providers only when explicitly budgeted. Independent calls can use
`Promise.allSettled()`; a failed result retains its structured envelope, so also
check `status`, not just whether the promise fulfilled.

### Semantics and artifacts

- `completed`: usable discovery leads; **not verified facts**.
- `empty`: recognized successful response with no leads.
- `failed`: CLI, deadline, JSON, shape, or budget failure. `partialOutput` says
  unusable stdout was retained; partial output is never promoted to success.
- Brave/Perplexity sources are `search-result`; Grok/AGY sources are
  `model-extracted-lead`. All have `verified: false`.
- Each source has an ID and `rawRef` (local JSON path + JSON Pointer).
- `omitted` counts this adapter's result-cap omissions only. Native wrapper
  omissions stay separately in `providerMeta`; neither measures search coverage.
- Brave uses its date-range API and exposes `page_age` in `source.date` without
  inventing a timezone. This is provider metadata, not verified publication time.
  Grok uses native date filters and validates model-stated dates. Perplexity/AGY
  get query hints only. Inspect source dates, especially on indexes/homepages.
- Brave display tags/entities are removed/decoded in the compact view only.
  Raw content is unchanged. Shortening is Unicode-safe and marks `truncated`.
- Grok `providerMeta.integrationDiagnostics` exposes native schema warnings,
  trace-inspection errors, accounting and observed native search starts. Inspect
  it on successes AND failures; normalized success is not native-schema compliance.
  Diagnostics only read the bounded trace under this call's own artifact directory;
  they never follow a path from retrieved content or expose raw model thoughts.
- `usage` and `reportedCostUsd` preserve reported values where available, including
  Grok output rejected by its wrapper. Null means unknown. External CLI usage is
  not added to Pi's own token accounting. Structured scout error messages are
  returned in `error`; detailed raw logs remain in the artifact directory.

Private per-call directories contain `request.json`, `stdout.txt`, `stderr.log`,
`raw.json` when parseable, and `result.json`. Grok/AGY native traces live beneath
that directory too. Raw artifacts are not dumped into model context.

Default output is `.artifacts/searches/` under the caller's cwd. Set trusted
`PI_RESEARCH_ARTIFACT_DIR` to override it. `.artifacts/` is ignored by Git. Keep
artifacts outside disposable subagent storage before stopping a child.

## Optional static qualification

`research_prepare({question, since, until, sources})` saves all original records
and fills `profiles/qualification-v3.json` in code. Recency is computed from
supplied dates; ambiguous timestamps are not silently assigned UTC. The static
questions cover topic contribution, context/caveats, authenticity and contextual
source/profile credibility. Missing identity/expertise evidence remains unknown;
source brands, badges and writing style are not authentication.

Preparation does **not** call a model or grant an allowance. With separate
approval, classify its requests through Pi's existing Jev integration: two small
passes per source, max15 sources/30 calls, concurrency4, no retries. There is no
per-source LLM prompt generation or automatic profile lookup.

`research_review({batchId, responses})` validates captured answers and saves a
ranked view plus needs-context, needs-evidence and material-qualification indexes.
All material remains available. Provenance unknowns don't erase comparable topic
scores, and no signal is silently combined into a scalar truth/credibility score.
Both local tools return structured data in codemode and concise direct summaries.
Artifacts default to `.artifacts/qualifications/`; a trusted
`PI_RESEARCH_QUALIFICATION_DIR` can override this. They never fetch rawRef paths.

The bounded whole-workflow contact is `eval/qualification-v3/contact.md`, with
its own fixed launcher and single-claim classifier runner. Its allowance is spent.
The [Codex GPT6.1 Sol High evaluation](docs/qualification-v3-evaluation.md) retained
15/15 sources: preparation2.8ms internally, ranking742ms, extra provenance720ms.
Overall outcome is **partial**: four page reads failed DNS, origin/profile evidence
remained unknown, and qualification/duplicate-ranking weaknesses remain visible.
Two deterministic review issues were hardened and replay-verified on unchanged
real captures; no new live calls or post-output rubric tuning.

## Live subagent contact

`pi-test.sh` uses the existing subagent launcher's supported local launcher hook.
It explicitly loads this extension, codemode and the packaged research-method
skill, disables unrelated extension/skill discovery, and leaves the launcher's
own control bridge intact.
No global install, trust-registry edit, or process-manager modification is needed.

The launcher pins the approved durable allowance directory to
`.artifacts/nvidia-live-2026-11-09` (arbitrary client environment variables do not
reliably propagate through tmux). Changing this path requires a new allowance.

```sh
subagent spawn --name nvidia-live --cwd "$PWD" \
  --no-extensions --no-skills \
  --tools read,bash,write,codemode,research_search \
  --file prompts/nvidia-live.md
```

The first run is authorized for one search per provider, five leads each, defaults,
no retries; selected source-page inspection is separate. `PI_RESEARCH_BUDGET_DIR`
uses atomic provider claim files to prevent repeated wrapper invocations across
concurrent calls and reloads. A failed invocation still consumes its allowance.
Do not delete claims or use a fresh directory to evade a spent allowance.

This only limits calls through our wrapper, not arbitrary bash, other tools,
or hidden remote provider work. It is NOT a sandbox or a hard billing cap.
Outside this test launcher, the optional budget directory must be set explicitly.

## First live result

The [Nvidia subagent smoke](docs/live-smoke-2026-11-09.md) loaded this extension
and exercised direct + codemode calls. Brave and Perplexity each returned five
leads. AGY needed authentication and timed out; Grok completed a search but its
existing scout rejected malformed result records. No retries were made.

Report: `.artifacts/nvidia-live-2026-11-09/report.md` (local, ignored by Git).
The original allowance is spent. A separately approved Grok follow-up returned
four usable leads; its native excerpt-length warning remains significant. See
[the upstream patch and recovery notes](patches/README.md). AGY's reserved
follow-up is parked, not permission to call it during integration-quality work.

Quality changes were checked against these real captured responses/traces without
new provider calls, copied fixtures or a mock harness; see
[the integration review](docs/integration-quality.md).

## Concurrency and reducer evaluation

The [fresh three-provider/Jev evaluation](docs/evaluation-results-2026-11-09.md)
measured concurrent retrieval and matched synthesis children. Brave/Perplexity
finished in about1s; Grok timed out at45s. Jev assessed ten sources in0.613s, but
the frozen preservation policy kept all ten: **no context reduction or demonstrated
synthesis-efficiency benefit**. Original and ranked reports took about39s each.

Reports, timings, usage and claim checks are preserved locally. No new searches
are needed to inspect them; `node eval/measure.mjs` recomputes metrics from the
captured evidence. All evaluation allowances are spent; AGY stays parked.

A subsequent [rank-only v2 pilot](docs/rank-only-v2-results.md) used a finer
ordinal score on the same ten sources. It took0.667s and put all three predefined
reference anchors in the top three (original order needed ten positions; coarse
v1 needed seven). All material remains available. This is a promising in-sample
reading-order result, not proven synthesis improvement or a new automatic tool.

## Boundaries

- No automatic fan-out, retries, provider fallback, or model escalation.
- Queries are passed as argument arrays, never shell strings.
- Existing provider guardrails and defaults are retained. Grok/AGY request/audit
  one native search; their audit is not a hard remote spending guarantee.
- Grok explicitly gets a 90s native deadline and 100s local deadline; other
  adapters keep 55s locally (AGY's native default remains45s, still parked).
  Use at least120s if setting a codemode timeout. Cancellation sends SIGTERM then
  escalates locally; remote work/billing may continue. The shared grok-x CLI's
  default is unchanged; this package passes its supported `--timeout 90` flag.
  Historical evaluation results used45s native Grok. The90s setting was exercised
  on November10: Grok completed in11.87s with a native excerpt-length warning;
  near-deadline recovery is still untested. `eval/collect.md` preserves the old
  frozen run's70s codemode limit and must not be reused unchanged.
- Search text and retrieved pages are untrusted data, not instructions.
- No automatic source-page reader: inspect selected originals with existing tools.
- No credential migration, authentication changes, or automatic artifact deletion.
- Live usability is the spike's test; comparative quality/efficiency is unproven.
