-- A house may name a bottle the library does not have, and it stays provisional
-- until Mudavym curates it (ADR 0124 Q3).
--
-- THE FOUNDER'S CALL, 2026-09-05 (batch 48): "Provisional on the item, curated
-- into the library." His own words that led there: "do option 1, + let each
-- restaurant to name their products to match their likings ... maybe the /menu
-- is editable, but masterwinelibrary parts /wines not at all."
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
-- ------------------------------------------------
-- ADR 0130 (`20260906010000_a_generic_name_stays_the_venues_own_wine.sql`)
-- already built the LIBRARY side of this the same day: a venue-owned row
-- carries `master_wine_library.provisional_for_restaurant_id`, is never a match
-- target for another venue, and is promoted by setting that column back to NULL.
-- Nothing here duplicates it. This migration adds the IDENTITY side, which is
-- the thing ADR 0124 introduced and ADR 0130 does not touch: a bottle identity
-- (producer, name, vintage, size, pack) that one house asserted, its curation
-- state, and the link to the library row it is eventually promoted onto.
--
-- The two columns are named the same on purpose. `provisional_for_restaurant_id`
-- means one thing in this repo -- "this row is one venue's own, not shared" --
-- and giving the identity register a synonym for it would be a second word for
-- one fact.
--
-- WHY PROVENANCE IS A SEPARATE COLUMN FROM THE STATE
-- -------------------------------------------------
-- The founder's option text says the promotion keeps "the house's original
-- assertion as provenance". ADR 0130 promotes by CLEARING
-- `provisional_for_restaurant_id`, so if this table used one column for both
-- "whose it is" and "who asserted it", promotion would erase the answer to the
-- second. So `asserted_for_restaurant_id` is written once and NEVER cleared,
-- and `standing` is derived from it and from `master_wine_id` rather than
-- stored -- a generated column cannot drift from the facts it describes, and
-- "printed as provisional everywhere it appears, never as official" is only
-- true if the printing reads something that cannot be wrong.
--
-- Additive and idempotent. No explicit BEGIN/COMMIT: the Supabase CLI wraps
-- each migration file in a transaction.

ALTER TABLE public.beverage_identities
  -- The house that asserted this bottle. Written once, never cleared: it is
  -- provenance, not state. NULL means nobody's house asserted it -- a
  -- transcription from a published source, or a platform-wide assertion.
  ADD COLUMN IF NOT EXISTS asserted_for_restaurant_id UUID
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,

  -- The shared library row this identity was promoted onto. Set by curation,
  -- never by a house. Many identities may name one library row -- a wine sold
  -- in 750 ml and in magnum is two trade items and one library entry -- which
  -- is why this direction is a column and the reverse one is not (ADR 0124:
  -- the library reaches an identity through a KEY, so one library row can name
  -- several identities; this is the many-to-one side of that same relation).
  ADD COLUMN IF NOT EXISTS master_wine_id UUID
    REFERENCES public.master_wine_library(id) ON DELETE RESTRICT,

  -- Where it sits in the curation queue. 'none' is the honest default: a
  -- transcribed source row is not waiting for anybody.
  ADD COLUMN IF NOT EXISTS curation_state VARCHAR(16) NOT NULL DEFAULT 'none'
    CHECK (curation_state IN ('none', 'queued', 'promoted', 'declined')),
  ADD COLUMN IF NOT EXISTS curated_by UUID
    REFERENCES public.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS curated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS curation_note TEXT;

-- THREE standings, not two, and the third is why.
--
-- The founder named two -- provisional and official -- and the rule is that a
-- provisional identity is never printed as official. Collapsing everything that
-- is not provisional into "official" would call an Iowa transcription an
-- official library entry, which is the exact class of falsehood this register
-- exists to stop. So a row that is neither a house's assertion nor promoted
-- onto a library row says what it is: 'source'.
ALTER TABLE public.beverage_identities
  ADD COLUMN IF NOT EXISTS standing TEXT GENERATED ALWAYS AS (
    CASE
      WHEN master_wine_id IS NOT NULL              THEN 'library'
      WHEN asserted_for_restaurant_id IS NOT NULL  THEN 'provisional'
      ELSE 'source'
    END
  ) STORED;

-- The curation queue is a QUERY, not a table. A queue table would carry its own
-- copy of "is this waiting", which can disagree with the identity's own
-- curation_state; there is exactly one fact and it lives on the row.
CREATE INDEX IF NOT EXISTS idx_beverage_identities_curation
  ON public.beverage_identities (curation_state, asserted_at DESC)
  WHERE curation_state = 'queued';

CREATE INDEX IF NOT EXISTS idx_beverage_identities_house
  ON public.beverage_identities (asserted_for_restaurant_id)
  WHERE asserted_for_restaurant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_beverage_identities_master_wine
  ON public.beverage_identities (master_wine_id)
  WHERE master_wine_id IS NOT NULL;

COMMENT ON COLUMN public.beverage_identities.asserted_for_restaurant_id IS
  'The house that asserted this bottle. Written once and NEVER cleared -- it is provenance, and promotion must keep it (ADR 0124 Q3, founder 2026-09-05). Compare master_wine_library.provisional_for_restaurant_id (ADR 0130), which IS cleared on promotion because there it is state.';
COMMENT ON COLUMN public.beverage_identities.master_wine_id IS
  'The shared library row this identity was promoted onto, set by curation and never by a house. Many identities may name one library row (750ml and magnum are two trade items, one entry) -- the many-to-one side of the relation whose other side ADR 0124 deliberately keeps as a KEY rather than a column.';
COMMENT ON COLUMN public.beverage_identities.standing IS
  'Generated, so what is printed cannot drift from what is true: ''library'' once promoted, ''provisional'' while it is one house''s assertion, ''source'' when transcribed from a published file. The founder''s rule is that a provisional identity is printed as provisional everywhere it appears and never as official.';
COMMENT ON COLUMN public.beverage_identities.curation_state IS
  'Where this sits in the Mudavym curation queue: none (nobody is waiting), queued, promoted, declined. The queue is a query over this column, not a second table that could disagree with it.';

DO $$
DECLARE
  c        text;
  absent   text;
  required text[] := ARRAY[
    'asserted_for_restaurant_id', 'master_wine_id', 'curation_state',
    'curated_by', 'curated_at', 'curation_note', 'standing'
  ];
  house    uuid;
  wine     uuid;
  prov     uuid;
  got      text;
BEGIN
  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'beverage_identities'
        AND column_name = c
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'beverage_identities is missing columns the gateway reads: %', absent;
  END IF;

  -- Every new column must be NULLABLE or defaulted: this table may already hold
  -- rows, and a NOT NULL without a default would demand a value nobody has.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'beverage_identities'
         AND column_name = 'asserted_for_restaurant_id') <> 'YES' THEN
    RAISE EXCEPTION 'asserted_for_restaurant_id must be nullable -- not every identity is a house''s';
  END IF;

  -- PROVE the standing rule on probes, then remove them. A generated column
  -- nobody exercised is a generated column nobody has.
  SELECT id INTO house FROM public.restaurants LIMIT 1;

  INSERT INTO public.beverage_identities
    (producer_normalised, name_normalised, vintage_text, size_ml, pack,
     display_label, assertion_method)
  VALUES ('probe producer', 'probe source wine', 'unstated', 750, 1,
          'Probe Source Wine', 'source_transcript')
  RETURNING id INTO prov;
  SELECT standing INTO got FROM public.beverage_identities WHERE id = prov;
  IF got <> 'source' THEN
    RAISE EXCEPTION 'an identity belonging to no house and no library row read as %, not source', got;
  END IF;
  DELETE FROM public.beverage_identities WHERE id = prov;

  IF house IS NOT NULL THEN
    INSERT INTO public.beverage_identities
      (producer_normalised, name_normalised, vintage_text, size_ml, pack,
       display_label, assertion_method, asserted_for_restaurant_id,
       curation_state)
    VALUES ('probe producer', 'probe house wine', 'unstated', 750, 1,
            'Probe House Wine', 'person', house, 'queued')
    RETURNING id INTO prov;
    SELECT standing INTO got FROM public.beverage_identities WHERE id = prov;
    IF got <> 'provisional' THEN
      RAISE EXCEPTION 'a house assertion read as %, not provisional', got;
    END IF;

    SELECT id INTO wine FROM public.master_wine_library WHERE deleted_at IS NULL LIMIT 1;
    IF wine IS NOT NULL THEN
      UPDATE public.beverage_identities
         SET master_wine_id = wine, curation_state = 'promoted'
       WHERE id = prov;
      SELECT standing INTO got FROM public.beverage_identities WHERE id = prov;
      IF got <> 'library' THEN
        RAISE EXCEPTION 'a promoted identity read as %, not library', got;
      END IF;
      -- The founder's rule, asserted rather than trusted: promotion keeps the
      -- house's original assertion.
      IF (SELECT asserted_for_restaurant_id FROM public.beverage_identities
           WHERE id = prov) IS NULL THEN
        RAISE EXCEPTION 'promotion erased the house that asserted the identity';
      END IF;
    END IF;
    DELETE FROM public.beverage_identities WHERE id = prov;
  END IF;

  RAISE NOTICE 'beverage_identities gained asserted_for_restaurant_id, master_wine_id, curation_state/by/at/note and a generated standing; source/provisional/library all proved on probes; % rows remain.',
    (SELECT count(*) FROM public.beverage_identities);
END
$$;
