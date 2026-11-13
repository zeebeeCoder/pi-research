# Frozen Yahoo history regression fixtures

These are intentional, bounded test inputs—not generated run output to ignore.

- `yahoo-2026-11-12.json`: exact ticker-cli JSON stdout from one approved history
  batch on 2026-11-12. Two EUR equities only: ASML.AS (256 daily bars) and RHM.DE
  (254), covering 2025-11-12 through 2026-11-12. The file is 84,130 bytes.
- `yahoo-2026-11-12.expected.json`: 9,612 bytes of reference metadata, warnings,
  numerical summaries, raw hash, full indicator-series hashes and PNG hashes
  retained from that run. No absolute artifact paths or binary/image blobs.

The raw records contain only symbol, public company name, currency and daily
OHLCV points. They contain no HTTP headers, cookies, credentials, account or
portfolio information. Raw data is CLI output, not original Yahoo HTTP bytes;
cent rounding, missing-versus-zero loss, unknown adjustments and uncertain bar
completion remain material. RHM has a zero-volume observation on 2026-06-25.
These records are not independently verified price facts or fresh quotes.

`../replay.test.mjs` freezes acquisition time and uses an in-process fake
transport. It verifies the raw hash and reproduces summaries, full numerical
series hashes and both PNG hashes through the integrated provider/module path.
No network request or classifier is made; another live allowance is not implied.
The test is self-contained and does not require the retired sibling package.

Do not refresh fixtures automatically, silently regenerate expected hashes from
changed implementation, or infer current market behavior from this frozen sample.
