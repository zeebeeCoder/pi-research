# Machine-local upstream patches

`grok-x-structured-output.patch` is applied to the existing shared skill at
`/home/sagent/vaults/skills/grok-x` (also symlinked from `~/.pi/agent/skills/grok-x`).
That directory is not a Git repository, so this patch versions the small upstream
change without vendoring or rewriting the provider client.

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

Original private backups and live repair artifacts are under
`.artifacts/provider-repair-2026-11-09/`. Live compatibility is pending; no schema
compliance or efficiency guarantee is implied by the flag alone.
