-- The alert ledger records alerts that HAPPENED, and says so when one did not.
--
-- POS lens, absence-as-health 8 (2026-09-03). `inventory_alert_state` held 7
-- rows with `last_alerted_at` stamped and `alert_count` bumped; `notifications`
-- held 2 rows covering 3 wines. Four wines were recorded as alerted and were
-- not — `upsertState` stamps the timestamp inside the crossing loop, BEFORE
-- the instant-alert cooldown at low-stock-alerts.service.ts:225-235 and before
-- prefs decide whether anything is sent at all.
--
-- That is this project's cross-cutting fault in its purest form: a system
-- reporting on itself reported ABSENCE (no notification) as HEALTH (alerted at
-- 21:04). Anyone auditing "did we tell them?" read the ledger and got yes.
--
-- The code fix is to stamp `last_alerted_at` only after a notification row
-- exists. That alone would leave a second, quieter gap: a crossing we
-- deliberately held for the digest would become indistinguishable from a
-- crossing we never noticed — both `last_alerted_at IS NULL`. So the held case
-- gets its own column rather than being inferred from the absence of another.
--
-- Additive and nullable. No backfill, and that is deliberate: the rows already
-- carrying a false `last_alerted_at` cannot be repaired from here, because
-- nothing in this table records WHICH of them corresponded to a notification.
-- Recovering that means joining `notifications` on time and wine set, which is
-- a guess wearing a repair's clothes. The column is the fix going forward and
-- the register carries the fact that the historical rows are unreliable.

alter table public.inventory_alert_state
  add column if not exists last_held_at timestamp with time zone,
  add column if not exists last_held_reason text;

comment on column public.inventory_alert_state.last_held_at is
  'When a crossing was detected and deliberately NOT alerted on — held for the '
  'daily digest by the instant cooldown or by the restaurant''s notification '
  'preferences. Distinct from last_alerted_at IS NULL, which means no crossing '
  'has been detected at all: "we chose not to tell them yet" and "nothing has '
  'happened" are different facts and must not render the same.';

comment on column public.inventory_alert_state.last_held_reason is
  'Why the crossing was held: instant_cooldown (another instant alert fired for '
  'this restaurant inside the cooldown window) or prefs (instant-first is off '
  'and the wine is not a critical the manager asked to be interrupted for). '
  'NULL when nothing is currently held.';

alter table public.inventory_alert_state
  drop constraint if exists inventory_alert_state_held_reason_check;
alter table public.inventory_alert_state
  add constraint inventory_alert_state_held_reason_check
  check (
    last_held_reason is null
    or last_held_reason in ('instant_cooldown', 'prefs')
  );

comment on column public.inventory_alert_state.last_alerted_at is
  'When a notification about this wine was actually CREATED. Stamped only after '
  'notifications.persistForRestaurant returns a row — never before, and never '
  'for a crossing that was suppressed. Rows written before 2026-09-06 may carry '
  'a timestamp for an alert nobody received (POS lens, absence-as-health 8); '
  'they are not backfilled because this table never recorded which of them '
  'corresponded to a notification.';

-- Finding a held wine has to be cheap, because the digest and the inbox both
-- want "what have we been sitting on?".
create index if not exists idx_inventory_alert_state_held
  on public.inventory_alert_state (restaurant_id, last_held_at desc)
  where last_held_at is not null;
