#!/usr/bin/env bash
# Schema parity — a fresh local database must equal the remote one.
#
# Why this exists
# ---------------
# Before the 2026-08-05 baseline, production had drifted so far from this repo
# that a fresh database could not be built at all: 27 tables, 403 columns and 13
# functions existed ONLY because DDL had been applied by hand. The single worst
# table was restaurant_inventory, with 37 such columns. The 13 functions were
# business logic with no source anywhere — calculate_sales_velocity,
# resolve_sku_to_inventory — which would have silently vanished had the database
# ever been rebuilt from migrations.
#
# The baseline fixed the accumulated drift. This script is what stops it coming
# back: it rebuilds a local database from migrations alone and diffs it against
# remote. Any hand-applied DDL, or any migration that was never pushed, fails.
#
#   ./scripts/check_schema_parity.sh            # compare local vs linked remote
#   ./scripts/check_schema_parity.sh --reset    # rebuild local first (slower, stricter)
#
# Requires: supabase CLI, a linked project, and a running local stack.
# READ-ONLY against remote. It never writes to either database.

set -euo pipefail

RESET=0
[[ "${1:-}" == "--reset" ]] && RESET=1

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REMOTE_URL="${SUPABASE_DIRECT_CONNECTION_STRING:-}"
if [[ -z "$REMOTE_URL" && -f .env ]]; then
  REMOTE_URL="$(grep -E '^SUPABASE_DIRECT_CONNECTION_STRING=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
if [[ -z "$REMOTE_URL" ]]; then
  echo "FAIL: no SUPABASE_DIRECT_CONNECTION_STRING (env or .env)" >&2
  exit 2
fi

DBC="$(docker ps --format '{{.Names}}' | grep supabase_db | head -1 || true)"
if [[ -z "$DBC" ]]; then
  echo "FAIL: local Supabase is not running (supabase start)" >&2
  exit 2
fi

if [[ $RESET -eq 1 ]]; then
  echo "Rebuilding local database from migrations..."
  supabase db reset --no-seed >/dev/null
fi

# Columns and non-extension functions are the two things that actually broke.
# Extension-owned functions are excluded: they are installed by CREATE EXTENSION,
# not by migrations, and counting them reports 165 phantom differences.
#
# Ad-hoc backup tables (_bak_*) are excluded, for the same reason as extension
# functions: they are not schema. They are snapshots someone took by hand before
# a risky change, they will never be in a migration, and on 2026-08-24 three of
# them (_bak_library_before_corpus 88 cols, _bak_seed_repair_20260813 6,
# _bak_wine_match_keys_20260812 4) accounted for ALL 98 reported differences —
# every other column matched exactly. Left in, this check can only ever be red,
# and a check that is always red is a check nobody reads.
#
# They are excluded from the COMPARISON but printed on every run below. An
# exclusion you cannot see is indistinguishable from a blind spot.
COLS_Q="SELECT table_name||'.'||column_name||':'||data_type
        FROM information_schema.columns WHERE table_schema='public'
          AND table_name NOT LIKE '\\_bak\\_%' ORDER BY 1;"
BAK_Q="SELECT table_name||' ('||count(*)||' cols)'
       FROM information_schema.columns WHERE table_schema='public'
         AND table_name LIKE '\\_bak\\_%' GROUP BY table_name ORDER BY 1;"
FNS_Q="SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
       ORDER BY 1;"

docker exec -i "$DBC" psql -U postgres -d postgres -qtAc "$COLS_Q" | sort > "$WORK/local_cols"
docker exec -i "$DBC" psql "$REMOTE_URL"  -qtAc "$COLS_Q" | sort > "$WORK/remote_cols"
docker exec -i "$DBC" psql -U postgres -d postgres -qtAc "$FNS_Q"  | sort > "$WORK/local_fns"
docker exec -i "$DBC" psql "$REMOTE_URL"  -qtAc "$FNS_Q"  | sort > "$WORK/remote_fns"
docker exec -i "$DBC" psql "$REMOTE_URL"  -qtAc "$BAK_Q"  | sort > "$WORK/remote_bak"

only_remote_cols="$(comm -13 "$WORK/local_cols" "$WORK/remote_cols")"
only_local_cols="$(comm -23 "$WORK/local_cols" "$WORK/remote_cols")"
only_remote_fns="$(comm -13 "$WORK/local_fns" "$WORK/remote_fns")"
only_local_fns="$(comm -23 "$WORK/local_fns" "$WORK/remote_fns")"

echo "local  : $(wc -l < "$WORK/local_cols" | tr -d ' ') columns, $(wc -l < "$WORK/local_fns" | tr -d ' ') functions"
echo "remote : $(wc -l < "$WORK/remote_cols" | tr -d ' ') columns, $(wc -l < "$WORK/remote_fns" | tr -d ' ') functions"

# Named, never silent. If one of these is ever a real table rather than a
# snapshot, it shows up here rather than vanishing from the comparison.
if [[ -s "$WORK/remote_bak" ]]; then
  echo "excluded from the comparison — ad-hoc backup tables on remote ($(wc -l < "$WORK/remote_bak" | tr -d ' ')):"
  sed 's/^/   /' "$WORK/remote_bak"
  echo "   (snapshots, not schema. Drop them on production when they are no longer needed.)"
fi

fail=0
report() {
  local title="$1" body="$2" hint="$3"
  [[ -z "$body" ]] && return 0
  fail=1
  echo
  echo "== $title ($(echo "$body" | wc -l | tr -d ' '))"
  echo "$body" | head -40 | sed 's/^/   /'
  [[ $(echo "$body" | wc -l) -gt 40 ]] && echo "   ... truncated"
  echo "   -> $hint"
}

# In remote but not local = DDL applied by hand to production. This is the
# failure the baseline was needed to clean up, and the one worth shouting about.
report "IN REMOTE, NOT IN LOCAL — hand-applied DDL" "$only_remote_cols" \
  "Capture it as a migration, then 'supabase migration repair --status applied <v>'."
report "IN REMOTE, NOT IN LOCAL — functions" "$only_remote_fns" \
  "Business logic with no source in the repo. Capture it as a migration."
# In local but not remote = a migration that was never pushed. Less alarming,
# still a divergence: code merged against a schema production does not have.
report "IN LOCAL, NOT IN REMOTE — unpushed migration" "$only_local_cols" \
  "Run 'supabase db push', or drop the migration if it was a mistake."
report "IN LOCAL, NOT IN REMOTE — functions" "$only_local_fns" \
  "Run 'supabase db push'."

if [[ $fail -eq 0 ]]; then
  echo
  echo "PASS — local and remote schemas are identical."
  exit 0
fi
echo
echo "FAIL — schema drift detected. See .planning/SCHEMA_DRIFT_INVENTORY.txt for what"
echo "       unchecked drift looked like the last time nobody was watching."
exit 1
