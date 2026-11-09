#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
: "${PI_RESEARCH_EXPERIMENT_DIR:?Set an approved durable experiment directory before launching the child}"
export PI_RESEARCH_ARTIFACT_DIR="$PI_RESEARCH_EXPERIMENT_DIR/searches"
export PI_RESEARCH_BUDGET_DIR="$PI_RESEARCH_EXPERIMENT_DIR/allowance"
# subagent --no-extensions also explicitly loads its own control bridge.
exec pi --approve --no-extensions --no-skills --no-mcp --no-prompt-templates \
  --extension "$ROOT/extensions/research.ts" --extension builtin:codemode "$@"
