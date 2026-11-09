#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Fixed approved run: tmux does not reliably forward arbitrary client env vars.
# Keep this path stable across relaunches; changing it grants a fresh allowance.
export PI_RESEARCH_EXPERIMENT_DIR="$ROOT/.artifacts/nvidia-live-2026-11-09"
export PI_RESEARCH_ARTIFACT_DIR="$PI_RESEARCH_EXPERIMENT_DIR/searches"
export PI_RESEARCH_BUDGET_DIR="$PI_RESEARCH_EXPERIMENT_DIR/allowance"
# subagent --no-extensions also explicitly loads its own control bridge.
exec pi --approve --no-extensions --no-skills --no-mcp --no-prompt-templates \
  --extension "$ROOT/extensions/research.ts" --extension builtin:codemode \
  --skill "$ROOT/skills/research-method/SKILL.md" "$@"
