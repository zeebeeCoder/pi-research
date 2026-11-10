#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# New user-approved evaluation; never reset or redirect this allowance on failure.
export PI_RESEARCH_EXPERIMENT_DIR="$ROOT/.artifacts/nvidia-qualification-v3-2026-11-10"
export PI_RESEARCH_ARTIFACT_DIR="$PI_RESEARCH_EXPERIMENT_DIR/searches"
export PI_RESEARCH_BUDGET_DIR="$PI_RESEARCH_EXPERIMENT_DIR/allowance"
export PI_RESEARCH_QUALIFICATION_DIR="$PI_RESEARCH_EXPERIMENT_DIR/qualification"
exec pi --approve --no-extensions --no-skills --no-mcp --no-prompt-templates \
  --extension "$ROOT/extensions/research.ts" --extension builtin:codemode \
  --skill "$ROOT/skills/research-method/SKILL.md" "$@"
