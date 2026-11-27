-- QA round 24 (2026-11-07): a letter whose sender could not be read, or that
-- the receiving server could not confirm came from its From, is held in
-- email_prospects with held_reason set, one row per letter. Migration
-- a_held_letter_is_its_own_row adds the column, bounds it, and leaves held
-- rows out of both one-per-domain unique indexes.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1: there is no held_reason column) and PASS with
-- it. One transaction, rolled back: it leaves nothing behind. Synthetic ids;
-- email_prospects.restaurant_id carries no foreign key.

begin;

-- T1 the column exists, is text and nullable (existing rows stay prospects).
do $$
declare
  t text;
  nn boolean;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull into t, nn
    from pg_attribute a
   where a.attrelid = 'public.email_prospects'::regclass
     and a.attname = 'held_reason' and not a.attisdropped;
  assert t = 'text', format('T1 FAIL email_prospects.held_reason is %s, expected text', coalesce(t, 'absent'));
  assert nn = false, 'T1 FAIL held_reason is NOT NULL';
end $$;

-- T2 two held letters of one house and one domain are two rows.
do $$
declare n int;
begin
  insert into public.email_prospects (restaurant_id, domain, sender_email, subject, held_reason)
  values ('00000000-0000-4000-8000-0000000000a1', 'bigdist.com', 'sales@bigdist.com', 'one', 'sender_unconfirmed'),
         ('00000000-0000-4000-8000-0000000000a1', 'bigdist.com', 'sales@bigdist.com', 'two', 'sender_unconfirmed');
  select count(*) into n from public.email_prospects
   where restaurant_id = '00000000-0000-4000-8000-0000000000a1' and held_reason is not null;
  assert n = 2, format('T2 FAIL %s held rows, expected 2', n);
end $$;

-- T3 a held letter does not take the domain's prospect row: a prospect of the
-- same house and domain still inserts beside it.
do $$
begin
  insert into public.email_prospects (restaurant_id, domain, sender_email, subject)
  values ('00000000-0000-4000-8000-0000000000a1', 'bigdist.com', 'new@bigdist.com', 'catalogue');
end $$;

-- T4 a second PROSPECT of that house and domain is still refused.
do $$
begin
  begin
    insert into public.email_prospects (restaurant_id, domain, sender_email)
    values ('00000000-0000-4000-8000-0000000000a1', 'bigdist.com', 'other@bigdist.com');
    raise exception 'T4 FAIL a second prospect row of one house and domain was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- T5 the operator's bucket: held letters with no house and no domain (a From
-- that names nobody) are each their own row, and the triage prospect index
-- still refuses a second prospect of one domain.
do $$
declare n int;
begin
  insert into public.email_prospects (restaurant_id, domain, held_reason, subject)
  values (null, '', 'sender_unreadable', 'x'), (null, '', 'sender_unreadable', 'y');
  select count(*) into n from public.email_prospects where restaurant_id is null and domain = '';
  assert n = 2, format('T5 FAIL %s operator held rows, expected 2', n);
  insert into public.email_prospects (restaurant_id, domain) values (null, 'stranger.example');
  begin
    insert into public.email_prospects (restaurant_id, domain) values (null, 'stranger.example');
    raise exception 'T5 FAIL a second triage prospect of one domain was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- T6 the reason is bounded.
do $$
begin
  begin
    insert into public.email_prospects (restaurant_id, domain, held_reason)
    values (null, 'x.example', 'looked_odd');
    raise exception 'T6 FAIL an unknown held_reason was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
