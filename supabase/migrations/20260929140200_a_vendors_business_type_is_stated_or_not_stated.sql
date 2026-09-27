-- A vendor's business type is stated by a person, or it is "Not stated" —
-- never guessed.
--
-- THE FOUNDER, 2026-09-21, answer (1):
--   "a vendor added without a business type gets a new 'Not stated' choice
--    instead of silently becoming 'Distributor' - nothing assumed, settable
--    later."
--
-- ---------------------------------------------------------------------------
-- THE COLUMN THAT WAS NEVER THERE
-- ---------------------------------------------------------------------------
-- `providers.vendor_type` has been read and written by `providers.service.ts`
-- since before this migration existed, and no migration — checked against
-- baseline:4854-4901 and every file since — has ever created it or any column
-- named `primary_business_type`. `match_restaurant_providers.sql:87-89`
-- already recorded the same finding for the RPC's SELECT list: "providers has
-- no vendor_type / primary_business_type column at all".
--
-- Three consequences, all measured on this branch before this migration:
--   1. `ProvidersService.updateProvider` wrote `vendor_type: ...` into a
--      column that does not exist. The value never got that far anyway: the
--      app's global ValidationPipe is `whitelist: true,
--      forbidNonWhitelisted: true` (main.ts:52-56), and `UpdateProviderDto`
--      never declared `primaryBusinessType`, so an update carrying it was
--      refused with a 400 before the controller ever ran.
--   2. `ProvidersService.createProvider`'s custom-vendor path (Mode B) never
--      set the column at all — CreateProviderDto's `type` field was declared
--      and never read into the insert payload.
--   3. `apps/web/src/services/api/providers.ts#mapProviderToApiPayload` never
--      sent `primaryBusinessType` in the HTTP body in the first place, so the
--      web form's "What they are" select was local component state only —
--      chosen, rendered, and discarded on submit. Both the rebuilt sheet
--      (`NewVendorSheet.tsx`) and the legacy modal
--      (`AddProviderModal.tsx`) defaulted that local state to `'Distributor'`
--      when nothing was typed, so a vendor added by clicking straight through
--      read back, on screen, as a distributor nobody said it was.
--
-- This migration adds the real column. The gateway and web fixes that read
-- and write it, and the "Not stated" choice that replaces the `'Distributor'`
-- default, are in the same commit.
--
-- ---------------------------------------------------------------------------
-- WHY NO DEFAULT AND NO CHECK CONSTRAINT
-- ---------------------------------------------------------------------------
-- Same rule as `20260903170000_a_default_is_not_an_answer.sql`: a default is
-- indistinguishable from an answer, so there is none. NULL is "Not stated" —
-- the UI's own new choice — and nothing here or in the application layer ever
-- substitutes a value for it.
--
-- No CHECK restricts the value to a fixed set either. `AddProviderModal.tsx`
-- already lets a house type its OWN business type ("Now accepts custom types
-- too") beyond the three the picker offers (Distributor / Importer /
-- Wholesaler), and the gateway DTO's own description has named a wider set
-- since before this file existed ("distributor, importer, wholesaler,
-- winery_direct, broker, other"). Constraining the column now would make that
-- existing, shipped behaviour a 400.
--
-- ADDITIVE. One column, two comments. No table created, no column altered or
-- dropped, no RLS change (the table's existing policies already scope every
-- row by `restaurant_id`, unaffected by adding a column), no data written.

SET local statement_timeout = '120s';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS primary_business_type TEXT;

COMMENT ON COLUMN public.providers.primary_business_type IS
  'What kind of business this vendor is (distributor, importer, wholesaler, or a house''s own free text), TYPED BY A PERSON. Nullable and normally null; no default and no derivation, ever (founder, 2026-09-21). NULL renders as the create/edit sheet''s "Not stated" choice — never assumed as ''Distributor''. Superseded columns `vendor_type` in ProviderRow (providers.service.ts) never existed as a database column; this is the first real one.';
