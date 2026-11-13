# Market evidence inside pi-research

`market_research` is registered by the existing `extensions/research.ts`.
There is no separate market package or installation. Existing local pi-research
registrations pick it up on restart or `/reload`. Loading only registers tools;
it does not resolve ticker-cli, fetch data or initialize authentication.

## Internal ownership

- `src/providers/index.ts` exports separate discovery and market registries.
  The search provider union and URL/snippet contract remain unchanged.
- `src/providers/market.mjs` registers Yahoo; `yahoo/index.mjs` owns executable
  resolution, the one bounded history invocation, raw acquisition receipts,
  transport/JSON failures and provider-history validation.
- `src/market/research.mjs` orchestrates that provider, calculations and rendering.
- `src/market/analysis.mjs` computes indicators; `chart.mjs` renders them.
- `src/market/tool.ts` defines the tool registered by the research extension.

No orders, recommendations, classifiers, separate quote, provider fallback,
Python/chart install or runtime npm dependencies. The installed `ticker-cli`
is needed only when the tool is called. The package directory must be writable
for `.artifacts/market/`.

**Upstream authorization caveat:** inspected ticker-cli v0.1.0 can refresh
authentication and retry a failed chart request once. EU consent handling can POST
`agree=agree`. There is no CLI switch to disable these behaviors. Do **not** invoke
this tool under strict read-only-network / no-retry / no-auth-repair constraints.
Obtain explicit approval covering upstream behavior first, or wait for a compatible
upstream capability. The wrapper itself never retries, repairs auth, or falls back.
Permission guidance is not an enforcement sandbox.

## Use

After authorization, call:

```js
const r = await tools.market_research({
  instruments: [
    { symbol: "ASML.AS", currency: "EUR" },
    { symbol: "RHM.DE", currency: "EUR" }
  ]
});
text(r); // <=24000 JSON characters; inspect status, every record, and diagnostics
const chart = r.records.find(x => x.chartPath);
if (chart) image(await tools.read({ path: chart.chartPath }));
```

For direct tool callers, call `read({path: record.chartPath})` after
`market_research`. **A printed path is not model-visible image inspection.**
Codemode must explicitly forward the image with `image()`; it receives the
structured evidence object, not the direct tool's content blocks. This supported
path was exercised with the installed Pi reader and QuickJS Codemode offline.

Use exact Yahoo tickers and expected ISO currency, e.g. `AAPL/USD`,
`ASML.AS/EUR`, `RHM.DE/EUR`. No symbol search, aliases, implicit currency guesses,
FX conversion, or ticker/name normalization. Special instruments and non-ISO
quote units such as GBp are outside this small equity-oriented interface.

One request accepts 1–4 distinct instruments and invokes exactly one command:

```text
ticker-cli --range 1y --format json -- SYMBOL...
```

This is one **CLI invocation**, not one HTTP request: ticker-cli initializes a
session and requests daily histories sequentially. It may internally retry as
described above. Timeout 45s is a subprocess termination deadline; installed Pi
can take another 5s of force-kill grace. Executable hashing, compute, render and
persistence add time, so this is not a strict 45s end-to-end cap. Combined output
budget 2 MiB; no separate price call.

## Evidence and artifacts

Fixed top-level `kind: "evidence"`, including partial/failed acquisition.
`completed` means processing succeeded, **not** verified market facts or all
indicators warmed up. Per-indicator statuses are `complete`,
`insufficient_data`, or `undefined`. Render failure preserves computed evidence;
missing/invalid symbols remain separate failed records. Total failure sets Pi
`isError: true` but preserves structured content for Codemode.

Each UUID run under the pi-research package's `.artifacts/market/runs/` contains:
- `ticker.stdout.json`, `ticker.stderr.txt`: exact captured CLI UTF-8 output,
  including failed/partial output (not original Yahoo HTTP bytes).
- `acquisition.json`: command, binary/raw SHA-256, timestamps and transport state.
- `SYMBOL.series.json`: validated bars, full indicator series and summaries.
- `SYMBOL.png`: 1200×920 candlesticks + SMA50/200/Bollinger, volume, RSI and MACD.
- `result.json`: same bounded object returned to direct and Codemode callers.

Files are exclusively created read-only (0444), never reused for later live calls.
Hashes support checking lineage, not tamper-proof storage. Compute and render use
the same frozen validated bars; renderer consumes already-computed series.
Re-reading charts/series requires no acquisition. Artifacts persist until manually
removed; no cache, background task, auto-refresh, or automatic retention cleanup.

`acquiredAt` is acquisition start, `acquisitionFinishedAt` is end, and
`lastBarDate` is a provider date—not a live quote timestamp.
Timings separate fetch (CLI including session), per-symbol validation/compute,
render (including PNG write), and total. Total additionally includes local
executable resolution/hash and artifact writes. Cancellation before/between work
is checked; bounded synchronous calculation/render cannot be interrupted mid-loop.

### Compose inside pi-research

```js
const outcomes = (await Promise.allSettled([
  tools.market_research({ instruments: [{symbol:"AAPL",currency:"USD"}] })
])).map(o => o.status === "rejected" ? {...o, reason:String(o.reason)} : o);
const routes = await tools.research_route({outcomes});
text({routes, evidence:routes.evidence.map(i=>outcomes[i].value),
      rejected:routes.rejected.map(i=>outcomes[i])});
```

Evidence-only work needs **no classifier**. In an authorized mixed discovery run,
pass only unchanged `leads` outcomes to `research_reduce`; retain evidence and
rejections separately. Routing does not validate market facts or grant acquisition
permission. Both tools belong to this same package.

## Formulas and warm-up (`pi-market-indicators.v1`)

The schema ID `pi-market.v1` and formula ID are retained for compatibility with
captured evidence; they are not a separate package dependency.

All periods count validated observations, not calendar days. Never shortened.

| Measurement | Formula / minimum history |
|---|---|
| SMA20/50/200 | Arithmetic mean of last N closes; N bars |
| RSI14 | 100−100/(1 + avg gain / avg loss); Wilder alpha 1/14, mean of first 14 changes seed; **15 bars**. No losses =>100, no gains =>0; both zero =>null/undefined |
| ATR14 | TR=max(H−L, abs(H−previous C), abs(L−previous C)); first TR undefined; Wilder mean-seeded alpha 1/14; **15 bars** |
| MACD12/26 | EMA12−EMA26; each EMA arithmetic-mean seeded, alpha=2/(N+1); 26 bars |
| Signal9 / histogram | EMA9 of defined MACD / MACD−signal; 34 bars |
| Bollinger20 | SMA20 ± 2 population SD of closes (ddof=0); 20 bars; no %B claim |
| Volume20 / ratio | Mean of last 20 volumes **including latest**, latest/mean; 20 bars, zero denominator =>null |
| OBV | First bar zero; add/subtract current volume on higher/lower close, tie unchanged; 1 bar |

Formula, warm-up, observed count, status, value and seed date travel in summaries.
MACD's `seededAt` names its slow EMA seed; fast EMA seeds at observation 12,
signal at observation 34. The full series preserves their common history.
JS double precision is retained in artifacts; chart labels are presentation-rounded.
EMA/Wilder/OBV are history-dependent; warm-up is not convergence.

## Data-quality limits

- Reject the whole affected symbol for malformed, duplicate, unordered, future,
  nonfinite or inconsistent bars. Never sort, skip rows, fill gaps, or coerce strings.
  Positive equity OHLC <=1e12 and nonnegative safe-integer volume only; 1–400 bars.
- Require exact returned symbol, nonempty upstream name and matching expected
  currency. Exchange and ISIN remain null, identity independently unverified.
- **Yahoo is not exchange-grade. Adjustment is unknown.** v0.1.0 uses Yahoo
  quote OHLC, discards adjusted-close/corporate-action context, rounds OHLC to two
  decimals, and emits UTC dates. Do not assert adjusted or definitely unadjusted.
- Upstream missing numeric values can become zeros. Zero price rejects; zero
  volume remains visible with a warning. Raw upstream nulls cannot be recovered.
- Latest daily bar is included and may be incomplete. There is no exchange calendar
  or session-completion check. >7-calendar-day age and >4-day gaps are warning
  heuristics, not freshness/completeness guarantees. Corporate actions can distort TA.
- Charts show last 120 observations with full-history seeds and compressed date
  gaps. Missing warm-up lines stay absent. RSI 30/70 lines are visual conventions,
  not recommendations. No Fibonacci, support/resistance, 52-week, VWAP/institutional
  demand, crossing-event or confidence claims.

## Offline verification

```sh
cd /path/to/pi-research
npm test
PI_RESEARCH_PI_PACKAGE=/path/to/installed/@earendil-works/pi-coding-agent \
  npm run test:market-contact
```

Tests require no install, network, credentials or models. The contact uses public
Pi SDK loader/factory/reader APIs, real QuickJS execution, a fake ticker executable
and a minimal mocked nested-tool context—not a model session or full permission
hook integration. It loads only the pi-research package, asserting all eight tools
are registered exactly once. The router and market tool come from one extension.
Artifacts/logs persist under `.artifacts/market/`; `latest-contact.json` points to results.
The frozen two-symbol live capture in `tests/market/fixtures/` replays without
network calls and checks indicator summaries, full series hashes and PNG hashes.

**One expressly approved live ASML.AS/RHM.DE batch succeeded on 2026-11-12:**
256/254 daily bars respectively through 2026-11-12; observed tool batch **1.730s**
(fetch 1.672s, compute 4.441ms, render 42.777ms). Both PNGs were inspected;
offline replay reproduced bars, indicator series/summaries and byte-identical PNGs.
The [bounded replay fixtures](../tests/market/fixtures/README.md) preserve the
captured histories and reference numerical/chart hashes without machine paths.
Cents precision, unknown adjustment/session completion and unrecoverable upstream
null-to-zero loss remain limitations; RHM has a zero-volume bar on 2026-06-25
(missing versus zero unknown). This two-symbol single observation establishes
neither broad EU reliability, independent price accuracy nor p95. The previous
strict read-only/no-retry allowance was blocked, not used; new explicit permission
covering native session/consent/retry behavior superseded it. That one-batch
permission is consumed; no further live invocation is authorized.
This observation predates the packaging move. Migration verification uses the
saved capture only; it does not claim a fresh live test or renew that allowance.
