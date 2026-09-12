-- calendar_events gets a real link to the schedule that created it.
-- =====================================================================
-- ADR 0068. Founder-decided: a first-class `recurring_order_id uuid`
-- column, nullable, FK, indexed. Not a join table, not a JSON blob.
--
-- WHY A COLUMN
--
-- `calendar_events` already carries `order_id uuid` and `provider_id uuid`
-- for exactly this purpose (baseline_from_production.sql:2344-2345), each
-- with its own FK and, for provider_id, its own index
-- (`idx_calendar_events_provider`, :8639). A third relationship of the same
-- shape is the same thing, and reads correctly to the ~15 other call sites
-- in calendar.service.ts that already speak in columns.
--
-- The code it replaces did not use a link at all. It serialised the id into
-- a `tags` JSON string and then searched for it with
--
--     .like("tags", `%${recurringOrder.id}%`)
--
-- a leading-wildcard substring scan that no index can serve, against a
-- column that DOES NOT EXIST -- `calendar_events` has never had `tags` or
-- `priority` (verified against production 2026-09-02: 0 of 2 present in
-- information_schema). So the write failed with PGRST204 and the read
-- matched nothing, and both were wrapped in a warn-only catch.
--
-- WHAT THIS IS NOT
--
--   * NOT a join table. A calendar event belongs to at most one schedule;
--     a join table would model a many-to-many that does not exist and
--     would need its own RLS, its own index and its own cleanup.
--   * NOT a JSONB `metadata` column. It is the same un-indexable read in a
--     better-typed disguise, and it cannot carry a foreign key.
--   * NOT a back-fill. This table holds 19 REAL rows in production
--     (2026-09-02) -- unlike every other table in this domain. None of them
--     can be attributed to a schedule, because no schedule has ever
--     materialised an event: `recurring_orders` held 0 rows, and the only
--     event_types present are audit, corporate, custom, delivery, meeting,
--     private_event, recurring, tasting and wine_dinner -- `order`, which
--     the pre-create path writes, is absent. The column stays NULL on all
--     19. Guessing an owner for a real row is worse than leaving it blank.
--
-- ON DELETE SET NULL, AND WHY IT DIFFERS FROM order_id
--
-- `calendar_events.order_id` has no ON DELETE clause, i.e. NO ACTION. That
-- is safe there because nothing cascades onto `procurement_orders`:
-- `procurement_orders_inventory_id_fkey` is itself NO ACTION (verified in
-- production 2026-09-02).
--
-- `recurring_orders` is different. `20260901180000_recurring_orders_shape.sql`
-- gave it `inventory_id ... ON DELETE CASCADE`, so deleting a wine deletes
-- its schedules. If this column were NO ACTION, that cascade would collide
-- with the surviving calendar rows and Postgres would REFUSE the wine
-- delete with a 23503 -- turning "delist a wine" into an opaque foreign-key
-- error. CASCADE is worse still: it would delete completed historical
-- events, destroying the record of orders that really were placed, because
-- someone delisted a bottle.
--
-- SET NULL keeps the history, never blocks a legitimate delete, and leaves
-- the event exactly as honest as it can be: it happened, and the schedule
-- that caused it is gone.

alter table public.calendar_events
  add column if not exists recurring_order_id uuid;

alter table public.calendar_events
  drop constraint if exists calendar_events_recurring_order_id_fkey,
  add  constraint calendar_events_recurring_order_id_fkey
       foreign key (recurring_order_id)
       references public.recurring_orders(id)
       on delete set null;

-- The index is the point of the change, not decoration.
--
-- `executeRecurringOrder` looks up "the event this schedule pre-created for
-- this date" on every materialisation. As a `LIKE '%uuid%'` over `tags` that
-- was a full scan by construction. As `WHERE recurring_order_id = $1 AND
-- event_date = $2` it is one index probe. Partial on NOT NULL because 19 of
-- 19 existing rows -- and every manually created event forever after -- have
-- no schedule, and there is no reason to index them.
create index if not exists idx_calendar_events_recurring_order
  on public.calendar_events (recurring_order_id, event_date)
  where recurring_order_id is not null;

comment on column public.calendar_events.recurring_order_id is
  'The recurring_orders schedule that created this event, if any. NULL for every manually created event and for all 19 rows that predate this column (2026-09-02). Replaces a JSON substring match against a `tags` column that never existed. ON DELETE SET NULL so that deleting a wine -- which CASCADEs to its schedules -- cannot be blocked by, or destroy, calendar history. See ADR 0068.';
