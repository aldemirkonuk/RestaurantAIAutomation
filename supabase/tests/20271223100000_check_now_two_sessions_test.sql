-- house_inbox_claim_read under REAL concurrency (r109 mail-fix, DD-r108-7 /
-- DD-r108-47: "the race spec is required"). The r108 proof ran on PGlite, which
-- is one session, so two claims there never overlapped. Here the claims run on
-- their own server connections (dblink), so a second UPDATE really waits on the
-- first one's row lock and re-checks its WHERE after the first commits.
--
--  A. one claim holds an uncommitted lease; a second session's claim blocks on
--     the row, and once the first commits it finds the lease held: claimed=false,
--     busy=true. One mailbox read, never two.
--  B. 25 rounds of two sessions sent at the same instant (a press, floor 60, and
--     the 5-minute run, floor 0): exactly one wins each round.
--  C. the run (floor 0) does not starve a press: it never stamps read_now_at, a
--     press is refused only while the run holds the lease or inside 60 s of its
--     last read, and wins after that; a press's stamp never holds off the run.
--  D. the catalog: anon and authenticated cannot EXECUTE it; service_role can.
--
-- Synthetic rows only. Run with p4-scratch/sim-run/fixes/db/pgtest.sh (CI does
-- not run supabase/tests). Needs a superuser (dblink, session_replication_role).

\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

-- The cursor row's FKs (restaurants, integration_oauth_connections) are not what
-- is under test; they are skipped for the fixture insert only.
SET session_replication_role = replica;
INSERT INTO public.house_inbox_cursors (connection_id, restaurant_id, last_internal_date)
VALUES ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000a1', 0);
SET session_replication_role = origin;

SELECT dblink_connect('b', 'dbname=' || current_database() || ' user=postgres');
SELECT dblink_connect('c', 'dbname=' || current_database() || ' user=postgres');
SELECT dblink_connect('w', 'dbname=' || current_database() || ' user=postgres');

-- Every write after the fixture goes through connection w (autocommit): a write
-- inside this session's DO block would hold the row lock until the block ends,
-- and the claims the block waits for would wait on it.
CREATE FUNCTION pg_temp.w(set_and_where text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dblink_exec('w', 'UPDATE public.house_inbox_cursors SET ' || set_and_where);
END $$;
CREATE FUNCTION pg_temp.reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.w('reading_until = NULL, reading_token = NULL, read_now_at = NULL, last_read_at = NULL'
    || ' WHERE connection_id = ' || quote_literal('a0000000-0000-4000-8000-0000000000c1'));
END $$;
CREATE FUNCTION pg_temp.claim_sql(floor_s int) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.house_inbox_claim_read(%L, %L, %s, 270)::text',
                'a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000a1', floor_s);
$$;

-- A. an uncommitted lease makes a second session wait, then lose.
SELECT pg_temp.reset();
BEGIN;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.house_inbox_claim_read('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000a1', 60, 270);
  ASSERT (r->>'claimed')::boolean, 'A: the first claim must win: ' || r::text;
END $$;
SELECT dblink_send_query('b', pg_temp.claim_sql(60));
DO $$
DECLARE waiting int := 0; i int;
BEGIN
  FOR i IN 1..100 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO waiting FROM pg_stat_activity
     WHERE wait_event_type = 'Lock' AND query LIKE '%house_inbox_claim_read%' AND pid <> pg_backend_pid();
    EXIT WHEN waiting > 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  ASSERT waiting = 1, 'A: the second session must be waiting on the row lock, found ' || waiting;
  ASSERT dblink_is_busy('b') = 1, 'A: the second claim must not return while the first is uncommitted';
END $$;
COMMIT;
DO $$
DECLARE r jsonb;
BEGIN
  SELECT x::jsonb INTO r FROM dblink_get_result('b') AS t(x text);
  PERFORM * FROM dblink_get_result('b') AS t(x text);
  ASSERT NOT (r->>'claimed')::boolean, 'A: the second session must lose once the first commits: ' || r::text;
  ASSERT (r->>'busy')::boolean, 'A: the loser must be told the grant is being read: ' || r::text;
  RAISE NOTICE 'A: second session waited on the lock, then got %', r;
END $$;

-- B. two sessions at the same instant, 25 times: exactly one winner each time.
DO $$
DECLARE i int; rb jsonb; rc jsonb; wins int; runs int := 0;
BEGIN
  FOR i IN 1..25 LOOP
    PERFORM pg_temp.reset();
    PERFORM dblink_send_query('b', pg_temp.claim_sql(60));
    PERFORM dblink_send_query('c', pg_temp.claim_sql(0));
    SELECT x::jsonb INTO rb FROM dblink_get_result('b') AS t(x text);
    PERFORM * FROM dblink_get_result('b') AS t(x text);
    SELECT x::jsonb INTO rc FROM dblink_get_result('c') AS t(x text);
    PERFORM * FROM dblink_get_result('c') AS t(x text);
    wins := (rb->>'claimed')::boolean::int + (rc->>'claimed')::boolean::int;
    ASSERT wins = 1, format('B round %s: %s winners (press %s, run %s)', i, wins, rb, rc);
    runs := runs + (rc->>'claimed')::boolean::int;
  END LOOP;
  RAISE NOTICE 'B: 25 rounds, one winner each (the run won %, the press %)', runs, 25 - runs;
END $$;

-- C. the run does not starve a press.
DO $$
DECLARE r jsonb; tok uuid;
  me text := quote_literal('a0000000-0000-4000-8000-0000000000c1');
BEGIN
  PERFORM pg_temp.reset();
  SELECT x::jsonb INTO r FROM dblink('b', pg_temp.claim_sql(0)) AS t(x text);
  ASSERT (r->>'claimed')::boolean, 'C: the run must take a free grant: ' || r::text;
  ASSERT (SELECT read_now_at IS NULL FROM public.house_inbox_cursors WHERE connection_id = 'a0000000-0000-4000-8000-0000000000c1'),
    'C: the run (floor 0) must not stamp the press floor';
  SELECT x::jsonb INTO r FROM dblink('c', pg_temp.claim_sql(60)) AS t(x text);
  ASSERT NOT (r->>'claimed')::boolean AND (r->>'busy')::boolean, 'C: a press while the run reads is refused as busy: ' || r::text;
  -- the run ends: released by its own token (as the gateway releases), its read 61 s ago.
  SELECT reading_token INTO tok FROM public.house_inbox_cursors WHERE connection_id = 'a0000000-0000-4000-8000-0000000000c1';
  PERFORM pg_temp.w('reading_until = NULL, reading_token = NULL, last_read_at = clock_timestamp() - interval ''61 seconds'''
    || ' WHERE connection_id = ' || me || ' AND reading_token = ' || quote_literal(tok));
  SELECT x::jsonb INTO r FROM dblink('c', pg_temp.claim_sql(60)) AS t(x text);
  ASSERT (r->>'claimed')::boolean, 'C: a press 61 s after the run ended must win: ' || r::text;
  -- a run that just ended refuses a press by the floor, not as busy, and says the wait.
  PERFORM pg_temp.reset();
  PERFORM pg_temp.w('last_read_at = clock_timestamp() WHERE connection_id = ' || me);
  SELECT x::jsonb INTO r FROM dblink('c', pg_temp.claim_sql(60)) AS t(x text);
  ASSERT NOT (r->>'claimed')::boolean AND NOT (r->>'busy')::boolean AND (r->>'wait_seconds')::int BETWEEN 59 AND 60,
    'C: a press right after a run waits the floor: ' || r::text;
  -- and a press's fresh floor stamp never holds off the run.
  PERFORM pg_temp.w('read_now_at = clock_timestamp() WHERE connection_id = ' || me);
  SELECT x::jsonb INTO r FROM dblink('b', pg_temp.claim_sql(0)) AS t(x text);
  ASSERT (r->>'claimed')::boolean, 'C: the run must not be held off by a fresh press stamp: ' || r::text;
END $$;

-- D. who may call it, from the catalog.
DO $$
DECLARE f text := 'public.house_inbox_claim_read(uuid, uuid, integer, integer)';
BEGIN
  ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), 'D: anon can EXECUTE';
  ASSERT NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'D: authenticated can EXECUTE';
  ASSERT has_function_privilege('service_role', f, 'EXECUTE'), 'D: service_role cannot EXECUTE';
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure), 'D: it must stay SECURITY INVOKER';
END $$;

SELECT dblink_disconnect('b');
SELECT dblink_disconnect('c');
SELECT dblink_disconnect('w');
DELETE FROM public.house_inbox_cursors WHERE connection_id = 'a0000000-0000-4000-8000-0000000000c1';
\echo 'PASS check_now_two_sessions: A lock-wait loser, B 25/25 single winner, C run never starves a press, D grants'
