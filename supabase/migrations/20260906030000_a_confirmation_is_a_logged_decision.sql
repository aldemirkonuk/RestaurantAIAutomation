-- A confirmation is a logged decision (ADR 0124 Q2).
--
-- THE FOUNDER'S CALL, 2026-09-05: "staff may confirm, log the decisions."
--
-- WHY A SECOND TABLE AND NOT MORE COLUMNS ON THE CANDIDATE
-- -------------------------------------------------------
-- `beverage_identity_candidates` already carries `status`, `decided_by`,
-- `decided_at` and `decision_note` (migration 20260905140000). Those describe
-- the CURRENT state of one proposal, and they are deliberately not duplicated
-- here. What they cannot do is survive an undo: the table's own
-- `bic_decision_is_dated` CHECK says a `pending` row has NO decision recorded,
-- so returning a candidate to `pending` must CLEAR `decided_by`/`decided_at` --
-- and with them the only trace that anyone ever decided anything. A manager who
-- undoes a confirmation would erase the confirmation.
--
-- So the candidate row stays the projection and this table is the event log.
-- The overlap is exactly one row's worth of who/when for the latest decision,
-- and that overlap is the point: it is what makes the undo reversible without
-- forgetting.
--
-- WHAT IS ADDED, BEING WHAT WAS MISSING
-- -------------------------------------
--   * the ACTION, including `undone`, which the candidate cannot express;
--   * the actor's ROLE and NAME AS THEY WERE, because the founder opened
--     confirming to staff and "who confirmed it" must still answer after that
--     person leaves -- `decided_by` is ON DELETE SET NULL everywhere in this
--     repo, and a foreign key that forgets is not an audit trail;
--   * the EVIDENCE THE PERSON SAW, captured server-side from the same rows the
--     queue route rendered. Not taken from the client: a client-supplied
--     "here is what I saw" is an attestation, not a record.
--   * the LINK BACK from an undo to the decision it reverses.
--
-- APPEND-ONLY, ENFORCED
-- ---------------------
-- A trigger raises on UPDATE and on DELETE. An audit log that the application
-- can rewrite is a log of what the application currently believes, which is the
-- thing the candidate row already is. The consequence is stated rather than
-- discovered: `restaurant_id` is ON DELETE RESTRICT, so a house holding
-- identity decisions cannot be hard-deleted -- retirement is a soft delete,
-- the same rule ADR 0115 set for the library link.
--
-- Additive and idempotent. No explicit BEGIN/COMMIT: the Supabase CLI wraps
-- each migration file in a transaction.

CREATE TABLE IF NOT EXISTS public.beverage_identity_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  candidate_id UUID NOT NULL
    REFERENCES public.beverage_identity_candidates(id) ON DELETE RESTRICT,

  -- The one deliberate copy from the candidate. The log is READ PER HOUSE and
  -- a filter on a PostgREST embed is not a filter on the outer rows, so this
  -- column is what makes "this house's decisions" a query rather than a
  -- client-side sieve over everyone's.
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE RESTRICT,

  action VARCHAR(16) NOT NULL
    CHECK (action IN ('confirmed', 'rejected', 'undone')),

  -- WHO, three ways, because one of them decays.
  decided_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The name as it was at the moment of the decision. NOT a join: the join
  -- goes null when the person is removed, and the log still has to say who.
  decided_by_label VARCHAR(200) NOT NULL CHECK (btrim(decided_by_label) <> ''),
  -- The role as it was. A confirmation made by staff and one made by an owner
  -- are different facts, and a person's role changes.
  decided_by_role VARCHAR(20) NOT NULL CHECK (btrim(decided_by_role) <> ''),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- WHAT THE PERSON SAW: the candidate's confidence, method and evidence, plus
  -- the identity and subject it named, as the server held them at the moment
  -- the decision was taken.
  evidence_shown JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,

  -- What the confirmation actually wrote, so an undo knows what to take back
  -- and a reader can see that a decision had an effect.
  link_written VARCHAR(120),

  -- Only an undo names a prior decision, and every undo must.
  undoes_decision_id UUID
    REFERENCES public.beverage_identity_decisions(id) ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bid_undo_names_its_decision CHECK (
    (action = 'undone') = (undoes_decision_id IS NOT NULL)
  )
);

-- The per-house read: this house's decisions, newest first.
CREATE INDEX IF NOT EXISTS idx_beverage_identity_decisions_house
  ON public.beverage_identity_decisions (restaurant_id, decided_at DESC);

-- "What happened to this candidate", in order.
CREATE INDEX IF NOT EXISTS idx_beverage_identity_decisions_candidate
  ON public.beverage_identity_decisions (candidate_id, decided_at DESC);

-- A decision may be undone once. Without this, two managers racing produce two
-- undos of one confirmation and the log says the link was taken back twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_beverage_identity_decisions_undo
  ON public.beverage_identity_decisions (undoes_decision_id)
  WHERE undoes_decision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.beverage_identity_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'beverage_identity_decisions is append-only: % is not permitted. An undo is a NEW row naming the decision it reverses.',
    TG_OP;
END
$function$;

COMMENT ON FUNCTION public.beverage_identity_decisions_append_only() IS
  'Refuses UPDATE and DELETE on the identity decision log. An audit trail the application can rewrite records what the application currently believes, which is what beverage_identity_candidates already is.';

DROP TRIGGER IF EXISTS trg_beverage_identity_decisions_append_only
  ON public.beverage_identity_decisions;
CREATE TRIGGER trg_beverage_identity_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.beverage_identity_decisions
  FOR EACH ROW EXECUTE FUNCTION public.beverage_identity_decisions_append_only();

-- ---------------------------------------------------------------------------
-- Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.beverage_identity_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beverage_identity_decisions_service_role
  ON public.beverage_identity_decisions;
CREATE POLICY beverage_identity_decisions_service_role
  ON public.beverage_identity_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.beverage_identity_decisions FROM anon, authenticated;

COMMENT ON TABLE public.beverage_identity_decisions IS
  'Append-only log of every identity-link decision (ADR 0124 Q2, founder 2026-09-05: "staff may confirm, log the decisions"). One row per confirm, reject or undo, naming who (id, name and role AS THEY WERE), when, which candidate, and what evidence the server showed them. The candidate row holds the CURRENT state; this holds the history, which is what makes an undo reversible without forgetting.';
COMMENT ON COLUMN public.beverage_identity_decisions.decided_by_label IS
  'The person''s name at the moment of the decision. Stored rather than joined because decided_by is ON DELETE SET NULL: a foreign key that forgets is not an audit trail.';
COMMENT ON COLUMN public.beverage_identity_decisions.evidence_shown IS
  'What the server rendered to the person: the candidate''s method, confidence and evidence, and the identity and subject it named. Captured server-side, never accepted from the client -- a client-supplied "here is what I saw" is an attestation, not a record.';
COMMENT ON COLUMN public.beverage_identity_decisions.undoes_decision_id IS
  'The decision this row reverses. Only an undo names one, and every undo must (bid_undo_names_its_decision); a decision can be undone once (uq_beverage_identity_decisions_undo).';
COMMENT ON COLUMN public.beverage_identity_decisions.restaurant_id IS
  'Copied from the candidate so "this house''s decisions" is a query on this table. ON DELETE RESTRICT with an append-only trigger means a house holding decisions is retired by soft delete, never hard-deleted -- ADR 0115''s rule for the library link.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  c          text;
  absent     text;
  required   text[] := ARRAY[
    'id', 'candidate_id', 'restaurant_id', 'action', 'decided_by',
    'decided_by_label', 'decided_by_role', 'decided_at', 'evidence_shown',
    'note', 'link_written', 'undoes_decision_id', 'created_at'
  ];
  ident_id   uuid;
  cand_id    uuid;
  first_id   uuid;
  blocked    boolean;
BEGIN
  IF to_regclass('public.beverage_identity_decisions') IS NULL THEN
    RAISE EXCEPTION 'beverage_identity_decisions was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.beverage_identity_decisions')) THEN
    RAISE EXCEPTION 'beverage_identity_decisions has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.beverage_identity_decisions', 'SELECT')
     OR has_table_privilege('anon', 'public.beverage_identity_decisions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.beverage_identity_decisions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.beverage_identity_decisions', 'INSERT')
  THEN
    RAISE EXCEPTION 'beverage_identity_decisions is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'beverage_identity_decisions'
        AND column_name = c
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'columns the gateway reads are missing: %', absent;
  END IF;

  IF (SELECT count(*) FROM public.beverage_identity_decisions) <> 0 THEN
    RAISE EXCEPTION 'this migration must not write rows';
  END IF;

  -- PROVE the append-only trigger, and prove the undo constraint, on probes
  -- that are removed again. A trigger nobody tried is a trigger nobody has.
  INSERT INTO public.beverage_identities
    (producer_normalised, name_normalised, vintage_text, size_ml, pack,
     display_label, assertion_method)
  VALUES ('probe producer', 'probe wine', '2019', 750, 1,
          'Probe Wine 2019', 'source_transcript')
  RETURNING id INTO ident_id;

  INSERT INTO public.beverage_identity_candidates
    (subject_table, subject_id, identity_id, method, confidence)
  VALUES ('beverages', gen_random_uuid(), ident_id, 'normalised_key', 0.9)
  RETURNING id INTO cand_id;

  INSERT INTO public.beverage_identity_decisions
    (candidate_id, action, decided_by_label, decided_by_role, evidence_shown)
  VALUES (cand_id, 'confirmed', 'Probe Person', 'staff', '{"probe": true}'::jsonb)
  RETURNING id INTO first_id;

  blocked := false;
  BEGIN
    UPDATE public.beverage_identity_decisions SET note = 'rewritten'
     WHERE id = first_id;
  EXCEPTION WHEN others THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'the decision log accepted an UPDATE -- it is not append-only';
  END IF;

  blocked := false;
  BEGIN
    INSERT INTO public.beverage_identity_decisions
      (candidate_id, action, decided_by_label, decided_by_role)
    VALUES (cand_id, 'undone', 'Probe Manager', 'manager');
  EXCEPTION WHEN others THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'an undo was accepted without naming the decision it reverses';
  END IF;

  -- Clean up. The trigger blocks DELETE on the log itself, so the probe rows
  -- are removed by dropping the trigger for the length of this block only --
  -- which is also, incidentally, the proof that the trigger is what stops it.
  ALTER TABLE public.beverage_identity_decisions DISABLE TRIGGER
    trg_beverage_identity_decisions_append_only;
  DELETE FROM public.beverage_identity_decisions WHERE candidate_id = cand_id;
  ALTER TABLE public.beverage_identity_decisions ENABLE TRIGGER
    trg_beverage_identity_decisions_append_only;

  DELETE FROM public.beverage_identity_candidates WHERE id = cand_id;
  DELETE FROM public.beverage_identities WHERE id = ident_id;

  IF (SELECT count(*) FROM public.beverage_identity_decisions) <> 0
     OR (SELECT count(*) FROM public.beverage_identity_candidates) <> 0
     OR (SELECT count(*) FROM public.beverage_identities) <> 0 THEN
    RAISE EXCEPTION 'the probes did not roll back';
  END IF;

  RAISE NOTICE 'beverage_identity_decisions created, RLS on, anon/authenticated revoked, append-only trigger proved against a real UPDATE, undo constraint proved, 0 rows written.';
END
$$;
