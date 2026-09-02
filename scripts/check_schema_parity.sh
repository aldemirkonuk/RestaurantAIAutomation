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
# Why it was rewritten (2026-09-02)
# ---------------------------------
# The first version compared exactly two things, and compared both of them
# badly. Its column key was `table.column:data_type` and its function query
# selected `proname` alone. Measured against a fixture carrying SEVEN real
# schema differences, it printed:
#
#     local  : 8 columns, 1 functions
#     remote : 8 columns, 1 functions
#     PASS — local and remote schemas are identical.        (exit 0)
#
# It could not see, and therefore certified as identical:
#
#   * numeric(12,3) vs bare numeric  — information_schema.data_type is the
#     string 'numeric' for both, so CI could not tell a correctly-scaled ledger
#     migration from a wrong one. This is the case that motivated the rewrite.
#   * a DROP NOT NULL                — is_nullable was never in the key.
#   * a changed function SIGNATURE   — only proname was compared, so
#     calculate_sales_velocity(uuid,integer) and
#     calculate_sales_velocity(text,bigint) are the same row.
#   * a changed function BODY        — never looked at at all.
#   * CHECK constraints              — including the unit vocabularies and the
#     ledger's quantity-integrity checks.
#   * UNIQUE constraints and indexes — including UNIQUE (restaurant_id,
#     master_wine_id), the constraint the merge dry-run reasons about.
#   * column DEFAULTs                — e.g. beverage_kind DEFAULT 'unknown'.
#   * MATERIALIZED VIEWS entirely    — information_schema.columns covers
#     relkind r/p/v/f and NOT 'm', so event_aggregates_daily,
#     event_aggregates_hourly and inventory_transaction_summary were invisible.
#   * triggers, RLS policies, enum labels, sequence types, column order.
#
# And, run against two EMPTY databases, it printed "0 columns, 0 functions"
# followed by PASS and exit 0 — the repo's cardinal fault, a check that reports
# absence as health.
#
# What changed
# ------------
#   * Everything is read from pg_catalog, not information_schema. format_type()
#     gives numeric(12,3); pg_attribute covers materialized views;
#     pg_get_constraintdef / pg_get_indexdef / pg_get_triggerdef /
#     pg_get_function_identity_arguments give real definitions.
#   * The comparison is keyed on (category, object) with the DEFINITION as the
#     value, so a changed object reports as ONE line with both sides shown,
#     rather than as an unpaired add and delete a human has to correlate.
#   * The exit-code contract is enforced structurally (see EXIT CODES).
#   * `--self-test` proves all of the above against throwaway databases.
#
# Usage
# -----
#   ./scripts/check_schema_parity.sh            # compare local vs linked remote
#   ./scripts/check_schema_parity.sh --reset    # rebuild local first (stricter)
#   ./scripts/check_schema_parity.sh --self-test  # prove the guard itself
#   ./scripts/check_schema_parity.sh --print-sql  # show exactly what is compared
#
# Environment
# -----------
#   SUPABASE_DIRECT_CONNECTION_STRING   remote DSN (or in .env). REQUIRED.
#   PARITY_DB_CONTAINER                 override the docker container to run
#                                       psql inside (default: first name
#                                       matching supabase_db).
#   PARITY_LOCAL_DB                     local database name (default: postgres).
#
# EXIT CODES
# ----------
#   0   checked, and every compared object matches
#   1   checked, and something differs — every difference is printed
#   2   COULD NOT CHECK — no DSN, no container, psql failed, a side returned
#       zero rows, zero relations were compared, or the two servers are not the
#       same Postgres major version. A comparison that scans nothing is exit 2,
#       never exit 0.
#
# Requires: docker, a running local stack, a linked project.
# READ-ONLY against remote. It never writes to either database. `--self-test`
# creates and drops throwaway databases in the LOCAL container only.

set -euo pipefail

MODE="compare"
RESET=0
case "${1:-}" in
  --reset)     RESET=1 ;;
  --self-test) MODE="self-test" ;;
  --print-sql) MODE="print-sql" ;;
  "")          ;;
  *) echo "usage: $0 [--reset|--self-test|--print-sql]" >&2; exit 2 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cannot_check() {
  echo "CANNOT CHECK — $*" >&2
  echo "   Exiting 2. A parity run that scanned nothing must never read as PASS." >&2
  exit 2
}

# ---------------------------------------------------------------------------
# The fingerprint
# ---------------------------------------------------------------------------
# Every query emits TAB-separated `category <TAB> object <TAB> definition`.
# `category|object` is the identity of the thing; `definition` is what must
# match. That split is what lets the report say "this column CHANGED, here is
# each side" instead of printing an orphan add next to an orphan delete.
#
# Exclusions, both of them deliberate and both of them PRINTED on every run,
# because an exclusion you cannot see is indistinguishable from a blind spot:
#
#   * Extension-owned objects (pg_depend deptype 'e'). They are installed by
#     CREATE EXTENSION, not by migrations; counting them reported 165 phantom
#     differences. Unlike the previous version, the dependency lookup is
#     qualified by classid — an unqualified objid can collide across catalogs.
#   * Ad-hoc backup tables (_bak_*). Snapshots someone took by hand before a
#     risky change; they will never be in a migration. On 2026-08-24 three of
#     them accounted for ALL 98 reported differences. Left in, this check can
#     only ever be red, and a check that is always red is a check nobody reads.

REL_KINDS="'r','p','v','m','f'"
NOT_BAK="c.relname NOT LIKE '\\_bak\\_%'"
# shellcheck disable=SC2016
ext_dep() { printf "NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='%s'::regclass AND d.objid=%s AND d.deptype='e')" "$1" "$2"; }

# One fact per LINE is the whole parsing contract, and pg_get_*def(oid, true)
# pretty-prints, which means it can return newlines. flat() collapses all
# whitespace so a reformatted-but-identical definition is not reported as drift
# and a multi-line one cannot split a fact in half.
flat() { printf "btrim(regexp_replace(%s, '[[:space:]]+', ' ', 'g'))" "$1"; }

# Cast-decoration normalizer for CHECK constraints. NARROW ON PURPOSE.
#
# A pg_dump/restore round-trip is not a fixed point for `x IN (...)` on a
# varchar column. Measured 2026-09-02 in a scratch Postgres, all four of these
# are the SAME predicate and Postgres renders them two different ways:
#
#   CHECK (unit_type IN ('BOTTLE','CASE'))                      -- production
#     -> CHECK (unit_type::text = ANY (ARRAY['BOTTLE'::character varying, ...]::text[]))
#   CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, ...])::text[])))
#     -> CHECK (unit_type::text = ANY (ARRAY['BOTTLE'::character varying::text, ...]))
#
# The second spelling is what pg_dump WROTE into
# 20260805000000_baseline_from_production.sql, so a fresh `supabase db reset`
# re-parses it and renders per-element while production still renders
# array-level. 45 constraints diverged this way on the first real CI run — every
# one a false positive, and unfixable by editing migrations, because the dump
# text cannot reproduce the tree it came from.
#
# So: collapse the DECORATION, never the content. Two literal replacements,
# deliberately not a general regex:
#
#   '::character varying::text'  ->  '::character varying'   (per-element form)
#   ']::text[]'                  ->  ']'                     (array-level form)
#
# Each requires a cast to sit directly against ANOTHER string-type cast or
# against an array literal's closing bracket. Neither can touch a column
# reference: `unit_type::text` survives untouched, because `unit_type` is
# neither `character varying` nor `]`. Nothing about the literal VALUES, their
# ORDER, the operator, or the column is normalized — add, remove or rename one
# array element and the definitions still differ. --self-test proves exactly
# that, in both directions.
#
# Known limit, stated rather than hidden: a CHECK whose own string literal
# contains the text `]::text[]` would have that literal rewritten too. It is
# rewritten identically on both sides, so it cannot manufacture a false PASS on
# its own, but it is a real edge and it is not defended against.
norm_casts() {
  printf "replace(replace(%s, '::character varying::text', '::character varying'), ']::text[]', ']')" "$1"
}

REL_VISIBLE="n.nspname='public' AND c.relkind IN ($REL_KINDS) AND $NOT_BAK AND $(ext_dep pg_class c.oid)"

read -r -d '' FINGERPRINT_SQL <<SQL || true
-- 1. server version. Compared like anything else: two different major versions
--    produce phantom differences in every other category, and reporting that as
--    drift is how a connectivity/version problem gets mistaken for a schema one.
SELECT 'server' || E'\t' || 'version' || E'\t' || current_setting('server_version_num');

-- 2. relations, including materialized views, plus the RLS flag.
SELECT 'relation' || E'\t' || n.nspname||'.'||c.relname || E'\t' ||
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                      WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                      WHEN 'f' THEN 'foreign table' ELSE c.relkind::text END ||
       CASE WHEN c.relrowsecurity THEN ', RLS enabled' ELSE ', RLS disabled' END ||
       CASE WHEN c.relforcerowsecurity THEN ', RLS forced' ELSE '' END
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE;

-- 3. columns. format_type() carries the typmod, so numeric(12,3) and bare
--    numeric are DIFFERENT strings — the whole point of the rewrite. Reading
--    pg_attribute rather than information_schema.columns is also what makes
--    materialized-view columns visible at all.
SELECT 'column' || E'\t' || n.nspname||'.'||c.relname||'.'||a.attname || E'\t' ||
       format_type(a.atttypid, a.atttypmod) ||
       CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END ||
       COALESCE(' DEFAULT ' || $(flat "pg_get_expr(ad.adbin, ad.adrelid, true)"), '') ||
       CASE a.attidentity WHEN 'a' THEN ' GENERATED ALWAYS AS IDENTITY'
                          WHEN 'd' THEN ' GENERATED BY DEFAULT AS IDENTITY'
                          ELSE '' END ||
       CASE a.attgenerated WHEN 's' THEN ' GENERATED ALWAYS STORED' ELSE '' END ||
       COALESCE(' COLLATE ' || (SELECT cl.collname FROM pg_collation cl
                                WHERE cl.oid=a.attcollation AND cl.collname <> 'default'), '')
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
WHERE $REL_VISIBLE AND a.attnum > 0 AND NOT a.attisdropped;

-- 4. column order, once per relation rather than once per column. A column
--    dropped and re-added shifts every later ordinal; reported per column that
--    is N lines of noise for one fact, so it is one line here.
SELECT 'column-order' || E'\t' || n.nspname||'.'||c.relname || E'\t' ||
       string_agg(a.attname, ',' ORDER BY a.attnum)
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE AND a.attnum > 0 AND NOT a.attisdropped
GROUP BY n.nspname, c.relname;

-- 5. constraints: CHECK (the unit vocabularies, the ledger quantity checks),
--    UNIQUE, PRIMARY KEY, FOREIGN KEY, EXCLUDE. None of these were compared.
SELECT 'constraint' || E'\t' || n.nspname||'.'||c.relname||'.'||con.conname || E'\t' ||
       $(norm_casts "$(flat "pg_get_constraintdef(con.oid, true)")")
FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE AND $(ext_dep pg_constraint con.oid);

-- 6. indexes. Constraint-backed indexes are skipped: they are already reported
--    by 5, and reporting one drift twice trains people to skim the output.
--    Rendered PRETTY (the 0, true arguments) for one reason: a partial index's
--    WHERE clause carries the same IN (...) predicate a CHECK does, and the
--    non-pretty form spells the two renderings a THIRD way —
--    ARRAY[('open'::character varying)::text, ...] — which norm_casts cannot
--    see past. Pretty mode emits exactly the constraint spelling, so one
--    normalizer covers both. Measured 2026-09-02: this is what the last false
--    positive on the first real CI run turned out to be (idx_pc_open_age).
--    Pretty mode also drops the schema qualifier from the rendered definition;
--    that loses nothing, because the schema is already in the comparison KEY.
SELECT 'index' || E'\t' || n.nspname||'.'||ci.relname || E'\t' ||
       $(norm_casts "$(flat "pg_get_indexdef(i.indexrelid, 0, true)")")
FROM pg_index i
JOIN pg_class ci ON ci.oid=i.indexrelid
JOIN pg_class c  ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE
  AND $(ext_dep pg_class ci.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid);

-- 7. functions. The KEY carries the identity arguments, so a changed signature
--    reports as one gone and one arrived instead of matching itself. The body
--    md5 is in the definition, so a silent rewrite of business logic — the
--    thing that made the 13 orphan functions dangerous — also fails.
--    proconfig is included because a SECURITY DEFINER function losing its
--    search_path pin is a privilege bug, not a cosmetic one.
SELECT 'function' || E'\t' ||
       n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' || E'\t' ||
       'returns ' || pg_get_function_result(p.oid) ||
       ' lang=' || l.lanname ||
       ' volatility=' || p.provolatile::text ||
       CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE ' SECURITY INVOKER' END ||
       COALESCE(' config=' || array_to_string(p.proconfig, ' '), '') ||
       CASE p.prokind WHEN 'p' THEN ' kind=procedure' WHEN 'a' THEN ' kind=aggregate'
                      WHEN 'w' THEN ' kind=window' ELSE '' END ||
       ' body_md5=' || md5(COALESCE(p.prosrc, ''))
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND $(ext_dep pg_proc p.oid);

-- 8. view and materialized-view bodies. Column lists alone cannot see a
--    rewritten SELECT, and inventory_lot_rollup is a plain view whose body is
--    load-bearing for the on-hand figure.
SELECT 'viewdef' || E'\t' || n.nspname||'.'||c.relname || E'\t' ||
       'md5=' || md5(pg_get_viewdef(c.oid, true))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('v','m') AND $NOT_BAK
  AND $(ext_dep pg_class c.oid);

-- 9. triggers. Business logic that no other category can see.
SELECT 'trigger' || E'\t' || n.nspname||'.'||c.relname||'.'||t.tgname || E'\t' ||
       $(flat "pg_get_triggerdef(t.oid, true)")
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE AND NOT t.tgisinternal AND $(ext_dep pg_trigger t.oid);

-- 10. RLS policies. A policy dropped by hand on production is a disclosure, and
--     it is invisible to every other check in this repo once the table already
--     exists (check_new_tables_are_locked_down.py only guards NEW tables).
SELECT 'policy' || E'\t' || n.nspname||'.'||c.relname||'.'||pol.polname || E'\t' ||
       'cmd=' || pol.polcmd::text ||
       ' permissive=' || pol.polpermissive::text ||
       ' roles=' || COALESCE((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                              FROM pg_roles r WHERE r.oid = ANY(pol.polroles)), 'PUBLIC') ||
       ' using=' || COALESCE($(flat "pg_get_expr(pol.polqual, pol.polrelid, true)"), '-') ||
       ' check=' || COALESCE($(flat "pg_get_expr(pol.polwithcheck, pol.polrelid, true)"), '-')
FROM pg_policy pol
JOIN pg_class c ON c.oid=pol.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE $REL_VISIBLE;

-- 11. enum labels and domains. An enum silently gaining a value on production
--     is the same defect class as a CHECK vocabulary widening.
SELECT 'type' || E'\t' || n.nspname||'.'||t.typname || E'\t' ||
       CASE t.typtype
         WHEN 'e' THEN 'enum(' || COALESCE((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                                            FROM pg_enum e WHERE e.enumtypid=t.oid), '') || ')'
         WHEN 'd' THEN 'domain ' || format_type(t.typbasetype, t.typtypmod) ||
                       CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END ||
                       COALESCE(' ' || (SELECT string_agg($(norm_casts "$(flat "pg_get_constraintdef(dc.oid, true)")"), ' ' ORDER BY dc.conname)
                                        FROM pg_constraint dc WHERE dc.contypid=t.oid), '')
         ELSE t.typtype::text END
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='public' AND t.typtype IN ('e','d') AND $(ext_dep pg_type t.oid);

-- 12. sequences. A serial backed by int4 where the repo says int8 overflows in
--     production and nowhere else.
SELECT 'sequence' || E'\t' || n.nspname||'.'||c.relname || E'\t' ||
       format_type(s.seqtypid, NULL) || ' increment=' || s.seqincrement ||
       ' min=' || s.seqmin || ' max=' || s.seqmax ||  ' cycle=' || s.seqcycle::text
FROM pg_sequence s
JOIN pg_class c ON c.oid=s.seqrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND $NOT_BAK AND $(ext_dep pg_class c.oid);
SQL

# Categories that CANNOT legitimately be empty in this repo's schema. If one of
# them returns zero rows on BOTH sides, the query is broken or the database is
# not the database we think it is — either way the run proved nothing.
REQUIRED_CATEGORIES="server relation column constraint index function"

BAK_Q="SELECT c.relname||' ('||count(*)||' cols)'
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname LIKE '\\_bak\\_%'
         AND a.attnum>0 AND NOT a.attisdropped
       GROUP BY c.relname ORDER BY 1;"

# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------

DBC=""
resolve_container() {
  DBC="${PARITY_DB_CONTAINER:-}"
  if [[ -z "$DBC" ]]; then
    DBC="$(docker ps --format '{{.Names}}' 2>/dev/null | grep supabase_db | head -1 || true)"
  fi
  [[ -n "$DBC" ]] || cannot_check "local Supabase is not running (supabase start)"
}

# psql_into <outfile> <sql> <psql target args...>
# Returns non-zero if psql itself failed. The old version let a psql failure
# ride out through `set -e` with psql's own exit code, which is 1 for a query
# error — indistinguishable from "the schemas differ".
psql_into() {
  local out="$1" sql="$2"; shift 2
  docker exec -i "$DBC" psql "$@" -v ON_ERROR_STOP=1 -q -t -A -F $'\t' -c "$sql" \
    < /dev/null > "$out" 2> "$out.err"
}

# fingerprint <label> <outfile> <psql target args...>
fingerprint() {
  local label="$1" out="$2"; shift 2
  if ! psql_into "$out.raw" "$FINGERPRINT_SQL" "$@"; then
    echo "   psql said: $(head -3 "$out.raw.err" | tr '\n' ' ')" >&2
    cannot_check "could not read the $label schema"
  fi
  # Drop blank lines psql emits between statement result sets.
  grep -v '^[[:space:]]*$' "$out.raw" | LC_ALL=C sort > "$out" || true
  [[ -s "$out" ]] || cannot_check "the $label schema returned ZERO rows"
  # "Zero tables compared" is exit 2 PER SIDE, not just when both sides are
  # empty. `server` always returns a row, so a file that is merely non-empty
  # proves only that psql answered — it does not prove a schema was read. An
  # empty database reaching the comparison is precisely how the old version
  # printed "0 columns, 0 functions / PASS".
  local nrel ncol
  nrel="$(count_of "$out" relation)"; ncol="$(count_of "$out" column)"
  [[ "$nrel" -gt 0 && "$ncol" -gt 0 ]] || \
    cannot_check "the $label schema has $nrel relations and $ncol columns in public — nothing to compare"
}

category_counts() { cut -f1 "$1" | LC_ALL=C uniq -c | awk '{printf "%s=%s ", $2, $1}'; }
count_of() { awk -F'\t' -v c="$2" '$1==c{n++} END{print n+0}' "$1"; }

# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------
# compare <local-file> <remote-file> [--quiet]
# 0 = identical, 1 = differs. Exits 2 itself on an unusable input.
compare() {
  local lf="$1" rf="$2" quiet="${3:-}"
  local d="$WORK/d.$$"; rm -f "$d".*

  # A required category empty on BOTH sides means the query is broken, not that
  # the schemas agree. This is the structural half of the exit-2 contract: it
  # cannot be satisfied by scanning nothing.
  local cat missing=""
  for cat in $REQUIRED_CATEGORIES; do
    if [[ "$(count_of "$lf" "$cat")" == "0" && "$(count_of "$rf" "$cat")" == "0" ]]; then
      missing="$missing $cat"
    fi
  done
  [[ -z "$missing" ]] || cannot_check "required categories returned zero rows on BOTH sides:$missing"

  # Two different major versions cannot be meaningfully diffed; every later
  # category would report phantom drift and it would read as hand-applied DDL.
  local lv rv
  lv="$(awk -F'\t' '$1=="server"{print $3}' "$lf" | head -1)"
  rv="$(awk -F'\t' '$1=="server"{print $3}' "$rf" | head -1)"
  if [[ "${lv:0:2}" != "${rv:0:2}" ]]; then
    cannot_check "local is server_version_num $lv, remote is $rv — different major versions"
  fi

  LC_ALL=C awk -F'\t' -v OL="$d.only_local" -v OR="$d.only_remote" -v CH="$d.changed" '
    FNR==NR { k = $1 SUBSEP $2; L[k] = $3; next }
    { k = $1 SUBSEP $2; R[k] = $3
      if (!(k in L)) { print $1 "\t" $2 "\t" $3 > OR }
      else if (L[k] != $3) { print $1 "\t" $2 "\t" L[k] "\t" $3 > CH } }
    END { for (k in L) if (!(k in R)) {
            split(k, p, SUBSEP); print p[1] "\t" p[2] "\t" L[k] > OL } }
  ' "$lf" "$rf"

  touch "$d.only_local" "$d.only_remote" "$d.changed"
  local n_ol n_or n_ch
  n_ol=$(wc -l < "$d.only_local" | tr -d ' ')
  n_or=$(wc -l < "$d.only_remote" | tr -d ' ')
  n_ch=$(wc -l < "$d.changed"     | tr -d ' ')

  [[ "$quiet" == "--quiet" ]] && { [[ $((n_ol + n_or + n_ch)) -eq 0 ]] && return 0 || return 1; }

  section() {  # <title> <file> <hint> <formatter>
    local title="$1" file="$2" hint="$3" fmt="$4" n
    n=$(wc -l < "$file" | tr -d ' ')
    [[ "$n" -eq 0 ]] && return 0
    echo
    echo "== $title ($n)"
    LC_ALL=C sort "$file" | head -40 | $fmt
    [[ "$n" -gt 40 ]] && echo "   ... $((n - 40)) more"
    echo "   -> $hint"
  }
  fmt_one()     { awk -F'\t' '{printf "   [%s] %s\n        %s\n", $1, $2, $3}'; }
  fmt_changed() { awk -F'\t' '{printf "   [%s] %s\n        local  : %s\n        remote : %s\n", $1, $2, $3, $4}'; }

  # Ordered worst-first. A CHANGED object is the class the old script was
  # blindest to, so it is printed first.
  section "CHANGED — same object, different definition" "$d.changed" \
    "Read both lines. If remote is the odd one out it was altered by hand; capture it as a migration, then 'supabase migration repair --status applied <v>'." \
    fmt_changed
  section "IN REMOTE, NOT IN LOCAL — hand-applied DDL" "$d.only_remote" \
    "FIRST: is your branch behind main? Migrations auto-apply on merge, so every migration merged since you branched is ALREADY on production and NOT in your local build — it lands here looking exactly like hand-applied DDL. Merge main and re-run BEFORE capturing anything; capturing another session's migration duplicates it. Only if the branch is current: capture it, then 'supabase migration repair --status applied <v>'." \
    fmt_one
  section "IN LOCAL, NOT IN REMOTE — unpushed migration" "$d.only_local" \
    "Run 'supabase db push', or drop the migration if it was a mistake." \
    fmt_one

  [[ $((n_ol + n_or + n_ch)) -eq 0 ]] && return 0 || return 1
}

# ---------------------------------------------------------------------------
# --self-test
# ---------------------------------------------------------------------------
# Every invariant below is an END-TO-END one: real DDL in a real Postgres,
# fingerprinted by the real queries, compared by the real comparison. A guard
# whose self-test only exercises its own string handling proves nothing about
# the SQL, and the SQL is where all nine blind spots lived.

SELFTEST_BASE="
CREATE TABLE public.inventory_lots (
    id uuid PRIMARY KEY,
    restaurant_id uuid NOT NULL,
    master_wine_id uuid,
    qty numeric(12,3) DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    beverage_kind text NOT NULL DEFAULT 'unknown',
    note text NOT NULL,
    CONSTRAINT il_unit_vocab CHECK (unit = ANY (ARRAY['bottle'::text,'case'::text,'keg'::text])),
    CONSTRAINT il_rid_mwid_key UNIQUE (restaurant_id, master_wine_id));
CREATE INDEX idx_il_restaurant ON public.inventory_lots USING btree (restaurant_id);
CREATE MATERIALIZED VIEW public.lot_rollup AS
    SELECT restaurant_id, count(*) AS lot_count FROM public.inventory_lots GROUP BY restaurant_id;
CREATE FUNCTION public.calculate_sales_velocity(p_restaurant_id uuid, p_days integer)
    RETURNS numeric LANGUAGE sql AS \$\$ SELECT 0::numeric \$\$;
CREATE TYPE public.lot_state AS ENUM ('open','closed');
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY il_tenant ON public.inventory_lots FOR SELECT USING (restaurant_id IS NOT NULL);
"

# name -> DDL applied to the remote side only. Each is one blind spot.
selftest_drifts() {
  cat <<'DRIFTS'
numeric-scale-erased|ALTER TABLE public.inventory_lots ALTER COLUMN qty TYPE numeric;
drop-not-null|ALTER TABLE public.inventory_lots ALTER COLUMN note DROP NOT NULL;
function-signature|DROP FUNCTION public.calculate_sales_velocity(uuid,integer); CREATE FUNCTION public.calculate_sales_velocity(p_restaurant_id text, p_days bigint) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
function-body|CREATE OR REPLACE FUNCTION public.calculate_sales_velocity(p_restaurant_id uuid, p_days integer) RETURNS numeric LANGUAGE sql AS $$ SELECT 1::numeric $$;
check-vocabulary|ALTER TABLE public.inventory_lots DROP CONSTRAINT il_unit_vocab; ALTER TABLE public.inventory_lots ADD CONSTRAINT il_unit_vocab CHECK (unit = ANY (ARRAY['bottle'::text,'case'::text,'keg'::text,'splash'::text]));
unique-constraint-dropped|ALTER TABLE public.inventory_lots DROP CONSTRAINT il_rid_mwid_key;
index-dropped|DROP INDEX public.idx_il_restaurant;
column-default-removed|ALTER TABLE public.inventory_lots ALTER COLUMN beverage_kind DROP DEFAULT;
matview-column-added|DROP MATERIALIZED VIEW public.lot_rollup; CREATE MATERIALIZED VIEW public.lot_rollup AS SELECT restaurant_id, count(*) AS lot_count, max(unit) AS a_unit FROM public.inventory_lots GROUP BY restaurant_id;
enum-label-added|ALTER TYPE public.lot_state ADD VALUE 'voided';
rls-disabled|ALTER TABLE public.inventory_lots DISABLE ROW LEVEL SECURITY;
policy-widened|ALTER POLICY il_tenant ON public.inventory_lots USING (true);
DRIFTS
}

# PAIRS — the normalizer's two-sided proof.
#
# Each row is `name|expect|ddlA|ddlB`. Both sides get SELFTEST_BASE plus their
# own DDL, then are compared. `same` means the normalizer MUST collapse the
# difference; `differs` means it MUST NOT.
#
# The `differs` rows are deliberately adversarial: each spells its two sides
# with the two DIFFERENT renderings *as well as* changing the content, so a
# normalizer that over-reached and swallowed the content would pass the `same`
# row and quietly fail these. That is the failure this list exists to catch —
# handing back the blindness the rewrite just removed.
selftest_pairs() {
  cat <<'PAIRS'
render-equivalent|same|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, 'CASE'::character varying])::text[]))));
check-value-added|differs|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, 'CASE'::character varying, 'SPLASH'::character varying])::text[]))));
check-value-removed|differs|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE','SPLASH')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, 'CASE'::character varying])::text[]))));
check-value-renamed|differs|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (((unit_type)::text = ANY ((ARRAY['BOTTLE'::character varying, 'CASEX'::character varying])::text[]))));
check-column-changed|differs|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (other_col IN ('BOTTLE','CASE')));
check-operator-negated|differs|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type IN ('BOTTLE','CASE')));|CREATE TABLE public.probe (unit_type character varying(20), other_col character varying(20), CONSTRAINT probe_chk CHECK (unit_type NOT IN ('BOTTLE','CASE')));
index-predicate-render-equivalent|same|CREATE TABLE public.probe (rid uuid, state character varying(20)); CREATE INDEX probe_idx ON public.probe (rid) WHERE state IN ('open','requested');|CREATE TABLE public.probe (rid uuid, state character varying(20)); CREATE INDEX probe_idx ON public.probe (rid) WHERE ((state)::text = ANY ((ARRAY['open'::character varying, 'requested'::character varying])::text[]));
index-predicate-value-added|differs|CREATE TABLE public.probe (rid uuid, state character varying(20)); CREATE INDEX probe_idx ON public.probe (rid) WHERE state IN ('open','requested');|CREATE TABLE public.probe (rid uuid, state character varying(20)); CREATE INDEX probe_idx ON public.probe (rid) WHERE ((state)::text = ANY ((ARRAY['open'::character varying, 'requested'::character varying, 'promised'::character varying])::text[]));
PAIRS
}

st_sql() { docker exec -i "$DBC" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -c "$2" </dev/null >/dev/null 2>&1; }
st_admin() { docker exec -i "$DBC" psql -U postgres -d postgres -q -c "$1" </dev/null >/dev/null 2>&1 || true; }

self_test() {
  resolve_container
  local A="parity_selftest_a" B="parity_selftest_b" E1="parity_selftest_e1" E2="parity_selftest_e2"
  local FAILED="$WORK/st_failures"; : > "$FAILED"
  local checks=0 code=0
  fail() { echo "$*" >> "$FAILED"; }
  local db
  for db in "$A" "$B" "$E1" "$E2"; do st_admin "DROP DATABASE IF EXISTS $db;"; st_admin "CREATE DATABASE $db;"; done
  trap 'for db in parity_selftest_a parity_selftest_b parity_selftest_e1 parity_selftest_e2; do st_admin "DROP DATABASE IF EXISTS $db;"; done; rm -rf "$WORK"' EXIT

  st_sql "$A" "$SELFTEST_BASE" || { echo "   could not build the fixture"; return 2; }
  st_sql "$B" "$SELFTEST_BASE" || { echo "   could not build the fixture"; return 2; }

  fingerprint "fixture A" "$WORK/st_a" -U postgres -d "$A"
  fingerprint "fixture B" "$WORK/st_b" -U postgres -d "$B"

  # 1. Identical databases compare clean.
  checks=$((checks+1))
  compare "$WORK/st_a" "$WORK/st_b" --quiet || fail "two identical fixtures did not compare clean"

  # 2. Every blind spot, one at a time, each on a fresh copy of B.
  local name ddl
  while IFS='|' read -r name ddl; do
    [[ -z "$name" ]] && continue
    checks=$((checks+1))
    st_admin "DROP DATABASE IF EXISTS $B;"; st_admin "CREATE DATABASE $B;"
    if ! st_sql "$B" "$SELFTEST_BASE"; then fail "$name: fixture rebuild failed"; continue; fi
    # ALTER TYPE ... ADD VALUE cannot run inside the implicit transaction psql
    # opens for a multi-statement -c, so each drift is piped in as statements.
    if ! printf '%s\n' "$ddl" | docker exec -i "$DBC" psql -U postgres -d "$B" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1; then
      fail "$name: drift DDL did not apply"; continue
    fi
    fingerprint "fixture B" "$WORK/st_b" -U postgres -d "$B"
    if compare "$WORK/st_a" "$WORK/st_b" --quiet; then
      fail "$name: NOT DETECTED — the guard is still blind to it"
    fi
  done < <(selftest_drifts)

  # 2b. The normalizer, proven in BOTH directions on the same list. One row must
  #     collapse; five must survive. A normalizer can only pass all six by
  #     touching the cast decoration and nothing else.
  local pname expect ddl_a ddl_b
  while IFS='|' read -r pname expect ddl_a ddl_b; do
    [[ -z "$pname" ]] && continue
    checks=$((checks+1))
    st_admin "DROP DATABASE IF EXISTS $A;"; st_admin "CREATE DATABASE $A;"
    st_admin "DROP DATABASE IF EXISTS $B;"; st_admin "CREATE DATABASE $B;"
    if ! st_sql "$A" "$SELFTEST_BASE$ddl_a" || ! st_sql "$B" "$SELFTEST_BASE$ddl_b"; then
      fail "$pname: pair fixture did not build"; continue
    fi
    fingerprint "pair A" "$WORK/st_pa" -U postgres -d "$A"
    fingerprint "pair B" "$WORK/st_pb" -U postgres -d "$B"
    if compare "$WORK/st_pa" "$WORK/st_pb" --quiet; then
      [[ "$expect" == "same" ]] || fail "$pname: COLLAPSED — the normalizer swallowed a real difference"
    else
      [[ "$expect" == "differs" ]] || fail "$pname: still reported as drift — the normalizer did not collapse it"
    fi
  done < <(selftest_pairs)

  # The pair loop rebuilt A. Restore it for the invariants below.
  st_admin "DROP DATABASE IF EXISTS $A;"; st_admin "CREATE DATABASE $A;"
  st_sql "$A" "$SELFTEST_BASE" || fail "fixture A rebuild failed"
  fingerprint "fixture A" "$WORK/st_a" -U postgres -d "$A"

  # 3. Two EMPTY databases, driven through the WHOLE path, must be exit 2 and
  #    never 0. This is the exact shape the previous version got wrong: it
  #    printed "0 columns, 0 functions" then "PASS" and exited 0.
  checks=$((checks+1))
  code=0
  ( fingerprint "empty A" "$WORK/st_e1" -U postgres -d "$E1"
    fingerprint "empty B" "$WORK/st_e2" -U postgres -d "$E2"
    compare "$WORK/st_e1" "$WORK/st_e2" ) >/dev/null 2>&1 || code=$?
  [[ "$code" == "2" ]] || fail "two empty databases exited $code, not 2"

  # 4. A required category empty on both sides is exit 2 even when the two
  #    fingerprints are byte-identical — "we agree about nothing" is not a pass.
  checks=$((checks+1))
  printf 'server\tversion\t160000\n' > "$WORK/st_h1"
  cp "$WORK/st_h1" "$WORK/st_h2"
  code=0; ( compare "$WORK/st_h1" "$WORK/st_h2" --quiet ) >/dev/null 2>&1 || code=$?
  [[ "$code" == "2" ]] || fail "identical-but-empty fingerprints exited $code, not 2"

  # 5. A major-version mismatch is exit 2, not a wall of phantom drift.
  checks=$((checks+1))
  awk -F'\t' 'BEGIN{OFS="\t"} $1=="server"{$3="150004"} {print}' "$WORK/st_a" > "$WORK/st_v"
  code=0; ( compare "$WORK/st_a" "$WORK/st_v" --quiet ) >/dev/null 2>&1 || code=$?
  [[ "$code" == "2" ]] || fail "a major-version mismatch exited $code, not 2"

  # 6. An unreachable database is exit 2.
  checks=$((checks+1))
  code=0; ( fingerprint "nowhere" "$WORK/st_n" -U postgres -d parity_selftest_does_not_exist ) >/dev/null 2>&1 || code=$?
  [[ "$code" == "2" ]] || fail "an unreachable database exited $code, not 2"

  # 6b. The fingerprint heredoc is UNQUOTED (it has to be — it interpolates the
  #     helper functions), which means bash also expands backticks inside it. A
  #     backtick in an explanatory SQL comment therefore runs as a command and
  #     silently mangles the query. That happened while writing this file, so it
  #     is an invariant now rather than a lesson.
  checks=$((checks+1))
  local hd_start hd_end
  hd_start="$(grep -n "FINGERPRINT_SQL <<SQL" "$0" | head -1 | cut -d: -f1)"
  hd_end="$(awk 'NR>'"$hd_start"' && /^SQL$/ {print NR; exit}' "$0")"
  if [[ -z "$hd_start" || -z "$hd_end" ]]; then
    fail "could not locate the fingerprint heredoc to check it"
  elif grep -n '`' "$0" | awk -F: -v a="$hd_start" -v b="$hd_end" '$1>a && $1<b' | grep -q .; then
    fail "a backtick appears inside the fingerprint heredoc — bash will execute it"
  fi
  checks=$((checks+1))
  if [[ -n "$("$0" --print-sql 2>&1 >/dev/null)" ]]; then
    fail "--print-sql wrote to stderr — the heredoc is being mangled by the shell"
  fi

  # 7. The real difference must be REPORTED, not merely counted — a guard that
  #    knows something changed but cannot say what is not usable.
  checks=$((checks+1))
  st_admin "DROP DATABASE IF EXISTS $B;"; st_admin "CREATE DATABASE $B;"
  st_sql "$B" "$SELFTEST_BASE" || fail "fixture rebuild failed"
  st_sql "$B" "ALTER TABLE public.inventory_lots ALTER COLUMN qty TYPE numeric;" || true
  fingerprint "fixture B" "$WORK/st_b" -U postgres -d "$B"
  compare "$WORK/st_a" "$WORK/st_b" > "$WORK/st_report" 2>&1 || true
  if ! grep -q 'numeric(12,3)' "$WORK/st_report" || ! grep -q 'CHANGED' "$WORK/st_report"; then
    fail "the report did not name numeric(12,3) as the changed side"
  fi

  echo "== --self-test: $checks invariants, end-to-end against real databases"
  if [[ -s "$FAILED" ]]; then
    sed 's/^/   FAIL — /' "$FAILED"
    return 1
  fi
  echo "   identical databases compare clean"
  echo "   numeric(12,3) -> numeric is caught (information_schema calls both 'numeric')"
  echo "   DROP NOT NULL is caught"
  echo "   a changed function SIGNATURE is caught; so is a changed function BODY"
  echo "   a widened CHECK vocabulary is caught"
  echo "   a dropped UNIQUE constraint and a dropped INDEX are caught"
  echo "   a removed column DEFAULT is caught"
  echo "   a materialized view's columns are compared at all (information_schema cannot see them)"
  echo "   an added enum label, a disabled RLS flag and a widened policy are caught"
  echo "   the SAME CHECK spelled two ways (x IN (...) vs the pg_dump array-cast text)"
  echo "     is NOT reported — the 45-constraint false positive from the first real CI run"
  echo "   a CHECK with a value added, removed or renamed, its column swapped, or its"
  echo "     operator negated IS still reported, even when the two sides ALSO use the"
  echo "     two different renderings — the normalizer collapses decoration, not content"
  echo "   a partial INDEX's WHERE predicate gets the same treatment in both directions"
  echo "     (the last false positive of the first real CI run was one of these)"
  echo "   an EMPTY database exits 2, never 0 — the fault this rewrite exists to remove"
  echo "   two identical-but-empty fingerprints exit 2, never 0"
  echo "   a Postgres major-version mismatch exits 2, not phantom drift"
  echo "   an unreachable database exits 2"
  echo "   the report NAMES the changed definition on both sides"
  echo "   the fingerprint heredoc carries no backtick for bash to execute, and"
  echo "     --print-sql emits nothing on stderr (this file had that bug once)"
  echo "PASS"
  return 0
}

# `--print-sql` exists so a human can answer "what did it actually compare?"
# against any database, without trusting this file's prose. The comparison IS
# the SQL; a guard that will not show you its own query is asking for faith.
if [[ "$MODE" == "print-sql" ]]; then
  printf '%s\n' "$FINGERPRINT_SQL"
  exit 0
fi

if [[ "$MODE" == "self-test" ]]; then
  self_test
  exit $?
fi

# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

REMOTE_URL="${SUPABASE_DIRECT_CONNECTION_STRING:-}"
if [[ -z "$REMOTE_URL" && -f .env ]]; then
  REMOTE_URL="$(grep -E '^SUPABASE_DIRECT_CONNECTION_STRING=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
[[ -n "$REMOTE_URL" ]] || cannot_check "no SUPABASE_DIRECT_CONNECTION_STRING (env or .env)"

resolve_container

if [[ $RESET -eq 1 ]]; then
  echo "Rebuilding local database from migrations..."
  supabase db reset --no-seed >/dev/null
fi

fingerprint "local"  "$WORK/local"  -U postgres -d "${PARITY_LOCAL_DB:-postgres}"
fingerprint "remote" "$WORK/remote" "$REMOTE_URL"

echo "local  : $(wc -l < "$WORK/local"  | tr -d ' ') facts — $(category_counts "$WORK/local")"
echo "remote : $(wc -l < "$WORK/remote" | tr -d ' ') facts — $(category_counts "$WORK/remote")"
echo "required categories (zero on both sides = exit 2): $REQUIRED_CATEGORIES"

# Named, never silent. If one of these is ever a real table rather than a
# snapshot, it shows up here rather than vanishing from the comparison.
if psql_into "$WORK/remote_bak" "$BAK_Q" "$REMOTE_URL" && [[ -s "$WORK/remote_bak" ]]; then
  echo "excluded from the comparison — ad-hoc backup tables on remote ($(wc -l < "$WORK/remote_bak" | tr -d ' ')):"
  sed 's/^/   /' "$WORK/remote_bak"
  echo "   (snapshots, not schema. Drop them on production when they are no longer needed.)"
fi

if compare "$WORK/local" "$WORK/remote"; then
  echo
  echo "PASS — local and remote agree on every compared object."
  echo "       Compared: relations (incl. materialized views), columns with full"
  echo "       type/nullability/default, column order, constraints, indexes,"
  echo "       function signatures and bodies, view bodies, triggers, RLS"
  echo "       policies, enum/domain types, sequences."
  echo "       NOT compared: grants and role membership, table/column comments,"
  echo "       schemas other than public, table data, and physical storage"
  echo "       settings. Those are still blind spots — see ADR 0072."
  exit 0
fi

echo
echo "FAIL — schema drift detected. See .planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt"
echo "       for what unchecked drift looked like the last time nobody was watching."
exit 1
