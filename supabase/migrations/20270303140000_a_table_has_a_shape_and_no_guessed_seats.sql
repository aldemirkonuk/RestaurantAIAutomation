-- A table has a shape, and nobody's seats are guessed (ADR 0347 D3, D4, D6).
--
-- WHAT THIS DOES
-- --------------
-- 1. restaurant_tables gains `shape` ('round' | 'rect'), nullable, no default.
--    NULL draws a plain marker; a shape is never guessed from seats (D6).
--    Placement uses the columns the table already has: x_pos / y_pos, plan
--    units 0..100 (D6). NULL x_pos or y_pos means the table waits in the tray
--    (D5). Width, height and rotation are NOT added: ADR 0347 names none, so
--    they are an undecided fork, not a default to pick here.
-- 2. The two guessing defaults go (D4): `seats DEFAULT 2` and
--    `is_outdoor DEFAULT false` (baseline_from_production.sql:5173, :5175).
--    ADR 0303's migration already dropped their NOT NULL
--    (20261222230000_tables_learned_from_the_pos.sql:130-131). No insert in
--    apps/ omits either column today, so no running writer changes.
-- 3. `floor_table_twin(house, name, exclude)`: D3's twin guard. The table of
--    the house (shown, hidden or retired) that already answers the word N or
--    `table N`, by any of pos_table_for_ref's four rules, for any till source:
--    a pos_refs word, its label, `table <label>`, a till_words word or a
--    former label. NULL when none does.
-- 4. `floor_create_table(...)`: D3's one create. Takes the house's
--    pg_advisory_xact_lock, runs the twin guard, and inserts with every value
--    the caller left out stored as NULL (seats, is_outdoor, x_pos, y_pos,
--    shape). It never upserts. No learned_at, so relink_on_add links the
--    waiting checks in the same statement.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- - The till's learner (pos_checks_find_or_learn_table) does not yet take the
--   same advisory lock, so an add racing the till can still make a twin. D3
--   asks for that; it is a change to ADR 0303's learner and is left to its own
--   reviewed migration.
-- - POST /analytics/tables still upserts (OD-253 open); only its seat guess
--   is removed, in code.

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS shape text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_tables_shape_check'
       AND conrelid = 'public.restaurant_tables'::regclass
  ) THEN
    ALTER TABLE public.restaurant_tables
      ADD CONSTRAINT restaurant_tables_shape_check CHECK (shape IN ('round', 'rect'));
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurant_tables.shape IS
  'round or rect, set only by a person in the floor builder (ADR 0347 D6). NULL draws a plain marker; never guessed from seats.';

ALTER TABLE public.restaurant_tables ALTER COLUMN seats DROP DEFAULT;
ALTER TABLE public.restaurant_tables ALTER COLUMN is_outdoor DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.floor_table_twin(
  p_restaurant_id uuid,
  p_label text,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, label text)
LANGUAGE sql
STABLE
AS $$
  WITH w AS (
    SELECT lower(btrim(p_label)) AS n, 'table ' || lower(btrim(p_label)) AS tn
  )
  SELECT t.id, t.label
    FROM public.restaurant_tables t, w
   WHERE t.restaurant_id = p_restaurant_id
     AND (p_exclude_id IS NULL OR t.id <> p_exclude_id)
     AND w.n <> ''
     AND (
          lower(btrim(t.label)) IN (w.n, w.tn)
       OR 'table ' || lower(btrim(t.label)) = w.n
       OR EXISTS (SELECT 1 FROM jsonb_each_text(t.pos_refs) r(src, word)
                   WHERE lower(btrim(r.word)) IN (w.n, w.tn))
       OR EXISTS (SELECT 1
                    FROM jsonb_each(t.till_words) s(src, words),
                         jsonb_array_elements_text(
                           CASE WHEN jsonb_typeof(s.words) = 'array' THEN s.words ELSE '[]'::jsonb END) k(word)
                   WHERE lower(btrim(k.word)) IN (w.n, w.tn))
       OR EXISTS (SELECT 1 FROM unnest(t.former_labels) f(label)
                   WHERE lower(btrim(f.label)) IN (w.n, w.tn)
                      OR 'table ' || lower(btrim(f.label)) = w.n)
     )
   ORDER BY t.created_at, t.id
   LIMIT 1
$$;

COMMENT ON FUNCTION public.floor_table_twin(uuid, text, uuid) IS
  'ADR 0347 D3 twin guard: the table of the house (any state) already answering N or "table N" by any pos_table_for_ref rule, any source. NULL row set when none.';

CREATE OR REPLACE FUNCTION public.floor_create_table(
  p_restaurant_id uuid,
  p_label text,
  p_seats integer DEFAULT NULL,
  p_is_outdoor boolean DEFAULT NULL,
  p_x_pos numeric DEFAULT NULL,
  p_y_pos numeric DEFAULT NULL,
  p_shape text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_label text := btrim(coalesce(p_label, ''));
  v_twin record;
  v_row public.restaurant_tables;
  v_linked integer;
BEGIN
  IF length(v_label) < 1 OR length(v_label) > 60 THEN
    RETURN jsonb_build_object('error', 'bad_label');
  END IF;
  -- One add per house at a time: the guard and the insert see the same tables.
  PERFORM pg_advisory_xact_lock(hashtextextended('restaurant_tables:' || p_restaurant_id::text, 0));
  SELECT * INTO v_twin FROM public.floor_table_twin(p_restaurant_id, v_label, NULL);
  IF FOUND THEN
    RETURN jsonb_build_object('error', 'twin', 'twin_id', v_twin.id, 'twin_label', v_twin.label);
  END IF;
  -- Every column a person did not give is written as NULL, by name (D4).
  INSERT INTO public.restaurant_tables
    (restaurant_id, label, seats, is_outdoor, x_pos, y_pos, shape)
  VALUES
    (p_restaurant_id, v_label, p_seats, p_is_outdoor, p_x_pos, p_y_pos, p_shape)
  RETURNING * INTO v_row;
  SELECT count(*) INTO v_linked FROM public.pos_checks WHERE table_id = v_row.id;
  RETURN jsonb_build_object('table', to_jsonb(v_row), 'checks_linked', v_linked);
END
$$;

COMMENT ON FUNCTION public.floor_create_table(uuid, text, integer, boolean, numeric, numeric, text) IS
  'ADR 0347 D3: create one table by hand under the house lock, refusing a twin; anything not given is NULL (D4).';

REVOKE ALL ON FUNCTION public.floor_table_twin(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.floor_create_table(uuid, text, integer, boolean, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.floor_table_twin(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.floor_create_table(uuid, text, integer, boolean, numeric, numeric, text) TO service_role;
