# Page-reading integration and unresolved DNS investigation

Recorded 13 November 2026. This is an evidence record, not a claim that all page
reads are reliable or that the observed navigation failures have been fixed.

## Lifecycle decision

A six-URL batch failed because the shared capture service was unavailable while
pi-research required connect-only access (`--no-auto-start`). Chrome itself was
connected. SC's on-demand services intentionally idle-exit; connect-only consumers
therefore need an independently maintained service.

The approved policy now delegates coordinated acquisition, shared capacity and
idle shutdown to SC. The adapter submits one capture batch without
`--no-auto-start`. Agents do not run `serve`, kill services or delete sockets.
Live foreign/incompatible services are not replaced. A failed capture is not
replayed automatically. Discovery remains independent of browser availability.

## Live Hacker News contact

- One loaded front-page snapshot yielded 30 ranked story links.
- All 30 were submitted in five concurrent calls, six URLs each.
- Snapshot: 2.318 seconds; expansion: 60.471 seconds.
- 12 captures completed; 18 failed with `net::ERR_NAME_NOT_RESOLVED`.
- Successful captures were retained in partial batches; no cleanup errors reported.
- No pagination or batch retries. Capture completion is not article completeness.

This demonstrated concurrent invocation through the shared service, but was not
a clean end-to-end success. Peak tab count and cold startup were not measured in
this first contact. Loaded error wording incorrectly asserted that no service was
started; the source diagnostic now avoids making that unsupported assertion.

## Bounded follow-up

The SC owner examined original receipts and ran controlled tests using the failed
HN item, failed GitHub project and HN homepage control:

1. Exact shared capture path, isolated services: all three targets succeeded both
   serially and across two independent callers. Six target navigations, no retries.
2. Scoped browser instrumentation: all three succeeded in serial and concurrent
   rounds, with matching document identifiers and independent CDP Document
   HTTP 200 / loadingFinished evidence. Twelve navigations total, including six
   blank-tab bootstraps; no retries or measured event losses.

Peak owned tabs in concurrent tests was two, with queued work released after a
slot became available. Owned tabs/services were cleaned up and diagnostic
attachments detached. Original user tabs remained unchanged. The diagnostic hook
was left opt-in/inactive, not permanently monitoring unrelated browsing.

## Finding and limitations

**NON-REPRODUCED: the original cause remains unresolved. No navigation fix or
blanket retry policy is justified.**

Original failures were main-frame Chrome resolution errors during page loading.
The receipt/source review found no evidence of cross-tab attribution or subframe
promotion. Later successful OS resolution and browser loads do not explain the
original failure. Neither intermittent DNS nor an SC defect has been established.

Prearming diagnostics required an owned blank tab before target navigation; this
changes creation timing. Debugger attachment and warm browser state can influence
reproduction. The original run lacks complete independent network/event traces.
A separately characterized missing-documentId attribution gap was not shown to
cause these failures.

## Local evidence and verification

Ignored local artifacts (not included in this commit):

- pi-research: `.artifacts/hn-parallel-integration-1794521657127/`
- pi-research: `.artifacts/hn-dns-rca-1794521903450/`
- SC repository: `artifacts/hn-dns-scoped-20261113/report.md`
- SC offline verifier: `bash artifacts/hn-dns-scoped-20261113/verify.sh`

The SC owner reported 33 targeted tests plus CLI typecheck/lint and artifact
correlation/privacy/deployment checks passing. Background typechecking retained
34 pre-existing errors, with no new error tuples from the diagnostic change.

Future live investigation needs a fresh bounded scope. These records do not
authorize replaying the 30-link batch, changing DNS settings or restarting Chrome.
