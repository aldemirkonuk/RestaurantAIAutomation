-- F-158 / W54 (owner-quarter sim, 2026-10-02; ADR 0267 option 8, founder:
-- "Keep the door's reason"): a wrong-item refusal was filed as `damaged`,
-- because procurement_credits had no reason for it. Migration
-- a_claim_keeps_the_door_reason widens procurement_credits_reason_check with
-- wrong_item, broken and temperature, and keeps every reason it already had.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. It must FAIL on a build
-- without that migration (T1: the CHECK does not name wrong_item; T2: the
-- insert is refused) and PASS with it. One transaction, rolled back: it
-- leaves nothing behind.

begin;

-- T1 the CHECK is validated and names the three door reasons beside every
-- reason it had before (the baseline seven and never_arrived).
do $$
declare
  def text;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.procurement_credits'::regclass
     and c.conname = 'procurement_credits_reason_check'
     and c.contype = 'c' and c.convalidated;
  assert def is not null, 'T1 FAIL procurement_credits_reason_check is missing or not validated';
  assert def ~ '''wrong_item''' and def ~ '''broken''' and def ~ '''temperature''',
    format('T1 FAIL the CHECK does not name the door''s reasons: %s', def);
  assert def ~ '''overbilled_vs_ship''' and def ~ '''qty_short''' and def ~ '''short_shipped'''
     and def ~ '''damaged''' and def ~ '''price_variance''' and def ~ '''never_ordered'''
     and def ~ '''other''' and def ~ '''never_arrived''',
    format('T1 FAIL the widen dropped an existing reason: %s', def);
end $$;

-- A house for the claims below. Ids are fixed and rolled back with the rest.
insert into public.restaurants (id, name, slug)
values ('f1580000-0000-4000-8000-000000000001', 'F-158 house', 'f158-house-door-reason-test');

-- T2 the measured case: a claim stores the door's reason — wrong item,
-- broken, temperature — and an old-shaped `damaged` claim still stores.
do $$
declare
  n integer;
begin
  insert into public.procurement_credits (restaurant_id, reason, summary, claimed_amount, state)
  values
    ('f1580000-0000-4000-8000-000000000001', 'wrong_item',  'F-158 wrong wine refused at the door', 44.00, 'open'),
    ('f1580000-0000-4000-8000-000000000001', 'broken',      'F-158 one broken bottle kept',          22.00, 'open'),
    ('f1580000-0000-4000-8000-000000000001', 'temperature', 'F-158 warm truck refused',              66.00, 'open'),
    ('f1580000-0000-4000-8000-000000000001', 'damaged',     'F-158 an old row, reason unknown',      11.00, 'open');
  select count(*) into n
    from public.procurement_credits
   where restaurant_id = 'f1580000-0000-4000-8000-000000000001';
  assert n = 4, format('T2 FAIL expected 4 claims stored, found %s', n);
end $$;

-- T3 the CHECK still refuses: a reason nobody defined is not admitted, so the
-- rebuild did not turn the constraint into a tautology.
do $$
declare
  refused boolean := false;
begin
  begin
    insert into public.procurement_credits (restaurant_id, reason, claimed_amount, state)
    values ('f1580000-0000-4000-8000-000000000001', 'wrong_wine', 1.00, 'open');
  exception when check_violation then
    refused := true;
  end;
  assert refused, 'T3 FAIL an undefined reason (the door''s own code, wrong_wine) was admitted as a claim reason';
end $$;

-- T4 the column says what the new reasons are for.
do $$
declare
  cmt text;
begin
  select col_description('public.procurement_credits'::regclass, a.attnum) into cmt
    from pg_attribute a
   where a.attrelid = 'public.procurement_credits'::regclass and a.attname = 'reason';
  assert cmt ~ 'ADR 0267' and cmt ~ 'wrong_item',
    format('T4 FAIL the reason column comment does not cite ADR 0267 and wrong_item: %s', coalesce(cmt, 'none'));
end $$;

rollback;
