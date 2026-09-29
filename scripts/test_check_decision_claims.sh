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
# ADR 0238 (2026-09-29) froze CLAIMS.jsonl and v3.0-TECH-DEBT.md at a pinned line
# count behind a sentinel, and moved new entries into claims.d/ and tech-debt.d/.
# Every fixture tree therefore carries a sentinel, both fragment directories and a
# small debt register, and `pin` rewrites the COPIED runner's two pin constants
# to the fixture's own line counts. The real runner has no override: a pin is
# changed by editing it, in review, or not at all. The cases at the bottom prove
# each freeze and fragment rule, and that fragments merge where tail appends
# conflict.
#
set -uo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)" || { echo "FAIL — cannot resolve scripts dir"; exit 2; }
HELPERS="check_decision_claims.sh _claims_parse.py _od_collisions.py check_od_ids_exist.py _migration_versions.py _debt_frozen.py"
for f in $HELPERS; do
  [ -f "$SRC/$f" ] || { echo "FAIL — $SRC/$f is missing; this test has nothing to test"; exit 2; }
done

WORK="$(mktemp -d)" || { echo "FAIL — mktemp"; exit 2; }
trap 'chmod -R u+rwx "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

GOOD='{"id":"OD-1","status":"resolved","claim":"true is true","verify":"true","verified":"2026-01-01"}'
NUMERIC_ID='{"id":215,"status":"resolved","claim":"x","verify":"true","verified":"2026-01-01"}'

GOOD2='{"id":"OD-2","status":"resolved","claim":"a fragment claim","verify":"true","verified":"2026-01-01"}'
SENTINEL='{"_comment": "FROZEN 2026-01-01 (fixture). Nothing may follow this line or be added above it: new claims go in claims.d/"}'
PIN_FAILED="$WORK/PIN_FAILED"

# pin <root>  -> sets the COPIED runner's two pins to the fixture's own line counts.
# If the constants cannot be found (renamed, or a runner that predates ADR 0238)
# every case fails: a freeze case must never pass on a runner that has no pin.
pin() {
  local run="$1/scripts/check_decision_claims.sh" c d
  c=$(( $(wc -l < "$1/.planning/decisions/CLAIMS.jsonl") ))
  d=$(( $(wc -l < "$1/.planning/v3.0-TECH-DEBT.md") ))
  sed -i.bak -e "s/^CLAIMS_FROZEN_LINES=[0-9]*/CLAIMS_FROZEN_LINES=$c/" \
             -e "s/^DEBT_FROZEN_LINES=[0-9]*/DEBT_FROZEN_LINES=$d/" "$run" && rm -f "$run.bak"
  grep -qx "CLAIMS_FROZEN_LINES=$c" "$run" && grep -qx "DEBT_FROZEN_LINES=$d" "$run" \
    || echo "cannot set the pins in $run" >> "$PIN_FAILED"
}

# fixture <name> <claims-jsonl-line>  -> prints the tree's root
fixture() {
  local root="$WORK/$1"
  mkdir -p "$root/scripts" "$root/.planning/decisions/claims.d" "$root/.planning/tech-debt.d" \
           "$root/supabase/migrations"
  local f; for f in $HELPERS; do cp -p "$SRC/$f" "$root/scripts/"; done
  printf '## Open\n\n| OD-1 | x |\n\n## Resolved\n\n' > "$root/.planning/decisions/OPEN-DECISIONS.md"
  : > "$root/supabase/migrations/20260101000000_fixture.sql"
  printf '%s\n%s\n' "$2" "$SENTINEL" > "$root/.planning/decisions/CLAIMS.jsonl"
  printf '# Fixture debt register\n\n## An old entry — OPEN — 2026-01-01\n\nBody.\n\n## FROZEN — new entries live in .planning/tech-debt.d/ (fixture)\n\nPointer.\n' \
    > "$root/.planning/v3.0-TECH-DEBT.md"
  printf '# claims.d\n' > "$root/.planning/decisions/claims.d/README.md"
  printf '# tech-debt.d\n' > "$root/.planning/tech-debt.d/README.md"
  pin "$root"
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
  if [ ! -e "$PIN_FAILED" ] && [ "$rc" -eq "$want_rc" ] && printf '%s' "$out" | grep -qF -- "$want_out" \
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

# ---------------------------------------------------------------------------
# ADR 0238 — fragments are read, and the two frozen registers stay frozen.
# ---------------------------------------------------------------------------
C=".planning/decisions/CLAIMS.jsonl"; CD=".planning/decisions/claims.d"
D=".planning/v3.0-TECH-DEBT.md"; DD=".planning/tech-debt.d"

r="$(fixture frag_ok "$GOOD")"; printf '%s\n' "$GOOD2" > "$r/$CD/feat-x.jsonl"
expect "a valid fragment's claim is read and counted with the frozen file's" \
  0 "2 checked, 2 holding" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_run "$GOOD")"
printf '%s\n' '{"id":"OD-2","status":"resolved","claim":"fragment claim that is false","verify":"false","verified":"2026-01-01"}' > "$r/$CD/feat-x.jsonl"
expect "a fragment's claim is RUN, not merely counted (a false one regresses)" \
  1 "fragment claim that is false" "$r" ./scripts/check_decision_claims.sh

r="$(fixture after "$GOOD")"; printf '%s\n' "$GOOD2" >> "$r/$C"
expect "a row appended after the CLAIMS sentinel is refused (exit 7)" \
  7 "claims.d" "$r" ./scripts/check_decision_claims.sh

r="$(fixture above "$GOOD")"; printf '%s\n%s\n%s\n' "$GOOD" "$GOOD2" "$SENTINEL" > "$r/$C"
expect "a row inserted above the CLAIMS sentinel is refused (exit 7)" \
  7 "FROZEN" "$r" ./scripts/check_decision_claims.sh

r="$(fixture nosentinel "$GOOD")"; printf '%s\n%s\n' "$GOOD" "$GOOD2" > "$r/$C"
expect "the sentinel replaced by a row, line count kept, is refused (exit 7)" \
  7 "sentinel" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_bad "$GOOD")"; printf '{not json\n' > "$r/$CD/feat-bad.jsonl"
expect "a malformed fragment fails and names its own file:line" \
  2 "feat-bad.jsonl:1" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_muzzled "$GOOD")"
printf '%s\n' '{"id":"OD-2","status":"resolved","claim":"x","verify":"true 2>/dev/null","verified":"2026-01-01"}' > "$r/$CD/feat-m.jsonl"
expect "the MUZZLED rule applies inside a fragment" \
  2 "suppresses its own stderr" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_case "$GOOD")"; printf '%s\n' "$GOOD2" > "$r/$CD/Feat-X.JSONL"
expect "a badly named fragment (Feat-X.JSONL) is an error, not silently skipped" \
  2 "Feat-X.JSONL" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_json "$GOOD")"; printf '%s\n' "$GOOD2" > "$r/$CD/feat-x.json"
expect "a stray .json in claims.d is an error, not silently skipped" \
  2 "feat-x.json" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_dir "$GOOD")"; mkdir -p "$r/$CD/sub"; printf '%s\n' "$GOOD2" > "$r/$CD/sub/feat-x.jsonl"
expect "a subdirectory in claims.d is an error" \
  2 "subdirectory" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_empty "$GOOD")"; printf '%s\n\n' '{"_comment": "nothing here"}' > "$r/$CD/feat-empty.jsonl"
expect "a fragment with zero claims (only a _comment) is refused" \
  2 "feat-empty.jsonl" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_zero "$GOOD")"; : > "$r/$CD/feat-zero.jsonl"
expect "a zero-byte fragment is refused" \
  2 "feat-zero.jsonl" "$r" ./scripts/check_decision_claims.sh

r="$(fixture frag_gone "$GOOD")"; rm -rf "${r:?}/$CD"
expect "a missing claims.d is a cannot-check, not zero fragments" \
  2 "claims parser exited 2" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_after "$GOOD")"; printf '\n## A new entry — OPEN — 2026-01-02\n' >> "$r/$D"
expect "a TECH-DEBT heading appended after the FROZEN section is refused (exit 7)" \
  7 "tech-debt.d" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_heading "$GOOD")"
printf '# Fixture debt register\n\n## An old entry — OPEN — 2026-01-01\n\nBody.\n\n## FROZEN — new entries live in .planning/tech-debt.d/ (fixture)\n\n## A new entry — OPEN — 2026-01-02\n' > "$r/$D"
expect "a heading after the FROZEN marker fails even with the line count kept" \
  7 "FROZEN" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_inside "$GOOD")"
printf '# Fixture debt register\n\n## An old entry — OPEN — 2026-01-01\n\nBody.\n\n**Fix.** A new paragraph inside a legacy entry.\n\n## FROZEN — new entries live in .planning/tech-debt.d/ (fixture)\n\nPointer.\n' > "$r/$D"
expect "a paragraph added inside a legacy TECH-DEBT entry is refused (it shifts citations)" \
  7 "FROZEN" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_ok "$GOOD")"; printf '## A new entry — OPEN — 2026-01-02\n\nBody.\n' > "$r/$DD/2026-01-02-feat-x.md"
expect "a well-formed debt fragment passes" \
  0 "1 checked, 1 holding" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_name "$GOOD")"; printf '## A new entry — OPEN — 2026-01-02\n' > "$r/$DD/notes.md"
expect "a debt fragment without its date prefix is an error" \
  2 "notes.md" "$r" ./scripts/check_decision_claims.sh

r="$(fixture debt_empty "$GOOD")"; printf 'no heading at all\n' > "$r/$DD/2026-01-02-feat-x.md"
expect "a debt fragment with no ## entry is refused" \
  2 "2026-01-02-feat-x.md" "$r" ./scripts/check_decision_claims.sh

expect "the debt freeze helper's own self-test passes" \
  0 "PASS" "$SRC" python3 "$SRC/_debt_frozen.py" --self-test

# ---------------------------------------------------------------------------
# The point of ADR 0238: three branches, one merges, the other two still merge
# clean. The control (the same three appending to the tail) must conflict, so
# this case notices if the fixture ever stops exercising the real failure.
# ---------------------------------------------------------------------------
# merge_sim <frag|tail|addadd>  -> prints one word per later branch
merge_sim() {
  local g="$WORK/git-$1"; mkdir -p "$g"
  (
    cd "$g" || exit 2
    G() { git -c user.name=t -c user.email=t@example.invalid -c init.defaultBranch=main "$@"; }
    G init -q . && mkdir -p claims.d && printf '%s\n' "$GOOD" > CLAIMS.jsonl && : > claims.d/README.md
    G add -A && G commit -qm base || exit 2
    local b slug out=""
    for b in a b c; do
      G checkout -q -b "$b" main || exit 2
      slug="$b"; [ "$1" = addadd ] && slug=same
      if [ "$1" = tail ]; then printf '{"id":"OD-%s"}\n' "$b" >> CLAIMS.jsonl
      else printf '{"id":"OD-%s"}\n' "$b" > "claims.d/feat-$slug.jsonl"; fi
      G add -A && G commit -qm "$b" || exit 2
    done
    G checkout -q main && G merge -q --no-edit a || exit 2
    for b in b c; do
      G checkout -q "$b" || exit 2
      if G merge -q --no-edit main >/dev/null 2>&1; then out="$out clean"
      elif G status --porcelain | grep -q '^AA'; then out="$out addadd"; G merge --abort
      else out="$out conflict"; G merge --abort; fi
    done
    printf '%s\n' "${out# }"
  )
}
if command -v git >/dev/null 2>&1; then
  expect "three branches each add a fragment; after one merges, the other two merge clean" \
    0 "clean clean" "$WORK" merge_sim frag
  expect "control: the same three appending to the CLAIMS tail conflict" \
    0 "conflict conflict" "$WORK" merge_sim tail
  expect "two branches choosing the same fragment slug conflict loudly (add/add)" \
    0 "addadd addadd" "$WORK" merge_sim addadd
else
  echo "   FAIL git unavailable — the merge cases are the point of ADR 0238"; fail=$((fail + 1))
fi

if [ -e "$PIN_FAILED" ]; then
  echo "   FAIL the fixture pins could not be set, so every case above was void:"
  sed 's/^/        /' "$PIN_FAILED"; fail=$((fail + 1))
fi

echo "== check_decision_claims.sh wrapper: $pass ok, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ] || { echo "FAIL"; exit 1; }
echo "PASS"
