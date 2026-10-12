-- the_ledger_reads_drink_lines_and_names_two_prices (ADR 0340 rule 25, the
-- menus build, lane 4: union readers read drink lines).
--
-- THE RULING. A house keeps one live menu per kind: Drinks, Food, Desserts
-- (founder answer S208, sim ledger; ADR 0340). Every drink reader selects lines
-- on menu_type first (any live menu), then lineIsDrink, so a dessert wine on
-- Desserts is read and a dish on Food is not; house_beverage_ledger counts a
-- product once and flags two prices instead of taking max() (ADR 0340 rule 25,
-- review R1.S10).
--
-- WHAT WAS WRONG. house_beverage_ledger's menu CTE (latest body:
-- the_cellar_counts_the_door_checked_price) read every non-discarded line of
-- every active menu. With a live Food menu beside Drinks, a dish became a
-- ledger row; with a wine on Drinks and on Desserts, menu_lines summed both
-- and max() hid the second price.
--
-- WHAT CHANGES, in the menu CTE and menu_agg only:
--   1. A line is read when line_kind = 'drink', or line_kind IS NULL on a menu
--      whose menu_type is not food or desserts. A 'dish' never is. This is
--      lineIsDrink without its last step (isKitchenLine's word lists stay in
--      the gateway; the ledger never applied them), so no line on a Drinks
--      menu that the ledger read before drops out.
--   2. menu_sections reads the house's own section title (menu_sections.title,
--      same menu, same house) before menu_items.category.
--   3. menu_lines is the line count on the live menu that lists the product
--      most, not the sum across menus. One live menu reads as before.
--   4. menu_bottle_price / menu_glass_price are the single distinct price the
--      live lines give, NULL when they give two or more; the new column
--      menu_price_conflict (appended, the 35th) is true then.
-- The inner join on restaurant_menus rm (status 'active') stays
-- (CELLAR-MENU-READERS-READ-THE-CURRENT-MENU). The ORDER BY is unchanged.
--
-- The return shape grows, which CREATE OR REPLACE cannot do, so the ledger is
-- dropped and created in this one transaction, and its COMMENT and grants are
-- applied again. The body is the_cellar_counts_the_door_checked_price's
-- verbatim except the lines marked CHANGED or ADDED
-- the_ledger_reads_drink_lines_and_names_two_prices. No applied migration is
-- edited. Reads only; this migration changes no row.

DROP FUNCTION public.house_beverage_ledger(uuid, integer);

CREATE FUNCTION public.house_beverage_ledger(
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
  match_method        text,
  -- ADDED the_cellar_counts_the_door_checked_price (ADR 0301 §2), appended so
  -- the first 31 columns keep their names, types and places.
  door_checked_lines        integer,
  first_bought_door_checked boolean,
  last_bought_door_checked  boolean,
  -- ADDED the_ledger_reads_drink_lines_and_names_two_prices (ADR 0340 rule
  -- 25), appended so the first 34 columns keep their names, types and places.
  menu_price_conflict       boolean
)
LANGUAGE sql
STABLE
AS $function$
WITH
-- ── the five books, each keyed the same way ────────────────────────────────
menu AS (
  SELECT public.beverage_house_key(mi.producer, mi.name) AS k,
         concat_ws(' ', mi.producer, mi.name)            AS label,
         -- CHANGED the_ledger_reads_drink_lines_and_names_two_prices: the
         -- house's own section title (menu_sections, ADR 0340 rule 6) when
         -- the line sits in one, else the category text as before.
         coalesce(nullif(btrim(ms.title), ''), mi.category) AS section,
         mi.menu_id,
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
  -- ADDED the_ledger_reads_drink_lines_and_names_two_prices: the line's
  -- section, on the same menu of the same house.
  LEFT JOIN public.menu_sections ms
    ON ms.id = mi.section_id
   AND ms.menu_id = mi.menu_id
   AND ms.restaurant_id = p_restaurant_id
  WHERE mi.restaurant_id = p_restaurant_id
    AND btrim(coalesce(mi.name, '')) <> ''
    -- ADDED a_discarded_menu_line_leaves_the_ledger_too: a discarded line is
    -- off the menu, not still on it.
    AND mi.status <> 'discarded'
    -- ADDED the_ledger_reads_drink_lines_and_names_two_prices (ADR 0340 rule
    -- 25): only a DRINK line, on any live menu (menu_type first). A line
    -- stored as a drink is one wherever it sits (a dessert wine on Desserts);
    -- a line stored as a dish never is; a line with no stored kind is one
    -- unless its menu is Food or Desserts. That is lineIsDrink without its
    -- last step: isKitchenLine's word lists live in the gateway, and the
    -- ledger never applied them, so no Drinks line drops out here.
    AND (mi.line_kind = 'drink'
         OR (mi.line_kind IS NULL
             AND (rm.menu_type IS NULL OR rm.menu_type NOT IN ('food', 'desserts'))))
),
-- Invoices. A purchase order is what we asked for; an invoice is what we were
-- charged. CHANGED the_cellar_counts_the_door_checked_price (ADR 0301 §2): the
-- door check, where a person checked the bill against the delivery, is the
-- other record of a charge. It joins below as `door`, labelled, and an
-- invoice linked to the order, or paired with its line, takes over from it;
-- one filed but neither linked nor paired counts alongside it (ADR 0301,
-- Harder / given up, 2026-10-07).
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
-- ADDED the_cellar_counts_the_door_checked_price (ADR 0301 §2): each
-- door-checked order no linked or paired invoice covers, at its checked price and its
-- accepted bottles. Keyed exactly as the order book keys the same line, so it
-- never makes a key the order book does not already make.
door AS (
  SELECT dc.house_key AS k, dc.door_checked_on, dc.unit_price, dc.paid,
         dc.bottles, dc.provider_name
  FROM public.house_door_checked(p_restaurant_id) dc
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
         max(t.sold_at)                                       AS last_at
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
-- [CHANGED 2026-10-05: these names are now the only way a till name that no
-- other book names becomes a row. The first build also admitted a name when a
-- line of it was flagged is_wine; that is dropped (the header, item 3).]
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
         (q.item_name IS NOT NULL)                    AS admit
  FROM till t
  LEFT JOIN queued q ON q.item_name = t.item_name
),

-- ── per-book aggregates ────────────────────────────────────────────────────
-- CHANGED the_ledger_reads_drink_lines_and_names_two_prices (ADR 0340 rule
-- 25). A product is counted once: `lines` is its line count on the live menu
-- that lists it most, not the sum over menus, so a wine on Drinks and on
-- Desserts is 1, and a house with one live menu reads as before. Two prices
-- are named, not maxed: a price is the one distinct price the live lines give
-- it, NULL when they give two or more, and `price_conflict` says so.
menu_per_menu AS (
  SELECT k, menu_id, count(*) AS n
  FROM menu WHERE k IS NOT NULL GROUP BY k, menu_id
),
menu_grouped AS (
  SELECT k,
         array_agg(DISTINCT bottle_price)
           FILTER (WHERE bottle_price IS NOT NULL)         AS bottles,
         array_agg(DISTINCT by_glass_price)
           FILTER (WHERE by_glass_price IS NOT NULL)       AS glasses,
         array_remove(array_agg(DISTINCT section), NULL)   AS sections,
         min(created_at)                                   AS first_at,
         (array_agg(label ORDER BY length(label) DESC))[1] AS label
  FROM menu WHERE k IS NOT NULL GROUP BY k
),
menu_agg AS (
  SELECT g.k,
         (SELECT max(p.n) FROM menu_per_menu p WHERE p.k = g.k)::integer AS lines,
         CASE WHEN cardinality(g.bottles) = 1 THEN g.bottles[1] END     AS bottle_price,
         CASE WHEN cardinality(g.glasses) = 1 THEN g.glasses[1] END     AS glass_price,
         (coalesce(cardinality(g.bottles), 0) > 1
          OR coalesce(cardinality(g.glasses), 0) > 1)                  AS price_conflict,
         g.sections,
         g.first_at,
         g.label
  FROM menu_grouped g
),
-- CHANGED the_cellar_counts_the_door_checked_price (ADR 0301 §2): bought is
-- the invoice lines plus the door rows. `lines` stays the invoice count, so the
-- 'invoice' book and invoice_lines mean what they meant; the door rows are
-- counted apart, and a first or last date a door row gave is marked. Labels
-- and first sightings still come from invoice lines alone.
bought AS (
  SELECT k, label, doc_date AS bought_on, unit_price,
         coalesce(line_total, unit_price * qty_bottles) AS paid,
         qty_bottles AS bottles, provider_name, created_at, false AS door
  FROM inv
  UNION ALL
  SELECT k, NULL, door_checked_on, unit_price, paid, bottles, provider_name,
         NULL, true
  FROM door
),
bought_agg AS (
  SELECT k,
         (count(*) FILTER (WHERE NOT door))::integer                            AS lines,
         (count(*) FILTER (WHERE door))::integer                                AS door_lines,
         min(bought_on)                                                         AS first_bought,
         max(bought_on)                                                         AS last_bought,
         sum(coalesce(bottles, 0))                                              AS bottles,
         sum(coalesce(paid, 0))                                                 AS paid,
         (array_agg(unit_price    ORDER BY bought_on DESC NULLS LAST, door))[1] AS last_unit_price,
         (array_agg(provider_name ORDER BY bought_on DESC NULLS LAST, door))[1] AS last_from,
         -- Whether the first and the last date came from a door row. On the
         -- same day an invoice line wins (false sorts first): paper outranks
         -- the door.
         ((array_agg(door ORDER BY bought_on ASC  NULLS LAST, door))[1]
           AND min(bought_on) IS NOT NULL)                                      AS first_door,
         ((array_agg(door ORDER BY bought_on DESC NULLS LAST, door))[1]
           AND max(bought_on) IS NOT NULL)                                      AS last_door,
         min(created_at)                                                        AS first_at,
         (array_agg(label ORDER BY length(label) DESC)
            FILTER (WHERE NOT door))[1]                                         AS label
  FROM bought WHERE k IS NOT NULL GROUP BY k
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
  -- A door row's key is its order line's key, already in ord_agg; so this
  -- line adds exactly the keys it added before.
  UNION SELECT k FROM bought_agg
  UNION SELECT k FROM ord_agg
  UNION SELECT k FROM quo_agg
  -- CHANGED the_cellar_reads_the_tills_own_record: a name only the till
  -- knows is a row when the queue ever held it, resolved or not (main's pour
  -- read the open queue alone; nothing in the code sets `resolved`), and only
  -- while `till` holds a line of that exact name (`pour` starts from `till`;
  -- T2). A key the other books name gets the till lines
  -- of the same key below either way. [CHANGED 2026-10-05: no longer also
  -- when a line of it is flagged is_wine; the header, item 3.]
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
      -- CHANGED the_cellar_counts_the_door_checked_price: the invoice book
      -- names a product only when an invoice line does; a door check alone
      -- is not an invoice.
      CASE WHEN i.lines > 0      THEN 'invoice' END,
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
    coalesce(i.door_lines, 0)                                  AS door_checked_lines,
    coalesce(i.first_door, false)                              AS first_bought_door_checked,
    coalesce(i.last_door, false)                               AS last_bought_door_checked,
    coalesce(m.price_conflict, false)                          AS menu_price_conflict,
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
  LEFT JOIN bought_agg i ON i.k = ky.k
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
  m.method AS match_method,
  b.door_checked_lines, b.first_bought_door_checked, b.last_bought_door_checked,
  b.menu_price_conflict
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
-- CHANGED the_cellar_counts_the_door_checked_price (ADR 0301 §2): a row with
-- at least one door row adds 1, however many it has, the founder's pick of
-- 2026-10-07, "Count it as a book (Recommended)": one book, as the register's
-- books sort counts it. The other terms still count lines. It moves only a
-- row's place (and so which rows p_limit keeps), never a figure.
ORDER BY (b.pos_lines + b.invoice_lines
          + (CASE WHEN b.door_checked_lines > 0 THEN 1 ELSE 0 END)
          + b.order_lines + b.quote_count + b.menu_lines) DESC,
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
  'behind them, summed by house_key; a name only the till knows is a row '
  'when the queue ever held it (ADR 0301). '
  'Bought is the invoice lines plus house_door_checked, the door-checked '
  'orders no linked or paired invoice covers, at the checked price times the accepted '
  'bottles; invoice_lines and the invoice book count invoice lines only, and '
  'door_checked_lines, first_bought_door_checked and last_bought_door_checked '
  'say what came from the door (ADR 0301 §2). '
  'The menu book reads DRINK lines only, on any live menu: line_kind drink, '
  'or no stored kind on a menu that is not food or desserts; menu_lines is '
  'the count on the live menu that lists it most (a product counted once); '
  'menu_bottle_price and menu_glass_price are NULL when the live lines give '
  'two or more, and menu_price_conflict says so; menu_sections reads the '
  'house''s section title (menu_sections) before category (ADR 0340 rule 25). '
  'service_role only.';

REVOKE ALL ON FUNCTION public.house_beverage_ledger(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_beverage_ledger(uuid, integer)
  TO service_role;
