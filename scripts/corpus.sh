#!/usr/bin/env bash
#
# corpus.sh — validate & debug the tree-sitter-ullbc grammar against Charon's
#             IR test corpus.
#
# This is the single tool for corpus work. The `corpus` CI job runs it with no
# arguments; humans (and Claude) use its flags to find out *which* files fail
# and *why*, down to the offending source line. When the grammar needs updating
# because Charon changed its pretty-printer, this is how you reproduce and
# localise every failure. See --help for the full contract.

set -euo pipefail

# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
corpus.sh — validate & debug tree-sitter-ullbc against Charon's IR corpus

USAGE
  scripts/corpus.sh [OPTIONS] [FILE ...]

WHAT IT DOES
  Regenerates the parser from grammar.js, then parses Charon IR dumps and
  reports parse errors. Only real IR dumps are checked: files whose first line
  is "# Final {U,}LLBC before serialization:". Other .out files (rustc panics,
  diagnostics) are skipped.

  With no FILE arguments it walks the whole corpus under
  <charon>/charon/tests/ui and prints a pass/fail summary. With one or more
  FILE arguments it parses just those files and always shows error detail.

MODES / OPTIONS
  -c, --charon DIR   Charon checkout to test against. Overrides $CHARON_DIR.
                     If neither is set, Charon is cloned into a temp dir
                     ($CHARON_REPO @ $CHARON_REF, default AeneasVerif/charon@main).
  -v, --verbose      For every failing file, print each ERROR/MISSING node with
                     the offending source line and a caret under the column.
                     (Always on when explicit FILEs are given.)
  -g, --group        Aggregate *why* things fail: collect the offending source
                     line of every error node across all failing files,
                     normalise away local names/numbers/strings, and print a
                     histogram of distinct constructs (most frequent first) with
                     a count and an example FILE:LINE for each. This is the fast
                     way to see "what new syntax do I need to support" without
                     piping the output through grep/sort/uniq yourself.
  -l, --list         Print only the newline-separated paths of failing files
                     (relative to the corpus root). Good for scripting / diffing.
  -s, --summary      Only print the final "OK/FAILED: n/m" summary line.
  -n, --no-generate  Skip `tree-sitter generate`; parse with the current
                     parser.c as-is (faster; use when grammar.js is unchanged).
  -m, --max-detail N In verbose mode, show at most N error nodes per file
                     (default: 5). Use 0 for unlimited.
      --no-record    Don't update scripts/tested-charon.txt on a clean full run.
  -h, --help         Show this help and exit.

CHARON VERSION TRACKING
  The Charon commit under test is always printed. After a *clean full run*
  (no FILE args, zero failures) the tested commit is written to
  scripts/tested-charon.txt (commit a working grammar together with that
  file). Because the CI job pins Charon@main, a red build tells you the
  grammar broke somewhere between the recorded hash and current main —
  bisect Charon across that range to find the pretty-printer change.

ENVIRONMENT
  CHARON_DIR    existing Charon checkout (same as --charon)
  CHARON_REPO   git URL to clone            (default: AeneasVerif/charon)
  CHARON_REF    git ref to clone            (default: main)
  TS            path to the tree-sitter CLI (default: ./node_modules/.bin/tree-sitter)

EXIT STATUS
  0  all checked dumps parse cleanly
  1  at least one dump has a parse error, or a setup problem occurred

EXAMPLES
  # Full run against a local Charon checkout (what you do while iterating):
  scripts/corpus.sh --charon ../charon

  # Just the list of failing files, to see the blast radius at a glance:
  scripts/corpus.sh --charon ../charon --list

  # Every failure with source context (find out *why* they fail):
  scripts/corpus.sh --charon ../charon --verbose

  # Drill into specific files (detail is automatic):
  scripts/corpus.sh --charon ../charon simple/hello-world.out arrays.out

  # CI form: clone Charon@main and check everything.
  scripts/corpus.sh
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
verbose=0
group=0
list_only=0
summary_only=0
do_generate=1
max_detail=5
record=1
charon="${CHARON_DIR:-}"
files=()

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--charon)      charon="$2"; shift 2 ;;
    -v|--verbose)     verbose=1; shift ;;
    -g|--group)       group=1; shift ;;
    -l|--list)        list_only=1; shift ;;
    -s|--summary)     summary_only=1; shift ;;
    -n|--no-generate) do_generate=0; shift ;;
    -m|--max-detail)  max_detail="$2"; shift 2 ;;
    --no-record)      record=0; shift ;;
    -h|--help)        usage; exit 0 ;;
    --)               shift; while [ $# -gt 0 ]; do files+=("$1"); shift; done ;;
    -*)               echo "error: unknown option: $1" >&2; echo "try: scripts/corpus.sh --help" >&2; exit 1 ;;
    *)                files+=("$1"); shift ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Explicit files always imply detailed output.
if [ "${#files[@]}" -gt 0 ]; then verbose=1; fi

# ---------------------------------------------------------------------------
# Locate the tree-sitter CLI
TS="${TS:-$root/node_modules/.bin/tree-sitter}"
if [ ! -x "$TS" ]; then TS="$(command -v tree-sitter || true)"; fi
if [ -z "$TS" ] || [ ! -x "$TS" ]; then
  echo "error: tree-sitter CLI not found. Run 'npm install' first." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Locate or fetch Charon
CHARON_REPO="${CHARON_REPO:-https://github.com/AeneasVerif/charon}"
CHARON_REF="${CHARON_REF:-main}"
cleanup=()
trap 'for d in "${cleanup[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done' EXIT

if [ -n "$charon" ]; then
  charon="$(cd "$charon" && pwd)"
  [ "$summary_only" -eq 1 ] || echo "Using Charon checkout: $charon"
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

# The exact Charon commit being tested — always reported, recorded on success.
charon_hash="$(git -C "$charon" rev-parse HEAD 2>/dev/null || echo unknown)"
charon_date="$(git -C "$charon" show -s --format=%cs HEAD 2>/dev/null || echo unknown)"
tested_file="$root/scripts/tested-charon.txt"
[ "$summary_only" -eq 1 ] || echo "Charon commit under test: ${charon_hash:0:12} ($charon_date)"

# ---------------------------------------------------------------------------
# Regenerate the parser so parser.c matches grammar.js
if [ "$do_generate" -eq 1 ]; then
  [ "$summary_only" -eq 1 ] || echo "Regenerating parser ..."
  if ! "$TS" generate >/dev/null 2>&1; then
    echo "error: tree-sitter generate failed:" >&2
    "$TS" generate >&2 || true
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# is_ir_dump FILE — true if FILE is a real IR dump we should check.
is_ir_dump() {
  head -n1 "$1" 2>/dev/null | grep -qE '^# Final U?LLBC before serialization:'
}

# print_detail FILE — show each ERROR/MISSING node with its source line.
# Parse output nodes look like:  (ERROR [row, col] - [row, col] ...)
print_detail() {
  local f="$1" shown=0
  # Collect "ROW COL KIND" for each error node (rows/cols are 0-based).
  while IFS= read -r line; do
    if [ "$max_detail" -ne 0 ] && [ "$shown" -ge "$max_detail" ]; then
      echo "      ... (more; raise --max-detail)"
      break
    fi
    local kind row col
    kind="$(printf '%s' "$line" | grep -oE '(ERROR|MISSING)' | head -n1)"
    row="$(printf '%s' "$line" | grep -oE '\[[0-9]+, [0-9]+\]' | head -n1 | grep -oE '[0-9]+' | head -n1)"
    col="$(printf '%s' "$line" | grep -oE '\[[0-9]+, [0-9]+\]' | head -n1 | grep -oE '[0-9]+' | sed -n 2p)"
    [ -n "$row" ] || continue
    local src caret
    src="$(sed -n "$((row + 1))p" "$f")"
    caret="$(printf '%*s' "$col" '')^"
    printf '      %s at line %d col %d:\n' "$kind" "$((row + 1))" "$col"
    printf '        %s\n' "$src"
    printf '        %s\n' "$caret"
    shown=$((shown + 1))
  done < <("$TS" parse "$f" 2>/dev/null | grep -E '\((ERROR|MISSING)')
}

# error_nodes FILE — emit "ROW<tab>COL" (0-based) for each ERROR/MISSING node.
error_nodes() {
  "$TS" parse "$1" 2>/dev/null | grep -E '\((ERROR|MISSING)' | \
    grep -oE '\[[0-9]+, [0-9]+\]' | head -n1000 | \
    while IFS= read -r coord; do
      printf '%s\t%s\n' \
        "$(printf '%s' "$coord" | grep -oE '[0-9]+' | head -n1)" \
        "$(printf '%s' "$coord" | grep -oE '[0-9]+' | sed -n 2p)"
    done
}

# print_group FILES... — aggregate offending source lines into a histogram of
# distinct constructs. Answers "which syntax is unsupported" in one shot.
print_group() {
  local f rel row col src
  {
    for f in "$@"; do
      [ -n "$f" ] || continue
      rel="${f#"$ui"/}"
      while IFS=$'\t' read -r row col; do
        [ -n "$row" ] || continue
        src="$(sed -n "$((row + 1))p" "$f")"
        printf '%s\t%s\t%s\n' "$rel" "$((row + 1))" "$src"
      done < <(error_nodes "$f")
    done
  } | awk -F'\t' '
      {
        src = $3; key = src
        gsub(/^[ \t]+/, "", key)             # trim leading indent
        gsub(/[ \t]+/, " ", key)             # collapse whitespace
        gsub(/"[^"]*"/, "\"S\"", key)        # string literals -> "S"
        gsub(/_[0-9]+/, "_N", key)           # local ids _17 -> _N
        gsub(/[0-9]+/, "N", key)             # remaining numbers -> N
        if (!(key in cnt)) { ex[key] = $1 ":" $2; exsrc[key] = src }
        cnt[key]++; nodes++
      }
      END {
        n = 0
        for (k in cnt) { keys[n] = k; n++ }
        # simple insertion sort by count desc (portable across awks)
        for (i = 1; i < n; i++) {
          kk = keys[i]; j = i - 1
          while (j >= 0 && cnt[keys[j]] < cnt[kk]) { keys[j+1] = keys[j]; j-- }
          keys[j+1] = kk
        }
        printf "  %d error node(s) across the failing files, %d distinct construct(s):\n\n", nodes, n
        for (i = 0; i < n; i++) {
          k = keys[i]
          s = exsrc[k]; sub(/^[ \t]+/, "", s)
          printf "  %5d  %s\n", cnt[k], s
          printf "         e.g. %s\n", ex[k]
        }
      }
    '
}

# ---------------------------------------------------------------------------
# Build the file work-list.
worklist=()
if [ "${#files[@]}" -gt 0 ]; then
  for arg in "${files[@]}"; do
    if [ -f "$arg" ]; then worklist+=("$arg")
    elif [ -f "$ui/$arg" ]; then worklist+=("$ui/$arg")
    else echo "error: no such corpus file: $arg" >&2; exit 1
    fi
  done
else
  while IFS= read -r f; do worklist+=("$f"); done < <(find "$ui" -name '*.out' | sort)
fi

# ---------------------------------------------------------------------------
# Parse everything.
total=0
fail=0
failed=()
for f in "${worklist[@]}"; do
  # For a full corpus walk, only check real IR dumps. Explicit files are checked
  # as-is (so you can point at anything).
  if [ "${#files[@]}" -eq 0 ]; then is_ir_dump "$f" || continue; fi
  total=$((total + 1))
  if "$TS" parse "$f" 2>/dev/null | grep -qE '\((ERROR|MISSING)'; then
    fail=$((fail + 1))
    failed+=("$f")
  fi
done

if [ "$total" -eq 0 ]; then
  echo "error: no ULLBC/LLBC dumps found to check under $ui" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Report.
if [ "$list_only" -eq 1 ]; then
  for f in "${failed[@]:-}"; do [ -n "$f" ] && echo "${f#"$ui"/}"; done
  [ "$fail" -eq 0 ] && exit 0 || exit 1
fi

if [ "$fail" -ne 0 ]; then
  if [ "$summary_only" -ne 1 ]; then
    echo
    if [ "$group" -eq 1 ]; then
      echo "FAILED: $fail / $total IR dumps have parse errors. Grouped by construct:"
      echo
      print_group "${failed[@]}"
      echo
    else
      echo "FAILED: $fail / $total IR dumps have parse errors:"
      for f in "${failed[@]}"; do
        echo "  ${f#"$ui"/}"
        [ "$verbose" -eq 1 ] && print_detail "$f"
      done
      echo
    fi
  fi
  echo "FAILED: $fail / $total IR dumps have parse errors."
  exit 1
fi

[ "$summary_only" -eq 1 ] || echo
echo "OK: all $total ULLBC/LLBC dumps parse cleanly."

# Record the tested commit after a clean *full* run (not single-file drilling),
# so the committed grammar is paired with a known-good Charon hash.
if [ "$record" -eq 1 ] && [ "${#files[@]}" -eq 0 ] && [ "$charon_hash" != unknown ]; then
  printf '%s\n' "$charon_hash" > "$tested_file"
  [ "$summary_only" -eq 1 ] || echo "Recorded tested Charon commit -> ${tested_file#"$root"/}"
fi
