#!/usr/bin/env bash
#
# Executable decision claims — does the register still describe reality?
#
# WHY THIS EXISTS
# ---------------
# On 2026-08-25, five OPEN-DECISIONS entries were acted on and five turned out to
# be wrong in ways that changed the priority:
#
#   OD-20, OD-36  fixed the day before, still listed as open
#   OD-35         "registered with no NODE_ENV gate" — it was gated, at :89
#   OD-56         "merge the Dependabot queue" — the queue and the CVEs had
#                 ZERO package overlap; merging all 15 would have fixed none
#   OD-63         "writes >=3 spurious rows" — the table does not exist in
#                 production, so it wrote none, ever
#   OD-44         counts stale (20 vs 19) and a third pattern list unmentioned
#
# None of that was carelessness. Prose rots because nothing re-reads it. A claim
# written as a sentence is checked exactly once — the day it is written.
#
# So a claim that can be checked by a command gets written as a command. This is
# the same move as ADR 0016's dated-source rule for rate rows, applied to the
# register itself: the failure mode there was also "a number nobody re-verified".
#
# WHAT THIS CATCHES, AND WHAT IT DOES NOT
# ---------------------------------------
# Catches: a resolved entry that has silently regressed, and an OPEN entry whose
# problem is already fixed (the OD-20/OD-36 class, which is the most common and
# the most corrosive — a register listing fixed things is one people stop
# reading).
#
# Does NOT catch: an entry whose claim is wrong in a way no command can test, or
# aimed at the wrong target entirely (OD-56). Nothing mechanical catches that.
# What helps there is the discipline this file enforces by example — state the
# claim precisely enough that someone could TRY to write a check for it.
#
# NEVER VACUOUS: a claim whose command cannot run is a FAILURE, not a skip.
# Exit 2 is reserved for "this guard could not check what it says it checks".
#
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "FAIL — cannot reach repo root"; exit 2; }

CLAIMS=".planning/decisions/CLAIMS.jsonl"
[ -f "$CLAIMS" ] || { echo "FAIL — $CLAIMS is missing; this guard has nothing to check"; exit 2; }

command -v python3 >/dev/null 2>&1 || { echo "FAIL — python3 unavailable"; exit 2; }

# Parse once, emit a tab-separated plan. A malformed line is a hard failure:
# silently skipping it is how a claim stops being checked without anyone noticing.
PLAN="$(python3 - "$CLAIMS" <<'PY'
import json, sys
bad = 0
rows = []
for n, line in enumerate(open(sys.argv[1]), 1):
    line = line.strip()
    if not line:
        continue
    try:
        o = json.loads(line)
    except Exception as e:
        print(f"MALFORMED\t{n}\t{e}", file=sys.stderr); bad = 1; continue
    if "_comment" in o:
        continue
    missing = [k for k in ("id", "status", "claim", "verify", "verified") if k not in o]
    if missing:
        print(f"MALFORMED\t{n}\t{o.get('id','?')} missing {missing}", file=sys.stderr); bad = 1; continue
    if o["status"] not in ("open", "resolved"):
        print(f"MALFORMED\t{n}\t{o['id']} status must be open|resolved, got {o['status']!r}", file=sys.stderr); bad = 1; continue
    rows.append("\t".join([o["id"], o["status"], o["verify"], o["claim"]]))
if bad:
    sys.exit(3)
if not rows:
    print("EMPTY", file=sys.stderr); sys.exit(4)
print("\n".join(rows))
PY
)"
case $? in
  3) echo "FAIL — $CLAIMS has malformed lines (see above). A claim that cannot be parsed is not being checked."; exit 2 ;;
  4) echo "FAIL — $CLAIMS parsed to zero claims. A guard with nothing to check must not report success."; exit 2 ;;
esac

total=0; held=0; broken=0; stale=0
declare -a BROKEN_MSG=() STALE_MSG=()

while IFS=$'\t' read -r id status verify claim; do
  [ -z "${id:-}" ] && continue
  total=$((total + 1))
  if bash -c "$verify" >/dev/null 2>&1; then holds="yes"; else holds="no"; fi

  # `status` alone decides what SHOULD be true:
  #   resolved -> the claim must hold. Not holding = the fix came undone.
  #   open     -> the claim must NOT hold yet. Holding = the entry is stale.
  if [ "$status" = "resolved" ]; then
    if [ "$holds" = "yes" ]; then held=$((held + 1)); else
      broken=$((broken + 1)); BROKEN_MSG+=("$id — $claim"); fi
  else
    if [ "$holds" = "no" ]; then held=$((held + 1)); else
      stale=$((stale + 1)); STALE_MSG+=("$id — listed OPEN, but its claim now verifies: $claim"); fi
  fi
done <<< "$PLAN"

echo "== Decision claims: $total checked, $held holding"

if [ "$broken" -gt 0 ]; then
  echo
  echo "== REGRESSED ($broken) — a resolved decision no longer holds"
  printf '   %s\n' "${BROKEN_MSG[@]}"
fi

if [ "$stale" -gt 0 ]; then
  echo
  echo "== STALE ($stale) — listed as open, but already true"
  printf '   %s\n' "${STALE_MSG[@]}"
  echo "   Strike these off. A register that lists fixed things is one people stop reading,"
  echo "   which is how a critical SSRF sat in it unread long enough to matter."
fi

if [ "$broken" -gt 0 ]; then
  echo
  echo "FAIL — a decision this repo considers settled has come undone."
  exit 1
fi
if [ "$stale" -gt 0 ]; then
  echo
  echo "FAIL — the register disagrees with the code about what is still broken."
  exit 1
fi

echo "PASS — every executable claim still describes reality."
exit 0
