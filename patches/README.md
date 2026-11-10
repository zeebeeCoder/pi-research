# Machine-local upstream patches

`grok-x-structured-output.patch` is applied to the existing shared skill at
`~/.pi/agent/skills/grok-x` (which may be a symlink).
This patch versions the small upstream change without vendoring or rewriting
the provider client.

Base `scripts/grok-x.js` SHA-256:
`d4d1f621f6dddccad2d005dd74ea09139d753fa92df0572d4e60111c485ab48d`

The patch asks Grok's CLI for the existing scout JSON schema and repeats the
required output shape in the final instruction. The native-call audit, query
matching, one-search limit, timeout, post validation, and all permissions remain
unchanged. No raw native post objects are silently reinterpreted as accepted leads.

Only apply to a matching reviewed baseline; do not apply twice:

```sh
cd /path/to/skills/grok-x
patch --dry-run -p1 < /path/to/pi-research/patches/grok-x-structured-output.patch
patch -p1 < /path/to/pi-research/patches/grok-x-structured-output.patch
```

Patched script SHA-256:
`ade9eaca9f3b9194040f255babeb4bf0f64c34411cbad4aa6af0dc133c8ab9c6`

Original private backups and live repair artifacts are under
`.artifacts/provider-repair-2026-11-09/`. One authorized real call on Grok Build
1.0.70 returned four accepted leads in 11.239s, one audited native search and one
model call, reported cost $0.041042. This follow-up invoked the same adapter via
Bun directly, not another child; the original child already verified the tool paths.

**Remaining caveat:** native `structuredOutputError` reported an excerpt over 220
characters. The existing normalizer accepted the valid record shape, clipped the
excerpt and marked it `truncated`; it was not changed. Thus normalized discovery
output works, but full native-schema compliance is NOT proven. The CLI flag is
not assumed to enforce all constraints. Do not remove the limit, ignore the
warning in evaluation, or claim independently verified evidence. Two returned
leads were @grok bot replies, not independent human corroboration.

AGY has not been called again: its new allowance is reserved until the human
finishes interactive authentication. The original four-provider allowance and
report are untouched.
