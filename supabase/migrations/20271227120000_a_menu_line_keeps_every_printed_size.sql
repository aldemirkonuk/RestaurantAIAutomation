-- r109 menu-g3: a menu line keeps every size it prints, with its price.
--
-- A meyhane prints raki at 20 cl / 35 cl / 70 cl, a kitchen prints half and
-- full portions, a bar prints a carafe beside the glass and the bottle. A
-- line had only by_glass_price and bottle_price, so a third price was lost or
-- forced into the wrong one. printed_sizes holds the sizes AS PRINTED:
-- [{label, ml, price}], 2 to 8 of them. It is read and shown only: making a
-- menu current still carries ONLY the bottle and the glass price to the
-- house, and a size never enters the plan or its fingerprint. NULL = the line
-- prints one price (or the read showed no sizes).
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS printed_sizes JSONB;

-- A CHECK cannot hold a subquery, so the rule is an immutable function (as
-- menu_printed_marks_fit): an array of 2 to 8 objects, each a label of 1 to
-- 40 characters, an ml that is null or a whole number from 10 to 5000, and a
-- price that is a number of at most two decimals, from 0 to under 10^8
-- (numeric(10,2), the line's own price columns). More than 8 is refused
-- whole. Every cast is guarded by its type test, so a wrong shape is false,
-- never an error.
CREATE OR REPLACE FUNCTION public.menu_printed_sizes_fit(sizes JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT sizes IS NULL
      OR (pg_catalog.jsonb_typeof(sizes) = 'array'
          AND pg_catalog.jsonb_array_length(sizes) BETWEEN 2 AND 8
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(sizes) AS e(v)
             WHERE CASE
                     WHEN pg_catalog.jsonb_typeof(e.v) IS DISTINCT FROM 'object' THEN true
                     WHEN pg_catalog.jsonb_typeof(e.v -> 'label') IS DISTINCT FROM 'string' THEN true
                     WHEN pg_catalog.char_length(e.v ->> 'label') NOT BETWEEN 1 AND 40 THEN true
                     WHEN pg_catalog.jsonb_typeof(e.v -> 'ml') = 'number'
                       THEN NOT ((e.v ->> 'ml') ~ '^[0-9]+$' AND (e.v ->> 'ml')::numeric BETWEEN 10 AND 5000)
                     WHEN pg_catalog.jsonb_typeof(e.v -> 'ml') IS NOT NULL
                          AND pg_catalog.jsonb_typeof(e.v -> 'ml') <> 'null' THEN true
                     ELSE false
                   END
                OR CASE
                     WHEN pg_catalog.jsonb_typeof(e.v -> 'price') IS DISTINCT FROM 'number' THEN true
                     ELSE (e.v ->> 'price')::numeric < 0
                       OR (e.v ->> 'price')::numeric >= 100000000
                       OR (e.v ->> 'price')::numeric <> pg_catalog.round((e.v ->> 'price')::numeric, 2)
                   END
          ));
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'menu_items_printed_sizes_fit'
                    AND conrelid = to_regclass('public.menu_items')) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_printed_sizes_fit CHECK (public.menu_printed_sizes_fit(printed_sizes));
  END IF;
END
$$;

COMMENT ON COLUMN public.menu_items.printed_sizes IS
  'Every size the line prints with its price, as printed (r109 menu-g3): [{label, ml, price}], 2 to 8. Shown only: never carried to the house price, never in the plan. NULL = one price printed.';
