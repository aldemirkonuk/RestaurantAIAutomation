-- a_library_price_names_its_currency — the shared wine library's reference
-- price says which currency it was recorded in (F-918).
--
-- WHAT WAS WRONG
-- --------------
-- master_wine_library.price_reference is a bare numeric(10,2)
-- (20260805000000_baseline_from_production.sql, the table's CREATE). Most
-- priced rows came off restaurant menus in the US and in Türkiye alike
-- (ADR 0117, menu_corpus), so the same 62 is dollars on one row and lira on
-- the next. The cellar printed it as "Market average" in the house's own
-- currency: ₺62 in a lira house, $62 in a dollar house, for one number, drawn
-- beside the house's own bottle price as if the two compared.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds price_reference_currency text, an ISO 4217 code (three capitals) or
-- NULL. NULL means "not recorded". Every existing row stays NULL: the corpus
-- never kept the currency, and guessing one (dollars, say) is the exact error
-- this column exists to stop. No backfill, by design.
--
-- The page shows a reference price beside a house's money only when this
-- column names that house's currency; NULL or another currency is not shown.
-- A writer that knows the currency of the price it writes sets it; one that
-- does not leaves it NULL.
--
-- Additive and idempotent: no row is rewritten, no policy or grant changes
-- (the table's existing ones cover the new column).

alter table public.master_wine_library
  add column if not exists price_reference_currency text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'master_wine_library_price_reference_currency_iso'
       and conrelid = 'public.master_wine_library'::regclass
  ) then
    alter table public.master_wine_library
      add constraint master_wine_library_price_reference_currency_iso
      check (price_reference_currency is null or price_reference_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.master_wine_library.price_reference_currency is
  'ISO 4217 code price_reference was recorded in; NULL = not recorded (never assume one). '
  'A reference price is shown beside a house''s money only when this names the house''s currency (F-918).';
