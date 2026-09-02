-- stock_counts — a count is a record in its own right (ADR 0078, restoring D14).
--
-- WHAT WAS WRONG
-- --------------
-- `.planning/07-reference/INVENTORY_SOTA_PLAN.md:63` locks decision D14:
--
--     "Count is truth; perpetual is the audit trail. The displayed/trusted
--      on-hand number is a periodic count re-based against the ledger — not
--      the raw perpetual projection."
--
-- The shipped code is the exact inverse, and nothing recorded the supersession.
-- The displayed number is `restaurant_inventory.stock_live`, a trigger-maintained
-- projection of `inventory_lots`; a count writes a delta into
-- `inventory_transactions` and is thereafter indistinguishable from a pour, a
-- receipt or a manual override.
--
-- Worse, AGREEMENT WAS PHYSICALLY UNRECORDABLE. Two constraints combine:
--
--   * set_stock_absolute returns NULL without writing anything when the implied
--     delta is zero (20260805131000_stock_race_and_pour_idempotency.sql:45).
--   * inventory_transactions carries CHECK (quantity_change <> 0).
--
-- So the ledger can only ever contain counts that DISAGREED. Any variance rate
-- computed from `transaction_type = 'reconciliation'` rows is 1.0 by
-- construction — a tautology that reads exactly like a measurement. This is the
-- `absence-reported-as-health` shape in its purest form: the successful case
-- leaves no trace, so the trace contains only failures and the aggregate over it
-- is a statement about the schema, not about the restaurant.
--
-- The only surviving evidence that a count happened at all was
-- `restaurant_inventory.last_counted_at`, a single timestamp with no quantity,
-- no actor and no history — and it was stamped by a SEPARATE round trip after
-- the RPC, whose failure was only a `logger.warn` (inventory.service.ts:397-401).
-- A count could therefore leave NO trace whatsoever and report success.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds `stock_counts`, written UNCONDITIONALLY on every count, and
-- `record_stock_count()`, the one primitive both count paths now go through. The
-- stock movement becomes a downstream CONSEQUENCE of a non-zero difference
-- rather than the only evidence the count occurred.
--
-- The shape is deliberately mirrored from `photo_count_suggestions`
-- (20260827100000), which already does exactly this for the MACHINE's answer: it
-- records the suggestion and grades it against the human number, so a suggestion
-- that was right is as visible as one that was wrong. The human count was the
-- half with no equivalent. That asymmetry — the machine's guesses fully audited,
-- the human's counts recorded only when they were wrong — is the thing being
-- corrected here.
--
-- NOTHING IS DROPPED. `last_counted_at` survives (see its comment below), the
-- ledger keeps every row it has, and set_stock_absolute is untouched so its
-- other caller (manual override in updateInventoryItem) is unaffected.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.stock_counts (
  id             uuid primary key default gen_random_uuid(),

  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,
  inventory_id   uuid not null
                 references public.restaurant_inventory(id) on delete cascade,

  -- Which book was counted. A shadow count and a live count of the same item
  -- are different observations and must not collapse into one another.
  stock_state    text not null check (stock_state in ('live','shadow')),

  -- What the system believed at the instant of the count: SUM(inventory_lots.qty)
  -- for this (inventory_id, stock_state), read INSIDE the same FOR UPDATE lock
  -- that the resulting movement's delta is computed from. It is deliberately NOT
  -- restaurant_inventory.stock_live: that column is a trigger-maintained
  -- projection, and reading it would let expected_qty disagree with the delta
  -- actually applied whenever the projection lags.
  --
  -- Not constrained >= 0. It is an observation of a system that can be wrong,
  -- and a negative lot sum is a defect this table should be able to witness
  -- rather than reject.
  expected_qty   integer not null,

  -- What the human found. >= 0 because you cannot count negative bottles.
  counted_qty    integer not null check (counted_qty >= 0),

  -- Generated, not written: variance is the whole reason this table exists and
  -- must never be capable of disagreeing with the two numbers it is derived
  -- from. ZERO IS A REAL, RECORDED VALUE HERE — that is the entire point.
  variance_qty   integer generated always as (counted_qty - expected_qty) stored,

  -- Which path committed it: 'mobile_count' (spot count) or 'reconciliation'
  -- (the ledger reconcile endpoint). Free text rather than an enum because
  -- inventory_transaction_source already exists and adding a value to a shipped
  -- enum is a lock this migration does not need to take.
  source         text not null,
  reason         text,

  counted_at     timestamptz not null default now(),

  -- ACTOR. references public.users(user_id) — NOT auth.users(id). The two tables
  -- are DISJOINT in this database (zero shared ids); the JWT carries
  -- public.users.user_id, so an FK to auth.users 23503s on every write and CI
  -- cannot catch it, because a fresh database has no rows to violate.
  --
  -- NULLABLE, and honestly so: a count committed by an unauthenticated internal
  -- path has no actor, and writing a placeholder would be a retroactive claim.
  counted_by     uuid references public.users(user_id) on delete set null,

  -- The SAME key the movement uses. Shared on purpose so the count and the
  -- movement can never disagree about whether a given request is a retry: the
  -- count row's unique index is the single gate, and a replay short-circuits
  -- before apply_stock_movement is reached.
  --
  -- NOT NULL: a count that cannot be de-duplicated cannot be a record, because
  -- "how often do counts agree" would become a function of signal quality.
  idempotency_key text not null unique,

  -- The movement this count caused, or NULL when the count AGREED and there was
  -- nothing to move. NULL here means "recorded, no correction needed" — it is a
  -- result, not missing data, and it is the value that was previously
  -- unrepresentable.
  transaction_id uuid references public.inventory_transactions(id) on delete set null
);

-- "Counts for this item, newest first" — the history view and the freshness
-- badge. Not partial: unlike photo_count_suggestions there is no pending/graded
-- split, every row is history from the moment it lands.
create index if not exists stock_counts_item_recent
  on public.stock_counts (inventory_id, counted_at desc);

-- "Counts across this restaurant in a window" — variance reporting.
create index if not exists stock_counts_restaurant_recent
  on public.stock_counts (restaurant_id, counted_at desc);

comment on table public.stock_counts is
  'Every physical count, recorded whether or not it changed anything (ADR 0078, restoring INVENTORY_SOTA_PLAN D14). Before this table a count that AGREED wrote nothing at all — set_stock_absolute returns NULL on a zero delta and inventory_transactions CHECKs quantity_change <> 0 — so any variance rate derived from the ledger was 1.0 by construction.';

comment on column public.stock_counts.expected_qty is
  'SUM(inventory_lots.qty) for this (inventory_id, stock_state), read under the same FOR UPDATE lock the applied delta is computed from. NOT restaurant_inventory.stock_live, which is a projection that can lag.';

comment on column public.stock_counts.variance_qty is
  'counted_qty - expected_qty, generated so it cannot drift from its inputs. 0 is a real recorded outcome — the outcome the ledger was structurally unable to hold.';

comment on column public.stock_counts.transaction_id is
  'The inventory_transactions row this count caused, or NULL when the count agreed and nothing moved. NULL is a result, not missing data.';

comment on column public.stock_counts.counted_by is
  'public.users(user_id). NOT auth.users — the two tables are disjoint here. NULL where the committing path genuinely has no authenticated actor; rows written before this migration have no equivalent and are not backfilled, because a retroactive attribution would be worse than the gap.';

-- ---------------------------------------------------------------------------
-- 2. RLS, in the SAME migration that creates the table.
--
-- OD-73 was closed on 2026-08-26 and REGENERATED the same day: three tables
-- created hours later shipped with no RLS. The house rule that came out of it is
-- that a table arrives locked or it does not arrive. This one carries
-- restaurant_id and joins to inventory, so it is tenant data.
--
-- RLS-enabled-WITH-a-service-role-policy, not RLS-with-no-policy: no-policy is
-- closed only by ABSENCE, and the next person to add one silently opens the
-- whole table.
-- ---------------------------------------------------------------------------

alter table public.stock_counts enable row level security;

drop policy if exists stock_counts_service_role on public.stock_counts;
create policy stock_counts_service_role
  on public.stock_counts
  for all to service_role using (true) with check (true);

-- No `authenticated` policy: the gateway reads this with the service key, as it
-- does every other inventory table. When a client-side surface needs it that is
-- a decision with its own ADR and a restaurant-isolation policy, not a bare
-- `using (true)`.
--
-- No REVOKE line: OD-72's `alter default privileges ... revoke all ... on tables
-- from anon, authenticated` (20260825210000_od72_revoke_client_grants.sql:183)
-- means anything created after it arrives with no client grant already.

-- ---------------------------------------------------------------------------
-- 3. record_stock_count — the one primitive that commits a count.
--
-- Lock discipline is copied from set_stock_absolute (spine repair, decision
-- A11): lock the restaurant_inventory row BEFORE reading the lot sum, so nobody
-- else's transaction can change the item between the read and the write. That is
-- what makes expected_qty capturable at all — any read done from TypeScript
-- before or after the RPC is racing the very movements the count is measuring,
-- which is the A11 bug this function must not reintroduce.
--
-- ORDER OF OPERATIONS IS LOAD-BEARING and is asserted by
-- scripts/check_a_count_is_recorded.sh:
--
--   1. lock         — serialises concurrent counts of the same item
--   2. replay gate  — one gate, shared with the movement's key
--   3. read expected
--   4. INSERT the count  <-- UNCONDITIONAL. Before any branch on the delta.
--   5. move stock        <-- only if the difference is non-zero
--   6. stamp last_counted_at
--
-- Steps 4 and 6 were previously two separate network round trips from the
-- gateway, the second of which only warned on failure. They are now in one
-- transaction with the movement: a count is recorded completely or not at all.
-- ---------------------------------------------------------------------------

create or replace function public.record_stock_count(
    p_inventory_id     uuid,
    p_counted_qty      integer,
    p_idempotency_key  text,
    p_stock_state      text    default 'live',
    p_source           text    default 'mobile_count',
    p_transaction_type text    default 'reconciliation',
    p_performed_by     uuid    default null,
    p_reason           text    default null
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_expected   int;
  v_delta      int;
  v_txn        uuid;
  v_count      public.stock_counts%rowtype;
BEGIN
  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted_qty must be a non-negative integer, got %', p_counted_qty;
  END IF;
  -- Refused rather than defaulted. A generated fallback key would make every
  -- retry a second count and quietly turn the agreement rate into a measure of
  -- mobile signal quality.
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'p_idempotency_key is required: a count that cannot be de-duplicated cannot be a record';
  END IF;

  -- (1) Lock FIRST. Every count of this item serialises here, which is what
  -- makes the check-then-insert in (2) safe as well as the read in (3) honest.
  SELECT restaurant_id INTO v_restaurant
    FROM public.restaurant_inventory
   WHERE id = p_inventory_id
     FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  -- (2) Replay gate. ONE gate for the count and the movement, because they share
  -- a key: a replay returns the original count and never reaches
  -- apply_stock_movement, so the two can never disagree about what a retry is.
  SELECT * INTO v_count FROM public.stock_counts
   WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'count_id',       v_count.id,
      'expected_qty',   v_count.expected_qty,
      'counted_qty',    v_count.counted_qty,
      'variance_qty',   v_count.variance_qty,
      'transaction_id', v_count.transaction_id,
      'counted_at',     v_count.counted_at,
      'replayed',       true
    );
  END IF;

  -- (3) What the system believed, under the lock.
  SELECT COALESCE(SUM(qty), 0) INTO v_expected
    FROM public.inventory_lots
   WHERE inventory_id = p_inventory_id
     AND stock_state  = p_stock_state;

  v_delta := p_counted_qty - v_expected;

  -- (4) THE COUNT IS RECORDED HERE, UNCONDITIONALLY.
  -- This INSERT is above every branch on v_delta on purpose: it is the one line
  -- that makes an agreeing count representable. ON CONFLICT is belt-and-braces
  -- behind the lock in (1) — the lock already serialises same-item retries.
  INSERT INTO public.stock_counts (
      restaurant_id, inventory_id, stock_state,
      expected_qty, counted_qty, source, reason,
      counted_by, idempotency_key
  ) VALUES (
      v_restaurant, p_inventory_id, p_stock_state,
      v_expected, p_counted_qty, p_source, p_reason,
      p_performed_by, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_count;

  IF v_count.id IS NULL THEN
    SELECT * INTO v_count FROM public.stock_counts
     WHERE idempotency_key = p_idempotency_key;
  END IF;

  -- (5) The movement is a CONSEQUENCE of disagreement, not the evidence of the
  -- count. apply_stock_movement re-locks the same restaurant_inventory row in
  -- this same transaction — safe, Postgres row locks are reentrant within one
  -- xact, which is the property set_stock_absolute already relies on.
  IF v_delta <> 0 THEN
    v_txn := public.apply_stock_movement(
      p_inventory_id, p_stock_state, v_delta,
      p_transaction_type, p_source, p_performed_by, p_reason,
      NULL, NULL, NULL, p_idempotency_key
    );
    UPDATE public.stock_counts SET transaction_id = v_txn WHERE id = v_count.id;
  END IF;

  -- (6) last_counted_at stays, and is now stamped inside the same transaction as
  -- the count row rather than in a separate round trip whose failure only warned.
  -- It is no longer EVIDENCE that a count happened — stock_counts is that — it is
  -- a denormalised cache of MAX(counted_at) so the inventory list can render a
  -- freshness badge without a correlated subquery per item.
  UPDATE public.restaurant_inventory
     SET last_counted_at = now()
   WHERE id = p_inventory_id;

  RETURN jsonb_build_object(
    'count_id',       v_count.id,
    'expected_qty',   v_expected,
    'counted_qty',    p_counted_qty,
    'variance_qty',   v_delta,
    'transaction_id', v_txn,
    'counted_at',     v_count.counted_at,
    'replayed',       false
  );
END;
$$;

comment on function public.record_stock_count IS
  'Commits a physical count and records it unconditionally in stock_counts (ADR 0078, restoring D14). The stock movement is a downstream consequence of a non-zero difference; a count that AGREES still produces a row, which set_stock_absolute + inventory_transactions were structurally unable to represent. Use this instead of set_stock_absolute for any human count.';
