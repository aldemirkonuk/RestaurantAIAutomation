#!/usr/bin/env bash
#
# Wrapper-level test for scripts/check_decision_claims.sh.
#
# _claims_parse.py --self-test proves the PARSER's verdicts. It cannot see what
# the shell runner does with them, and that is where the guard failed open until
# 2026-09-26: the runner's `case $?` named 3/4/5/6 and nothing else, so a parser
# crash (exit 1) or an unreadable input (exit 2) matched no arm, the loop
# counted zero claims, and the run printed PASS, exit 0. The parser's self-test
# was 10/10 and CI was green the whole time.
#
# So this builds a throwaway tree with the REAL runner and helpers copied in,
# breaks one thing per case, and asserts on the runner's own exit code and words.
# Each case pins one arm: removing the `*)` arm, the zero-claims check, or the
# absolute script-dir resolution each turns at least one case red.
#
set -uo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)" || { echo "FAIL — cannot resolve scripts dir"; exit 2; }
HELPERS="check_decision_claims.sh _claims_parse.py _od_collisions.py check_od_ids_exist.py _migration_versions.py"
for f in $HELPERS; do
  [ -f "$SRC/$f" ] || { echo "FAIL — $SRC/$f is missing; this test has nothing to test"; exit 2; }
done

WORK="$(mktemp -d)" || { echo "FAIL — mktemp"; exit 2; }
trap 'chmod -R u+rwx "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

GOOD='{"id":"OD-1","status":"resolved","claim":"true is true","verify":"true","verified":"2026-01-01"}'
NUMERIC_ID='{"id":215,"status":"resolved","claim":"x","verify":"true","verified":"2026-01-01"}'

# fixture <name> <claims-jsonl-line>  -> prints the tree's root
fixture() {
  local root="$WORK/$1"
  mkdir -p "$root/scripts" "$root/.planning/decisions" "$root/supabase/migrations"
  local f; for f in $HELPERS; do cp -p "$SRC/$f" "$root/scripts/"; done
  printf '## Open\n\n| OD-1 | x |\n\n## Resolved\n\n' > "$root/.planning/decisions/OPEN-DECISIONS.md"
  : > "$root/supabase/migrations/20260101000000_fixture.sql"
  printf '%s\n' "$2" > "$root/.planning/decisions/CLAIMS.jsonl"
  printf '%s' "$root"
}

# stub_parser <root> <python-body>  -> replaces the tree's parser with a stub
stub_parser() {
  printf 'import sys\n%s\n' "$2" > "$1/scripts/_claims_parse.py"
}

PASS_LINE="PASS — every executable claim still describes reality."
pass=0; fail=0
# expect <label> <want-exit> <want-substring> <dir-to-run-from> <command...>
expect() {
  local label="$1" want_rc="$2" want_out="$3" dir="$4"; shift 4
  local out rc
  out="$(cd "$dir" && "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq "$want_rc" ] && printf '%s' "$out" | grep -qF -- "$want_out" \
     && { [ "$want_rc" -eq 0 ] || ! printf '%s' "$out" | grep -qF "$PASS_LINE"; }; then
    echo "   ok   $label"; pass=$((pass + 1))
  else
    echo "   FAIL $label"
    echo "        wanted exit $want_rc containing '$want_out', got exit $rc:"
    printf '%s\n' "$out" | sed 's/^/        | /' | tail -n 8
    fail=$((fail + 1))
  fi
}

r="$(fixture root "$GOOD")"
expect "a good claim passes, run from the repo root" \
  0 "1 checked, 1 holding" "$r" ./scripts/check_decision_claims.sh

r="$(fixture inside "$GOOD")"
expect "a good claim passes, run from inside scripts/ (dirname is lexical)" \
  0 "1 checked, 1 holding" "$r/scripts" ./check_decision_claims.sh

r="$(fixture numeric "$NUMERIC_ID")"
expect "an unquoted numeric id is MALFORMED, not a crash that reads as PASS" \
  2 "malformed lines" "$r" ./scripts/check_decision_claims.sh

r="$(fixture crash "$GOOD")"; stub_parser "$r" 'raise TypeError("simulated parser crash")'
expect "a parser crash (exit 1) is caught by the default arm" \
  2 "claims parser exited 1" "$r" ./scripts/check_decision_claims.sh

r="$(fixture cannot "$GOOD")"; stub_parser "$r" 'sys.exit(2)'
expect "a parser that could not read its input (exit 2) is caught by the default arm" \
  2 "claims parser exited 2" "$r" ./scripts/check_decision_claims.sh

r="$(fixture gone "$GOOD")"; rm -f "$r/scripts/_claims_parse.py"
expect "a missing parser file is caught by the default arm" \
  2 "claims parser exited 2" "$r" ./scripts/check_decision_claims.sh

r="$(fixture silent "$GOOD")"; stub_parser "$r" 'sys.exit(0)'
expect "a parser that says 0 and emits nothing is a zero-claims FAIL, not PASS" \
  2 "zero claims were checked" "$r" ./scripts/check_decision_claims.sh

if [ "$(id -u)" -ne 0 ]; then
  r="$(fixture unreadable "$GOOD")"; chmod 000 "$r/.planning/decisions/CLAIMS.jsonl"
  expect "an unreadable register is caught by the default arm" \
    2 "claims parser exited 2" "$r" ./scripts/check_decision_claims.sh
else
  echo "   skip an unreadable register (running as root: chmod 000 does not deny root)"
fi

echo "== check_decision_claims.sh wrapper: $pass ok, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ] || { echo "FAIL"; exit 1; }
echo "PASS"
