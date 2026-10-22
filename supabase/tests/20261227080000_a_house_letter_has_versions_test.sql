-- W25 / ADR 0313 (4a-ii): migration a_house_letter_has_versions gives a house
-- letter template append-only versions, a tenant-checked published pointer
-- and one order letter per house.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. Run it on a database built from
-- supabase/migrations. Synthetic fixtures only, one transaction, rolled back.
--
-- On a build WITHOUT the migration, T1 fails at once (no table
-- letter_template_versions, no column published_version_id).

begin;

insert into public.restaurants (id, name, slug) values
  ('a2514000-0000-4000-8000-000000000001', 'W25 versions house', 'w25-versions-house'),
  ('a2514000-0000-4000-8000-000000000002', 'W25 other house', 'w25-other-house');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('a2514000-0000-4000-8000-0000000000a1', 'w25-owner@x.test', 'W25 owner',
   'a2514000-0000-4000-8000-000000000001', 'owner');
insert into public.communication_templates (id, restaurant_id, name, body, type, category) values
  ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
   'Order letter', '{{greeting}} draft', 'letter', 'order_request'),
  ('a2514000-0000-4000-8000-000000000102', 'a2514000-0000-4000-8000-000000000001',
   'Price ask', 'Hello', 'letter', 'price_query'),
  ('a2514000-0000-4000-8000-000000000201', 'a2514000-0000-4000-8000-000000000002',
   'Their order letter', '{{greeting}}', 'letter', 'order_request');

-- T1. A version is written, the template points at it, and nothing was
-- published by the migration itself.
do $$
begin
  assert (select published_version_id from public.communication_templates
          where id = 'a2514000-0000-4000-8000-000000000101') is null,
    'T1: a template arrived with a published version';
  insert into public.letter_template_versions
    (id, template_id, restaurant_id, version, kind, body, body_hash, author)
  values ('a2514000-0000-4000-8000-000000000301', 'a2514000-0000-4000-8000-000000000101',
          'a2514000-0000-4000-8000-000000000001', 1, 'publish', '{{greeting}} v1',
          repeat('a', 64), 'a2514000-0000-4000-8000-0000000000a1');
  assert (select locale from public.letter_template_versions
          where id = 'a2514000-0000-4000-8000-000000000301') = 'en',
    'T1: a version without a locale is not en (ADR 0313 R4)';
  update public.communication_templates
     set published_version_id = 'a2514000-0000-4000-8000-000000000301'
   where id = 'a2514000-0000-4000-8000-000000000101';
end
$$;

-- T2. A version of another house's template is refused (the composite key).
do $$
begin
  begin
    insert into public.letter_template_versions
      (template_id, restaurant_id, version, kind, body, body_hash)
    values ('a2514000-0000-4000-8000-000000000201', 'a2514000-0000-4000-8000-000000000001',
            1, 'publish', 'x', repeat('b', 64));
    raise exception 'T2: a version filed under the wrong house was admitted';
  exception when foreign_key_violation then null;
  end;
end
$$;

-- T3. A template may point only at one of its own versions.
do $$
begin
  begin
    update public.communication_templates
       set published_version_id = 'a2514000-0000-4000-8000-000000000301'
     where id = 'a2514000-0000-4000-8000-000000000102';
    raise exception 'T3: a template pointed at another template''s version';
  exception when foreign_key_violation then null;
  end;
end
$$;

-- T4. Append-only: UPDATE and DELETE sent directly are refused.
do $$
begin
  begin
    update public.letter_template_versions set body = 'changed'
     where id = 'a2514000-0000-4000-8000-000000000301';
    raise exception 'T4: a version was updated';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'letter_template_versions is append-only%' then raise; end if;
  end;
  begin
    delete from public.letter_template_versions
     where id = 'a2514000-0000-4000-8000-000000000301';
    raise exception 'T4: a version was deleted';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'letter_template_versions is append-only%' then raise; end if;
  end;
end
$$;

-- T5. Numbering: one number per (template, locale); a Turkish version 1 is
-- additive; a locale the renderer does not write is refused; so is a bad hash.
do $$
begin
  begin
    insert into public.letter_template_versions
      (template_id, restaurant_id, version, kind, body, body_hash)
    values ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
            1, 'publish', 'again', repeat('c', 64));
    raise exception 'T5: two version 1s in one locale';
  exception when unique_violation then null;
  end;
  insert into public.letter_template_versions
    (template_id, restaurant_id, locale, version, kind, body, body_hash)
  values ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
          'tr', 1, 'reset', 'tr default', repeat('d', 64));
  begin
    insert into public.letter_template_versions
      (template_id, restaurant_id, locale, version, kind, body, body_hash)
    values ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
            'fr', 1, 'publish', 'fr', repeat('e', 64));
    raise exception 'T5: locale fr admitted';
  exception when check_violation then null;
  end;
  begin
    insert into public.letter_template_versions
      (template_id, restaurant_id, version, kind, body, body_hash)
    values ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
            2, 'edit', 'x', repeat('f', 64));
    raise exception 'T5: kind edit admitted';
  exception when check_violation then null;
  end;
  begin
    insert into public.letter_template_versions
      (template_id, restaurant_id, version, kind, body, body_hash)
    values ('a2514000-0000-4000-8000-000000000101', 'a2514000-0000-4000-8000-000000000001',
            2, 'publish', 'x', 'not-a-hash');
    raise exception 'T5: a body_hash that is not sha256 hex admitted';
  exception when check_violation then null;
  end;
end
$$;

-- T6. One order letter per house; another house, and other purposes, are free.
do $$
begin
  begin
    insert into public.communication_templates (restaurant_id, name, body, type, category)
    values ('a2514000-0000-4000-8000-000000000001', 'Second order letter', 'x', 'letter', 'order_request');
    raise exception 'T6: a second order_request letter in one house was admitted';
  exception when unique_violation then null;
  end;
  insert into public.communication_templates (restaurant_id, name, body, type, category)
  values ('a2514000-0000-4000-8000-000000000001', 'Second price ask', 'x', 'letter', 'price_query');
end
$$;

-- T7. The author's user row deleted: the author goes NULL, the version stays.
do $$
begin
  delete from public.users where user_id = 'a2514000-0000-4000-8000-0000000000a1';
  assert (select author from public.letter_template_versions
          where id = 'a2514000-0000-4000-8000-000000000301') is null,
    'T7: the deleted author is still named';
  assert (select body from public.letter_template_versions
          where id = 'a2514000-0000-4000-8000-000000000301') = '{{greeting}} v1',
    'T7: the version changed when its author left';
end
$$;

-- T8. Deleting the template removes its versions (the foreign key's own
-- delete passes the trigger), even while one is the published version.
do $$
begin
  delete from public.communication_templates where id = 'a2514000-0000-4000-8000-000000000101';
  assert not exists (select 1 from public.letter_template_versions
                     where template_id = 'a2514000-0000-4000-8000-000000000101'),
    'T8: versions outlived their template';
end
$$;

-- T9. Locked down: RLS on, no client grant.
do $$
begin
  assert (select relrowsecurity from pg_class
          where oid = 'public.letter_template_versions'::regclass),
    'T9: RLS is off on letter_template_versions';
  assert not has_table_privilege('anon', 'public.letter_template_versions', 'SELECT')
     and not has_table_privilege('authenticated', 'public.letter_template_versions', 'SELECT')
     and not has_table_privilege('authenticated', 'public.letter_template_versions', 'INSERT'),
    'T9: a client role can reach letter_template_versions';
end
$$;

rollback;
