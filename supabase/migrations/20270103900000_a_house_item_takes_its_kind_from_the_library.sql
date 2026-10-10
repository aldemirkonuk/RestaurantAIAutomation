-- A HOUSE ITEM TAKES ITS KIND FROM THE LIBRARY. F-738 (sim wave 26).
--
-- WHAT BROKE. set_house_item_identity() (20260903171000_the_house_item_is_
-- the_ledgers_key.sql, section 4) filled a library-linked row's kind with
-- `coalesce(NEW.kind, 'wine')`. Neither gateway insert path sends a kind, so
-- a Bomonti or an Efe Rakı added from the library was stored as a wine,
-- although master_wine_library.beverage_kind already said beer or spirit
-- (trg_wine_beverage_kind, 20260817060000_beverage_kind_classification.sql).
-- Every reader of restaurant_inventory.kind (house_items, /ask readings)
-- inherited the mistake.
--
-- THE CHANGE. The trigger now reads the linked row's beverage_kind. Every
-- beverage_kind value except 'unknown' is also a restaurant_inventory.kind
-- value, so it is copied as is. 'wine' and 'unknown' stay 'wine', exactly as
-- before: the library has not said the row is anything else, and kind has no
-- 'unknown' member to say "not yet known". Whether an unclassified library
-- row should become 'other' instead is NOT decided here.
--
-- A kind the caller states still wins, as before (the early RETURN and the
-- coalesce are unchanged).
--
-- BACKFILL. Rows already stored as 'wine' that are linked to a library row
-- classified as something else are corrected in the same file. Only rows
-- whose provenance says the trigger or the original backfill chose 'wine'
-- (wine_library, backfill) are touched; a kind a person declared is left
-- alone. updated_at moves on the corrected rows
-- (update_restaurant_inventory_updated_at); nothing reads it as a count.
--
-- NOT DONE. A library row reclassified AFTER a house item was added does
-- not carry its new kind to that item: kind is still stamped at insert.

CREATE OR REPLACE FUNCTION public.set_house_item_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_library_kind text;
BEGIN
  IF NEW.kind IS NOT NULL AND NEW.uom IS NOT NULL
     AND NEW.display_name IS NOT NULL AND NEW.identity_provenance IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.master_wine_id IS NULL THEN
    RAISE EXCEPTION
      'restaurant_inventory: a house item with no master_wine_id must state kind, uom, display_name and identity_provenance. Nothing here is derivable and a default would file this as a bottle of wine (ADR 0115 / OD-113).'
      USING ERRCODE = '23502';
  END IF;

  IF NEW.kind IS NULL THEN
    SELECT w.beverage_kind INTO v_library_kind
    FROM public.master_wine_library w
    WHERE w.id = NEW.master_wine_id;
  END IF;

  NEW.kind := coalesce(
    NEW.kind,
    CASE WHEN v_library_kind IN ('beer', 'spirit', 'sake', 'cider',
                                 'cocktail', 'non_alcoholic')
         THEN v_library_kind
         ELSE 'wine'
    END);
  NEW.uom  := coalesce(NEW.uom, lower(nullif(btrim(NEW.unit_type), '')), 'bottle');
  NEW.identity_provenance := coalesce(NEW.identity_provenance, 'wine_library');

  IF NEW.display_name IS NULL THEN
    SELECT coalesce(nullif(btrim(NEW.wine_name), ''),
                    nullif(btrim(w.name), ''),
                    nullif(btrim(w.producer), ''))
      INTO NEW.display_name
    FROM public.master_wine_library w
    WHERE w.id = NEW.master_wine_id;
  END IF;

  IF NEW.display_name IS NULL THEN
    RAISE EXCEPTION
      'restaurant_inventory: library row % carries no name and no producer, so there is no honest display_name for this house item (ADR 0115).',
      NEW.master_wine_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.set_house_item_identity IS
  'BEFORE INSERT on restaurant_inventory. Derives kind (from the linked '
  'library row''s beverage_kind; wine when the library says wine or does not '
  'know), uom, display_name and identity_provenance for a row that carries a '
  'master_wine_id; RAISES for one that does not (ADR 0115, F-738).';

UPDATE public.restaurant_inventory ri
SET kind = w.beverage_kind
FROM public.master_wine_library w
WHERE w.id = ri.master_wine_id
  AND ri.kind = 'wine'
  AND ri.identity_provenance IN ('wine_library', 'backfill')
  AND w.beverage_kind IN ('beer', 'spirit', 'sake', 'cider',
                          'cocktail', 'non_alcoholic');
