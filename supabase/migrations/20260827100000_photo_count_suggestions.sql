-- photo_count_suggestions — the link that makes a photo count gradable (OD-59, P3.0).
--
-- Why this table exists
-- --------------------
-- `photo_count` is the ONE task type in the OD-59 census where a machine can
-- eventually say "right" rather than "well-formed" — and it was the one type
-- where that was unreachable. The reason is stated in the product code itself
-- (`inventory.service.ts`, decision E46): the vision estimate is
--
--     "a vision suggestion only. Never writes anything; the caller drops the
--      result into the same quantity field the voice path fills, and the human
--      still has to call recordSpotCount."
--
-- That posture is right and is NOT changed here. But it means the suggestion is
-- returned to the browser and forgotten, so when the human commits a real count
-- minutes later there is nothing to compare it against. The model's answer and
-- the truth exist at different times and were never joined.
--
-- Without this table the honest verdict for photo_count is a floor: `failure`
-- when the model declines, `NULL` otherwise. Anything stronger would be a
-- guess — and the census said so in as many words.
--
-- What this table is NOT
-- ---------------------
-- It is not a stock write, an audit trail, or a second source of truth for
-- counts. It records what the model SUGGESTED and, later, what the human
-- actually counted, for the sole purpose of grading the model. Nothing in the
-- product reads it; `restaurant_inventory` remains the only place a quantity
-- means anything.

create table if not exists public.photo_count_suggestions (
  id             uuid primary key default gen_random_uuid(),

  -- The footprint row this suggestion came from. NULLABLE on purpose: emission
  -- is fire-and-forget and can be dropped (the ref settles `null`), and a
  -- dropped emit must not cost us the suggestion — it costs us only the ability
  -- to grade that particular one, which the re-grade then skips.
  event_id       uuid references public.neural_footprint_event(id) on delete cascade,

  restaurant_id  uuid not null,
  inventory_id   uuid not null
                 references public.restaurant_inventory(id) on delete cascade,

  -- NULL is the model declining — "a null with a clear note is better than a
  -- confident wrong number", which is the prompt's own instruction. It is a
  -- real, gradable answer, not missing data.
  suggested_qty  integer check (suggested_qty is null or suggested_qty >= 0),
  confidence     text check (confidence in ('low','medium','high')),

  created_at     timestamptz not null default now(),

  -- Filled by the re-grade when a human commits a count for the same item.
  -- `graded_at is null` is the work queue; a row that never gets graded is a
  -- suggestion nobody acted on, which is itself worth being able to count.
  graded_at      timestamptz,
  counted_qty    integer
);

-- The re-grade lookup: newest ungraded suggestion for one inventory item.
-- Partial index because the graded rows are history and are never scanned this
-- way — they only accumulate.
create index if not exists photo_count_suggestions_pending
  on public.photo_count_suggestions (inventory_id, created_at desc)
  where graded_at is null;

comment on table public.photo_count_suggestions is
  'What the photo-count model suggested, so it can later be graded against the count a human actually committed (OD-59 human_count_v1). Not a stock record and not read by the product — restaurant_inventory remains the only place a quantity means anything.';

comment on column public.photo_count_suggestions.suggested_qty is
  'NULL = the model declined to guess, which is a gradable answer (the prompt asks for it explicitly), not missing data.';

comment on column public.photo_count_suggestions.graded_at is
  'NULL = no human count has been matched to this suggestion yet. Ungraded rows are the queue; they are also the honest measure of suggestions nobody acted on.';

-- ---------------------------------------------------------------------------
-- RLS in the SAME migration that creates the table.
--
-- OD-73 was closed on 2026-08-26 and REGENERATED the same day: three tables
-- created hours later shipped with no RLS. The house rule that came out of it
-- is that a table arrives locked or it does not arrive. This one carries
-- restaurant_id and joins to inventory, so it is tenant data.
--
-- RLS-enabled-WITH-a-service-role-policy, not RLS-with-no-policy: no-policy is
-- closed only by ABSENCE, and the next person to add one silently opens the
-- whole table.
alter table public.photo_count_suggestions enable row level security;

drop policy if exists photo_count_suggestions_service_role
  on public.photo_count_suggestions;
create policy photo_count_suggestions_service_role
  on public.photo_count_suggestions
  for all to service_role using (true) with check (true);

-- No `authenticated` policy, deliberately: nothing client-side reads this. When
-- a product surface needs it, that is a decision with an ADR and a
-- restaurant-isolation policy — not a bare `using (true)`.
--
-- No REVOKE line: OD-72's `alter default privileges ... revoke all ... from
-- anon, authenticated` (20260825210000:183) means anything created after it
-- arrives with no client grant already. Adding one here would be cargo, and the
-- session that wrote one in #116 removed it again in #117 after reading past
-- the sweep.
