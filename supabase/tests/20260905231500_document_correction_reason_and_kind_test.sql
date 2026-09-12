-- SQL tests for 20260905231500_document_correction_reason_and_kind.sql.
--
-- HOW TO RUN. Plain psql assertions against a throwaway Postgres built from
-- supabase/migrations in filename order (recipe: pgvector/pgvector:pg17 +
-- postgresql-17-postgis-3, the Supabase roles and schemas, pgcrypto/uuid-ossp in
-- `extensions`, pg_trgm/btree_gist/vector/postgis in `public`, an `auth.users`
-- stub, the PostGIS revokes). Then:
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/20260905231500_document_correction_reason_and_kind_test.sql
--
-- Every assertion RAISEs on failure. The whole file runs in one transaction that
-- is ROLLED BACK: it writes fixtures and leaves nothing behind. NEVER run it
-- against production. All fixture data below is SYNTHETIC.

begin;

insert into public.restaurants (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'SYNTHETIC Meyhane A', 'synthetic-a');

insert into public.procurement_documents (id, restaurant_id, doc_type, source_channel)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        'invoice', 'email');

-- ---------------------------------------------------------------------------
-- T16 — the two new columns exist with the stated shape: `reason` nullable
--       (a row written before the door existed has none, and a default would
--       fabricate one), `kind` NOT NULL defaulting to 'correction'.
-- ---------------------------------------------------------------------------
do $$
declare reason_nullable text; kind_nullable text; kind_default text;
begin
  select is_nullable into reason_nullable from information_schema.columns
   where table_schema='public' and table_name='document_corrections' and column_name='reason';
  select is_nullable, column_default into kind_nullable, kind_default
    from information_schema.columns
   where table_schema='public' and table_name='document_corrections' and column_name='kind';

  if reason_nullable is null then
    raise exception 'T16 FAILED: document_corrections.reason does not exist';
  end if;
  if reason_nullable <> 'YES' then
    raise exception 'T16 FAILED: reason must be nullable, got %', reason_nullable;
  end if;
  if kind_nullable is null then
    raise exception 'T16 FAILED: document_corrections.kind does not exist';
  end if;
  if kind_nullable <> 'NO' then
    raise exception 'T16 FAILED: kind must be NOT NULL, got %', kind_nullable;
  end if;
  if kind_default is null or kind_default not like '%correction%' then
    raise exception 'T16 FAILED: kind default must be ''correction'', got %', coalesce(kind_default,'<none>');
  end if;
  raise notice 'T16 ok — reason nullable, kind NOT NULL default correction';
end;
$$;

-- ---------------------------------------------------------------------------
-- T17 — `kind` accepts exactly the two literals the reader switches on, and
--       refuses a third. A verification that could be spelled `verify` would
--       silently never match the reader's `=== "verification"`.
-- ---------------------------------------------------------------------------
insert into public.document_corrections (document_id, revision, field_path, before, after, reason, kind)
values ('44444444-4444-4444-4444-444444444444', 2, 'lines[0].netPrice',
        '{"value":142}'::jsonb, '{"value":132}'::jsonb, 'the paper says 132,00', 'correction'),
       ('44444444-4444-4444-4444-444444444444', 3, 'documentNumber',
        '{"value":"A-1"}'::jsonb, '{"value":"A-1"}'::jsonb, null, 'verification');

do $$
declare refused boolean := false;
begin
  begin
    insert into public.document_corrections (document_id, revision, field_path, kind)
    values ('44444444-4444-4444-4444-444444444444', 4, 'documentNumber', 'verify');
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'T17 FAILED: kind accepted a literal outside (correction, verification)';
  end if;
  raise notice 'T17 ok — kind accepts correction and verification, refuses a third';
end;
$$;

-- ---------------------------------------------------------------------------
-- T18 — ADDING THE COLUMNS DID NOT WEAKEN APPEND-ONLY. The slice-1 trigger is a
--       ROW trigger on UPDATE/DELETE; ALTER TABLE ... ADD COLUMN is DDL and does
--       not fire it, so the guarantee must still hold on the NEW columns too.
--       This is the assertion the brief asks for, aimed at the columns this
--       migration introduced: an attempted UPDATE of `reason` is refused.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false; still_there text;
begin
  begin
    update public.document_corrections set reason = 'rewritten after the fact'
     where document_id = '44444444-4444-4444-4444-444444444444' and revision = 2;
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'T18 FAILED: an UPDATE of document_corrections.reason was allowed';
  end if;

  select reason into still_there from public.document_corrections
   where document_id = '44444444-4444-4444-4444-444444444444' and revision = 2;
  if still_there <> 'the paper says 132,00' then
    raise exception 'T18 FAILED: the reason changed to %', still_there;
  end if;
  raise notice 'T18 ok — the new columns are append-only like the rest of the row';
end;
$$;

-- ---------------------------------------------------------------------------
-- T19 — a DELETE of a correction row is still refused, so a correction log
--       cannot be pruned to hide a change a vendor dispute rests on.
-- ---------------------------------------------------------------------------
do $$
declare refused boolean := false; n integer;
begin
  begin
    delete from public.document_corrections
     where document_id = '44444444-4444-4444-4444-444444444444';
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'T19 FAILED: a DELETE on document_corrections was allowed';
  end if;
  select count(*) into n from public.document_corrections
   where document_id = '44444444-4444-4444-4444-444444444444';
  if n <> 2 then
    raise exception 'T19 FAILED: expected 2 correction rows, found %', n;
  end if;
  raise notice 'T19 ok — corrections cannot be deleted';
end;
$$;

rollback;
