-- An order request is a letter kind of its own (W25; ADR 0313, 4a-i).
--
-- The order-request letter the gateway renders (POST /internal/letters/
-- order-request) is staged through stage_order_letter (ADR 0266) with
-- outbound_email_type = 'ORDER_REQUEST'. It is not an ORDER_CONFIRMATION:
-- that kind is the house's confirmation after a deal (procurement.service.ts
-- labels it "confirming the order"), and a separate kind is what lets the door
-- dedupe by p_kind. The column is varchar(50) (baseline), not an enum, so the
-- CHECK is the only thing to widen.
--
-- READ-AND-APPEND, NOT A LITERAL. The kinds are read out of the constraint as
-- it stands and 'ORDER_REQUEST' is appended, the shape
-- a_house_keeps_its_own_copy_of_its_mail uses: a hand-typed list would drop
-- any kind a peer migration appended in between.
--
-- EVERY LITERAL IS READ. The parse takes every quoted literal in the
-- definition, so a kind with digits or lower case (a peer's
-- 'ORDER_REQUEST_V2') is kept, not silently dropped; a literal that is not
-- letters, digits and "_" stops the migration instead of being rebuilt.
--
-- NOT VALID, THEN VALIDATE. The new CHECK is added NOT VALID and validated by
-- a separate statement. Limit: a migration file runs in one transaction, so
-- the ACCESS EXCLUSIVE lock DROP/ADD takes is held until commit and VALIDATE
-- still scans under it. The split shortens the lock only when VALIDATE runs
-- in a transaction of its own.
--
-- Nothing else changes: no door change (stage_order_letter already accepts
-- outbound_email_type and email_headers), no grant, no row.

DO $$
DECLARE
  existing_def text;
  kinds text[];
  wanted text := 'ORDER_REQUEST';
  rebuilt text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO existing_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.procurement_conversations'::regclass
     AND c.conname = 'chk_outbound_email_type';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'chk_outbound_email_type is absent: this migration extends a constraint that must already exist (the_house_writes_its_own_mail)';
  END IF;

  -- Every quoted literal in the definition, whatever its characters ('' is an
  -- escaped quote inside one), so a kind with digits or lower case is kept.
  SELECT pg_catalog.array_agg(DISTINCT pg_catalog.replace(m[1], '''''', '''')) INTO kinds
    FROM pg_catalog.regexp_matches(existing_def, '''((?:[^'']|'''')*)''', 'g') AS m;

  -- A literal that is not letters, digits and "_" is not a kind this file
  -- knows how to rebuild: stop, never guess.
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(kinds) AS k WHERE k !~ '^[A-Za-z0-9_]+$') THEN
    RAISE EXCEPTION
      'chk_outbound_email_type admits a value that is not letters, digits and "_" in "%" - refusing to rebuild it',
      existing_def;
  END IF;

  -- Eleven kinds existed after the_house_writes_its_own_mail. Fewer means the
  -- parse failed, and rebuilding from a failed parse would delete the
  -- vocabulary every sent letter is filed under.
  IF kinds IS NULL OR pg_catalog.array_length(kinds, 1) < 11 THEN
    RAISE EXCEPTION
      'could not read the admitted outbound kinds out of "%" - refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY (kinds) THEN
    RETURN;  -- already admitted; re-running this file changes nothing
  END IF;

  kinds := kinds || wanted;

  SELECT pg_catalog.string_agg(pg_catalog.quote_literal(k) || '::text', ', ' ORDER BY k)
    INTO rebuilt
    FROM pg_catalog.unnest(kinds) AS k;

  EXECUTE 'ALTER TABLE public.procurement_conversations DROP CONSTRAINT chk_outbound_email_type';
  EXECUTE 'ALTER TABLE public.procurement_conversations ADD CONSTRAINT chk_outbound_email_type CHECK ('
       || 'outbound_email_type IS NULL OR outbound_email_type::text = ANY (ARRAY['
       || rebuilt || '])) NOT VALID';
  EXECUTE 'ALTER TABLE public.procurement_conversations VALIDATE CONSTRAINT chk_outbound_email_type';
END
$$;

-- Assertions. A partial apply must fail here, not pass quietly.
DO $$
DECLARE
  def text;
  k text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.procurement_conversations'::regclass
     AND c.conname = 'chk_outbound_email_type';

  IF def IS NULL THEN
    RAISE EXCEPTION 'chk_outbound_email_type is missing after the rebuild';
  END IF;
  FOREACH k IN ARRAY ARRAY[
    'PRICE_INQUIRY', 'DEMAND_OFFER', 'PROMO_INQUIRY', 'WINE_INQUIRY',
    'MANUAL_REPLY', 'ORDER_CONFIRMATION', 'ACCEPTANCE_CONFIRM_REQUEST',
    'CLARIFICATION', 'COUNTER_OFFER', 'ESCALATION', 'HOUSE_LETTER',
    'ORDER_REQUEST'
  ] LOOP
    IF pg_catalog.strpos(def, '''' || k || '''') = 0 THEN
      RAISE EXCEPTION 'chk_outbound_email_type does not admit % after the rebuild: %', k, def;
    END IF;
  END LOOP;
  IF NOT (SELECT c.convalidated FROM pg_catalog.pg_constraint c
           WHERE c.conrelid = 'public.procurement_conversations'::regclass
             AND c.conname = 'chk_outbound_email_type') THEN
    RAISE EXCEPTION 'chk_outbound_email_type was left NOT VALID';
  END IF;
  IF pg_catalog.strpos(def, 'IS NULL') = 0 THEN
    RAISE EXCEPTION 'chk_outbound_email_type no longer admits NULL: %', def;
  END IF;
END
$$;
