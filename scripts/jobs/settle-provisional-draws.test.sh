#!/bin/bash
# settle-provisional-draws.test.sh - proves scripts/jobs/settle-provisional-draws.sql.
#
#   PSQL_CMD='psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q' bash scripts/jobs/settle-provisional-draws.test.sh
#   (local pgtest container: PSQL_CMD='docker exec -i fixlane-pg psql -U postgres -d <db> -v ON_ERROR_STOP=1 -q')
#
# <db> must be a SCRATCH database built from supabase/migrations (never production):
# the test commits synthetic rows (house c0920000-...). CI does not run it
# (claim SUPABASE-TESTS-RUN-IN-CI); it is run by hand / pgtest, like supabase/tests.
#
# Asserts: (1) the dry run leaves every row count and the settlements' identity
# sequence unchanged; (2) apply writes N, a second apply writes 0; (3) while a job
# run holds its locks a live finalise_delivery_cost waits (lock_timeout, 55P03);
# (4) a second job run waits on the advisory lock.
set -u
: "${PSQL_CMD:?set PSQL_CMD}"
JOB="$(cd "$(dirname "$0")" && pwd)/settle-provisional-draws.sql"
FAILS=0
q() { eval "$PSQL_CMD -At" <<<"$1"; }
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; FAILS=$((FAILS + 1)); }
eq() { case "$2" in ''|*ERROR*) bad "$1: empty or error: $2"; return;; esac; [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1: expected '$3', got '$2'"; }
state() { q "select (select count(*) from public.inventory_lot_draw_settlements) || '/' || (select count(*) from public.inventory_lot_draws) || '/' || (select count(*) from public.inventory_lots) || '/' || (select coalesce(last_value::text,'never') from pg_sequences where schemaname || '.' || sequencename = pg_get_serial_sequence('public.inventory_lot_draw_settlements','seq')) " 2>&1; }

# ---- fixture: 3 provisional lots with sales; a and b are finalised, then their
# settlements removed (as superuser) so they look like pre-settlement history.
# c stays provisional for the concurrency check.
eval "$PSQL_CMD" >/dev/null <<'SQL' || { echo "FAIL fixture"; exit 1; }
create function pg_temp.u(s text) returns uuid language sql immutable as $$ select ('c0920000-0000-4000-8000-' || lpad(s, 12, '0'))::uuid $$;
insert into public.restaurants (id, name, slug) values (pg_temp.u('1'), 'Settle job test house', 'settle-job-test-house');
do $$ declare x text; begin
  foreach x in array array['a','b','c'] loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
      values (pg_temp.u('1'||x||'0'), 'SETTLE-JOB-'||upper(x), 'Settle job wine '||upper(x), 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
      values (pg_temp.u('2'||x||'0'), pg_temp.u('1'), pg_temp.u('1'||x||'0'), 750, 150);
    insert into public.deliveries (id, restaurant_id, state) values (pg_temp.u('3'||x||'0'), pg_temp.u('1'), 'DELIVERED');
    perform public.apply_stock_movement(pg_temp.u('2'||x||'0'), 'live', 10, 'purchase', 'manual', null, 'settle job test',
      null, null, null, null, null, 'delivery', pg_temp.u('3'||x||'0'));
    perform public.apply_stock_movement(pg_temp.u('2'||x||'0'), 'live', -4, 'sale', 'manual', null, 'settle job test');
  end loop;
  perform public.finalise_delivery_cost(pg_temp.u('3a0'), pg_temp.u('2a0'), 12.50, 'invoice');
  perform public.finalise_delivery_cost(pg_temp.u('3b0'), pg_temp.u('2b0'), 20.00, 'invoice');
end $$;
set session_replication_role = replica;
delete from public.inventory_lot_draw_settlements where restaurant_id = pg_temp.u('1');
SQL

# ---- 1. dry run writes nothing, sequence included
before=$(state)
out=$(eval "$PSQL_CMD" <"$JOB" 2>&1)
after=$(state)
eq "dry run leaves counts and the settlements sequence unchanged" "$after" "$before"
echo "$out" | grep -q 'dry run, ROLLED BACK' && ok "dry run says it rolled back" || bad "dry run output: $out"
echo "$out" | grep -q '2 *|' && ok "dry run prints the count (2 draws)" || bad "dry run printed no count: $out"

# ---- 2. apply writes N, again writes 0
eval "$PSQL_CMD" -v apply=1 <"$JOB" >/dev/null 2>&1
eq "apply writes 2 settlements" "$(q "select count(*) from public.inventory_lot_draw_settlements where restaurant_id='c0920000-0000-4000-8000-000000000001'")" 2
eq "settled at the lots' costs (4x12.50 + 4x20.00)" "$(q "select sum(settled_total) from public.inventory_lot_draw_settlements where restaurant_id='c0920000-0000-4000-8000-000000000001'")" 130.00
eval "$PSQL_CMD" -v apply=1 <"$JOB" >/dev/null 2>&1
eq "second apply writes nothing more" "$(q "select count(*) from public.inventory_lot_draw_settlements where restaurant_id='c0920000-0000-4000-8000-000000000001'")" 2

# ---- 3. while the job holds its locks, a live finalise waits (55P03)
SLOW=$(mktemp)
sed 's/^COMMIT;$/SELECT pg_sleep(8);\nCOMMIT;/' "$JOB" >"$SLOW"
( eval "$PSQL_CMD" -v apply=1 <"$SLOW" >/dev/null 2>&1 ) &
BG=$!
sleep 3
fin=$(eval "$PSQL_CMD" <<'SQL' 2>&1
set lock_timeout = '1500ms';
select public.finalise_delivery_cost('c0920000-0000-4000-8000-0000000003c0'::uuid, 'c0920000-0000-4000-8000-0000000002c0'::uuid, 30.00, 'invoice');
SQL
)
echo "$fin" | grep -q 'lock timeout' && ok "finalise_delivery_cost waits while the job holds the lots (55P03)" || bad "finalise did not wait: $fin"
# ---- 4. a second job run waits on the advisory lock
second=$({ echo "set lock_timeout = '1500ms';"; cat "$JOB"; } | eval "$PSQL_CMD" -v apply=1 2>&1)
echo "$second" | grep -q 'lock timeout' && ok "a second job run waits (lock timeout)" || bad "second job did not wait: $second"
wait $BG
# advisory lock alone (no table lock held by the other session): the job must still wait
hold=$(mktemp)
( eval "$PSQL_CMD" <<'SQL' >/dev/null 2>&1
begin; select pg_advisory_xact_lock(hashtext('settle-provisional-draws')); select pg_sleep(6); commit;
SQL
) &
BG2=$!
sleep 2
adv=$({ echo "set lock_timeout = '1500ms';"; cat "$JOB"; } | eval "$PSQL_CMD" -v apply=1 2>&1)
echo "$adv" | grep -q 'lock timeout' && ok "job waits on the advisory lock alone" || bad "job ignored the advisory lock: $adv"
wait $BG2
rm -f "$SLOW" "$hold"
[ "$FAILS" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$FAILS FAILED"; exit 1; }
