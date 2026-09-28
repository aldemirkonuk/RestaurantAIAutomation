#!/usr/bin/env bash
# Test for merge-audited-pr.sh: a stand-in `gh` driven by env vars exercises every
# refusal (each asserted on its own reason), the pinned merge arguments, the
# merge-commit filter and the squash subject. Needs bash and jq; touches nothing.
# Run: bash .planning/handoff/merge-audited-pr.test.sh   (exit 0 = all pass)
set -u
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
S="$(cd "$(dirname "$0")" && pwd)/merge-audited-pr.sh"
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'SHIM'
#!/usr/bin/env bash
# fake gh: reads FAKE_* env vars
args="$*"
jqexpr=""; prev=""
for a in "$@"; do [[ "$prev" == "--jq" ]] && jqexpr="$a"; prev="$a"; done
echo "gh $args" >> "$FAKE_LOG"
case "$1 $2" in
  "pr view")
    if [[ "$args" == *"--json comments"* ]]; then printf '%s' "$FAKE_COMMENTS" | jq -r "$jqexpr"
    elif [[ "$args" == *"--json mergeCommit"* ]]; then printf '{"mergeCommit":{"oid":"%s"}}' "$FAKE_MERGE" | jq -r "$jqexpr"
    else printf '%s' "$FAKE_PR" | jq -r "$jqexpr"; fi ;;
  "pr checks") echo "fake checks"; exit "${FAKE_CHECKS_RC:-0}" ;;
  "pr diff") printf '%s\n' "${FAKE_DIFF:-}" ;;
  "pr merge") echo "MERGED $args" >> "$FAKE_LOG"; exit "${FAKE_MERGE_RC:-0}" ;;
  "run list") printf '[{"databaseId": 4242}]' | jq -r "$jqexpr" ;;
  "run watch") exit "${FAKE_WATCH_RC:-0}" ;;
  *) echo "unexpected gh $args" >&2; exit 99 ;;
esac
SHIM
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH"
SHA=abcdef1234567890abcdef1234567890abcdef12
PR_OK="{\"state\":\"OPEN\",\"isDraft\":false,\"headRefOid\":\"$SHA\",\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\",\"title\":\"t\"}"
PASS_ME="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"\\n <!-- pr-audit-gate: pr=491 sha=abcdef1 verdict=PASS -->\\nreport\"}]}"
SPOOF="{\"comments\":[{\"author\":{\"login\":\"mallory\"},\"body\":\"<!-- pr-audit-gate: pr=491 sha=abcdef1 verdict=PASS -->\"}]}"
BLOCK_TOO="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"<!-- pr-audit-gate: pr=491 sha=abcdef1 verdict=PASS -->\"},{\"author\":{\"login\":\"github-actions[bot]\"},\"body\":\"<!-- pr-audit-gate: pr=491 sha=abcdef12 verdict=BLOCK -->\"}]}"
STALE="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"<!-- pr-audit-gate: pr=491 sha=1111111 verdict=PASS -->\"}]}"
OTHERPR="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"<!-- pr-audit-gate: pr=490 sha=abcdef1 verdict=PASS -->\"}]}"
pass=0; fail=0
t() {  # name expected_rc expect_merge(yes/no) input -- env...
  local name=$1 want=$2 wantmerge=$3 input=$4 why=$5; shift 5
  export FAKE_LOG="$T/log.$name"; : > "$FAKE_LOG"
  env "$@" FAKE_LOG="$FAKE_LOG" bash "$S" $ARGS <<<"$input" > "$T/out.$name" 2>&1
  local rc=$? merged=no
  grep -q '^MERGED' "$FAKE_LOG" && merged=yes
  if [[ $rc -eq $want && $merged == $wantmerge ]] && { [[ -z "$why" ]] || grep -qF -- "$why" "$T/out.$name"; }; then pass=$((pass+1)); echo "ok   $name (rc=$rc merged=$merged)"
  else fail=$((fail+1)); echo "FAIL $name (rc=$rc want $want, merged=$merged want $wantmerge)"; sed 's/^/     /' "$T/out.$name" | tail -5; fi
}
ARGS="";            t no-number 2 no "" "usage:" FAKE_PR="$PR_OK"
ARGS="abc";         t non-numeric 2 no "" "usage:" FAKE_PR="$PR_OK"
ARGS="491 --force"; t bad-option 2 no "" "unknown option" FAKE_PR="$PR_OK"
ARGS="491"; t closed 2 no "491" "not OPEN" FAKE_PR="${PR_OK/OPEN/CLOSED}" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t draft 2 no "491" "is a draft" FAKE_PR="${PR_OK/false/true}" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t conflicting 2 no "491" "is CONFLICTING" FAKE_PR="${PR_OK/\"MERGEABLE\"/\"CONFLICTING\"}" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t behind 2 no "491" "is BEHIND" FAKE_PR="${PR_OK/CLEAN/BEHIND}" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t checks-failing 2 no "491" "exit 1" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_CHECKS_RC=1
ARGS="491"; t checks-pending 2 no "491" "exit 8" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_CHECKS_RC=8
ARGS="491"; t no-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="{\"comments\":[]}"
ARGS="491"; t spoofed-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$SPOOF"
ARGS="491"; t stale-sha-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$STALE"
ARGS="491"; t other-pr-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$OTHERPR"
ARGS="491"; t block-marker 2 no "491" "BLOCK marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$BLOCK_TOO"
ARGS="491"; t wrong-confirm 2 no "490" "did not match" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t happy-path 0 yes "491" "DONE:" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_MERGE=deadbeef
ARGS="491"; t merge-refused 2 yes "491" "merge refused" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_MERGE_RC=1
ARGS="491"; t ci-fails-after 2 yes "491" "CI failed" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_MERGE=deadbeef FAKE_WATCH_RC=1
ARGS="490 --gate-owned"; t gate-owned-happy 0 yes "490" "DONE:" FAKE_DIFF=".planning/decisions/README.md" FAKE_PR="$PR_OK" FAKE_COMMENTS="{\"comments\":[]}" FAKE_MERGE=deadbeef
ARGS="490 --gate-owned"; t gate-owned-checks-red 2 no "490" "exit 1" FAKE_DIFF=".planning/decisions/README.md" FAKE_PR="$PR_OK" FAKE_COMMENTS="{\"comments\":[]}" FAKE_CHECKS_RC=1
# the merge must be pinned to the exact head SHA, squash, with -R
grep -q "pr merge 491 -R aldemirkonuk/RestaurantAIAutomation --squash --match-head-commit $SHA" "$T/log.happy-path" \
  && { pass=$((pass+1)); echo "ok   merge-args-pinned"; } || { fail=$((fail+1)); echo "FAIL merge-args-pinned"; grep MERGED "$T/log.happy-path"; }
grep -q -- "--commit deadbeef" "$T/log.happy-path" \
  && { pass=$((pass+1)); echo "ok   runs-filtered-by-merge-commit"; } || { fail=$((fail+1)); echo "FAIL runs-filtered-by-merge-commit"; }
DECOY="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"<!-- pr-audit-gate: (superseding pr=1 sha=aaaaaaa verdict=BLOCK) pr=491 sha=abcdef1 verdict=PASS -->\"}]}"
PREFIXED="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"note: <!-- pr-audit-gate: pr=491 sha=abcdef1 verdict=PASS -->\"}]}"
NOCOLON="{\"comments\":[{\"author\":{\"login\":\"aldemirkonuk\"},\"body\":\"<!-- pr-audit-gate pr=491 sha=abcdef1 verdict=PASS -->\"}]}"
ARGS="490 --gate-owned"; t gate-owned-not-owned 2 no "490" "changes no gate-owned path" FAKE_DIFF="apps/web/src/App.tsx" FAKE_PR="$PR_OK" FAKE_COMMENTS="{\"comments\":[]}"
ARGS="490 --gate-owned"; t gate-owned-glob 0 yes "490" "DONE:" FAKE_DIFF=$'apps/x.ts\n.planning/decisions/0050-agent-dispatch.md' FAKE_PR="$PR_OK" FAKE_COMMENTS="{\"comments\":[]}" FAKE_MERGE=deadbeef
ARGS="491"; t decoy-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$DECOY"
ARGS="491"; t prefixed-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PREFIXED"
ARGS="491"; t no-colon-marker 2 no "491" "no trusted PASS marker" FAKE_PR="$PR_OK" FAKE_COMMENTS="$NOCOLON"
ARGS="#491"; t hash-number 0 yes "491" "DONE:" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_MERGE=deadbeef
ARGS="491"; t bad-sha 2 no "491" "head SHA" FAKE_PR="${PR_OK/$SHA/}" FAKE_COMMENTS="$PASS_ME"
ARGS="491"; t pending-message 2 no "491" "still pending" FAKE_PR="$PR_OK" FAKE_COMMENTS="$PASS_ME" FAKE_CHECKS_RC=8
grep -q -- "--subject t (#491)" "$T/log.happy-path" \
  && { pass=$((pass+1)); echo "ok   squash-subject"; } || { fail=$((fail+1)); echo "FAIL squash-subject"; grep MERGED "$T/log.happy-path"; }
echo "== $pass passed, $fail failed"
[[ $fail -eq 0 ]]
