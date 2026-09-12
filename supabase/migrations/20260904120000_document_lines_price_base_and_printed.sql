-- ADR 0104 D1 / D12 slice 2, deliverable 0 — make the price base and the
-- printed literals STORABLE.
--
-- WHAT WAS BROKEN. PR #298 (`ff62668c`) taught the extractor to read BT-149
-- (item price base quantity), BT-150 (its unit) and the literal glyphs a
-- document printed for each money and quantity field, and carried them on
-- `ParsedLine` / `ParsedDocument`. Nothing persisted them:
-- `procurement_document_lines` has no column for any of the three, so the
-- values existed only for the length of one HTTP request. A document read back
-- from the database therefore yielded `priceBaseQty: null` and no `as_printed`
-- on any envelope — and `CanonicalDocumentService.toParsedDocument` said so in
-- a comment ("no BT-149/BT-150 columns yet") rather than being wrong about it.
--
-- WHY IT MATTERS ON SCREEN. `142,00 / KS(12)` and `142,00` are the same three
-- digits and a factor of twelve apart. Slice 2's sheet prints the price base as
-- a sub-line under the unit price, and prints `as printed "…"` under every
-- field's provenance. Without these columns both render as absent — which the
-- template would then have to describe as "not kept", when the truth is "never
-- stored". Those are different sentences and only one of them is honest.
--
-- ADDITIVE AND NULLABLE, on purpose. Every existing row genuinely has no
-- printed basis and no kept literals: the extraction that produced them never
-- had the fields. A DEFAULT of `1` on `price_base_qty` would assert the paper
-- printed a per-unit price on ten years of documents nobody read that way, and
-- `'{}'::jsonb` on `printed` would assert we kept literals we did not. NULL is
-- the true value and the only safe backfill, which is why there is none.
--
-- `price_base_uom` carries the SAME seven singulars every other unit column in
-- this schema is constrained to (20260901150000_order_line_capture_and_units.sql
-- unified them), so a price base can never be stated in a unit the quantity
-- comparison cannot read.

alter table public.procurement_document_lines
  add column if not exists price_base_qty numeric(12,3),
  add column if not exists price_base_uom text,
  add column if not exists printed jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_document_lines_price_base_uom_check'
  ) then
    alter table public.procurement_document_lines
      add constraint procurement_document_lines_price_base_uom_check
      check (price_base_uom is null or price_base_uom in
             ('bottle','case','keg','pack','split_case','each','liter'));
  end if;

  -- A base quantity of zero cannot be divided by, and a negative one is not a
  -- quantity. `lineNetFromPrice` already refuses both with a named problem
  -- rather than guessing; the column refuses to hold them at all, so a bad
  -- write cannot become a stored fact that every later read has to re-refuse.
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_document_lines_price_base_qty_check'
  ) then
    alter table public.procurement_document_lines
      add constraint procurement_document_lines_price_base_qty_check
      check (price_base_qty is null or price_base_qty > 0);
  end if;
end;
$$;

comment on column public.procurement_document_lines.price_base_qty is
  'EN 16931 BT-149 — the quantity `unit_price` is stated FOR, when the document prints one (`142,00 / KS(12)` is 12). NULL means the paper did not say, never "assume 1": a guessed base is wrong by exactly the pack size. ADR 0104 D1.';
comment on column public.procurement_document_lines.price_base_uom is
  'EN 16931 BT-150 — the unit `price_base_qty` is counted in, in the same seven singulars as `uom`. NULL when the document printed no basis.';
comment on column public.procurement_document_lines.printed is
  'The literal glyphs the document printed, keyed by field (`qty`, `unitPrice`, `lineTotal`, `allowance`, `deposit`, `priceBaseQty`). NEVER reformatted — `1.234,56` stays `1.234,56` — so the screen can show what the paper said beside what we concluded (ADR 0104 D1, `as_printed`). ABSENT means we did not keep it; it never means the paper was blank.';

alter table public.procurement_documents
  add column if not exists printed jsonb;

comment on column public.procurement_documents.printed is
  'Printed literals for the DOCUMENT''s own money fields (`total`, `subtotal`, `tax`, `freight`, …). Same contract as procurement_document_lines.printed: kept unreformatted, absent when not kept.';
