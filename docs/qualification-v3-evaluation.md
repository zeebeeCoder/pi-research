# Qualification v3 — independent bounded-run evaluation

**Outcome: PARTIAL.** The actual extension workflow passed preservation, frozen-question and response-validation checks. Whole-research verification is limited by four failed original-page inspections and a semantic qualification-label overreach. No package code, profile, launcher, request/response file or git state was edited.

## Run identity and boundaries

Evaluator: **openai-codex/gpt-6.1-sol, high**, confirmed from `PI_PROVIDER`, `PI_MODEL` and `PI_REASONING_LEVEL`; no fallback or child agent. Start: **2026-11-10 07:12:29.504 UTC**. The actual clock yielded **November 4 inclusive–November 11 exclusive**, seven UTC dates including partial November 10. Framing/discovery as-of: **07:13:04.470 UTC**.

`describeTool` confirmed registration of `research_search`, `research_prepare` and `research_review`. Code, frozen profile, skill and supplied runner were read. The unchanged runner executed once; no additional classifier call or synthetic fixture was used.

## Observed outcomes

| Phase | Result | Wall time |
|---|---|---:|
| Brave | Completed, 5 leads; cost unknown | 1.041 s |
| Perplexity search | Completed, 5 leads; cost unknown | 1.212 s |
| Grok | Completed, 5 leads; native schema warning | 11.870 s |
| Independent search batch | One call/provider, no retries | 11.871 s |
| Original-page inspection | 4 DNS failures, no HTTP response | 24.031 s summed |
| Preparation | 15 sources, 30 requests, no oversized items | 17 ms outer / 2.758 ms internal |
| Jev ranking | 15 valid responses | 742 ms |
| Jev provenance | 15 valid responses | 720 ms |
| Classifier runner | 30 calls, peak concurrency 4 | 1.462 s |
| Report production | 07:15:22.575–07:16:07.817 UTC | 45.242 s |
| Start through report completion | Includes framing, inspection and authoring | **218.313 s** |

The Grok warning explicitly reports an excerpt exceeding its native 220-character schema limit; normalized excerpts were clipped. This was completion with warnings, not warning-free schema compliance. All eight clipped leads remain marked in the corpus. No provider failed; failure/error-envelope branches were therefore not exercised.

Page selection covered the NVIDIA index, Reuters H200 imports, DCD customer-mix rules and Bloomberg-syndicated RTX expectations. Every attempt failed hostname resolution before fetching. Empty raw-body files and failure metadata are retained. No redirects, retries, login/bypass, linked-page or profile reads occurred.

## Preservation and structural verification

**30 artifact checks passed; none failed.** Actual raw provider JSON re-normalizes to exactly the saved source values. Complete search envelopes, original source fields, prepared sources and reviewed sources match. All **15 sources are retained; zero excluded**. Fourteen enter the ranked view; the navigation-only homepage remains in needs-context. Every source remains in needs-evidence.

Every prepared request uses its pass’s frozen questions, the original question/window and public source-only state. Profile SHA256:

`9149ac391398cd6d50b4bddc6c43689c80e2ea5e42630d958c1bf16f165be8fd`

Two responses/source, correct `typesafe/jev-latest`, no duplicate calls, valid types/ranges/labels/distributions, and maximum observed concurrency four were verified. Jev usage: **38,714 input + 2,732 output = 41,446 tokens**. Its reported zero catalog-cost estimate is not evidence of free billing. Known provider subtotal: **$0.055764**, Grok only; Brave, Perplexity, evaluator and parent costs are not included.

Five timezone-free Brave timestamps correctly remain ambiguous. DCD’s provider date November 2 conflicts with displayed November 4; AMD’s November 4 repeat has a November 3 dateline/event context. The report does not substitute publication metadata for a confirmed event date.

## Important findings, without repairs

1. **Raw-answer flag indexes:** `src/qualification.ts:143–144` derives material/concern indexes without requiring valid pass status. No invalid response occurred here; this is a code-visible hardening issue, not a demonstrated invalid-output event.
2. **Prepared-request consistency:** `src/qualification.ts:113–114` checks the saved profile hash but does not verify saved request questions/state against profile/items. Independent comparisons pass on this run’s unchanged files. No tampering test was performed.
3. **Semantic overreach:** Jev labels all 15 items “material qualification,” including B3’s pure newsroom navigation (probability 0.71) and generic B4 cost commentary. B3 supplies no explicit substantive qualification. Structural validity does not establish semantic correctness or useful selectivity.
4. **Reading-order trade-off:** A bot lead, G4, ranks second; repeated reporting occupies several early positions. This is not independent confirmation or measured human sentiment.

All 15 authenticity and all 15 source-credibility labels are **unknown**. This fits the absence of inspected identity/profile evidence; no positive authenticity/credibility claim or inferred AI authorship needs endorsement.

## Research report, claims and diagnostic

The 487-word `report.md` distinguishes reported import/delivery/customer-mix constraints, an unconfirmed Oracle index lead, pre-window AMD context and conditional capacity commentary. It preserves limited imports and existing-lease protection; it does not confirm a fresh company announcement or repeat a personal allegation as established fact.

`claims.json`: **10 claims, 11 exact supporting quotations; all IDs and quote containment pass**. Separate manual review found no unsupported external factual statement within the report’s expressly attributed, snippet-only scope. Quote containment does not authenticate or prove those statements.

The pre-classifier checklist has six anchors. Coverage at 1/3/5 is **1/1/1 original versus 1/2/3 ranked**; depth to all anchors is **10 original versus 13 ranked**. This is only a reading-order diagnostic, not evidence of research quality, synthesis benefit or generalization.

## Evidence and untested areas

Run root: `/home/sagent/code/opti/pi-research/.artifacts/nvidia-qualification-v3-2026-11-10`.

Key files: `preflight.json`, `retrieval.json`, `corpus.json`, `inspections-fetch.json`, `reference-review.json`, `source-register.json`, `preparation-metrics.json`, `classifier.json`, `responses/`, `report-timing.json`, `report.md`, `claims.json`, `verification.json`, `metrics.json`, and `native-normalization-verification.json`. Frozen prepared/review artifacts are under `qualification/8b7cde6f-627e-4c5b-9f76-3d50f0a6ebe9/`.

Successful HTTP inspection, redirect/private-address rejection behavior, independently supported provenance, provider failures, classifier invalid/error/missing responses, interruption, oversized state and allowance collisions were **not live-tested**. Error lanes were code-reviewed only. No matched synthesis control exists; no causal speedup versus old runs is claimed. Verification/register/document overhead is recorded separately in `metrics.json`, not hidden in provider timing.

**No human acceptance or PIR-1000 completion claim.**
