# shellcheck shell=bash
# Shared search for the grep guards over application code (ADR 0259):
# check_no_direct_type_attributes_access.sh, check_no_guest_name_matching.sh
# and check_no_raw_guest_channels.sh. Source it; do not run it.
#
# Why it exists. All three guards used to run
#   rg -n -P "$PATTERN" --type ts --type py ... 2>/dev/null || true
# The CI runner (ubuntu-24.04, image 20260920.314.1) has no ripgrep, so `rg`
# was "command not found", the error went to /dev/null, `|| true` ate the exit
# code, and every guard printed PASS having searched nothing (CI run
# 36956858853: PASS in 12 ms over a tree where eight lines matched). The same
# shape check_no_direct_stock_writes.sh had with `rg --type tsx`.
#
# What it does instead:
#   - searches with `git grep`, which every checkout already has, over the
#     files rg used to see: tracked plus untracked-not-ignored (.gitignore is
#     honoured, so node_modules and build output stay out);
#   - exits 2 (CANNOT CHECK, which blocks like a failure) when git is missing,
#     the tree is not a repository, the corpus is too small to be this repo,
#     or the search itself errors;
#   - offers acg_self_test, which proves on the real tree that the guard
#     reaches .ts/.tsx/.py files, fires on a seeded line, and refuses to pass
#     without git.

# The corpus rg's `--type ts --type py` covered, minus tests.
ACG_PATHSPECS=(
  'apps/*.ts' 'apps/*.tsx' 'apps/*.cts' 'apps/*.mts' 'apps/*.py' 'apps/*.pyi'
  'services/*.ts' 'services/*.tsx' 'services/*.cts' 'services/*.mts' 'services/*.py' 'services/*.pyi'
  'scripts/*.ts' 'scripts/*.tsx' 'scripts/*.cts' 'scripts/*.mts' 'scripts/*.py' 'scripts/*.pyi'
  ':!*.spec.ts' ':!*.test.ts' ':!*.spec.tsx' ':!*.test.tsx'
)

# Fewer files than this is not this repository (it holds thousands).
ACG_MIN_CORPUS=200

# To stderr, so a call inside $(...) still reaches the log.
acg_cannot_check() {
  {
    echo "CANNOT CHECK — $1"
    echo "  This is exit 2, never a pass: a guard that searched nothing gives the"
    echo "  same answer as one that looked and found health."
  } >&2
  exit 2
}

# Moves to the repository root, or exits 2.
acg_enter_repo() {
  local here="${BASH_SOURCE[1]:-$0}" dir=.
  [[ "$here" == */* ]] && dir="${here%/*}"
  command -v git >/dev/null 2>&1 || acg_cannot_check "git is not on PATH."
  local top
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" \
    || acg_cannot_check "${dir} is not inside a git repository."
  cd "$top" || acg_cannot_check "cannot enter ${top}."
}

# Sets ACG_CORPUS_COUNT, ACG_TSX_COUNT and ACG_PY_COUNT, or exits 2.
acg_measure_corpus() {
  local files rc f
  files="$(git ls-files --cached --others --exclude-standard -- "${ACG_PATHSPECS[@]}")"
  rc=$?
  [[ $rc -eq 0 ]] || acg_cannot_check "listing the corpus failed (git ls-files exit ${rc})."
  ACG_CORPUS_COUNT=0 ACG_TSX_COUNT=0 ACG_PY_COUNT=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    ACG_CORPUS_COUNT=$((ACG_CORPUS_COUNT + 1))
    [[ "$f" == *.tsx ]] && ACG_TSX_COUNT=$((ACG_TSX_COUNT + 1))
    [[ "$f" == *.py ]] && ACG_PY_COUNT=$((ACG_PY_COUNT + 1))
  done <<< "$files"
  if [[ $ACG_CORPUS_COUNT -lt $ACG_MIN_CORPUS ]]; then
    acg_cannot_check "the corpus is ${ACG_CORPUS_COUNT} files under apps/, services/ and scripts/; that is not this repo."
  fi
}

# Prints `file:line:content` for every line matching the PCRE in $1, or exits 2.
acg_search() {
  local out rc
  out="$(git grep -n -I -P --untracked -e "$1" -- "${ACG_PATHSPECS[@]}" 2>&1)"
  rc=$?
  case $rc in
    0) printf '%s\n' "$out" ;;
    1) ;;
    *) acg_cannot_check "the search failed (git grep exit ${rc}): ${out:0:300}" ;;
  esac
}

# Trims surrounding whitespace, as the allowlists compare.
acg_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# True when `file:line:content` is a comment line: //, /*, * in TypeScript, # in Python.
acg_is_comment_line() {
  local hit="$1" file="${1%%:*}" content
  content="${hit#*:}"; content="${content#*:}"
  content="$(acg_trim "$content")"
  case "$file" in
    *.py|*.pyi) [[ "$content" == '#'* ]] ;;
    *) [[ "$content" == '//'* || "$content" == '/*'* || "$content" == '*'* ]] ;;
  esac
}

# True when `file:line:content` matches an ALLOWLIST entry `file|trimmed content`.
# Keyed on content, not line number, so an exemption cannot drift onto a new line.
acg_is_allowlisted() {
  local hit="$1" file="${1%%:*}" content entry
  shift
  content="${hit#*:}"; content="${content#*:}"
  content="$(acg_trim "$content")"
  for entry in "$@"; do
    if [[ "$file" == "${entry%%|*}" && "$content" == "${entry#*|}" ]]; then
      return 0
    fi
  done
  return 1
}

# acg_self_test GUARD SEED_LINE_TS SEED_LINE_PY
# Proves, against the real tree, that GUARD reaches .tsx and .py files, fails
# on a line it exists to catch in each, and refuses to pass without git.
acg_self_test() {
  local guard="$1" seed_ts_line="$2" seed_py_line="$3"
  local seed_ts="apps/acg-self-test-$$.tsx" seed_py="scripts/acg-self-test-$$.py"
  local out rc failed=0
  # shellcheck disable=SC2064
  trap "rm -f '$seed_ts' '$seed_py'" EXIT

  acg_measure_corpus
  if [[ $ACG_TSX_COUNT -lt 1 || $ACG_PY_COUNT -lt 1 ]]; then
    echo "  FAIL reach: ${ACG_TSX_COUNT} .tsx and ${ACG_PY_COUNT} .py files in the corpus; both must be searched."
    failed=1
  else
    echo "  ok — reach: ${ACG_CORPUS_COUNT} files, ${ACG_TSX_COUNT} of them .tsx and ${ACG_PY_COUNT} .py."
  fi

  printf '%s\n' "$seed_ts_line" > "$seed_ts"
  out="$("$BASH" "$guard" 2>&1)"; rc=$?
  if [[ $rc -eq 1 && "$out" == *"$seed_ts"* ]]; then
    echo "  ok — fires on a seeded .tsx line (exit 1, names ${seed_ts})."
  else
    echo "  FAIL fires-tsx: exit ${rc}, seed ${seed_ts} not reported."
    failed=1
  fi
  rm -f "$seed_ts"

  printf '%s\n' "$seed_py_line" > "$seed_py"
  out="$("$BASH" "$guard" 2>&1)"; rc=$?
  if [[ $rc -eq 1 && "$out" == *"$seed_py"* ]]; then
    echo "  ok — fires on a seeded .py line (exit 1, names ${seed_py})."
  else
    echo "  FAIL fires-py: exit ${rc}, seed ${seed_py} not reported."
    failed=1
  fi
  rm -f "$seed_py"

  out="$(PATH="/nonexistent-acg-$$" "$BASH" "$guard" 2>&1)"; rc=$?
  if [[ $rc -eq 2 && "$out" == *"git is not on PATH"* ]]; then
    echo "  ok — without git it exits 2, not 0."
  else
    echo "  FAIL no-git: exit ${rc} (want 2 naming git): ${out:0:200}"
    failed=1
  fi

  out="$( (acg_search '(') 2>&1 )"; rc=$?
  if [[ $rc -eq 2 ]]; then
    echo "  ok — a search that errors exits 2, not 0."
  else
    echo "  FAIL search-error: exit ${rc} (want 2)."
    failed=1
  fi

  if [[ $failed -ne 0 ]]; then
    echo "SELF-TEST FAILED — ${guard} cannot be trusted to fail."
    exit 1
  fi
  echo "SELF-TEST PASSED — ${guard} reaches the tree, fires on its shape, and cannot pass blind."
}
