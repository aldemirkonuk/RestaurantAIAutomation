-- A good says what one piece of it weighs and what one ml of it weighs
-- (r28 recipes audit, gap 7).
--
-- A recipe line is measured one way and its good may be kept another: "2 eggs"
-- against eggs kept by the gram, "2 tbsp flour" against flour kept by the
-- kilogram, "20 g syrup" against a bottle of syrup. Until now each of these
-- was a unit mismatch: no price and not counted on the nutrition card. The
-- house can now state, for that very good, the weight that joins the two.
-- Nothing is assumed: there is no table of what an egg usually weighs, and a
-- good with no statement stays a mismatch.
--
-- Both are grams, per piece and per ml. They change no lot's cost and no
-- stock count: they say only how a line meets the good. NULL is "not stated".
-- The upper bounds catch a slip (grams per litre typed as grams per ml); the
-- gateway refuses the same figures first, in words.

ALTER TABLE public.restaurant_inventory
  ADD COLUMN IF NOT EXISTS piece_grams numeric(10,3)
    CONSTRAINT restaurant_inventory_piece_grams_positive CHECK (piece_grams > 0 AND piece_grams <= 50000),
  ADD COLUMN IF NOT EXISTS ml_grams numeric(8,4)
    CONSTRAINT restaurant_inventory_ml_grams_positive CHECK (ml_grams > 0 AND ml_grams <= 5);

COMMENT ON COLUMN public.restaurant_inventory.piece_grams IS
  'What one piece of this good weighs, in g, as the house stated it. A recipe line counted in pieces of a weighed good, or weighed against a good counted in pieces, is priced and counted through it. NULL: not stated, and the line stays a unit mismatch (r28 recipes gap 7).';
COMMENT ON COLUMN public.restaurant_inventory.ml_grams IS
  'What one ml of this good weighs, in g, as the house stated it. A recipe line measured by volume against a weighed good, or weighed against a good kept by volume, is priced and counted through it. NULL: not stated (r28 recipes gap 7).';
