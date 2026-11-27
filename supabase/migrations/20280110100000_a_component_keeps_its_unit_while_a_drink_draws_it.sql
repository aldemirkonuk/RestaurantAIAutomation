-- r109 drinks fixer (r105 walk, finding 2 on #2067): the kind of unit a
-- house-made component is made in cannot change while a LIVE recipe draws it,
-- and a line that draws it cannot be written against a unit that is changing.
--
-- The gateway checked "is it drawn?" and then wrote in a second call, with no
-- lock. A manager saving a drink with 30 ml of the mix (read as ml10, passes)
-- and an owner changing the mix to grams (no line visible yet, passes) both
-- committed: a current drink drew a gram component in millilitres. Two rules
-- close it in the database, where the lock lives:
--
--  1. BEFORE INSERT on recipe_lines: a line that names a component takes
--     FOR SHARE on the component's row and states its unit again. An owner's
--     UPDATE of that row waits for the save; a save that meets an UPDATE in
--     flight waits for it, then reads the new unit and is refused.
--  2. BEFORE UPDATE OF yield_base_unit on dishes: refused while a current
--     version of a live drink or dish draws it. The row lock is held by then,
--     so a save that committed first is seen. A retired drink or dish does not
--     hold the unit (its pointer stays, a soft delete, but it cannot be opened).
--
-- The gateway keeps its own check as the first, wordier refusal and prices a
-- line in the wrong unit as not known (recipe-cost.ts) as the backstop.

CREATE OR REPLACE FUNCTION public.recipe_line_keeps_component_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_unit text;
BEGIN
  IF NEW.component_dish_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT d.yield_base_unit INTO v_unit FROM public.dishes d WHERE d.id = NEW.component_dish_id FOR SHARE;
  IF v_unit IS DISTINCT FROM NEW.base_unit THEN
    RAISE EXCEPTION 'Ingredient % (%) is measured in %, but the component is made in %.', NEW.position, NEW.label, NEW.base_unit, v_unit
      USING ERRCODE = 'RCP00', HINT = 'component_unit';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS recipe_lines_keep_component_unit ON public.recipe_lines;
CREATE TRIGGER recipe_lines_keep_component_unit BEFORE INSERT ON public.recipe_lines
  FOR EACH ROW EXECUTE FUNCTION public.recipe_line_keeps_component_unit();

CREATE OR REPLACE FUNCTION public.dish_yield_unit_not_changed_while_drawn() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.yield_base_unit IS NOT NULL AND NEW.yield_base_unit IS DISTINCT FROM OLD.yield_base_unit AND EXISTS (
    SELECT 1
      FROM public.recipe_lines l
     WHERE l.component_dish_id = NEW.id
       AND (EXISTS (SELECT 1 FROM public.recipe_current_dish c JOIN public.dishes o ON o.id = c.dish_id
                     WHERE c.version_id = l.version_id AND o.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.recipe_current c JOIN public.cocktails o ON o.id = c.cocktail_id
                        WHERE c.version_id = l.version_id AND o.deleted_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'Take % out of the recipes that use it before it is made in a different kind of unit.', NEW.name
      USING ERRCODE = 'RCP00', HINT = 'component_unit_in_use';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dishes_yield_unit_not_changed_while_drawn ON public.dishes;
CREATE TRIGGER dishes_yield_unit_not_changed_while_drawn BEFORE UPDATE OF yield_base_unit ON public.dishes
  FOR EACH ROW EXECUTE FUNCTION public.dish_yield_unit_not_changed_while_drawn();
