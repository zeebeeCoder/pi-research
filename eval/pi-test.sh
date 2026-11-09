#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Explicitly approved evaluation, separate from spent earlier allowances.
export PI_RESEARCH_EXPERIMENT_DIR="$ROOT/.artifacts/nvidia-eval-2026-11-09"
export PI_RESEARCH_ARTIFACT_DIR="$PI_RESEARCH_EXPERIMENT_DIR/searches"
export PI_RESEARCH_BUDGET_DIR="$PI_RESEARCH_EXPERIMENT_DIR/allowance"
exec pi --approve --no-extensions --no-skills --no-mcp --no-prompt-templates \
  --extension "$ROOT/extensions/research.ts" --extension builtin:codemode \
  --skill "$ROOT/skills/research-method/SKILL.md" "$@"
