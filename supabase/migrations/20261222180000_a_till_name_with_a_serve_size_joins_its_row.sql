-- A till name with a serve size in it joins the row it names, and /cellar's
-- Sold says how many were bottles and how many were glasses. ADR 0301, the
-- founder's ruling of 2026-10-05 on its "Fork deferred".
--
-- WHAT WAS WRONG. Tuzlu Rüzgar's till adds a serve size to the menu's name:
-- 'Yeni Rakı (single 50ml)', 'Yeni Rakı 70cl bottle', 'Efes Pilsen (draft
-- 400ml)', 'Fords Gin (50ml)', 'Kavaklıdere Lâl Rosé (glass)'. The ledger
-- joined a till name to a row only when their beverage_house_keys were equal
-- (migration the_cellar_reads_the_tills_own_record), so every such name keyed
-- apart from its row: on the sim's feed every rakı, spirit, draft-beer and
-- wine line reached no Sold or Taken cell. And a row that did get lines summed
-- singles, bottles and glasses into one count.
--
-- THE RULING (AskUserQuestion, 2026-10-05 ~23:07Z), verbatim: "Join by
-- contained name, split Sold (Recommended)". Its option text: "A till name
-- joins the most specific row whose words it contains (a tie joins none).
-- Sold is split into bottles and pours by the till's sale unit; Taken is
-- summed. Fills rakı, spirits, draft beer and most wine on the sim feed.
-- Risk: a cocktail named after a spirit with no row of its own joins that
-- spirit." His earlier units pick (2026-10-04): "Bottles · glasses
-- (Recommended)".
--
-- WHAT THIS DOES.
--   1. house_till_lines gains `sold_as`: what one of the line is, 'bottle',
--      'glass', or NULL (unit unknown), by the order ADR 0011 locks for the
--      POS bridge (PosHubService resolveSaleVolume): the line's
--      sale_volume_ml first, then its sale_unit with this house's inventory
--      row, else unknown. A line that names no inventory item of this house
--      (unmapped, another house's item, or a queue line) is unknown, as the
--      bridge books it nowhere. The return type grows, so it is dropped and
--      created again, with its grants.
--   2. house_beverage_ledger joins each till name to ONE row:
--        - "words" are the distinct tokens of the name's beverage_house_key,
--          the one normalisation every book's key already went through;
--        - the row whose key equals the name's key (exact) wins;
--        - else the row, among those whose every word the name holds, with
--          the most distinct words (contains);
--        - rows level at the top tie, and the name joins none of them; each
--          tied row counts the name's lines in `tied_lines`;
--        - a name that joins no row (it holds no row's words, or it ties) is
--          a row of its own only when the queue ever held it, as before.
--      The rows are the keys the menu, invoice, order and quote books name.
--      The join runs once per distinct till name, on the words a name and a
--      row share (an equi-join on the word), never every name against every
--      row.
--   3. The ledger's Sold is split into poured_bottles, poured_glasses and
--      poured_unit_unknown, which sum to poured_qty. Taken is summed as
--      before. It also returns tied_lines, and till_names: the till names
--      counted on the row, with how each joined.
--   4. house_till_names(p_restaurant_id, p_label) (a new overload) lists the
--      till names the ledger counts on the row whose key is p_label's key, so
--      the row record's till book and the Sold cell use one rule, this one.
--      house_till_names(p_restaurant_id) is unchanged.
--
-- The ledger's signature does not change; its return shape grows by five
-- columns at the end, so it is dropped and created again, with its grants.
-- Its body is migration the_cellar_reads_the_tills_own_record's verbatim,
-- the menu CTE included, except where marked CHANGED or ADDED below. No
-- applied migration is edited. Reads only; this migration changes no row.

-- ---------------------------------------------------------------------------
-- 1. The till's own record, one row per line, now with what one of it is.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.house_till_lines(uuid, text[]);

CREATE FUNCTION public.house_till_lines(
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
  external_check_id text,
  -- ADDED a_till_name_with_a_serve_size_joins_its_row: 'bottle', 'glass',
  -- or NULL (unit unknown).
  sold_as           text
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
         c.external_check_id                                AS external_check_id,
         -- ADDED a_till_name_with_a_serve_size_joins_its_row: what one of
         -- this line is, in ADR 0011's order (PosHubService resolveSaleVolume).
         -- Only a line that names an inventory item of THIS house resolves,
         -- as only such a line moves stock (PosHubService applyStockEffects).
         -- 1. A sale volume, when the line has one, outranks the label: under
         --    10 ml, or over the item's bottle (750 ml when it has none), is
         --    unknown; exactly the item's bottle is a bottle; else a glass.
         --    A volume that is not a number is unknown.
         -- 2. Else the label: 'bottle' is a bottle; 'glass' is a glass when
         --    the item has a pour size, else unknown.
         -- 3. Else unknown.
         -- The sizes are the item's as they are now, not as they were at the
         -- sale. A line flagged not wine still gets its unit: the unit is a
         -- fact about the sale, whether or not stock moved.
         CASE
           WHEN ri.id IS NULL THEN NULL
           WHEN s.has_ml THEN CASE
             WHEN s.ml IS NULL OR s.ml < 10 THEN NULL
             WHEN s.ml > coalesce(CASE WHEN ri.bottle_size_ml > 0 THEN ri.bottle_size_ml END, 750) THEN NULL
             WHEN ri.bottle_size_ml > 0 AND s.ml = ri.bottle_size_ml THEN 'bottle'
             ELSE 'glass'
           END
           WHEN s.unit = 'bottle' THEN 'bottle'
           WHEN s.unit = 'glass'
                AND ri.pour_size_ml > 0 AND ri.pour_size_ml < 'Infinity'::double precision THEN 'glass'
         END                                                AS sold_as
  FROM public.pos_checks c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.items) = 'array' THEN c.items ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS li(item, n)
  -- ADDED a_till_name_with_a_serve_size_joins_its_row: the line's sale
  -- volume and label, each read so that a malformed value is an unknown
  -- unit, never a cast error. They are read only for a line that found its
  -- inventory item (the CASE above stops first at `ri.id IS NULL`).
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_typeof(li.item->'sale_volume_ml'), 'null') <> 'null' AS has_ml,
           CASE jsonb_typeof(li.item->'sale_volume_ml')
             WHEN 'number' THEN (li.item->>'sale_volume_ml')::numeric
             WHEN 'string' THEN CASE
               WHEN btrim(li.item->>'sale_volume_ml') ~ '^-?[0-9]+(\.[0-9]+)?$'
               THEN btrim(li.item->>'sale_volume_ml')::numeric END
           END                                                                   AS ml,
           CASE WHEN jsonb_typeof(li.item->'sale_unit') = 'string'
                THEN lower(btrim(li.item->>'sale_unit')) END                     AS unit
  ) AS s
  -- The line's inventory item, when it is this house's. Joined on the id's
  -- text, as the bridge looks it up (PosHubService.applyStockEffects keys its
  -- map by the row's id and asks it for the line's inventory_id as sent), so
  -- an inventory_id that is not the item's id as Postgres writes it finds
  -- nothing rather than failing a cast, and the probe is one hash lookup a
  -- line.
  LEFT JOIN public.restaurant_inventory ri
    ON ri.id::text = li.item->>'inventory_id'
   AND ri.restaurant_id = c.restaurant_id
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
  -- ADDED a_till_name_with_a_serve_size_joins_its_row: nor a sale unit or
  -- volume, so its unit is unknown.
  SELECT 'q:' || u.id::text                                 AS id,
         btrim(u.item_name)                                 AS item_name,
         u.qty                                              AS qty,
         u.price                                            AS price,
         u.created_at                                       AS sold_at,
         NULL::boolean                                      AS is_wine,
         true                                               AS from_queue,
         u.source                                           AS source,
         u.external_check_id                                AS external_check_id,
         NULL::text                                         AS sold_as
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
  '`sold_as` is what one of the line is, bottle or glass, by ADR 0011''s '
  'order against this house''s own inventory item, else NULL (unit unknown). '
  'Reads only. service_role only: p_restaurant_id is a parameter, so EXECUTE '
  'is a tenancy boundary (ADR 0301).';

REVOKE ALL ON FUNCTION public.house_till_lines(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_till_lines(uuid, text[])
  TO service_role;

-- house_till_names(p_restaurant_id) is unchanged; it reads house_till_lines
-- by name, so it needs no new body. Its grants are restated beside the
-- function it reads.
REVOKE ALL ON FUNCTION public.house_till_names(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_till_names(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The ledger joins each till name to the row it names, and splits Sold.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.house_beverage_ledger(uuid, integer);

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
  -- ADDED a_till_name_with_a_serve_size_joins_its_row (ADR 0301, the
  -- 2026-10-05 ruling): Sold split by what one of each line is. The three sum
  -- to poured_qty.
  poured_bottles      numeric,
  poured_glasses      numeric,
  poured_unit_unknown numeric,
  -- The lines of till names that hold this row's words and another row's
  -- equally (a tie): counted on neither.
  tied_lines          integer,
  -- The till names counted on this row: [{item_name, lines, how}], how being
  -- 'exact' or 'contains'.
  till_names          jsonb
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
-- every check not voided, plus the queue lines with no check behind them.
-- Grouped by name first, so beverage_house_key runs once per distinct name
-- rather than once per line.
-- CHANGED a_till_name_with_a_serve_size_joins_its_row (ADR 0301, the
-- 2026-10-05 ruling): Sold is also summed per unit (house_till_lines
-- `sold_as`), with the same coalesce(qty, 0) as Sold, so the three parts
-- always add up to it.
till AS MATERIALIZED (
  SELECT t.item_name,
         count(*)::integer                                    AS lines,
         sum(coalesce(t.qty, 0))                              AS qty,
         coalesce(sum(coalesce(t.qty, 0)) FILTER (WHERE t.sold_as = 'bottle'), 0) AS bottles,
         coalesce(sum(coalesce(t.qty, 0)) FILTER (WHERE t.sold_as = 'glass'), 0)  AS glasses,
         coalesce(sum(coalesce(t.qty, 0)) FILTER (WHERE t.sold_as IS NULL), 0)    AS unit_unknown,
         sum(coalesce(t.price, 0) * coalesce(t.qty, 1))       AS revenue,
         min(t.sold_at)                                       AS first_at,
         max(t.sold_at)                                       AS last_at
  FROM public.house_till_lines(p_restaurant_id) t
  GROUP BY t.item_name
),
-- Every name the queue has ever held, resolved or not: the names that may
-- be a row of their own when they join no other book's row.
queued AS (
  SELECT DISTINCT btrim(u.item_name) AS item_name
  FROM public.pos_unresolved_lines u
  WHERE u.restaurant_id = p_restaurant_id
    AND btrim(coalesce(u.item_name, '')) <> ''
),
-- CHANGED a_till_name_with_a_serve_size_joins_its_row: carries the per-unit
-- sums, and is MATERIALIZED because the join below reads it four times.
pour AS MATERIALIZED (
  SELECT public.beverage_house_key(NULL, t.item_name) AS k,
         t.item_name                                  AS label,
         t.lines, t.qty, t.bottles, t.glasses, t.unit_unknown,
         t.revenue, t.first_at, t.last_at,
         (q.item_name IS NOT NULL)                    AS admit
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

-- ── ADDED a_till_name_with_a_serve_size_joins_its_row: the row each till
--    name joins (ADR 0301, the 2026-10-05 ruling) ───────────────────────────
-- The rows a till name can join: the keys the four other books name.
book AS (
  SELECT k FROM menu_agg
  UNION SELECT k FROM inv_agg
  UNION SELECT k FROM ord_agg
  UNION SELECT k FROM quo_agg
),
-- A key's words are the distinct tokens of its beverage_house_key: the
-- normalisation every book's key already went through, never a second one.
-- `n` is how many distinct words the row has: how specific it is.
book_word AS MATERIALIZED (
  SELECT b.k, x.w, count(*) OVER (PARTITION BY b.k) AS n
  FROM book b
  CROSS JOIN LATERAL (SELECT DISTINCT unnest(string_to_array(b.k, ' ')) AS w) x
  WHERE b.k IS NOT NULL
),
name_word AS MATERIALIZED (
  SELECT DISTINCT p.k, unnest(string_to_array(p.k, ' ')) AS w
  FROM pour p
  WHERE p.k IS NOT NULL
),
-- Every row whose every word the name holds. Joined on the word, so the work
-- is the (name, row) pairs that share a word, never every name against every
-- row.
reach AS (
  SELECT nw.k AS name_k, bw.k AS row_k, min(bw.n) AS n
  FROM name_word nw
  JOIN book_word bw ON bw.w = nw.w
  GROUP BY nw.k, bw.k
  HAVING count(*) = min(bw.n)
),
-- The row whose key is the name's key wins outright (exact). Else the row
-- with the most words (contains). Rows level at the top are a tie, and the
-- name joins none of them. rnk = 1 marks the winner, or every tied row.
pick AS (
  SELECT r.name_k, r.row_k,
         CASE WHEN r.row_k = r.name_k THEN 'exact'
              WHEN count(*) OVER (PARTITION BY r.name_k, r.n) > 1 THEN 'tie'
              ELSE 'contains'
         END                                                    AS how,
         rank() OVER (PARTITION BY r.name_k
                      ORDER BY (r.row_k = r.name_k) DESC, r.n DESC) AS rnk
  FROM reach r
),
-- Each till name, on the one key its lines count on: the row it joined, or,
-- when it joined none (it holds no row's words, or it ties), its own key,
-- which is a row only when the queue held it (`keys` below), as before.
pour_on AS (
  SELECT pk.row_k AS k, p.label, p.lines, p.qty, p.bottles, p.glasses,
         p.unit_unknown, p.revenue, p.first_at, p.last_at, p.admit, pk.how
  FROM pour p
  JOIN pick pk ON pk.name_k = p.k AND pk.rnk = 1 AND pk.how <> 'tie'
  UNION ALL
  SELECT p.k, p.label, p.lines, p.qty, p.bottles, p.glasses,
         p.unit_unknown, p.revenue, p.first_at, p.last_at, p.admit, 'exact'
  FROM pour p
  WHERE p.k IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pick pk
                    WHERE pk.name_k = p.k AND pk.rnk = 1 AND pk.how <> 'tie')
),
-- A tied name's lines, counted on every row it tied on, and on none's Sold.
tie_agg AS (
  SELECT pk.row_k AS k, sum(p.lines)::integer AS lines
  FROM pour p
  JOIN pick pk ON pk.name_k = p.k AND pk.rnk = 1 AND pk.how = 'tie'
  GROUP BY pk.row_k
),
-- CHANGED the_cellar_reads_the_tills_own_record (ADR 0301 §1): `pour`
-- arrives one row per till name, already summed in `till`, so these columns
-- sum and bound those per-name fields. bool_or(admit) feeds the keys line
-- below.
-- CHANGED a_till_name_with_a_serve_size_joins_its_row: grouped by the key
-- each name's lines count on (`pour_on`), not by the name's own key, and it
-- sums the three units and lists the names.
pour_agg AS (
  SELECT k,
         sum(lines)::integer                                AS lines,
         sum(qty)                                           AS qty,
         sum(bottles)                                       AS bottles,
         sum(glasses)                                       AS glasses,
         sum(unit_unknown)                                  AS unit_unknown,
         sum(revenue)                                       AS revenue,
         min(first_at)                                      AS first_at,
         max(last_at)                                       AS last_at,
         (array_agg(label ORDER BY length(label) DESC))[1]  AS label,
         bool_or(admit)                                     AS admit,
         jsonb_agg(jsonb_build_object('item_name', label, 'lines', lines, 'how', how)
                   ORDER BY label)                          AS till_names
  FROM pour_on GROUP BY k
),

-- ── every product this house's own books name ───────────────────────────────
keys AS (
  SELECT k FROM menu_agg
  UNION SELECT k FROM inv_agg
  UNION SELECT k FROM ord_agg
  UNION SELECT k FROM quo_agg
  -- CHANGED the_cellar_reads_the_tills_own_record: a name only the till
  -- knows is a row when the queue ever held it, resolved or not, and only
  -- while `till` holds a line of it.
  -- CHANGED a_till_name_with_a_serve_size_joins_its_row: "a name only the
  -- till knows" is now a name that joins no other book's row (`pour_on`).
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
    po.last_at                                                 AS last_poured,
    -- ADDED a_till_name_with_a_serve_size_joins_its_row.
    po.bottles                                                 AS poured_bottles,
    po.glasses                                                 AS poured_glasses,
    po.unit_unknown                                            AS poured_unit_unknown,
    coalesce(tz.lines, 0)                                      AS tied_lines,
    po.till_names                                              AS till_names
  FROM keys ky
  LEFT JOIN menu_agg m  ON m.k  = ky.k
  LEFT JOIN inv_agg  i  ON i.k  = ky.k
  LEFT JOIN ord_agg  o  ON o.k  = ky.k
  LEFT JOIN quo_agg  q  ON q.k  = ky.k
  LEFT JOIN pour_agg po ON po.k = ky.k
  -- ADDED a_till_name_with_a_serve_size_joins_its_row.
  LEFT JOIN tie_agg  tz ON tz.k = ky.k
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
  -- ADDED a_till_name_with_a_serve_size_joins_its_row.
  b.poured_bottles, b.poured_glasses, b.poured_unit_unknown,
  b.tied_lines, b.till_names
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

COMMENT ON FUNCTION public.house_beverage_ledger(uuid, integer) IS
  'The house''s own cross-book record for a non-wine product (menu, invoice, '
  'order, quote, pos), reconciled against the catalogue by house_key. '
  'The menu CTE reads only lines on a current menu (restaurant_menus.status '
  '= ''active'', ADR 0193) and excludes status = ''discarded'' lines. '
  'The pos book is the till''s own record, house_till_lines. A till name joins '
  'the row of the other four books whose key equals its key, else the row '
  'with the most words among those whose every word it holds; rows level at '
  'the top tie, and the name joins none (tied_lines). A name that joins no '
  'row is a row of its own when the queue ever held it. Sold is split into '
  'poured_bottles, poured_glasses and poured_unit_unknown; till_names lists '
  'the names counted on the row (ADR 0301).';

REVOKE ALL ON FUNCTION public.house_beverage_ledger(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_beverage_ledger(uuid, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The till names one row counts, for the row record (one rule with Sold).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.house_till_names(
  p_restaurant_id uuid,
  p_label         text
)
RETURNS TABLE (
  item_name text,
  lines     bigint,
  joined_by text
)
LANGUAGE sql
STABLE
AS $function$
  -- The ledger's own join, read back for one row: the row whose house_key is
  -- p_label's key (a row's label always keys to its own house_key). The
  -- ledger is read whole (no p_limit cut), so a row past the register's cut
  -- still finds its names.
  SELECT j.item_name, j.lines, j.how
  FROM public.house_beverage_ledger(p_restaurant_id, 2147483647) l
  CROSS JOIN LATERAL jsonb_to_recordset(coalesce(l.till_names, '[]'::jsonb))
       AS j(item_name text, lines bigint, how text)
  WHERE l.house_key = public.beverage_house_key(NULL, p_label)
$function$;

COMMENT ON FUNCTION public.house_till_names(uuid, text) IS
  'The till names house_beverage_ledger counts on the row whose house_key is '
  'beverage_house_key(NULL, p_label), with how each joined (exact or '
  'contains), so the row record reads the lines its Sold cell sums. Reads '
  'only. service_role only, for the same reason as house_till_lines '
  '(ADR 0301).';

REVOKE ALL ON FUNCTION public.house_till_names(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_till_names(uuid, text)
  TO service_role;
