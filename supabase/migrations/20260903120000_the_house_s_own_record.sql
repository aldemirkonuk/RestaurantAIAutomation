-- The house's own record on a bottle that is not a wine.
--
-- WHY THIS EXISTS
-- ---------------
-- DESIGN-FOUNDATION.md §6, the `/cellar` row, names the exponential idea for
-- this page: "**The house's own record on every bottle** — first bought, what
-- we have paid, what we poured, when it ran out, who quoted it". Need it: now.
--
-- For a WINE that record is already reachable: `restaurant_inventory` is keyed
-- on `master_wine_id`, and `inventory_transactions`, `pour_events`,
-- `wine_consumption_log` and `procurement_order_items` all hang off it.
--
-- For a beer, a whisky or a cola there is no such key. `public.beverages` has
-- no `restaurant_id` at all (20260817070000_beverages_table.sql:217) and
-- nothing in the schema references `beverages.id` except
-- `cocktail_ingredients.beverage_id` (20260817090000_cocktails.sql:63), which
-- is empty by design. That is OD-113 — the non-wine inventory identity axis —
-- seen from the reporting side: a house can buy, list, quote and sell a keg,
-- and the platform holds five separate records of it that cannot be joined.
--
-- So this migration does not invent an identity. It reassembles one, from the
-- five books that DO carry the product's name and DO carry a restaurant_id:
--
--   menu_items                  what the house lists, and charges
--   procurement_document_lines  what the house has been invoiced, and when
--   procurement_order_items     what the house has ordered
--   vendor_price_observations   who quoted it, at what, from which source
--   pos_unresolved_lines        what the house has actually sold
--
-- WHAT THE KEY IS, AND WHAT IT IS EMPHATICALLY NOT
-- ------------------------------------------------
-- `beverage_house_key()` below is built from `beverage_tokenize()` — the
-- existing tokenizer, in its one home — and nothing else. There is no second
-- EQUIV table, no second NOISE list, no similarity score and no threshold.
--
-- It is DELIBERATELY COARSER than `beverage_identity_key()`, and the reason is
-- concrete rather than aesthetic. `identity_key` preserves the producer/name
-- split, because for merging two catalogue rows that split is information. The
-- five books above record it five different ways: `menu_items` has a `producer`
-- column, `procurement_document_lines` has one free-text `description`, and
-- `pos_unresolved_lines` has whatever the till was programmed with. So
-- `identity_key('Lagunitas','IPA')` is `'lagunitas||ipa'` while
-- `identity_key(NULL,'Lagunitas IPA')` is `'||ipa lagunitas'` — the same
-- product, two keys, and a cross-book record that never assembles.
-- `beverage_house_key` folds the producer into the name before tokenizing, so
-- the key is the sorted token multiset and the two agree.
--
-- The cost of that is stated rather than hidden: this key CANNOT tell a
-- producer from a name, so two products whose combined tokens coincide would
-- group. It is therefore a REPORTING key only. It must never be written to a
-- row, never used to merge or link catalogue entries, and never substituted
-- for `identity_key` — arch §3.4's zero-false-merge property is a property of
-- `identity_key`, and this function does not inherit it.
--
-- HOW A HOUSE ROW REACHES THE CATALOGUE
-- -------------------------------------
-- Two ways, and the row always says which:
--
--   `exact`    — the catalogue row's own tokens and the house line's tokens are
--                the same multiset.
--   `contains` — every token of the catalogue row appears in the house line
--                ("Lagunitas IPA" in "LAGUNITAS IPA 6/12OZ NR"). Weaker, and
--                labelled weaker wherever it is rendered.
--
-- There is no third tier. A house line that reaches neither keeps `NULL` and is
-- shown as the house's own record with no catalogue entry behind it — which is
-- the truth, and is a far more useful sentence than a fuzzy guess.
--
-- WHAT IS NOT HERE, AND WHY
-- -------------------------
-- No `on hand`. Stock for a non-wine is exactly what OD-113 blocks: every
-- quantity path in this schema (`restaurant_inventory`, `inventory_lots`,
-- `inventory_transactions`, `pour_events`) is keyed on `master_wine_id`, so
-- there is no honest quantity to return and none is returned. The surfaces
-- render an em dash with that reason, never a zero.
--
-- SECURITY. `p_restaurant_id` is a parameter, so anyone who may EXECUTE this
-- may read any house's books. EXECUTE is therefore revoked from PUBLIC, anon
-- and authenticated and granted to service_role alone — the gateway holds the
-- service key and takes the restaurant from the signed JWT before calling.
-- Asserted at the bottom of this file rather than assumed.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The reporting key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.beverage_house_key(
  p_producer text,
  p_name     text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
           WHEN cardinality(public.beverage_tokenize(concat_ws(' ', p_producer, p_name))) = 0
             THEN NULL
           ELSE (
             SELECT array_to_string(array_agg(t ORDER BY t), ' ')
             FROM unnest(public.beverage_tokenize(concat_ws(' ', p_producer, p_name))) AS t
           )
         END;
$function$;

COMMENT ON FUNCTION public.beverage_house_key IS
  'REPORTING key only. Sorted token multiset of producer+name, via '
  'beverage_tokenize(). Deliberately coarser than beverage_identity_key(): it '
  'discards the producer/name split so that five books which record that split '
  'differently can be joined into one house record. It does NOT inherit '
  'identity_key''s zero-false-merge property and must never be used to merge, '
  'link or write identity. NULL when the text tokenizes to nothing.';

-- ---------------------------------------------------------------------------
-- 2. The house's record, per product, for one restaurant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.house_beverage_ledger(
  p_restaurant_id uuid,
  p_limit         integer DEFAULT 600
)
RETURNS TABLE (
  house_key           text,
  label               text,
  books               text[],
  first_seen          timestamptz,
  menu_lines          integer,
  menu_bottle_price   numeric,
  menu_glass_price    numeric,
  menu_sections       text[],
  invoice_lines       integer,
  first_bought        date,
  last_bought         date,
  bottles_bought      numeric,
  paid_total          numeric,
  last_unit_price     numeric,
  last_bought_from    text,
  order_lines         integer,
  last_ordered_at     timestamptz,
  last_order_price    numeric,
  last_ordered_from   text,
  quote_count         integer,
  last_quote_at       timestamptz,
  last_quote_price    numeric,
  last_quote_source   text,
  last_quote_from     text,
  pos_lines           integer,
  poured_qty          numeric,
  poured_revenue      numeric,
  first_poured        timestamptz,
  last_poured         timestamptz,
  beverage_id         uuid,
  match_method        text
)
LANGUAGE sql
STABLE
AS $function$
WITH
-- ── the five books, each keyed the same way ────────────────────────────────
menu AS (
  SELECT public.beverage_house_key(mi.producer, mi.name) AS k,
         concat_ws(' ', mi.producer, mi.name)            AS label,
         mi.category                                     AS section,
         mi.bottle_price, mi.by_glass_price, mi.created_at
  FROM public.menu_items mi
  WHERE mi.restaurant_id = p_restaurant_id
    AND btrim(coalesce(mi.name, '')) <> ''
),
-- Invoices only. A purchase order is what we asked for; an invoice is what we
-- were charged, and "what we have paid" is a claim only the invoice supports.
inv AS (
  SELECT public.beverage_house_key(NULL, l.description) AS k,
         l.description                                  AS label,
         d.doc_date, l.unit_price, l.line_total, l.qty_bottles,
         p.name                                         AS provider_name,
         l.created_at
  FROM public.procurement_document_lines l
  JOIN public.procurement_documents d ON d.id = l.document_id
  LEFT JOIN public.providers p ON p.id = d.provider_id
  WHERE l.restaurant_id = p_restaurant_id
    AND d.doc_type = 'invoice'
    AND btrim(coalesce(l.description, '')) <> ''
),
ord AS (
  SELECT public.beverage_house_key(oi.producer, oi.wine_name) AS k,
         concat_ws(' ', oi.producer, oi.wine_name)            AS label,
         coalesce(oi.final_unit_price, oi.negotiated_unit_price,
                  oi.quoted_unit_price)                       AS unit_price,
         o.requested_at,
         p.name                                               AS provider_name
  FROM public.procurement_order_items oi
  JOIN public.procurement_orders o ON o.id = oi.order_id
  LEFT JOIN public.providers p ON p.id = o.provider_id
  WHERE o.restaurant_id = p_restaurant_id
    AND btrim(coalesce(oi.wine_name, '')) <> ''
),
-- Tenant-scoped observations only. `vendor_price_observations.restaurant_id` is
-- nullable because a scraped public list price belongs to everyone
-- (20260805154027_vendor_price_observations.sql:53-56); those rows are somebody
-- else's market intelligence, not this house's quote, and are excluded.
quo AS (
  SELECT public.beverage_house_key(NULL, v.product_name_raw) AS k,
         v.product_name_raw                                  AS label,
         v.raw_price, v.source_type, v.observed_at,
         coalesce(p.name, v.vendor_name_raw)                 AS provider_name
  FROM public.vendor_price_observations v
  LEFT JOIN public.providers p ON p.id = v.provider_id
  WHERE v.restaurant_id = p_restaurant_id
    AND btrim(coalesce(v.product_name_raw, '')) <> ''
),
-- What was actually sold. UNRESOLVED lines only, and that is the point rather
-- than a limitation: a resolved line has been mapped to an inventory row, which
-- is necessarily a wine, and is already counted against that wine. Every sale
-- of a beer, a whisky or a cola lands here and nowhere else.
pour AS (
  SELECT public.beverage_house_key(NULL, u.item_name) AS k,
         u.item_name                                  AS label,
         u.qty, u.price, u.created_at
  FROM public.pos_unresolved_lines u
  WHERE u.restaurant_id = p_restaurant_id
    AND u.resolved = false
    AND btrim(coalesce(u.item_name, '')) <> ''
),

-- ── per-book aggregates ────────────────────────────────────────────────────
menu_agg AS (
  SELECT k,
         count(*)::integer                                 AS lines,
         max(bottle_price)                                 AS bottle_price,
         max(by_glass_price)                               AS glass_price,
         array_remove(array_agg(DISTINCT section), NULL)   AS sections,
         min(created_at)                                   AS first_at,
         (array_agg(label ORDER BY length(label) DESC))[1] AS label
  FROM menu WHERE k IS NOT NULL GROUP BY k
),
inv_agg AS (
  SELECT k,
         count(*)::integer                                              AS lines,
         min(doc_date)                                                  AS first_bought,
         max(doc_date)                                                  AS last_bought,
         sum(coalesce(qty_bottles, 0))                                  AS bottles,
         sum(coalesce(line_total, unit_price * qty_bottles, 0))         AS paid,
         (array_agg(unit_price    ORDER BY doc_date DESC NULLS LAST))[1] AS last_unit_price,
         (array_agg(provider_name ORDER BY doc_date DESC NULLS LAST))[1] AS last_from,
         min(created_at)                                                AS first_at,
         (array_agg(label ORDER BY length(label) DESC))[1]              AS label
  FROM inv WHERE k IS NOT NULL GROUP BY k
),
ord_agg AS (
  SELECT k,
         count(*)::integer                                                    AS lines,
         max(requested_at)                                                    AS last_at,
         (array_agg(unit_price    ORDER BY requested_at DESC NULLS LAST))[1]  AS last_price,
         (array_agg(provider_name ORDER BY requested_at DESC NULLS LAST))[1]  AS last_from,
         min(requested_at)                                                    AS first_at,
         (array_agg(label ORDER BY length(label) DESC))[1]                    AS label
  FROM ord WHERE k IS NOT NULL GROUP BY k
),
quo_agg AS (
  SELECT k,
         count(*)::integer                                                 AS n,
         max(observed_at)                                                  AS last_at,
         (array_agg(raw_price     ORDER BY observed_at DESC))[1]           AS last_price,
         (array_agg(source_type   ORDER BY observed_at DESC))[1]           AS last_source,
         (array_agg(provider_name ORDER BY observed_at DESC))[1]           AS last_from,
         min(observed_at)                                                  AS first_at,
         (array_agg(label ORDER BY length(label) DESC))[1]                 AS label
  FROM quo WHERE k IS NOT NULL GROUP BY k
),
pour_agg AS (
  SELECT k,
         count(*)::integer                                  AS lines,
         sum(coalesce(qty, 0))                              AS qty,
         sum(coalesce(price, 0) * coalesce(qty, 1))         AS revenue,
         min(created_at)                                    AS first_at,
         max(created_at)                                    AS last_at,
         (array_agg(label ORDER BY length(label) DESC))[1]  AS label
  FROM pour WHERE k IS NOT NULL GROUP BY k
),

-- ── every product this house's own books name ───────────────────────────────
keys AS (
  SELECT k FROM menu_agg
  UNION SELECT k FROM inv_agg
  UNION SELECT k FROM ord_agg
  UNION SELECT k FROM quo_agg
  UNION SELECT k FROM pour_agg
),

-- ── the catalogue, tokenized ONCE ──────────────────────────────────────────
-- MATERIALIZED deliberately: inlined, `beverage_tokenize` would be re-evaluated
-- inside the lateral for every (key, candidate) pair — 600 x 600 calls of a
-- function that does four regexp passes and an unnest.
cat AS MATERIALIZED (
  SELECT b.id,
         public.beverage_house_key(b.producer, b.name)                AS k,
         public.beverage_tokenize(concat_ws(' ', b.producer, b.name)) AS toks
  FROM public.beverages b
  WHERE b.deleted_at IS NULL AND b.superseded_by IS NULL
),

base AS MATERIALIZED (
  SELECT
    ky.k                                                       AS house_key,
    -- The longest name any of this house's own books uses. Longest rather than
    -- first because a till abbreviates ("LAG IPA") where an invoice does not.
    coalesce(m.label, i.label, o.label, q.label, po.label)     AS label,
    array_remove(ARRAY[
      CASE WHEN m.k  IS NOT NULL THEN 'menu'    END,
      CASE WHEN i.k  IS NOT NULL THEN 'invoice' END,
      CASE WHEN o.k  IS NOT NULL THEN 'order'   END,
      CASE WHEN q.k  IS NOT NULL THEN 'quote'   END,
      CASE WHEN po.k IS NOT NULL THEN 'pos'     END
    ], NULL)                                                   AS books,
    -- `infinity` is the sentinel for "this book has nothing", stripped straight
    -- back to NULL. A house with no dated book has no first sighting; it does
    -- not have one in the year 294276.
    nullif(least(
      coalesce(m.first_at,  'infinity'::timestamptz),
      coalesce(i.first_at,  'infinity'::timestamptz),
      coalesce(o.first_at,  'infinity'::timestamptz),
      coalesce(q.first_at,  'infinity'::timestamptz),
      coalesce(po.first_at, 'infinity'::timestamptz)
    ), 'infinity'::timestamptz)                                AS first_seen,
    coalesce(m.lines, 0)                                       AS menu_lines,
    m.bottle_price                                             AS menu_bottle_price,
    m.glass_price                                              AS menu_glass_price,
    m.sections                                                 AS menu_sections,
    coalesce(i.lines, 0)                                       AS invoice_lines,
    i.first_bought                                             AS first_bought,
    i.last_bought                                              AS last_bought,
    i.bottles                                                  AS bottles_bought,
    i.paid                                                     AS paid_total,
    i.last_unit_price                                          AS last_unit_price,
    i.last_from                                                AS last_bought_from,
    coalesce(o.lines, 0)                                       AS order_lines,
    o.last_at                                                  AS last_ordered_at,
    o.last_price                                               AS last_order_price,
    o.last_from                                                AS last_ordered_from,
    coalesce(q.n, 0)                                           AS quote_count,
    q.last_at                                                  AS last_quote_at,
    q.last_price                                               AS last_quote_price,
    q.last_source                                              AS last_quote_source,
    q.last_from                                                AS last_quote_from,
    coalesce(po.lines, 0)                                      AS pos_lines,
    po.qty                                                     AS poured_qty,
    po.revenue                                                 AS poured_revenue,
    po.first_at                                                AS first_poured,
    po.last_at                                                 AS last_poured
  FROM keys ky
  LEFT JOIN menu_agg m  ON m.k  = ky.k
  LEFT JOIN inv_agg  i  ON i.k  = ky.k
  LEFT JOIN ord_agg  o  ON o.k  = ky.k
  LEFT JOIN quo_agg  q  ON q.k  = ky.k
  LEFT JOIN pour_agg po ON po.k = ky.k
  WHERE ky.k IS NOT NULL
),

-- The house line's own tokens, computed once per product rather than once per
-- candidate. Same reason `cat` is materialized.
based AS MATERIALIZED (
  SELECT b.*, public.beverage_tokenize(b.label) AS toks FROM base b
)

SELECT
  b.house_key, b.label, b.books, b.first_seen,
  b.menu_lines, b.menu_bottle_price, b.menu_glass_price, b.menu_sections,
  b.invoice_lines, b.first_bought, b.last_bought, b.bottles_bought,
  b.paid_total, b.last_unit_price, b.last_bought_from,
  b.order_lines, b.last_ordered_at, b.last_order_price, b.last_ordered_from,
  b.quote_count, b.last_quote_at, b.last_quote_price, b.last_quote_source,
  b.last_quote_from,
  b.pos_lines, b.poured_qty, b.poured_revenue, b.first_poured, b.last_poured,
  m.id     AS beverage_id,
  m.method AS match_method
FROM based b
-- Exact first; then the most specific containment. There is no third tier: a
-- product that reaches neither keeps NULL and is shown as the house's own
-- record with no catalogue entry behind it.
LEFT JOIN LATERAL (
  SELECT c.id,
         CASE WHEN c.k = b.house_key THEN 'exact' ELSE 'contains' END AS method
  FROM cat c
  WHERE c.k = b.house_key
     OR (cardinality(c.toks) > 0 AND c.toks <@ b.toks)
  ORDER BY (c.k = b.house_key) DESC, cardinality(c.toks) DESC, c.id
  LIMIT 1
) m ON true
-- The richest record first: a bottle with an invoice, a quote and a sale behind
-- it is the one an operator opened this register to find.
ORDER BY (b.pos_lines + b.invoice_lines + b.order_lines
          + b.quote_count + b.menu_lines) DESC,
         b.label ASC
LIMIT greatest(p_limit, 1);
$function$;

COMMENT ON FUNCTION public.house_beverage_ledger IS
  'One row per product THIS restaurant''s own books name, assembled across '
  'menu_items, procurement_document_lines (invoices), procurement_order_items, '
  'vendor_price_observations and pos_unresolved_lines by beverage_house_key(). '
  'Carries first bought, paid, ordered, quoted and poured, plus the catalogue '
  'row it reaches (match_method exact|contains) or NULL. No quantity on hand: '
  'every stock path is keyed on master_wine_id, which is OD-113. service_role '
  'only — p_restaurant_id is a parameter, so EXECUTE is a tenancy boundary.';

-- ---------------------------------------------------------------------------
-- 3. Lock it down in the same migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.house_beverage_ledger(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_beverage_ledger(uuid, integer)
  TO service_role;

-- The key function is harmless on its own (it reads nothing) but there is no
-- reason for a browser role to hold it either.
REVOKE ALL ON FUNCTION public.beverage_house_key(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beverage_house_key(text, text)
  TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  k1 text;
  k2 text;
BEGIN
  IF to_regprocedure('public.beverage_house_key(text,text)') IS NULL THEN
    RAISE EXCEPTION 'beverage_house_key was not created';
  END IF;
  IF to_regprocedure('public.house_beverage_ledger(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'house_beverage_ledger was not created';
  END IF;

  -- The whole point of the coarser key, asserted rather than described: the
  -- same product recorded with the producer split out and recorded as one
  -- string must produce ONE key, or no cross-book record ever assembles.
  k1 := public.beverage_house_key('Lagunitas', 'IPA');
  k2 := public.beverage_house_key(NULL, 'Lagunitas IPA');
  IF k1 IS DISTINCT FROM k2 THEN
    RAISE EXCEPTION
      'beverage_house_key does not join the two ways a book records a producer: % vs %', k1, k2;
  END IF;

  -- And it must still discriminate. A key that collapsed everything would
  -- assemble a record out of unrelated products.
  IF public.beverage_house_key('Lagunitas', 'IPA')
     = public.beverage_house_key('Lagunitas', 'Pils') THEN
    RAISE EXCEPTION 'beverage_house_key does not discriminate between two products';
  END IF;

  -- Empty text is NULL, not the empty string: a row whose name tokenizes to
  -- nothing must not group with every other such row.
  IF public.beverage_house_key(NULL, '   ') IS NOT NULL THEN
    RAISE EXCEPTION 'beverage_house_key returned a groupable key for empty text';
  END IF;

  -- EXECUTE on the ledger is a tenancy boundary. If a browser role holds it,
  -- one house can read another's invoices by passing a different uuid.
  IF has_function_privilege('anon', 'public.house_beverage_ledger(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.house_beverage_ledger(uuid,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'house_beverage_ledger is executable by anon/authenticated — that is a cross-tenant read';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.house_beverage_ledger(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute house_beverage_ledger — the gateway would 500';
  END IF;

  RAISE NOTICE 'beverage_house_key + house_beverage_ledger created; key joins and discriminates; EXECUTE is service_role only.';
END
$$;
