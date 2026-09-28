-- The shared wine library may say it does not know who made a wine, or where.
--
-- Antalya night. `wine-submissions.service.ts` writes three identity fields it
-- does not have, on every row it creates, because the columns forbid null:
--
--     producer: item.producer || item.name       -- the wine's OWN NAME
--     country:  item.country  || "Unknown"       -- a country called Unknown
--
-- Measured on production 2026-09-05, read-only:
--
--     master_wine_library                                4252 rows
--     country = 'Unknown'                                 328
--     region  = 'Unknown'                                 340
--     source  = 'menu_import'                              77
--     ...of which country = 'Unknown'                      77   (100%)
--     ...of which producer = the row's own name            48   (62%)
--
-- This is not a display problem. `master_wine_library` is the SHARED catalogue
-- every tenant matches against, and producer is an identity attribute: a row
-- whose producer is "House White Wine" claims a producer by that name exists.
--
-- Worse, the placeholder and the key disagree. `signature_hash` is computed
-- over the resolved reading — `item.producer ?? null`, `item.country ?? null`
-- (wine-submissions.service.ts:440-447) — while the ROW stores the fabricated
-- string. So the canonical row misrepresents the very identity its dedup key
-- was taken over, and anyone reading the row to understand the hash is reading
-- something that was never hashed.
--
-- `NOT NULL` on a column the writer cannot fill is a schema that requires a
-- lie. The fix is the same shape as simpos_catalog.price
-- (20260905174500): let the column hold the truth, and let the UI render it.
--
-- primary_type is deliberately NOT relaxed. Its 'unknown' is a member of a
-- vocabulary — a value that says "unclassified" — not a placeholder standing in
-- for a real answer, and beverage_kind's classifier already depends on it.

-- ---------------------------------------------------------------------------
-- 1. The columns may be unknown
-- ---------------------------------------------------------------------------

alter table public.master_wine_library
  alter column producer drop not null,
  alter column country  drop not null;

comment on column public.master_wine_library.producer is
  'Who made this wine, or NULL when nobody has said. NULL — never the wine''s '
  'own name, which is what `producer || name` wrote on 48 of 77 menu-import '
  'rows before 2026-09-06. This is an identity attribute on a SHARED catalogue: '
  'a fabricated producer asserts that a producer by that name exists, to every '
  'tenant that matches against it.';

comment on column public.master_wine_library.country is
  'Country of origin, or NULL when unknown. NOT the string ''Unknown'', which '
  '328 rows still carry and which sorts, groups and filters as though it were a '
  'country.';

-- ---------------------------------------------------------------------------
-- 2. No backfill of the 328 — and why
-- ---------------------------------------------------------------------------
--
-- It is tempting to `UPDATE ... SET country = NULL WHERE country = 'Unknown'`,
-- and it is wrong twice over.
--
-- First, `signature_hash` is a stored column computed over the identity
-- fields. Rewriting producer or country without recomputing the hash leaves the
-- row keyed on a signature its own columns no longer produce — the exact
-- disagreement this migration exists to stop, introduced by the repair.
--
-- Second, 'Unknown' is not always a placeholder this code wrote. The library
-- has 4252 rows from several sources over months; some of those strings may
-- have arrived from a vendor file or been typed by a human meaning it. This
-- migration cannot tell those apart, and a repair that cannot tell which rows
-- it is repairing is a guess applied at scale.
--
-- So the writer is fixed here and the existing rows are left, honestly
-- described, for a migration that can recompute the hash alongside the value.
-- Filed in v3.0-TECH-DEBT.md rather than silently carried.

do $$
declare
  n_country integer;
  n_region  integer;
begin
  select count(*) into n_country from public.master_wine_library where country = 'Unknown';
  select count(*) into n_region  from public.master_wine_library where region  = 'Unknown';
  raise notice
    'master_wine_library placeholders left in place (see TECH-DEBT): country=Unknown on % row(s), region=Unknown on % row(s). The writer no longer creates them.',
    n_country, n_region;
end $$;
