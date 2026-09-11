-- Repair the master_wine_library rows the two sim nights wrote with fabricated
-- identity fields. ADR 0130; founder-authorised 2026-09-05, scope fixed to
-- Sim Meyhouse a229f22b-… and Sim Vanilla Kaleiçi 684920db-… .
--
-- THIS IS A DATA OPERATION, NOT A MIGRATION. It must never be placed in
-- supabase/migrations: migrations auto-apply on merge and rebuild a fresh
-- database that never held these rows (memory/deleting-fabricated-production-rows
-- rule 7, memory/schema-parity-drift-diagnosis).
--
-- It deletes nothing. Every FK to master_wine_library was read first
-- (datasets/library/REPAIR-2026-09-05-measure.md §3) precisely so that this
-- could be stated rather than hoped: no ON DELETE CASCADE can fire, because no
-- DELETE is issued.
--
-- It is idempotent. Each UPDATE is self-limiting — it fires only while the
-- fabricated value is still there — so a real value entered later survives, and
-- a second run is a no-op (rule 4).
--
-- It refuses to run on a database that does not look like the one measured.
-- Every count is asserted against the measurement; anything else raises and
-- the whole transaction rolls back.
--
--   Class A  48 rows  producer = the wine's own name. The fabrication was the
--                     only thing making the identity "specific". Owner set to
--                     the one venue that stocks it; producer and country nulled.
--                     The trigger rekeys them under venue:<id>| .
--   Class B  29 rows  producer is real; only country = 'Unknown' is fabricated.
--                     Country nulled; the row stays in the shared library.
--   Cross    1 row    Antalya's "House White Wine" is given its own provisional
--                     row; its inventory, lot and pour events are repointed at
--                     it. Sim Bistro's ac6a550f row is left byte-identical.

\set ON_ERROR_STOP on

begin;

do $repair$
declare
  c_meyhouse    constant uuid := 'a229f22b-2aac-4e54-a8b2-033a8f93ac5e';
  c_antalya     constant uuid := '684920db-e416-4099-9969-66873afa6c57';
  c_house_white constant uuid := 'ac6a550f-cbff-5ea6-9672-8504127a2c89';

  -- The measurement this repair was planned against (stop 1, 2026-09-05).
  k_class_a  constant integer := 48;
  k_class_b  constant integer := 29;
  k_hw_inv   constant integer := 1;
  k_hw_lots  constant integer := 1;
  k_hw_pours constant integer := 2;

  pre_a  integer; pre_b  integer;
  pre_hi integer; pre_hl integer; pre_hp integer;
  did_a  integer; did_b  integer;
  did_hi integer; did_hl integer; did_hp integer; did_hw integer;
  fresh  boolean;
  shared integer;
  hw_before text; hw_after text;
  v_new_id uuid;
begin

  ---------------------------------------------------------------------------
  -- 0. Refuse to touch a row any tenant outside the scope also references.
  --    Measured as 0; asserted here so a later cross-link cannot be repaired
  --    away silently.
  ---------------------------------------------------------------------------
  select count(*) into shared
  from public.master_wine_library m
  where m.source = 'menu_import'
    and exists (select 1 from public.restaurant_inventory ri
                 where ri.master_wine_id = m.id
                   and ri.restaurant_id not in (c_meyhouse, c_antalya));
  if shared <> 0 then
    raise exception
      'ABORT: % menu_import row(s) are referenced by a tenant outside the authorised scope. A shared row is never altered. Re-measure before proceeding.', shared;
  end if;

  -- The other tenant's row, fingerprinted before anything runs.
  select md5(t::text) into hw_before
  from public.master_wine_library t where t.id = c_house_white;

  ---------------------------------------------------------------------------
  -- 1. Pre-counts. Either this is the measured database, or it is already
  --    repaired. Nothing else is allowed to proceed.
  ---------------------------------------------------------------------------
  select count(*) into pre_a from public.master_wine_library m
   where m.source = 'menu_import'
     and m.provisional_for_restaurant_id is null
     and m.country = 'Unknown'
     and m.producer is not null
     and public.wine_normalize_text(m.producer) = public.wine_normalize_text(m.name);

  select count(*) into pre_b from public.master_wine_library m
   where m.source = 'menu_import'
     and m.country = 'Unknown'
     and (m.producer is null
          or public.wine_normalize_text(m.producer) <> public.wine_normalize_text(m.name));

  select count(*) into pre_hi from public.restaurant_inventory
   where restaurant_id = c_antalya and master_wine_id = c_house_white;
  select count(*) into pre_hl from public.inventory_lots
   where restaurant_id = c_antalya and master_wine_id = c_house_white;
  select count(*) into pre_hp from public.pour_events
   where restaurant_id = c_antalya and master_wine_id = c_house_white;

  fresh := (pre_a = k_class_a and pre_b = k_class_b
            and pre_hi = k_hw_inv and pre_hl = k_hw_lots and pre_hp = k_hw_pours);

  if not fresh then
    if pre_a = 0 and pre_b = 0 and pre_hi = 0 and pre_hl = 0 and pre_hp = 0 then
      raise notice 'Already repaired — every candidate count is 0. Continuing as a no-op.';
    else
      raise exception
        'ABORT: pre-state does not match the measurement. class_a %/%, class_b %/%, house-white inventory %/%, lots %/%, pours %/%. Re-measure; do not force.',
        pre_a, k_class_a, pre_b, k_class_b, pre_hi, k_hw_inv, pre_hl, k_hw_lots, pre_hp, k_hw_pours;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 2. Class A — the fabricated producer was load-bearing. Give the row to the
  --    one venue that stocks it and write absence as absence. The trigger
  --    recomputes signature_hash under wine_provisional_signature_hash(), whose
  --    'venue:' prefix cannot collide with any shared key by construction.
  ---------------------------------------------------------------------------
  with owner as (
    select ri.master_wine_id as wid, min(ri.restaurant_id::text)::uuid as rid
    from public.restaurant_inventory ri
    where ri.restaurant_id in (c_meyhouse, c_antalya)
    group by ri.master_wine_id
    having count(distinct ri.restaurant_id) = 1
  )
  update public.master_wine_library m
     set provisional_for_restaurant_id = o.rid,
         producer = null,
         country  = null
    from owner o
   where o.wid = m.id
     and m.source = 'menu_import'
     and m.provisional_for_restaurant_id is null
     and m.country = 'Unknown'
     and m.producer is not null
     and public.wine_normalize_text(m.producer) = public.wine_normalize_text(m.name);
  get diagnostics did_a = row_count;

  ---------------------------------------------------------------------------
  -- 3. Class B — a real producer, a fabricated country. This is the backfill
  --    20260906023000 deferred because it "cannot tell which rows it is
  --    repairing"; inside this scope it can, and the trigger recomputes the
  --    hash alongside the value, which is the other half of what that
  --    migration asked for.
  ---------------------------------------------------------------------------
  update public.master_wine_library m
     set country = null
   where m.source = 'menu_import'
     and m.country = 'Unknown'
     and (m.producer is null
          or public.wine_normalize_text(m.producer) <> public.wine_normalize_text(m.name));
  get diagnostics did_b = row_count;

  ---------------------------------------------------------------------------
  -- 4. The cross-tenant link. Antalya wrote "House White Wine"; the resolver
  --    bound it to Sim Bistro's California row and inventory.service then
  --    persisted that row's name over the venue's own. Give the venue its own
  --    provisional row and move its records onto it. Sim Bistro's row, its
  --    inventory, its lot, its pour event, its four menu_items and its
  --    submission row are not touched.
  ---------------------------------------------------------------------------
  select id into v_new_id from public.master_wine_library
   where provisional_for_restaurant_id = c_antalya
     and name = 'House White Wine'
     and deleted_at is null;

  if v_new_id is null then
    insert into public.master_wine_library
      (wine_id, name, producer, vintage, country, region, grape_variety,
       primary_type, library_tier, source, review_status,
       provisional_for_restaurant_id)
    values
      -- wine_id is varchar(20) and UNIQUE; the dry run caught a longer
      -- literal as `value too long for type character varying(20)`.
      ('WINE_rpr0905ahw', 'House White Wine',
       null, null, null, null, null,
       'unknown', 3, 'menu_import', 'pending', c_antalya)
    returning id into v_new_id;
    did_hw := 1;
  else
    did_hw := 0;
  end if;

  update public.restaurant_inventory
     set master_wine_id = v_new_id,
         wine_name      = 'House White Wine'   -- the venue's own words, restored
   where restaurant_id = c_antalya and master_wine_id = c_house_white;
  get diagnostics did_hi = row_count;

  update public.inventory_lots
     set master_wine_id = v_new_id
   where restaurant_id = c_antalya and master_wine_id = c_house_white;
  get diagnostics did_hl = row_count;

  update public.pour_events
     set master_wine_id = v_new_id
   where restaurant_id = c_antalya and master_wine_id = c_house_white;
  get diagnostics did_hp = row_count;

  -- wine_consumption_log reaches a wine only through inventory_id, which did
  -- not change, so its rows follow the repointed inventory row with no write.

  ---------------------------------------------------------------------------
  -- 5. Assert what happened equals what was planned.
  ---------------------------------------------------------------------------
  if fresh then
    if did_a <> k_class_a or did_b <> k_class_b
       or did_hi <> k_hw_inv or did_hl <> k_hw_lots or did_hp <> k_hw_pours
       or did_hw <> 1 then
      raise exception
        'ABORT: applied counts differ from the measurement. class_a %/%, class_b %/%, inventory %/%, lots %/%, pours %/%, new row %/1.',
        did_a, k_class_a, did_b, k_class_b, did_hi, k_hw_inv, did_hl, k_hw_lots, did_hp, k_hw_pours, did_hw;
    end if;
  else
    if did_a <> 0 or did_b <> 0 or did_hi <> 0 or did_hl <> 0 or did_hp <> 0 or did_hw <> 0 then
      raise exception
        'ABORT: a re-run wrote rows (a=% b=% inv=% lots=% pours=% new=%). The repair is not idempotent; investigate.',
        did_a, did_b, did_hi, did_hl, did_hp, did_hw;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 6. Post-state invariants — true after a first run and after a re-run.
  ---------------------------------------------------------------------------
  select md5(t::text) into hw_after
  from public.master_wine_library t where t.id = c_house_white;
  if hw_after is distinct from hw_before then
    raise exception 'ABORT: the other tenant''s HOUSE WHITE row changed. It must be byte-identical.';
  end if;

  perform 1 from public.master_wine_library
   where source = 'menu_import' and country = 'Unknown';
  if found then
    raise exception 'ABORT: a sim-tenant row still carries country = ''Unknown''.';
  end if;

  perform 1 from public.master_wine_library
   where source = 'menu_import' and producer is not null
     and public.wine_normalize_text(producer) = public.wine_normalize_text(name);
  if found then
    raise exception 'ABORT: a sim-tenant row still carries producer = its own name.';
  end if;

  perform 1 from public.v_signature_drift;
  if found then
    raise exception 'ABORT: v_signature_drift is non-empty — a stored hash no longer matches its own identity fields.';
  end if;

  perform 1 from public.master_wine_library m
   where m.provisional_for_restaurant_id is not null
     and exists (select 1 from public.restaurant_inventory ri
                  where ri.master_wine_id = m.id
                    and ri.restaurant_id <> m.provisional_for_restaurant_id);
  if found then
    raise exception 'ABORT: a venue-owned row is stocked by a different venue.';
  end if;

  if (select count(*) from public.restaurant_inventory
       where restaurant_id = c_antalya and master_wine_id = c_house_white) <> 0 then
    raise exception 'ABORT: Antalya still points at the other tenant''s HOUSE WHITE row.';
  end if;

  raise notice 'REPAIR OK — class_a % · class_b % · house-white row % (inventory % / lots % / pours % repointed) · other tenant''s row unchanged · drift 0',
    did_a, did_b, coalesce(v_new_id::text,'?'), did_hi, did_hl, did_hp;
end
$repair$;

commit;
