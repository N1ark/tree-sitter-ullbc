#!/usr/bin/env bash
#
# Validate the tree-sitter-ullbc grammar against Charon's IR test corpus.
#
# Clones Charon (or reuses an existing checkout) and parses every ULLBC/LLBC
# dump under `charon/tests/ui`, asserting zero parse errors. Non-IR `.out`
# files (rustc panics / diagnostics) are skipped: only files whose banner is
# `# Final {U,}LLBC before serialization:` are checked.
#
# Usage:
#   ./scripts/check-corpus.sh
#
# Environment:
#   CHARON_DIR   use this existing Charon checkout instead of cloning
#   CHARON_REPO  git URL to clone        (default: AeneasVerif/charon)
#   CHARON_REF   git ref to clone        (default: main)
#   TS           path to the tree-sitter CLI (default: ./node_modules/.bin/tree-sitter)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

CHARON_REPO="${CHARON_REPO:-https://github.com/AeneasVerif/charon}"
CHARON_REF="${CHARON_REF:-main}"

# --- Locate the tree-sitter CLI -------------------------------------------
TS="${TS:-$root/node_modules/.bin/tree-sitter}"
if [ ! -x "$TS" ]; then
  TS="$(command -v tree-sitter || true)"
fi
if [ -z "$TS" ] || [ ! -x "$TS" ]; then
  echo "error: tree-sitter CLI not found. Run 'npm install' first." >&2
  exit 1
fi

# --- Locate or fetch Charon ------------------------------------------------
cleanup=()
trap 'for d in "${cleanup[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done' EXIT

if [ -n "${CHARON_DIR:-}" ]; then
  charon="$CHARON_DIR"
  echo "Using Charon checkout: $charon"
else
  tmp="$(mktemp -d)"
  cleanup+=("$tmp")
  charon="$tmp/charon"
  echo "Cloning $CHARON_REPO @ $CHARON_REF ..."
  git clone --depth 1 --branch "$CHARON_REF" "$CHARON_REPO" "$charon"
  echo "Charon commit: $(git -C "$charon" rev-parse --short HEAD)"
fi

ui="$charon/charon/tests/ui"
if [ ! -d "$ui" ]; then
  echo "error: $ui not found (is this a Charon checkout?)" >&2
  exit 1
fi

# --- Regenerate the parser so parser.c matches grammar.js ------------------
echo "Regenerating parser ..."
if ! "$TS" generate >/dev/null 2>&1; then
  echo "error: tree-sitter generate failed:" >&2
  "$TS" generate >&2 || true
  exit 1
fi

# --- Parse every IR dump ---------------------------------------------------
total=0
fail=0
failed=()
while IFS= read -r f; do
  # Only real IR dumps (skip stack traces and other diagnostic .out files).
  head -n1 "$f" | grep -qE '^# Final U?LLBC before serialization:' || continue
  total=$((total + 1))
  if "$TS" parse "$f" 2>/dev/null | grep -qE '\((ERROR|MISSING)'; then
    fail=$((fail + 1))
    failed+=("$f")
  fi
done < <(find "$ui" -name '*.out' | sort)

if [ "$total" -eq 0 ]; then
  echo "error: no ULLBC/LLBC dumps found under $ui" >&2
  exit 1
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "FAILED: $fail / $total IR dumps have parse errors:"
  for f in "${failed[@]}"; do
    echo "  ${f#"$ui"/}"
    "$TS" parse "$f" 2>/dev/null | grep -nE '\((ERROR|MISSING)' | head -3 | sed 's/^/      /'
  done
  exit 1
fi

echo
echo "OK: all $total ULLBC/LLBC dumps parse cleanly."
