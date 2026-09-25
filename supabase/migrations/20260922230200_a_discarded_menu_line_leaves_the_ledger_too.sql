-- house_beverage_ledger stops counting a discarded menu_items row —
-- ADR 0160 sec110 item 7 fix pass, 2026-09-18.
--
-- `getMenu` (menus.service.ts) already filters `status <> 'discarded'`, but
-- `house_beverage_ledger`'s `menu` CTE (20260903120000_the_house_s_own_record
-- .sql:163-171) reads every `menu_items` row for the restaurant with no status
-- filter at all — so a line a person discarded from /menu kept counting into
-- `menu_lines`/`menu_bottle_price`/`menu_glass_price`/`menu_sections` on
-- every register that reads this function
-- (`cellar-registers.service.ts:404`'s "on the list" book,
-- `beverages.service.ts:761`'s `readMenuLines`). Discard removes a line from
-- what guests see; it should remove it from what the ledger counts as
-- currently listed too.
--
-- Additive and idempotent: `CREATE OR REPLACE FUNCTION` with the exact same
-- signature and return shape, so this is a no-op to re-run and callers need
-- no change. The only line that differs from 20260903120000's body is the one
-- extra predicate on the `menu` CTE, marked below.
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
    -- ADDED 20260922230200: a discarded line is off the menu, not still on it.
    AND mi.status <> 'discarded'
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
  'The house''s own cross-book record for a non-wine product (menu, invoice, '
  'order, quote, pos), reconciled against the catalogue by house_key. '
  '20260922230200: the menu CTE excludes status = ''discarded'' rows.';
