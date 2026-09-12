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
# STRICT MODE (ADR 0025 §5, locked by the founder 2026-08-26)
# -----------------------------------------------------------
# The line above was a promise this file did not keep. Until 2026-08-26 the runner
# was `if bash -c "$verify"; then holds=yes; else holds=no; fi`, and for a claim
# with `status: open` — where NOT holding is what passes — a missing file, a typo,
# a renamed symbol and a deleted file were all indistinguishable from "the bug is
# still present". Four states were measured against this file before it changed:
#
#   malformed JSON                            -> exit 2 already. The only one that
#                                                was honouring the contract.
#   open claim, verify greps a missing file   -> grep exits 2, counted as HOLDING,
#                                                whole run PASS, exit 0.
#   resolved claim, `! grep ... <missing>`    -> the negation turns grep's error
#                                                into exit 0, counted as HOLDING,
#                                                exit 0. That shape guards a
#                                                SECURITY claim in this repo:
#                                                rename the file and it is green
#                                                forever.
#   open claim, command not found             -> exit 127, counted as HOLDING,
#                                                exit 0.
#
# So three of the four cannot-run states certified themselves. Now: stderr is
# captured, and exit 126/127 or a cannot-run signature on stderr is a FAILURE
# (exit 2) regardless of the exit code the claim reports.
#
# Exit status alone cannot carry this. A negated command inverts its own failure,
# which is exactly how the security claim above stayed green. Only stderr
# distinguishes "ran and disagreed" from "never ran".
#
# Which is why a claim MAY NOT SUPPRESS ITS OWN STDERR. The one broken claim found
# when this was measured carried its own `2>/dev/null`, so classifying by stderr
# without banning suppression finds 0 of 68 — it certifies the exact claim it was
# built to catch. Any `2>` in a verify command is rejected at parse time.
#
# Cost when it shipped: 0 of 94 claims. Not a noise generator — the one instance
# ADR 0025 measured (OD-78 grepping a `.env.example` that has never existed in
# this repo) had already been repointed by `fix/dossier-rot-sweep`.
#
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "FAIL — cannot reach repo root"; exit 2; }

CLAIMS=".planning/decisions/CLAIMS.jsonl"
[ -f "$CLAIMS" ] || { echo "FAIL — $CLAIMS is missing; this guard has nothing to check"; exit 2; }

command -v python3 >/dev/null 2>&1 || { echo "FAIL — python3 unavailable"; exit 2; }

# Parse once, emit a tab-separated plan. A malformed line is a hard failure:
# silently skipping it is how a claim stops being checked without anyone noticing.
PLAN="$(python3 - "$CLAIMS" <<'PY'
import json, re, sys
bad = 0
muzzled = 0
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
    # Strict mode reads stderr to tell "ran and disagreed" from "never ran". A claim
    # that redirects its own stderr blinds that, and the ONE broken claim found when
    # this was measured did exactly that.
    if re.search(r"2\s*>", o["verify"]):
        print(f"MUZZLED\t{n}\t{o['id']} redirects stderr: {o['verify']}", file=sys.stderr); muzzled = 1; continue
    rows.append("\t".join([o["id"], o["status"], o["verify"], o["claim"]]))
if bad:
    sys.exit(3)
if muzzled:
    sys.exit(5)
if not rows:
    print("EMPTY", file=sys.stderr); sys.exit(4)
print("\n".join(rows))
PY
)"
case $? in
  3) echo "FAIL — $CLAIMS has malformed lines (see above). A claim that cannot be parsed is not being checked."; exit 2 ;;
  4) echo "FAIL — $CLAIMS parsed to zero claims. A guard with nothing to check must not report success."; exit 2 ;;
  5) echo "FAIL — a claim suppresses its own stderr (see above). Strict mode reads stderr to"
     echo "       tell 'ran and disagreed' from 'never ran'; a muzzled claim certifies itself."
     echo "       Drop the '2>' redirect. Ordinary noise is fine — only stderr is inspected,"
     echo "       and only for cannot-run signatures."; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Structural check: no OD id may name two different decisions.
# ---------------------------------------------------------------------------
# Four id collisions happened across 2026-08-24/25. Sessions each take "the next
# free number" from the same trunk, and git merges the duplicates IN SILENCE,
# because the surrounding prose differs — no conflict, no warning, two decisions
# wearing one name. One pair (OD-64) turned out to be the same defect filed
# twice; both landed on main and neither session saw the other.
#
# A row may legitimately appear once in Open and once in Resolved (OD-25: the
# partial agreement is recorded, the remainder is still open). Twice in the SAME
# section is always a collision.
REGISTER=".planning/decisions/OPEN-DECISIONS.md"
[ -f "$REGISTER" ] || { echo "FAIL — $REGISTER is missing"; exit 2; }

dupes="$(python3 "$(dirname "$0")/_od_collisions.py" "$REGISTER")"
dupe_status=$?
if [ "$dupe_status" -ne 0 ]; then
  echo "FAIL — could not check $REGISTER for id collisions (exit $dupe_status)"
  exit 2
fi
if [ -n "$dupes" ]; then
  echo "== ID COLLISION — one OD number naming two decisions"
  printf '   %s\n' "$dupes"
  echo "   Renumber the one with FEWER citations (grep .planning and source comments first),"
  echo "   or fold them together if they are the same decision. Git will not catch this:"
  echo "   duplicate ids merge cleanly because the prose around them differs."
  echo
  echo "FAIL — a decision id names more than one decision."
  exit 1
fi

# ---------------------------------------------------------------------------
# Structural check: no two migrations may share a version.
# ---------------------------------------------------------------------------
# schema_migrations keys on `version`, so a duplicate makes the second INSERT
# violate the primary key and `supabase db reset` dies partway through. This
# happened on 2026-08-25 and surfaced as "Fresh database equals remote" — a
# failure message that says DRIFT when the truth is a duplicate key. It cost a
# full CI cycle to read, on a check that was otherwise reporting correctly.
#
# Same class as the OD-id collision above: two sessions each pick a number that
# looks free off the same trunk, and git merges both silently.
migdupes="$(python3 "$(dirname "$0")/_migration_versions.py" supabase/migrations)"
mig_status=$?
if [ "$mig_status" -ne 0 ]; then
  echo "FAIL — could not check supabase/migrations for duplicate versions (exit $mig_status)"
  exit 2
fi
if [ -n "$migdupes" ]; then
  echo "== MIGRATION VERSION COLLISION"
  printf '   %s\n' "$migdupes"
  echo "   Rename the later one past every version already on main. Safe if it was"
  echo "   applied out-of-band (never registered under the old version); if it WAS"
  echo "   registered, use: supabase migration repair --status applied <version>"
  echo
  echo "FAIL — two migrations share a version; supabase db reset cannot run."
  exit 1
fi

total=0; held=0; broken=0; stale=0; unrunnable=0
declare -a BROKEN_MSG=() STALE_MSG=() UNRUNNABLE_MSG=()

# The signatures of "this command never got as far as answering the question".
# Deliberately narrow: a claim is free to print anything it likes on stderr, and only
# these patterns — plus exit 126/127 — are read as cannot-run.
CANNOT_RUN='No such file or directory|command not found|cannot open|Is a directory|Permission denied|No such device or address'

while IFS=$'\t' read -r id status verify claim; do
  [ -z "${id:-}" ] && continue
  total=$((total + 1))

  # stdout discarded, stderr captured. The order matters: `2>&1` first points stderr at
  # the substitution, THEN `>/dev/null` moves stdout away from it.
  err="$(bash -c "$verify" 2>&1 >/dev/null)"; rc=$?

  if [ "$rc" -eq 127 ] || [ "$rc" -eq 126 ] || printf '%s' "$err" | grep -qE "$CANNOT_RUN"; then
    unrunnable=$((unrunnable + 1))
    UNRUNNABLE_MSG+=("$id (exit $rc) — ${err%%$'\n'*}")
    UNRUNNABLE_MSG+=("      claim: $claim")
    UNRUNNABLE_MSG+=("      verify: $verify")
    continue
  fi

  if [ "$rc" -eq 0 ]; then holds="yes"; else holds="no"; fi

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

if [ "$unrunnable" -gt 0 ]; then
  echo
  echo "== COULD NOT RUN ($unrunnable) — the guard never found out whether these hold"
  printf '   %s\n' "${UNRUNNABLE_MSG[@]}"
  echo
  echo "   This is NOT a skip. Before ADR 0025 §5 these counted as holding and the run"
  echo "   went green: for an open claim, 'the command failed' and 'the bug is still"
  echo "   there' were the same observation. Repoint the command at what exists, or"
  echo "   strike the claim — but do not let it sit here reporting on nothing."
  echo
  echo "FAIL — a claim's verify command could not run."
  exit 2
fi

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
