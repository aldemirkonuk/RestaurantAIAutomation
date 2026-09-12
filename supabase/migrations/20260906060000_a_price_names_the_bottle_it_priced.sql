-- A price names the bottle it priced — ADR 0124 Q5, founder 2026-09-05 (batch 49):
-- "Yes, identity_id on price_history now."
--
-- WHAT Q5 ASKED, AND WHY IT COULD NOT STAY OPEN
-- ---------------------------------------------
-- ADR 0124 added `identity_id` to `restaurant_inventory`,
-- `vendor_price_observations` and `price_index_postings`
-- (`20260905140000_a_bottle_has_one_identity.sql`) and left `price_history` out,
-- naming the gap in its own Q5: *"A 12 x 375 case and a 6 x 750 case are now two
-- keys — is `price_history` next? ... Grouping by identity in the ladder makes
-- the two tables disagree about what a price is a price OF."*
--
-- That disagreement is not cosmetic. ADR 0119 Q4 made `price_history.unit` a
-- STATED value (NOT NULL, seven-word CHECK, no default,
-- `20260905072500`), so a case price and a bottle price now sit in the same
-- table honestly. The ladder groups by identity, where format is PART of the
-- key rather than a scale factor. With no `identity_id` here, the only join
-- available is `master_wine_id` — one library row for the 750 AND the magnum —
-- so the two registers would key the same trade on different things, and the
-- house's own paper could never be read beside a vendor's sighting of the same
-- bottle. The founder closed it: yes, now.
--
-- REJECTED: keep the two apart. The argument for it is real — `price_history`
-- is the house's own ledger of what IT paid, `vendor_price_observations` is the
-- market, and a column that only makes sense once somebody confirms an identity
-- is dead weight until then. It loses because the cost of adding the column
-- later is not the column: it is that every row written between now and then
-- carries no identity and can never be joined retroactively without re-deriving
-- an assertion nobody made. A nullable column costs one `ADD COLUMN`; a year of
-- unjoinable rows costs the ladder.
--
-- THE SHAPE, AND WHERE IT DIFFERS FROM ITS THREE SIBLINGS
-- -------------------------------------------------------
--   * NULLABLE, `REFERENCES beverage_identities(id) ON DELETE RESTRICT` --
--     identical to the three columns 20260905140000 added. NULL is a real
--     state: "this row has no confirmed identity", never "unknown, treat as
--     the same as its neighbour". ADR 0016.
--   * BACKFILLED, which the three siblings deliberately were not. Their
--     subjects (a house item, a vendor sighting, a posting) reach an identity
--     only through a person's confirmation. A `price_history` row already
--     carries `master_wine_id`, and ADR 0124's keys table records the library
--     link as `('mudavym:master_wine_library', <library row id>)` -- so where
--     that key names EXACTLY ONE identity, the link is a transcription of an
--     assertion somebody already made, not a new guess. Where it names none, or
--     more than one, the row is left NULL: ADR 0124's joiner treats an
--     ambiguous exact key as a REFUSAL, and this migration refuses the same way
--     rather than picking the lower uuid.
--   * The index is `(identity_id, unit)` and is NOT PARTIAL, unlike
--     `idx_vpo_identity` and its two siblings. Those are `WHERE identity_id IS
--     NOT NULL` because their readers filter to identified rows. The contract
--     here is the opposite and explicit: a reader groups by identity AND unit
--     and PRINTS the NULL group as "unidentified" rather than dropping it
--     (ADR 0016, ADR 0020). A partial index would serve every part of that
--     query except the one the decision exists to protect.
--
-- THE COUNT IS RECORDED WHETHER OR NOT IT CHANGED ANYTHING
-- --------------------------------------------------------
-- ADR 0078's rule, and `scripts/check_a_count_is_recorded.py`'s shape: a
-- backfill that resolves zero rows must leave the same trace as one that
-- resolves a thousand. Otherwise the migration log holds only the backfills
-- that found something, and "no NOTICE" reads identically to "never ran" --
-- `absence-reported-as-health`. So the NOTICE below fires unconditionally with
-- four numbers, and the assertion block re-derives them from the table rather
-- than trusting the variables.
--
-- MEASURED BEFORE WRITTEN (production `Restaurant_Wine_Ops` /
-- exzueerziesmczwlhomd, read-only, 2026-09-05, per ADR 0119's and ADR 0124's
-- own measurements): `price_history` holds 0 rows and `beverage_identities`
-- holds 0 rows, because nothing writes an identity yet. So the backfill's
-- expected result on the only surface that matters is 0 of 0, and this
-- migration invents nothing. It is written to be correct on a full table
-- anyway, because it will be re-run on every environment that fills first.
--
-- ADDITIVE: one nullable column, one index, three comments. No column dropped,
-- no type changed, no RLS change (`price_history` keeps the posture the
-- baseline gave it), and the only write is the backfill below.
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 0. Refuse to run against a tree where the parent does not exist yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.beverage_identities') is null then
    raise exception 'beverage_identities does not exist. 20260905140000_a_bottle_has_one_identity.sql must be applied first; a foreign key to a table that is not there is not a weaker link, it is no link.';
  end if;
  if to_regclass('public.beverage_identity_keys') is null then
    raise exception 'beverage_identity_keys does not exist, so the backfill below has nothing to read and would silently leave every row NULL while reporting success.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The link. Nullable, never guessed.
-- ---------------------------------------------------------------------------
alter table public.price_history
  add column if not exists identity_id uuid
    references public.beverage_identities(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. The backfill, and its count.
--
-- Only an UNAMBIGUOUS library link resolves. `having count(distinct
-- k.identity_id) = 1` is the whole rule: ADR 0124 measured 1,736 of Iowa's
-- 9,118 distinct UPCs naming more than one product, and built its joiner to
-- REFUSE an ambiguous exact key rather than choose. A backfill that chose here
-- would write, at scale and unattended, exactly the answer the joiner refuses
-- to give when a person is watching.
-- ---------------------------------------------------------------------------
do $$
declare
  total_rows        bigint;
  candidate_rows    bigint;  -- rows carrying a master_wine_id at all
  resolved_rows     bigint;  -- rows this backfill actually wrote
  ambiguous_rows    bigint;  -- rows whose library key named >1 identity
  unresolved_rows   bigint;  -- rows left NULL, for any reason
  pre_identified    bigint;  -- rows already carrying an identity before this ran
  final_identified  bigint;
begin
  select count(*) into total_rows from public.price_history;

  -- Counted BEFORE the update. Re-applying this file (add column if not
  -- exists) must not read its own earlier work as somebody else's write:
  -- the PGlite probe applied it twice and the assertion below fired on the
  -- second pass until this line existed.
  select count(*) into pre_identified
    from public.price_history where identity_id is not null;

  select count(*) into candidate_rows
    from public.price_history
   where master_wine_id is not null;

  select count(*) into ambiguous_rows
    from (
      select ph.id
        from public.price_history ph
        join public.beverage_identity_keys k
          on k.key_namespace = 'mudavym:master_wine_library'
         and k.key_value     = ph.master_wine_id::text
       where ph.master_wine_id is not null
         and ph.identity_id is null
       group by ph.id
      having count(distinct k.identity_id) > 1
    ) amb;

  with resolved as (
    -- `(array_agg(distinct ...))[1]` and not `min()`: Postgres has no
    -- `min(uuid)` (42883, caught by the PGlite probe before this file was
    -- ever applied anywhere). The HAVING below guarantees the aggregate
    -- holds exactly one distinct value, so the subscript is a read of the
    -- only candidate, never a choice between several.
    select ph.id as row_id, (array_agg(distinct k.identity_id))[1] as identity_id
      from public.price_history ph
      join public.beverage_identity_keys k
        on k.key_namespace = 'mudavym:master_wine_library'
       and k.key_value     = ph.master_wine_id::text
     where ph.master_wine_id is not null
       and ph.identity_id is null
     group by ph.id
    having count(distinct k.identity_id) = 1
  )
  update public.price_history ph
     set identity_id = r.identity_id
    from resolved r
   where ph.id = r.row_id;

  get diagnostics resolved_rows = row_count;

  select count(*) into final_identified
    from public.price_history where identity_id is not null;

  unresolved_rows := total_rows - final_identified;

  -- UNCONDITIONAL. Zero is a result, and it is recorded the same way a
  -- thousand would be (ADR 0078).
  raise notice
    'price_history.identity_id backfill: % row(s) in the table, % carrying a master_wine_id, % resolved through an unambiguous mudavym:master_wine_library key and WRITTEN, % refused as ambiguous (key named more than one identity), % left NULL. NULL is "unidentified" and every reader must print it, never drop it.',
    total_rows, candidate_rows, resolved_rows, ambiguous_rows, unresolved_rows;

  -- Assert the count rather than reporting success. Re-derived from the table,
  -- not read back off the variable that produced it.
  if final_identified <> pre_identified + resolved_rows then
    raise exception
      'price_history now holds % identified row(s); % were identified before this ran and this backfill wrote %. The three numbers must agree or the count in the NOTICE above is fiction.',
      final_identified, pre_identified, resolved_rows;
  end if;

  if final_identified + unresolved_rows <> total_rows then
    raise exception
      'the backfill accounts for % of % row(s). Every row is either identified or explicitly left NULL; a row in neither bucket means the count above is fiction.',
      final_identified + unresolved_rows, total_rows;
  end if;

  if exists (
    select 1
      from public.price_history ph
      join public.beverage_identity_keys k
        on k.key_namespace = 'mudavym:master_wine_library'
       and k.key_value     = ph.master_wine_id::text
     where ph.identity_id is not null
     group by ph.id, ph.identity_id
    having count(distinct k.identity_id) > 1
  ) then
    raise exception
      'a row was identified through a library key that names more than one identity. An ambiguous exact key is a REFUSAL (ADR 0124), never a choice made quietly at 3am by a migration.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The index the mandated read needs -- INCLUDING the NULL group.
-- ---------------------------------------------------------------------------
create index if not exists idx_price_history_identity_unit
  on public.price_history (identity_id, unit);

-- ---------------------------------------------------------------------------
-- 4. What the column means, where a reader will find it.
-- ---------------------------------------------------------------------------
comment on column public.price_history.identity_id is
  'The trade item this price is a price OF (ADR 0124 Q5, founder 2026-09-05: "Yes, identity_id on price_history now."). Nullable: NULL means the row has no confirmed identity, which readers must PRINT as "unidentified" and never drop or fold into a neighbouring group (ADR 0016, ADR 0020). Backfilled once, only where the row''s master_wine_id resolves through an UNAMBIGUOUS mudavym:master_wine_library key -- an ambiguous key is a refusal, never a choice. Read it TOGETHER WITH `unit`: identity fixes what the bottle is, unit fixes what the number counts, and a comparison that groups by one without the other is the same fault in two different disguises.';

comment on index public.idx_price_history_identity_unit is
  'Deliberately NOT partial, unlike idx_vpo_identity and its two siblings on the other identity registers. Those filter to identified rows; the contract here is that the unidentified group is PRINTED (ADR 0124 Q5), so an index that excludes NULL would serve every part of the mandated query except the part the decision exists to protect.';

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'price_history'
       and column_name  = 'identity_id'
  ) then
    raise exception 'price_history.identity_id was not created.';
  end if;

  -- NULLABLE, always. A NOT NULL here would force a guess on every row whose
  -- bottle nobody has identified, which is the entire failure this design
  -- refuses (the same assertion 20260905140000 makes about its three columns).
  if (select is_nullable from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'price_history'
         and column_name  = 'identity_id') <> 'YES' then
    raise exception 'price_history.identity_id must be nullable -- an unidentified price is a real state, not an error.';
  end if;

  if (select column_default from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'price_history'
         and column_name  = 'identity_id') is not null then
    raise exception 'price_history.identity_id must have NO default. A default is the mechanism that turned the old unit column into a constant that asserted "bottle" about every row (ADR 0119 Q4); it would do the same here with a bottle nobody identified.';
  end if;

  if not exists (
    select 1
      from pg_constraint pc
      join pg_class pcl on pcl.oid = pc.conrelid
      join pg_class ref on ref.oid = pc.confrelid
     where pcl.relname = 'price_history'
       and ref.relname = 'beverage_identities'
       and pc.contype  = 'f'
  ) then
    raise exception 'price_history.identity_id has no foreign key to beverage_identities. Without it the column is a uuid-shaped string that can name a row that never existed.';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'price_history'
       and indexname  = 'idx_price_history_identity_unit'
  ) then
    raise exception 'idx_price_history_identity_unit was not created; the read this decision mandates (group by identity AND unit) has no index behind it.';
  end if;
end $$;
