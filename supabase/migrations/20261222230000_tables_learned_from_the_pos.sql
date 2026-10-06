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
-- renamed; no drawing. Narrowed 2026-10-05 ~14:15Z, after the production dry
-- run found a 'booth' table and six people's names among the words, verbatim
-- pick "Only words with a number (Recommended)": a word becomes a NEW table
-- only when it has an ASCII digit 0-9 in it ('T12', '12', 'Patio 3'). A word
-- with none ('booth', 'Ayla') stays on the check as its table_ref, links to a
-- table that already answers it, and never makes one; such a table is added
-- by hand once. The rule holds for the backfill and for new checks alike.
--
-- THE METHOD (the lane's proposal under that ruling, in ADR 0303):
--  1. pos_checks.table_ref keeps the till's own word for where the check was,
--     NULL when it sent none. The database reads it out of `raw` with
--     pos_table_ref_from_raw, mirroring the adapters, whenever a check is
--     inserted or its raw is written (step 3), and for history (step 6).
--     pos-hub writes no new column, so the gateway and this migration deploy
--     in either order. Clover's orderType is a channel, never a table (AW24,
--     ruling "Own row, POS field"), so Clover gives NULL.
--  2. restaurant_tables gains learned_at (set only by learning; NULL means a
--     person added the row) and hidden_at (NULL means shown). seats and
--     is_outdoor become nullable, and a learned row writes NULL to both: the
--     till does not say how many seats a table has or whether it is outside.
--     Their DEFAULTs stay for the existing POST path.
--  3. A BEFORE trigger on pos_checks first sets table_ref from raw: on an
--     insert, and on an update that writes raw (an upsert re-send). A word
--     raw carries wins; when raw carries none, a writer's own table_ref
--     stands, and a word that came from the old raw goes with it. A changed
--     word drops a link the statement did not set itself. An update that
--     leaves the word as it was keeps the table the check had, whatever the
--     statement sets: a past check never moves while its word stands
--     (founder, 2026-10-05, "Keep every spelling"). Otherwise the trigger
--     resolves the word to a table: the pos ref of that source, then the
--     label, then "table <label>" (resolveTable's three rules), then a word
--     the table remembers (step 4), case- and space-insensitive, over active
--     tables, hidden ones included. When nothing answers, the word has an
--     ASCII digit in it, it is at most 60 characters long (the most PATCH
--     lets a person name a table), and no RETIRED (is_active = false) table
--     answers either, it LEARNS the table. Any other word is kept as
--     table_ref and left without a table until one answers it. Learning
--     runs inside its own exception block: a failure is a WARNING and the
--     check is stored without a table. A sale is never refused for this.
--  4. A renamed table keeps every spelling (founder, 2026-10-05 ~23:22Z,
--     verbatim pick "Keep every spelling (Recommended)"). When a table's
--     label or pos_refs changes, every distinct
--     word on a check linked to it, per source, and its old pos_refs words
--     join restaurant_tables.till_words ({source: [word, ...]}), and its old
--     label joins former_labels. The resolver reads both, last: a till word
--     of that source, or a former label by either label rule. So a renamed
--     table answers every word it answered before the rename (another
--     table's current label can outrank a remembered word, but the word is
--     still answered), and no rename or re-map leaves a word for the learner
--     to make a twin of.
--     [Corrected 2026-10-05, after the afda5d868 audit. Step 3's "an update
--     that leaves the word as it was keeps the table" replaces "A re-sent
--     check whose word has not changed keeps the table it had when nothing
--     answers now: a re-send never drops a link", which held only when the
--     statement left table_id NULL; a re-send naming another table moved the
--     check. Step 4 replaces "On a rename, the till words already linked to
--     the row are merged into its pos_refs (existing keys win), so ... the
--     till's next T7 never learns a duplicate", which was broader than the
--     code: it kept one word per source and the row's own word won, so a
--     renamed table could learn a twin and a re-send move a past check onto
--     it.]
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
--     this one statement, by the same digit rule as a new check.
--
-- PRODUCTION EFFECT ON MERGE (migrations auto-apply). Step 6 writes
-- pos_checks.table_ref on every check whose stored raw carries a table word,
-- and restaurant_tables rows and pos_checks.table_id for the words with a
-- digit. The coordinator's read-only production dry run under the digit rule
-- (2026-10-05 ~16:10Z) counted 3,656 checks with a word: 21 already linked
-- and kept, 3,621 to link (none to an existing table), 14 that keep their
-- word with no table (Tuzlu Rüzgar's 2 "booth" checks and a Sim Meyhouse's
-- 12 first-name checks), 0 blocked by a retired table, and 40 tables to
-- learn (Tuzlu 24, the Sim Meyhouse 16). This lane reads no production data.
-- ADR 0303 names the read-only dry-run query and records its counts.
-- till_words and former_labels arrive empty on every existing row (a constant
-- default, no rewrite); the backfill renames nothing, so it writes neither.
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
  'The till''s own word for where this check was (ADR 0303), read out of raw by pos_checks_find_or_learn_table on insert and whenever raw is written; a writer''s own value stands only when raw carries none. NULL when the till sent none. Clover''s order type is a channel, not a table, and is never stored here.';

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
  'When an owner or manager hid this table (ADR 0303). A hidden table still catches its checks, and they stay in takings. Each per-table reader that honours it leaves the table out; ADR 0303 names which readers do. NULL means shown.';
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS till_words jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS former_labels text[] NOT NULL DEFAULT '{}'::text[];
COMMENT ON COLUMN public.restaurant_tables.till_words IS
  'Every till word, per source ({source: [word, ...]}), that a check linked to this table carried when its label or pos_refs last changed, plus its earlier pos_refs words (ADR 0303). Written by restaurant_tables_keep_till_names only; pos_table_for_ref reads it after pos_refs and the label.';
COMMENT ON COLUMN public.restaurant_tables.former_labels IS
  'Every label this table had before a rename (ADR 0303). pos_table_for_ref reads each one, last, by the label and "table <label>" rules, so a renamed table answers what it answered before.';

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
-- 3b. Which table answers to a till word: the source's pos ref, then the
--     label, then "table <label>" (resolveTable's three rules, in this
--     order), then a word the table remembers (step 4): a till word of that
--     source, or a former label by either label rule. Ties go to the older
--     row. A remembered word ranks last because pos-hub's in-memory
--     resolveTable reads pos_refs and labels only and its answer stands when
--     it finds one: with remembered words last, it answers only by rules
--     that outrank them here too, and when it finds nothing it leaves
--     table_id NULL and this function decides. Active tables only (hidden
--     ones included), unless asked for retired ones too.
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
  SELECT m.id
    FROM (
      SELECT t.id, t.created_at,
             CASE
               WHEN lower(btrim(t.pos_refs ->> p_source)) = r.ref THEN 0
               WHEN lower(btrim(t.label)) = r.ref THEN 1
               WHEN 'table ' || lower(btrim(t.label)) = r.ref THEN 2
               -- A table never renamed or re-mapped remembers nothing: skip the scans.
               WHEN t.till_words = '{}'::jsonb AND cardinality(t.former_labels) = 0 THEN NULL
               WHEN EXISTS (SELECT 1
                              FROM jsonb_array_elements_text(
                                     CASE WHEN jsonb_typeof(t.till_words -> p_source) = 'array'
                                          THEN t.till_words -> p_source ELSE '[]'::jsonb END) k(word)
                             WHERE lower(btrim(k.word)) = r.ref)
                 OR EXISTS (SELECT 1
                              FROM unnest(t.former_labels) f(label)
                             WHERE lower(btrim(f.label)) = r.ref
                                OR 'table ' || lower(btrim(f.label)) = r.ref) THEN 3
             END AS rank
        FROM public.restaurant_tables t
        CROSS JOIN (SELECT lower(btrim(p_ref)) AS ref) r
       WHERE r.ref <> ''
         AND t.restaurant_id = p_restaurant_id
         AND (t.is_active OR p_include_retired)
    ) m
   WHERE m.rank IS NOT NULL
   ORDER BY m.rank, m.created_at, m.id
   LIMIT 1
$$;
COMMENT ON FUNCTION public.pos_table_for_ref(uuid, text, text, boolean) IS
  'The table a till word resolves to (ADR 0303): the source''s pos ref, then the label, then "table <label>", then a remembered till word of that source or former label. NULL for a blank word or no match.';

-- ---------------------------------------------------------------------------
-- 3c. Find the check's table, or learn it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_checks_find_or_learn_table()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_word text;
  v_ref text;
  v_id uuid;
BEGIN
  -- The till's word follows raw. On an upsert re-send the UPDATE names raw but
  -- not table_ref, so NEW.table_ref is still OLD's: a word that came from the
  -- old raw goes when the new raw names no table, and a word a writer set
  -- itself (raw carrying none) stands.
  IF TG_OP = 'INSERT' THEN
    NEW.table_ref := coalesce(public.pos_table_ref_from_raw(NEW.source, NEW.raw), NEW.table_ref);
  ELSIF NEW.raw IS DISTINCT FROM OLD.raw THEN
    v_word := public.pos_table_ref_from_raw(NEW.source, NEW.raw);
    IF v_word IS NOT NULL THEN
      NEW.table_ref := v_word;
    ELSIF NEW.table_ref IS NOT DISTINCT FROM OLD.table_ref
          AND OLD.table_ref IS NOT DISTINCT FROM public.pos_table_ref_from_raw(OLD.source, OLD.raw) THEN
      NEW.table_ref := NULL;
    END IF;
    -- A changed word re-resolves a link this statement did not set itself.
    IF lower(btrim(coalesce(NEW.table_ref, ''))) <> lower(btrim(coalesce(OLD.table_ref, '')))
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id THEN
      NEW.table_id := NULL;
    END IF;
  END IF;

  -- A past check never moves (founder, 2026-10-05, "Keep every spelling"):
  -- while an update leaves the check's word as it was, the check keeps the
  -- table it had, whatever the statement sets. An upsert re-send names
  -- table_id from pos-hub's in-memory resolve, which may now find another
  -- table, or none.
  IF TG_OP = 'UPDATE' AND OLD.table_id IS NOT NULL
     AND lower(btrim(coalesce(NEW.table_ref, ''))) = lower(btrim(coalesce(OLD.table_ref, ''))) THEN
    NEW.table_id := OLD.table_id;
    RETURN NEW;
  END IF;

  v_ref := NULLIF(btrim(NEW.table_ref), '');
  IF NEW.table_id IS NOT NULL OR v_ref IS NULL THEN
    RETURN NEW;
  END IF;

  v_id := public.pos_table_for_ref(NEW.restaurant_id, NEW.source, v_ref);

  -- Only a word with an ASCII digit in it makes a table (founder, 2026-10-05:
  -- "Only words with a number"), and only one of at most 60 characters, the
  -- most PATCH lets a person name a table. Any other word keeps its
  -- table_ref and waits for a table that answers it. A retired table that
  -- answers is the owner's earlier answer: no duplicate.
  IF v_id IS NULL
     AND v_ref ~ '[0123456789]'
     AND char_length(v_ref) <= 60
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
  'BEFORE trigger on pos_checks (ADR 0303): reads table_ref out of raw; an update that leaves the word as it was keeps the check''s table; otherwise resolves the word to a table, or learns one when the word has an ASCII digit in it and is at most 60 characters. Never refuses a check.';

DROP TRIGGER IF EXISTS pos_checks_find_or_learn_table ON public.pos_checks;
-- No WHEN clause: the word is read from raw inside the function, after a
-- WHEN would already have been evaluated, and a trigger on INSERT OR UPDATE
-- cannot compare OLD.raw in one. The function returns at once when there is
-- nothing to resolve.
CREATE TRIGGER pos_checks_find_or_learn_table
  BEFORE INSERT OR UPDATE OF raw, table_id, table_ref ON public.pos_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.pos_checks_find_or_learn_table();

-- ---------------------------------------------------------------------------
-- 4. A renamed or re-mapped table keeps every spelling: every word on a
--    check linked to it, per source, and its earlier pos_refs words join
--    till_words; its old label joins former_labels. Nothing is dropped: the
--    row's own till_words and former_labels, old and new, are kept, and a
--    word already kept in any case is not added twice.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_tables_keep_till_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_words jsonb := CASE WHEN jsonb_typeof(NEW.till_words) = 'object' THEN NEW.till_words ELSE '{}'::jsonb END;
  v_list jsonb;
  v_label text;
  w record;
BEGIN
  FOR w IN
    SELECT k.key AS source, btrim(e.word) AS word, 0 AS pass, NULL::timestamptz AS seen
      FROM jsonb_each(CASE WHEN jsonb_typeof(OLD.till_words) = 'object' THEN OLD.till_words ELSE '{}'::jsonb END) k
     CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(k.value) = 'array' THEN k.value ELSE '[]'::jsonb END) e(word)
    UNION ALL
    SELECT p.key, btrim(p.value #>> '{}'), 1, NULL::timestamptz
      FROM jsonb_each(CASE WHEN jsonb_typeof(OLD.pos_refs) = 'object' THEN OLD.pos_refs ELSE '{}'::jsonb END) p
     WHERE jsonb_typeof(p.value) IN ('string', 'number')
    UNION ALL
    SELECT c.source, btrim(c.table_ref), 2, min(c.opened_at)
      FROM public.pos_checks c
     WHERE c.table_id = OLD.id
       AND NULLIF(btrim(c.table_ref), '') IS NOT NULL
     GROUP BY c.source, btrim(c.table_ref)
     ORDER BY 3, 4, 1, 2
  LOOP
    CONTINUE WHEN w.word IS NULL OR w.word = '';
    v_list := CASE WHEN jsonb_typeof(v_words -> w.source) = 'array' THEN v_words -> w.source ELSE '[]'::jsonb END;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_list) k(word)
                    WHERE lower(btrim(k.word)) = lower(w.word)) THEN
      v_words := jsonb_set(v_words, ARRAY[w.source], v_list || to_jsonb(w.word));
    END IF;
  END LOOP;
  NEW.till_words := v_words;

  -- The old label, unless the rename only changed its case or spacing.
  NEW.former_labels := coalesce(NEW.former_labels, '{}'::text[]);
  FOREACH v_label IN ARRAY coalesce(OLD.former_labels, '{}'::text[])
                           || CASE WHEN lower(btrim(OLD.label)) IS DISTINCT FROM lower(btrim(NEW.label))
                                   THEN ARRAY[OLD.label] ELSE '{}'::text[] END LOOP
    v_label := NULLIF(btrim(v_label), '');
    IF v_label IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(NEW.former_labels) f(label)
                        WHERE lower(btrim(f.label)) = lower(v_label)) THEN
      NEW.former_labels := NEW.former_labels || v_label;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
-- [Corrected 2026-10-05, after the afda5d868 audit: this comment replaces
-- "merges the till words already linked to the row into pos_refs; existing
-- keys win", broader than that code, which merged one word per source.]
COMMENT ON FUNCTION public.restaurant_tables_keep_till_names() IS
  'BEFORE UPDATE OF label, pos_refs on restaurant_tables (ADR 0303): adds to till_words every distinct word, per source, on a check linked to the row, and its earlier pos_refs words; adds its old label to former_labels unless the rename changed only its case or spacing. It drops no word or label the row kept.';

DROP TRIGGER IF EXISTS restaurant_tables_keep_till_names ON public.restaurant_tables;
CREATE TRIGGER restaurant_tables_keep_till_names
  BEFORE UPDATE OF label, pos_refs ON public.restaurant_tables
  FOR EACH ROW
  WHEN (NEW.label IS DISTINCT FROM OLD.label OR NEW.pos_refs IS DISTINCT FROM OLD.pos_refs)
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
