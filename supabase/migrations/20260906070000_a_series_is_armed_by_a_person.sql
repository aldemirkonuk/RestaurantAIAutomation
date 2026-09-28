-- A series is armed by a person, on numbers that person was shown.
--
-- WHY THIS EXISTS (the founder's answer to phase 0's Q3, 2026-09-05:
-- "a Mudavym admin arms one series at a time ... with the calibration's derived
-- threshold SHOWN before the act; the act is sealed and logged; the calibration
-- job only PROPOSES numbers and writes nothing to the series; nothing arms
-- itself")
-- ---------------------------------------------------------------------------
-- 20260905235000 created the register with `armed BOOLEAN NOT NULL DEFAULT
-- false` and a CHECK that an armed series must carry a derived threshold. What
-- it did not carry is WHO armed it, WHEN, and ON WHICH NUMBERS -- so a row
-- could be flipped to true by anything with the service role and nothing would
-- record that a decision had been made at all. An alert that begins firing with
-- no account of who turned it on is the absence-reported-as-health shape at the
-- one door that interrupts people.
--
-- THE SEAL, AND WHY THIS ACT CANNOT USE `mcp_seal_challenges`
-- ---------------------------------------------------------------------------
-- Measured, not assumed: `mcp_seal_challenges.actor_user_id` is
-- `UUID NOT NULL REFERENCES public.users(user_id)`
-- (20260904170000_a_seal_is_redeemed_not_asserted.sql), and `restaurant_id` is
-- required beside it. A Mudavym admin authenticated by `X-Admin-Key` has
-- NEITHER: ADR 0099's own guard says it "authenticates a machine; it carries no
-- tenant and no user, so a route using it must derive neither from
-- request.user". So the tenant seal store structurally cannot hold this act,
-- and inventing a synthetic user row to fit it would put a fake person's name
-- on a real decision.
--
-- What is preserved instead is the PROPERTY the seal exists for -- *what was
-- approved and what was written have to be the same thing*. The arming route is
-- challenge-and-redeem with the CALIBRATION PROPOSAL as the challenge: the
-- admin reads the proposal, which carries a sha256 over the exact derived
-- numbers and the window they came from, and the arming write must carry that
-- hash back. The service recomputes the proposal from the series' own
-- observations at write time and refuses when the hash differs. A threshold
-- that moved between the showing and the act cannot be armed. The hash is
-- stored on the row and on the log, so the numbers a series was armed on are
-- recoverable afterwards rather than merely asserted.
--
-- THE LOG IS APPEND-ONLY AND RECORDS DISARMING TOO
-- ---------------------------------------------------------------------------
-- A table that only recorded arming would make "this series has never been
-- armed" and "this series was armed and somebody turned it off" render alike.
--
-- Also here: the seal vocabulary learns `commodity_exposure`, for the OTHER
-- half of the founder's answer (Q5) -- an owner or manager asserting that one
-- of this house's items is exposed to a series. That act DOES have a real user
-- and a real house, so it uses the tenant seal store properly.
--
-- Additive. No existing column is altered, no existing CHECK is narrowed, no
-- existing row is rewritten. RLS on and anon/authenticated revoked on the new
-- table in this same file. The Supabase CLI wraps each migration in a
-- transaction, so no explicit BEGIN/COMMIT.

-- ---------------------------------------------------------------------------
-- 1. What the series row remembers about the act that armed it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.commodity_index_series
  -- Not a user FK: the actor is a Mudavym admin holding the service key and has
  -- no `public.users` row. A free-text label, so the column can never claim a
  -- person who does not exist. `check_fk_targets_exist` would pass on a FK to
  -- users; it is the SEMANTICS that forbid one here.
  ADD COLUMN IF NOT EXISTS armed_by_label TEXT,
  ADD COLUMN IF NOT EXISTS armed_at TIMESTAMPTZ,
  -- sha256 over the calibration proposal the admin was shown. This is the
  -- column that turns "somebody armed it" into "somebody armed it on THESE
  -- numbers, and here is the proof they were on the screen".
  ADD COLUMN IF NOT EXISTS armed_proposal_hash TEXT,
  ADD COLUMN IF NOT EXISTS armed_note TEXT;

COMMENT ON COLUMN public.commodity_index_series.armed_by_label IS
  'Who armed this series, as a label rather than a user FK: the actor is a Mudavym admin holding ADR 0099''s service key and has no public.users row. A FK here would name a person who does not exist.';
COMMENT ON COLUMN public.commodity_index_series.armed_proposal_hash IS
  'sha256 of the calibration proposal the admin was shown before arming. The arming write must carry it back and the service recomputes it: a threshold that moved between the showing and the act cannot be armed.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'commodity_index_series_arming_names_itself'
       AND conrelid = to_regclass('public.commodity_index_series')
  ) THEN
    -- An armed series names who armed it, when, and on which numbers -- all
    -- three or none. Two of three is a record that looks complete and is not.
    ALTER TABLE public.commodity_index_series
      ADD CONSTRAINT commodity_index_series_arming_names_itself
      CHECK (
        armed = false
        OR (armed_by_label IS NOT NULL AND btrim(armed_by_label) <> ''
            AND armed_at IS NOT NULL
            AND armed_proposal_hash IS NOT NULL
            AND armed_proposal_hash ~ '^[0-9a-f]{64}$')
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The log. Append-only, and it records the OFF direction too.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commodity_series_arming_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  series_id UUID NOT NULL
    REFERENCES public.commodity_index_series(id) ON DELETE CASCADE,
  -- Kept beside the FK on purpose: a series deleted from the register takes its
  -- rows with it, and the key is what a later reader searches the log by.
  series_key TEXT NOT NULL CHECK (btrim(series_key) <> ''),

  act TEXT NOT NULL CHECK (act IN ('armed', 'disarmed')),

  actor_label TEXT NOT NULL CHECK (btrim(actor_label) <> ''),
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The numbers, kept whole. Recomputing them later from the observations would
  -- give a different answer the moment one more observation lands, so the log
  -- holds what was actually on the screen rather than a recipe for it.
  proposal_hash TEXT CHECK (proposal_hash IS NULL OR proposal_hash ~ '^[0-9a-f]{64}$'),
  rise_threshold NUMERIC(6, 4),
  step_guard NUMERIC(6, 4),
  fires_per_year NUMERIC(6, 2),
  window_from DATE,
  window_to DATE,
  window_n_obs INTEGER,

  note TEXT,

  -- Arming states its numbers; disarming has none to state.
  CONSTRAINT commodity_series_arming_log_arming_states_its_numbers
    CHECK (
      act <> 'armed'
      OR (proposal_hash IS NOT NULL
          AND rise_threshold IS NOT NULL
          AND step_guard IS NOT NULL
          AND fires_per_year IS NOT NULL
          AND window_from IS NOT NULL
          AND window_to IS NOT NULL
          AND window_n_obs IS NOT NULL)
    )
);

COMMENT ON TABLE public.commodity_series_arming_log IS
  'Append-only record of every act that armed or DISARMED a commodity index series (phase 0 Q3). Records the off direction too: a log that held only arming would make "never armed" and "armed and then turned off" render alike.';

CREATE INDEX IF NOT EXISTS idx_commodity_series_arming_log_series
  ON public.commodity_series_arming_log (series_key, acted_at DESC);

ALTER TABLE public.commodity_series_arming_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commodity_series_arming_log_service_role
  ON public.commodity_series_arming_log;
CREATE POLICY commodity_series_arming_log_service_role
  ON public.commodity_series_arming_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.commodity_series_arming_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The seal learns `commodity_exposure`.
-- ---------------------------------------------------------------------------
--
-- READ-AND-APPEND, not a hard-coded list. 20260905225000 introduced this shape
-- and it is the correct one: a file that rewrites the whole vocabulary from a
-- literal DROPS every kind a migration ordered after it added. That is not
-- hypothetical on this branch -- see the assertion at the end of this file,
-- which measures the vocabulary rather than trusting it.

DO $$
DECLARE
  wanted CONSTANT TEXT := 'commodity_exposure';
  existing_def TEXT;
  kinds TEXT[];
  rebuilt TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'chk_mcp_seal_challenges_subject_kind is absent: this migration extends a constraint that must already exist (20260904210000)';
  END IF;

  SELECT array_agg(DISTINCT m[1]) INTO kinds
  FROM regexp_matches(existing_def, '''([a-z_]+)''', 'g') AS m;

  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" - refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(kinds) THEN
    RETURN;
  END IF;

  kinds := kinds || wanted;

  SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
  INTO rebuilt
  FROM unnest(kinds) AS k;

  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind';
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind '
       || format('CHECK (subject_kind IN (%s))', rebuilt);
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted BOOLEAN;
  probe_series UUID;
  kinds TEXT[];
BEGIN
  IF to_regclass('public.commodity_series_arming_log') IS NULL THEN
    RAISE EXCEPTION 'commodity_series_arming_log was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = to_regclass('public.commodity_series_arming_log') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'commodity_series_arming_log has RLS off';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'commodity_series_arming_log'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'commodity_series_arming_log still grants anon or authenticated';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.commodity_series_arming_log')
       AND con.contype = 'f' AND ns.nspname <> 'public'
  ) THEN
    RAISE EXCEPTION 'a foreign key on commodity_series_arming_log points outside public';
  END IF;

  -- No DEFAULT on any arming column: a default would arm, or credit, a series
  -- without anybody deciding to.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commodity_index_series'
       AND column_name IN ('armed_by_label', 'armed_at', 'armed_proposal_hash')
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'an arming column carries a DEFAULT; a default would credit an act nobody made';
  END IF;

  -- PROBE: a series cannot be armed without naming who, when and on what.
  INSERT INTO public.commodity_index_series
    (series_key, issuer, issuer_jurisdiction, series_title, source_url,
     value_kind, unit, base_period, cadence, max_age_days, licence,
     redistribution, rise_threshold, step_guard, threshold_window_from,
     threshold_window_to, threshold_window_n_obs, threshold_computed_at)
  VALUES
    ('probe.arming', 'probe', 'WORLD', 'probe', 'https://example.invalid',
     'index_number', 'Index, base year = 100', '2014-2016=100', 'monthly', 70,
     'unstated', 'unstated', 0.0850, 0.0780, DATE '1990-01-01',
     DATE '2026-08-01', 440, NOW())
  RETURNING id INTO probe_series;

  BEGIN
    UPDATE public.commodity_index_series
       SET armed = true
     WHERE id = probe_series;
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE id = probe_series;
    RAISE EXCEPTION 'a series was armed without naming who armed it, when, or on which numbers';
  END IF;

  -- And a proposal hash that is not a sha256 is refused, so a placeholder
  -- cannot stand in for the proof.
  BEGIN
    UPDATE public.commodity_index_series
       SET armed = true, armed_by_label = 'founder', armed_at = NOW(),
           armed_proposal_hash = 'shown-on-screen'
     WHERE id = probe_series;
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE id = probe_series;
    RAISE EXCEPTION 'a series was armed on a proposal hash that is not a hash';
  END IF;

  UPDATE public.commodity_index_series
     SET armed = true, armed_by_label = 'founder', armed_at = NOW(),
         armed_proposal_hash = repeat('a', 64)
   WHERE id = probe_series;

  -- PROBE: an arming log row states its numbers; a disarming one need not.
  BEGIN
    INSERT INTO public.commodity_series_arming_log
      (series_id, series_key, act, actor_label)
    VALUES (probe_series, 'probe.arming', 'armed', 'founder');
    admitted := true;
  EXCEPTION WHEN check_violation THEN
    admitted := false;
  END;
  IF admitted THEN
    DELETE FROM public.commodity_index_series WHERE id = probe_series;
    RAISE EXCEPTION 'an arming was logged without the numbers it was armed on';
  END IF;

  INSERT INTO public.commodity_series_arming_log
    (series_id, series_key, act, actor_label)
  VALUES (probe_series, 'probe.arming', 'disarmed', 'founder');

  DELETE FROM public.commodity_index_series WHERE id = probe_series;

  -- MEASURE the seal vocabulary rather than trusting it. This block is not a
  -- style check: it is the only place that can catch a later migration
  -- rewriting the CHECK from a hard-coded literal and silently dropping a kind
  -- an earlier one added.
  SELECT array_agg(DISTINCT m[1]) INTO kinds
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
  WHERE c.conrelid = 'public.mcp_seal_challenges'::regclass
    AND c.conname = 'chk_mcp_seal_challenges_subject_kind';

  IF NOT ('commodity_exposure' = ANY(kinds)) THEN
    RAISE EXCEPTION 'commodity_exposure was not admitted to the seal vocabulary';
  END IF;

  RAISE NOTICE 'commodity arming: log created, RLS on, anon/authenticated revoked, three CHECK probes refused; seal vocabulary now holds %', array_to_string(kinds, ', ');
END
$$;
