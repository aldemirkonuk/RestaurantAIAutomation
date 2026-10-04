-- A TABLE IS LEARNED FROM THE TILL, AND A PAST CHECK FINDS ITS TABLE AGAIN.
-- ADR 0303. Analytics-walk findings AW25 (A-051) and AW30 (A-055).
--
-- WHAT BROKE. A check reached a table only one way: pos-hub's resolveTable
-- (pos-hub.service.ts) matched the till's table word against the house's
-- restaurant_tables rows, in memory, at the moment the check arrived. Nothing
-- creates a restaurant_tables row except POST /analytics/tables, and no
-- screen calls it. So a house whose till names tables T1..T24 had zero rows,
-- every pos_checks.table_id stayed NULL, and the till's word was thrown away:
-- it lived only inside `raw`. The room register then said "The room has to be
-- drawn before it can be read" to a house that has no drawing tool, and a
-- table added later could not catch the checks that already named it. The
-- owner-quarter sim's analytics walk (2026-10-03, read-only) found Tuzlu
-- Rüzgar with every check unattributed (AW25) and the room register asking
-- for a drawing no page can make (AW30). A learned table must also not
-- inherit seats = 2 / is_outdoor = false: those column DEFAULTs are answers
-- nobody gave (ADR 0020).
--
-- THE RULING. The founder, 2026-10-04 ~00:30Z, verbatim pick "Learn from the
-- POS (Recommended)": every POS table ref becomes a table the owner can rename
-- or hide; past checks re-link from the stored ref when a table is added or
-- renamed; no drawing.
--
-- THE METHOD (the lane's proposal under that ruling, in ADR 0303):
--  1. pos_checks.table_ref keeps the till's own word for where the check was,
--     NULL when it sent none. pos-hub writes it; pos_table_ref_from_raw reads
--     it back out of `raw` for history, mirroring the adapters: Clover's
--     orderType is a channel, never a table (AW24, ruling "Own row, POS
--     field"), so Clover gives NULL.
--  2. restaurant_tables gains learned_at (set only by learning; NULL means a
--     person added the row) and hidden_at (NULL means shown). seats and
--     is_outdoor become nullable, and a learned row writes NULL to both: the
--     till does not say how many seats a table has or whether it is outside.
--     Their DEFAULTs stay for the existing POST path.
--  3. A BEFORE trigger on pos_checks resolves the till's word to a table with
--     the same precedence as resolveTable (pos ref of that source, then the
--     label, then "table <label>"), case- and space-insensitive, over active
--     tables, hidden ones included. When nothing answers and no RETIRED
--     (is_active = false) table answers either, it LEARNS the table. Learning
--     runs inside its own exception block: a failure is a WARNING and the
--     check is stored without a table. A sale is never refused for this.
--     A re-sent check whose word has not changed keeps the table it had when
--     nothing answers now: a re-send never drops a link.
--  4. On a rename, the till words already linked to the row are merged into
--     its pos_refs (existing keys win), so "Window 7" keeps catching T7 and
--     the till's next T7 never learns a duplicate.
--  5. Re-link: adding a table by hand, or changing a table's label, pos_refs
--     or is_active, fills table_id on the house's unlinked checks whose word
--     now resolves to it. A LEARNED insert re-links only at commit (a
--     deferred constraint trigger): it fires inside a pos_checks statement,
--     and an immediate re-link there can touch a row the same INSERT ... ON
--     CONFLICT DO UPDATE batch is about to update, which aborts the whole
--     import ("ON CONFLICT DO UPDATE command cannot affect row a second
--     time"; the SQL test's T11 pins it). A re-link only fills NULLs; it
--     never moves an existing link.
--  6. Backfill: every stored check whose raw carries a table word gets
--     table_ref, which runs (3) row by row, so history learns and links in
--     this one statement.
--
-- PRODUCTION EFFECT ON MERGE (migrations auto-apply). Step 6 writes
-- restaurant_tables rows, and pos_checks.table_ref and table_id, for every
-- house whose stored raw carries a table word. For Tuzlu Rüzgar that is
-- expected to be about 26 tables (T1-T24, BOOTH, EVENT, per the sim
-- generator) over about 3,593 checks. Neither count was measured on
-- production: this lane reads no production data. ADR 0303 carries the
-- read-only dry-run query for the coordinator.
--
-- SECURITY. Every function is SECURITY INVOKER with no search_path setting,
-- like a_short_pour_opens_the_next_bottle. The only pos_checks writer today is
-- the gateway's service role, which bypasses RLS. A writer under RLS without a
-- restaurant_tables INSERT policy would store its checks unlinked (the WARNING
-- path), never refused.
--
-- RE-RUNNABLE. IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- throughout; the backfill touches only rows whose table_ref is still NULL.
-- The closing DO block reads the catalog only and writes no row. No explicit
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in a transaction.

SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1-2. Columns and the index that keeps a re-link cheap.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pos_checks ADD COLUMN IF NOT EXISTS table_ref text;
COMMENT ON COLUMN public.pos_checks.table_ref IS
  'The till''s own word for where this check was (ADR 0303), as sent; NULL when it sent none. Clover''s order type is a channel, not a table, and is never stored here.';

ALTER TABLE public.restaurant_tables ALTER COLUMN seats DROP NOT NULL;
ALTER TABLE public.restaurant_tables ALTER COLUMN is_outdoor DROP NOT NULL;
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS learned_at timestamptz;
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
COMMENT ON COLUMN public.restaurant_tables.seats IS
  'Seats at this table. NULL when nobody has said (a table learned from the till, ADR 0303); per-seat figures are then withheld.';
COMMENT ON COLUMN public.restaurant_tables.is_outdoor IS
  'Whether this table is outside. NULL when nobody has said (a table learned from the till, ADR 0303).';
COMMENT ON COLUMN public.restaurant_tables.learned_at IS
  'When this table was learned from a till word on a check (ADR 0303). NULL means a person added it.';
COMMENT ON COLUMN public.restaurant_tables.hidden_at IS
  'When an owner or manager hid this table (ADR 0303). A hidden table still catches its checks; its checks stay in takings and leave every per-table figure. NULL means shown.';

CREATE INDEX IF NOT EXISTS idx_pos_checks_unlinked_ref
  ON public.pos_checks (restaurant_id)
  WHERE table_id IS NULL AND table_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3a. The till's word inside a stored raw payload, as the adapters read it
--     (pos-adapters.ts). A value counts only as a JSON string or number; JSON
--     null is skipped like JavaScript's `??`; blank is NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_table_ref_from_raw(p_source text, p_raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN v IS NULL THEN NULL
           WHEN jsonb_typeof(v) = 'string' THEN NULLIF(btrim(v #>> '{}'), '')
           WHEN jsonb_typeof(v) = 'number' THEN v #>> '{}'
           ELSE NULL
         END
    FROM (
      SELECT CASE
               WHEN p_raw IS NULL OR jsonb_typeof(p_raw) <> 'object' THEN NULL
               WHEN p_source = 'clover' THEN NULL
               WHEN p_source = 'square' THEN NULLIF(p_raw -> 'ticket_name', 'null'::jsonb)
               WHEN p_source = 'toast' THEN
                 coalesce(NULLIF(p_raw -> 'table' -> 'guid', 'null'::jsonb),
                          NULLIF(p_raw -> 'table' -> 'name', 'null'::jsonb))
               ELSE
                 coalesce(NULLIF(p_raw -> 'tableRef', 'null'::jsonb),
                          NULLIF(p_raw -> 'table_ref', 'null'::jsonb),
                          NULLIF(p_raw -> 'table', 'null'::jsonb))
             END AS v
    ) w
$$;
COMMENT ON FUNCTION public.pos_table_ref_from_raw(text, jsonb) IS
  'The till''s table word inside a stored pos_checks.raw, read as the adapters read it (ADR 0303). Clover gives NULL: its order type is a channel (AW24).';

-- ---------------------------------------------------------------------------
-- 3b. Which table answers to a till word. Same precedence as resolveTable:
--     the source's pos ref, then the label, then "table <label>"; ties go to
--     the older row. Active tables only (hidden ones included), unless asked
--     for retired ones too.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_table_for_ref(
  p_restaurant_id uuid,
  p_source text,
  p_ref text,
  p_include_retired boolean DEFAULT false
)
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT t.id
    FROM public.restaurant_tables t
    CROSS JOIN (SELECT lower(btrim(p_ref)) AS ref) r
   WHERE r.ref <> ''
     AND t.restaurant_id = p_restaurant_id
     AND (t.is_active OR p_include_retired)
     AND (lower(btrim(t.pos_refs ->> p_source)) = r.ref
          OR lower(btrim(t.label)) = r.ref
          OR 'table ' || lower(btrim(t.label)) = r.ref)
   ORDER BY CASE WHEN lower(btrim(t.pos_refs ->> p_source)) = r.ref THEN 0
                 WHEN lower(btrim(t.label)) = r.ref THEN 1
                 ELSE 2 END,
            t.created_at, t.id
   LIMIT 1
$$;
COMMENT ON FUNCTION public.pos_table_for_ref(uuid, text, text, boolean) IS
  'The table a till word resolves to, with resolveTable''s precedence (ADR 0303). NULL for a blank word or no match.';

-- ---------------------------------------------------------------------------
-- 3c. Find the check's table, or learn it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_checks_find_or_learn_table()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_ref text := NULLIF(btrim(NEW.table_ref), '');
  v_id uuid;
BEGIN
  IF NEW.table_id IS NOT NULL OR v_ref IS NULL THEN
    RETURN NEW;
  END IF;

  v_id := public.pos_table_for_ref(NEW.restaurant_id, NEW.source, v_ref);

  -- A re-sent check keeps its table when nothing answers to its unchanged word.
  IF v_id IS NULL AND TG_OP = 'UPDATE' AND OLD.table_id IS NOT NULL
     AND lower(btrim(coalesce(OLD.table_ref, ''))) = lower(v_ref) THEN
    v_id := OLD.table_id;
  END IF;

  -- A retired table that answers is the owner's earlier answer: no duplicate.
  IF v_id IS NULL
     AND public.pos_table_for_ref(NEW.restaurant_id, NEW.source, v_ref, true) IS NULL THEN
    BEGIN
      INSERT INTO public.restaurant_tables
        (restaurant_id, label, seats, is_outdoor, pos_refs, learned_at)
      VALUES
        (NEW.restaurant_id, v_ref, NULL, NULL, jsonb_build_object(NEW.source, v_ref), now())
      ON CONFLICT (restaurant_id, label) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        v_id := public.pos_table_for_ref(NEW.restaurant_id, NEW.source, v_ref);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pos_checks %/%: table "%" could not be learned (%); the check is stored without a table',
        NEW.source, NEW.external_check_id, v_ref, SQLERRM;
      v_id := NULL;
    END;
  END IF;

  NEW.table_id := v_id;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION public.pos_checks_find_or_learn_table() IS
  'BEFORE trigger on pos_checks (ADR 0303): resolves table_ref to a table, or learns one. Never refuses a check.';

DROP TRIGGER IF EXISTS pos_checks_find_or_learn_table ON public.pos_checks;
CREATE TRIGGER pos_checks_find_or_learn_table
  BEFORE INSERT OR UPDATE OF table_id, table_ref ON public.pos_checks
  FOR EACH ROW
  WHEN (NEW.table_id IS NULL AND NEW.table_ref IS NOT NULL)
  EXECUTE FUNCTION public.pos_checks_find_or_learn_table();

-- ---------------------------------------------------------------------------
-- 4. A renamed table keeps the till words it already caught.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_tables_keep_till_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_words jsonb;
BEGIN
  IF jsonb_typeof(coalesce(NEW.pos_refs, '{}'::jsonb)) <> 'object' THEN
    RETURN NEW;
  END IF;
  SELECT jsonb_object_agg(w.source, w.word) INTO v_words
    FROM (SELECT DISTINCT ON (c.source) c.source, btrim(c.table_ref) AS word
            FROM public.pos_checks c
           WHERE c.table_id = OLD.id
             AND NULLIF(btrim(c.table_ref), '') IS NOT NULL
           ORDER BY c.source, c.opened_at DESC, c.id) w;
  IF v_words IS NOT NULL THEN
    NEW.pos_refs := v_words || coalesce(NEW.pos_refs, '{}'::jsonb);
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION public.restaurant_tables_keep_till_names() IS
  'BEFORE UPDATE OF label on restaurant_tables (ADR 0303): merges the till words already linked to the row into pos_refs; existing keys win.';

DROP TRIGGER IF EXISTS restaurant_tables_keep_till_names ON public.restaurant_tables;
CREATE TRIGGER restaurant_tables_keep_till_names
  BEFORE UPDATE OF label ON public.restaurant_tables
  FOR EACH ROW
  WHEN (NEW.label IS DISTINCT FROM OLD.label)
  EXECUTE FUNCTION public.restaurant_tables_keep_till_names();

-- ---------------------------------------------------------------------------
-- 5. Re-link the house's unlinked checks to a table that now answers.
--    TG_ARGV[0] = 'learned' is the deferred, fail-safe call after learning;
--    a person's act (add, rename, re-map, re-activate) is refused on error.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_tables_relink_checks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_NARGS > 0 AND TG_ARGV[0] = 'learned' THEN
    BEGIN
      UPDATE public.pos_checks c
         SET table_id = NEW.id
       WHERE c.restaurant_id = NEW.restaurant_id
         AND c.table_id IS NULL
         AND c.table_ref IS NOT NULL
         AND public.pos_table_for_ref(c.restaurant_id, c.source, c.table_ref) = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'restaurant_tables %: earlier checks could not be re-linked (%); they stay without a table',
        NEW.id, SQLERRM;
    END;
    RETURN NULL;
  END IF;

  UPDATE public.pos_checks c
     SET table_id = NEW.id
   WHERE c.restaurant_id = NEW.restaurant_id
     AND c.table_id IS NULL
     AND c.table_ref IS NOT NULL
     AND public.pos_table_for_ref(c.restaurant_id, c.source, c.table_ref) = NEW.id;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION public.restaurant_tables_relink_checks() IS
  'AFTER trigger on restaurant_tables (ADR 0303): fills table_id on the house''s unlinked checks whose till word now resolves to this table. Never moves a link.';

DROP TRIGGER IF EXISTS restaurant_tables_relink_on_add ON public.restaurant_tables;
CREATE TRIGGER restaurant_tables_relink_on_add
  AFTER INSERT ON public.restaurant_tables
  FOR EACH ROW
  WHEN (NEW.learned_at IS NULL AND NEW.is_active)
  EXECUTE FUNCTION public.restaurant_tables_relink_checks();

DROP TRIGGER IF EXISTS restaurant_tables_relink_on_change ON public.restaurant_tables;
CREATE TRIGGER restaurant_tables_relink_on_change
  AFTER UPDATE OF label, pos_refs, is_active ON public.restaurant_tables
  FOR EACH ROW
  WHEN (NEW.is_active)
  EXECUTE FUNCTION public.restaurant_tables_relink_checks();

DROP TRIGGER IF EXISTS restaurant_tables_relink_on_learn ON public.restaurant_tables;
CREATE CONSTRAINT TRIGGER restaurant_tables_relink_on_learn
  AFTER INSERT ON public.restaurant_tables
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.learned_at IS NOT NULL)
  EXECUTE FUNCTION public.restaurant_tables_relink_checks('learned');

-- ---------------------------------------------------------------------------
-- 6. Backfill: history keeps the till's word, and learns and links by (3).
-- ---------------------------------------------------------------------------

UPDATE public.pos_checks
   SET table_ref = public.pos_table_ref_from_raw(source, raw)
 WHERE table_ref IS NULL
   AND raw IS NOT NULL
   AND public.pos_table_ref_from_raw(source, raw) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Shape check: catalog reads only.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'pos_table_ref_from_raw', 'pos_table_for_ref', 'pos_checks_find_or_learn_table',
    'restaurant_tables_keep_till_names', 'restaurant_tables_relink_checks'
  ] LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = v_name) <> 1 THEN
      RAISE EXCEPTION '% must have exactly one definition (ADR 0303)', v_name;
    END IF;
    IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = v_name) THEN
      RAISE EXCEPTION '% must stay SECURITY INVOKER (ADR 0303)', v_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal AND tgname IN (
         'pos_checks_find_or_learn_table', 'restaurant_tables_keep_till_names',
         'restaurant_tables_relink_on_add', 'restaurant_tables_relink_on_change',
         'restaurant_tables_relink_on_learn')) <> 5 THEN
    RAISE EXCEPTION 'the five ADR 0303 triggers are not all in place';
  END IF;
END $$;
