-- N3 (BEVERAGE_CATALOGUE_PLAN.md): stamp WHEN enrichment touched a row,
-- distinct from `updated_at`, which any write bumps -- a manual edit, a
-- merge, a price change. Without a dedicated column, "when did we LEARN
-- this attribute" is indistinguishable from "when was this row last saved
-- for any reason", and that distinction cannot be reconstructed once lost
-- (arch §9.3 -- point-in-time correctness is the thing that cannot be
-- backfilled; training a model on today's enriched attributes against
-- last quarter's sales is the failure this prevents, arch §10.6 M4).
--
-- Deliberately a single per-row timestamp, not a full append-only
-- observation log. The heavier design (one row per attribute per
-- observation) is the correct SHAPE for true bitemporal correctness, but
-- has no consumer yet: pos_checks/sales_events/recommendation_actions are
-- all empty today (arch §9.4), so building it now would be exactly the
-- "infrastructure for data that does not exist" mistake this plan
-- elsewhere refuses (arch §4.2/§9.4). This column is the cheap, cannot-
-- backfill-later part; the full log is deferred to when a training
-- pipeline actually exists to consume it.
--
-- Implemented as a TRIGGER, not application-code writes, and that choice
-- is the point: a column stamped by individual call sites is one someone
-- forgets. This one is enforced by construction for every current writer
-- (wine-submissions.service.ts, wines.service.ts,
-- scripts/load_enriched_wines.py) and every future one (the research
-- agent, once it lands blend percentages) without any of them knowing
-- this column exists.

alter table master_wine_library
  add column if not exists enrichment_observed_at timestamptz;

comment on column master_wine_library.enrichment_observed_at is
  'When enrichment (data_enrichment/field_confidences) last changed on this row. Distinct from updated_at, which any write bumps. Auto-stamped by trg_wine_enrichment_observed_at -- never set by application code -- so no future writer can forget it. NULL for rows enriched before this column existed; that history cannot be recovered (BEVERAGE_CATALOGUE_ARCHITECTURE.md §9.3).';

create or replace function set_wine_enrichment_observed_at()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT'
      and (new.data_enrichment is not null or new.field_confidences is not null))
     or (tg_op = 'UPDATE'
         and (new.data_enrichment is distinct from old.data_enrichment
              or new.field_confidences is distinct from old.field_confidences)) then
    new.enrichment_observed_at := now();
  end if;
  return new;
end;
$$;

comment on function set_wine_enrichment_observed_at() is
  'Stamps enrichment_observed_at whenever data_enrichment or field_confidences actually changes -- not on every touch of the row, so an unrelated price/status edit does not falsely read as a re-enrichment event.';

drop trigger if exists trg_wine_enrichment_observed_at on master_wine_library;
create trigger trg_wine_enrichment_observed_at
  before insert or update on master_wine_library
  for each row
  execute function set_wine_enrichment_observed_at();

-- Backfill: rows that already carry enrichment data are stamped with
-- updated_at as the best available approximation (they were enriched no
-- LATER than their last update) rather than left NULL and silently
-- excluded from any future "enriched since T" query. This is an
-- approximation, not a recovery of the true fact -- see the column
-- comment -- and is stated as such rather than presented as precise.
update master_wine_library
   set enrichment_observed_at = updated_at
 where enrichment_observed_at is null
   and (data_enrichment is not null or field_confidences is not null);
