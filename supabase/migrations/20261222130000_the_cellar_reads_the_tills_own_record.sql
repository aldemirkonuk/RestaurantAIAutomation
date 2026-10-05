-- /cellar's Sold and Taken read the till's own record, not the open
-- unresolved-lines queue. 2026-10-03 analytics walk, AW10 (A-015, A-016);
-- ADR 0301 §1.
--
-- WHAT WAS WRONG. `pos_checks.items` keeps every line the till rang, with its
-- qty, unit price, is_wine and inventory_id (PosHubService.ingest). The
-- ledger's `pour` CTE (latest definition: the_ledger_lists_only_the_current_menu)
-- read only `pos_unresolved_lines WHERE resolved = false`: the review queue of
-- lines the bridge could not map. A mapped line never enters that queue, and
-- pos-hub skips every `!is_wine` line before it (only the Toast direct path
-- queues a non-wine line, and only an unmapped one).
-- [CORRECTED 2026-10-05: too broad. The queue also holds mapped lines the
-- bridge could not book against this house's stock. pos-hub queues a mapped
-- wine line whose mapping names another house's item, or whose read of the
-- house's items failed, and one whose sale volume does not resolve (reason
-- no_sale_volume) (PosHubService.applyStockEffects). A mapped line whose
-- sale volume resolves against this house's own item never enters it. The
-- Toast direct path queues a line, wine or not, that nothing maps, and also
-- one whose mapping names another house's item (ToastService
-- .applyOrderSaleEffects). house_till_lines reads a queued line from the
-- queue only when no check is behind it; when its check exists, the check's
-- own lines stand for it, and a voided check's lines count as nothing.]
-- So a mapped Yeni Rakı
-- (436 singles and 67 bottles rung in Jul-Aug) read "the till never rang it",
-- and the six non-wine registers read Sold and Taken blank on every row:
-- about 2,152 cocktails (about $36.8K) and about 1,090 soft drinks.
--
-- WHAT THIS DOES.
--   1. public.house_till_lines(p_restaurant_id, p_names) is the till's own
--      record, one row per line: every item of every pos_checks row that is
--      not voided, plus the pos_unresolved_lines rows that have NO check
--      behind them (an orphan, e.g. the Toast direct path, which queues a line
--      without writing pos_checks). A queue line whose check exists is
--      already counted from the check, and a voided check's queue line goes
--      with its check. `p_names` narrows it to exact (btrim) names; the
--      cellar's row record uses it after matching names in the gateway.
--   2. public.house_till_names(p_restaurant_id) lists the distinct names the
--      till has rung, with how many lines each.
--   3. house_beverage_ledger's `pour` CTE reads house_till_lines, grouped by
--      name first so beverage_house_key runs once per distinct name, not once
--      per line. A till name that no other book names becomes a ledger row
--      only when a line of it is flagged is_wine, or the queue ever held it
--      (so every name that was a row before stays one). Food the house never
--      queued stays out, which keeps today's boundary (ADR 0115 and OD-113 own
--      food). A product any other book already names attaches its till lines
--      either way, which is how a cocktail or a cola on the menu gets its
--      Sold and Taken.
--      [CORRECTED 2026-10-05: "every name that was a row before stays one"
--      was too broad. A name the open queue held, and no other book names,
--      stays a row only while house_till_lines still holds a line of it: a
--      line on a check that is not voided, or a queued line with no check
--      behind it (an orphan). A name whose every line sat on voided checks
--      leaves with them, because a voided check is not a sale (ADR 0301 §1,
--      "Stated behaviours"; this migration's test, T2).]
--
-- The ledger's signature and return shape do not change: CREATE OR REPLACE,
-- so its grants stay as they are and callers need no change. Its body is the
-- cellar lane's (the_ledger_lists_only_the_current_menu) verbatim, menu CTE
-- included, except the `pour` section and the `keys` line marked CHANGED
-- below, and the COMMENT. [CORRECTED 2026-10-05: and the `pour_agg` columns,
-- now marked CHANGED below as well.] No applied migration is edited. Reads
-- only; this migration changes no row.

-- ---------------------------------------------------------------------------
-- 1. The till's own record, one row per line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_till_lines(
  p_restaurant_id uuid,
  p_names         text[] DEFAULT NULL
)
RETURNS TABLE (
  id                text,
  item_name         text,
  qty               numeric,
  price             numeric,
  sold_at           timestamptz,
  is_wine           boolean,
  from_queue        boolean,
  source            text,
  external_check_id text
)
LANGUAGE sql
STABLE
AS $function$
  -- Every line of every check that was not voided. `price` is a unit price
  -- (pos-types.ts CanonicalItem.price). A qty or price that is not a number
  -- is NULL, never a cast error that would take the whole ledger down. The
  -- line is dated when its check closed, else when it opened, the rule the
  -- other check readers use (goals.service.ts, insight-generator.service.ts).
  SELECT c.id::text || ':' || li.n                          AS id,
         btrim(li.item->>'name')                            AS item_name,
         CASE jsonb_typeof(li.item->'qty')
           WHEN 'number' THEN (li.item->>'qty')::numeric
           WHEN 'string' THEN CASE
             WHEN btrim(li.item->>'qty') ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN btrim(li.item->>'qty')::numeric END
         END                                                AS qty,
         CASE jsonb_typeof(li.item->'price')
           WHEN 'number' THEN (li.item->>'price')::numeric
           WHEN 'string' THEN CASE
             WHEN btrim(li.item->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN btrim(li.item->>'price')::numeric END
         END                                                AS price,
         coalesce(c.closed_at, c.opened_at)                 AS sold_at,
         coalesce(li.item->'is_wine' = 'true'::jsonb, false) AS is_wine,
         false                                              AS from_queue,
         c.source                                           AS source,
         c.external_check_id                                AS external_check_id
  FROM public.pos_checks c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.items) = 'array' THEN c.items ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS li(item, n)
  WHERE c.restaurant_id = p_restaurant_id
    AND NOT c.voided
    AND jsonb_typeof(li.item) = 'object'
    AND btrim(coalesce(li.item->>'name', '')) <> ''
    AND (p_names IS NULL OR btrim(li.item->>'name') = ANY (p_names))

  UNION ALL

  -- The queue lines with no check behind them, resolved or not. Matched on
  -- the check's own unique key (uq_pos_checks_source_check: restaurant_id,
  -- source, external_check_id), so the anti-join is one index probe a line.
  -- The queue does not record is_wine; `from_queue` says where it came from.
  SELECT 'q:' || u.id::text                                 AS id,
         btrim(u.item_name)                                 AS item_name,
         u.qty                                              AS qty,
         u.price                                            AS price,
         u.created_at                                       AS sold_at,
         NULL::boolean                                      AS is_wine,
         true                                               AS from_queue,
         u.source                                           AS source,
         u.external_check_id                                AS external_check_id
  FROM public.pos_unresolved_lines u
  WHERE u.restaurant_id = p_restaurant_id
    AND btrim(coalesce(u.item_name, '')) <> ''
    AND (p_names IS NULL OR btrim(u.item_name) = ANY (p_names))
    AND NOT EXISTS (
      SELECT 1
      FROM public.pos_checks c
      WHERE c.restaurant_id = u.restaurant_id
        AND c.source = u.source
        AND c.external_check_id = u.external_check_id
    )
$function$;

COMMENT ON FUNCTION public.house_till_lines(uuid, text[]) IS
  'The till''s own record for one house, one row per line: every item of '
  'every pos_checks row that is not voided, plus the pos_unresolved_lines '
  'rows with no pos_checks row behind them on (restaurant_id, source, '
  'external_check_id). p_names narrows it to exact btrim names. `id` is '
  'unique per line (check id:ordinal, or q:queue id), for keyset paging. '
  'Reads only. service_role only: p_restaurant_id is a parameter, so EXECUTE '
  'is a tenancy boundary (ADR 0301).';

REVOKE ALL ON FUNCTION public.house_till_lines(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_till_lines(uuid, text[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The names the till has rung, so a reader can match names before it reads
--    lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_till_names(
  p_restaurant_id uuid
)
RETURNS TABLE (
  item_name text,
  lines     bigint
)
LANGUAGE sql
STABLE
AS $function$
  SELECT t.item_name, count(*) AS lines
  FROM public.house_till_lines(p_restaurant_id) t
  GROUP BY t.item_name
$function$;

COMMENT ON FUNCTION public.house_till_names(uuid) IS
  'The distinct names in house_till_lines for one house, with how many lines '
  'each. Reads only. service_role only, for the same reason as '
  'house_till_lines (ADR 0301).';

REVOKE ALL ON FUNCTION public.house_till_names(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_till_names(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The ledger's pour reads the till's own record.
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
  -- ADDED the_ledger_lists_only_the_current_menu: only a line on a CURRENT
  -- menu is on the menu (ADR 0193: status 'active'). A draft was read and
  -- never chosen; an archived menu was current once. Several active menus
  -- are read as one union, as every other current-menu reader does.
  JOIN public.restaurant_menus rm
    ON rm.id = mi.menu_id
   AND rm.restaurant_id = p_restaurant_id
   AND rm.status = 'active'
  WHERE mi.restaurant_id = p_restaurant_id
    AND btrim(coalesce(mi.name, '')) <> ''
    -- ADDED a_discarded_menu_line_leaves_the_ledger_too: a discarded line is
    -- off the menu, not still on it.
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
-- CHANGED the_cellar_reads_the_tills_own_record (ADR 0301 §1): what was
-- actually sold is the till's own record, house_till_lines: every line of
-- every check not voided, plus the queue lines with no check behind them. It
-- used to be the open unresolved-lines queue alone, which holds only the wine
-- lines the bridge could not map, so a mapped rakı and every non-wine sale
-- never reached Sold or Taken.
-- [CORRECTED 2026-10-05: too broad, as the header's correction says: the queue
-- also holds mapped wine lines pos-hub could not book, and the Toast direct
-- path's lines, wine or not, that nothing maps or whose mapping names another
-- house's item. What never reached Sold or Taken was a mapped line whose sale
-- volume resolved against this house's own item, like the rakı, and every
-- non-wine line on the pos-hub path, which skips them before the queue.]
-- Grouped by name first, so beverage_house_key
-- runs once per distinct name rather than once per line.
till AS MATERIALIZED (
  SELECT t.item_name,
         count(*)::integer                                    AS lines,
         sum(coalesce(t.qty, 0))                              AS qty,
         sum(coalesce(t.price, 0) * coalesce(t.qty, 1))       AS revenue,
         min(t.sold_at)                                       AS first_at,
         max(t.sold_at)                                       AS last_at,
         bool_or(coalesce(t.is_wine, false) OR t.from_queue)  AS admit
  FROM public.house_till_lines(p_restaurant_id) t
  GROUP BY t.item_name
),
-- Every name the queue has ever held, resolved or not. The old pour read only
-- the queue, so each of these names was a row before this migration and stays
-- one. pos-hub queues wine lines only; the Toast direct path queues every line
-- it cannot map.
-- [CORRECTED 2026-10-05: too broad three times. The old pour read only the
-- OPEN queue (resolved = false), so a name only resolved lines held was not a
-- row before. And `pour` below starts from `till` and only joins these names
-- to it, so a queued name is admitted only while house_till_lines still holds
-- a line of it; a name whose every line sat on voided checks has none there,
-- and leaves with them. And the Toast direct path queues a line that has a
-- menu guid and a quantity above 0 when nothing maps it or its mapping names
-- another house's item; a line without a guid or a quantity it skips.]
queued AS (
  SELECT DISTINCT btrim(u.item_name) AS item_name
  FROM public.pos_unresolved_lines u
  WHERE u.restaurant_id = p_restaurant_id
    AND btrim(coalesce(u.item_name, '')) <> ''
),
pour AS (
  SELECT public.beverage_house_key(NULL, t.item_name) AS k,
         t.item_name                                  AS label,
         t.lines, t.qty, t.revenue, t.first_at, t.last_at,
         (t.admit OR q.item_name IS NOT NULL)         AS admit
  FROM till t
  LEFT JOIN queued q ON q.item_name = t.item_name
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
-- CHANGED the_cellar_reads_the_tills_own_record (ADR 0301 §1): `pour` now
-- arrives one row per till name, already summed in `till`, so these columns
-- sum and bound those per-name fields (lines, qty, revenue, first_at,
-- last_at) where they used to count and date raw queue lines (count(*),
-- created_at). Sold and Taken keep the old per-line rules, applied in `till`.
-- bool_or(admit) is new, and feeds the keys line below.
pour_agg AS (
  SELECT k,
         sum(lines)::integer                                AS lines,
         sum(qty)                                           AS qty,
         sum(revenue)                                       AS revenue,
         min(first_at)                                      AS first_at,
         max(last_at)                                       AS last_at,
         (array_agg(label ORDER BY length(label) DESC))[1]  AS label,
         bool_or(admit)                                     AS admit
  FROM pour WHERE k IS NOT NULL GROUP BY k
),

-- ── every product this house's own books name ───────────────────────────────
keys AS (
  SELECT k FROM menu_agg
  UNION SELECT k FROM inv_agg
  UNION SELECT k FROM ord_agg
  UNION SELECT k FROM quo_agg
  -- CHANGED the_cellar_reads_the_tills_own_record: a name only the till
  -- knows is a row when a line of it is flagged is_wine or the queue ever
  -- held it. A key the other books name attaches its till lines below either
  -- way.
  UNION SELECT k FROM pour_agg WHERE admit
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
  'The menu CTE reads only lines on a current menu (restaurant_menus.status '
  '= ''active'', ADR 0193) and excludes status = ''discarded'' lines. '
  'The pos book is the till''s own record, house_till_lines: every line of '
  'every pos_checks row not voided, plus pos_unresolved_lines with no check '
  'behind them; a name only the till knows is a row when a line of it is '
  'flagged is_wine or the queue ever held it (ADR 0301).';
