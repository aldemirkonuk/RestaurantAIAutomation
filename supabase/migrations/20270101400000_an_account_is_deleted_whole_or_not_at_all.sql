-- F-457 (house-lifecycle sim, 2026-10-09): deleting an account left every
-- house, dropped the person's Google/Microsoft sign-in links, and only then
-- tried `DELETE FROM public.users` -- which ~30 `ON DELETE RESTRICT` foreign
-- keys refuse once the person has, say, written a crew note
-- (team_notes.author_user_id) or changed a menu price
-- (menu_price_versions.changed_by). The account stayed; the houses were gone.
--
-- `account_delete_blockers(p_user_id)` answers, BEFORE the first write, which
-- records would refuse that delete:
--   1. every foreign key on public.users(user_id) whose delete rule refuses
--      (RESTRICT / NO ACTION), or sets a NOT NULL column to null/default,
--      with how many rows name this person -- read from the catalog, so a
--      referrer added by a later migration is covered without editing this;
--   2. if none of those holds a row, the delete itself, tried and rolled
--      back, so a refusal one hop away (a cascaded row someone else's RESTRICT
--      still points at, a CHECK) is caught too. One row, count null.
-- No rows back = the delete would go through as things stand.
--
-- It decides nothing about retention (OD-163 is open): it only lets the
-- gateway refuse up front, naming the records, instead of failing half-way.
-- ADR: see the account-delete decision note (coordinator's call, 2026-10-09).

create or replace function public.account_delete_blockers(p_user_id uuid)
returns table (table_name text, column_name text, row_count bigint)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  fk record;
  n bigint;
  v_constraint text;
  v_table text;
  v_found boolean := false;
begin
  for fk in
    select c.conrelid::regclass as rel,
           c.conrelid::regclass::text as rel_name,
           a.attname::text as col
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.users'::regclass
       and array_length(c.conkey, 1) = 1
       and (c.confdeltype in ('r', 'a')
            or (c.confdeltype in ('n', 'd') and a.attnotnull))
     order by 2, 3
  loop
    execute format('select count(*) from %s where %I = $1', fk.rel, fk.col)
       into n using p_user_id;
    if n > 0 then
      v_found := true;
      table_name := fk.rel_name;
      column_name := fk.col;
      row_count := n;
      return next;
    end if;
  end loop;

  if v_found then
    return;
  end if;

  -- The delete, tried and undone. A clean delete raises our own SQLSTATE so
  -- the block's subtransaction rolls it back; anything else names the
  -- constraint that refused.
  begin
    delete from public.users where user_id = p_user_id;
    raise exception using errcode = 'MDACD', message = 'dry run';
  exception
    when sqlstate 'MDACD' then
      null;
    when others then
      get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
      table_name := coalesce(
        (select c.conrelid::regclass::text from pg_constraint c
          where c.conname = v_constraint limit 1),
        nullif(v_table, ''),
        'unknown');
      column_name := nullif(v_constraint, '');
      row_count := null;
      return next;
  end;
end;
$$;

comment on function public.account_delete_blockers(uuid) is
  'F-457: records that would refuse DELETE FROM public.users for this person '
  '(RESTRICT/NO ACTION referrers with their row counts, else one row from a '
  'rolled-back trial delete). Empty = the delete would go through. Read before '
  'the first write of an account delete; decides nothing about retention (OD-163).';

revoke all on function public.account_delete_blockers(uuid) from public;
revoke all on function public.account_delete_blockers(uuid) from anon, authenticated;
grant execute on function public.account_delete_blockers(uuid) to service_role;
