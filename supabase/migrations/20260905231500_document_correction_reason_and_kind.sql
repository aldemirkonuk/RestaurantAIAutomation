-- A correction says WHY, and a verification is not a correction (ADR 0104 D5, slice 3).
--
-- WHAT THIS IS
-- ------------
-- Slice 1 built `document_corrections` with who / when / which field / what was
-- there before (20260903160000). Slice 3 opens the door that writes it, and the
-- door carries two facts the table cannot hold yet:
--
--   reason  the human sentence the corrector typed. ADR 0104 D5 makes the
--           correction log the evidence a vendor dispute rests on, and a log of
--           "142,00 became 132,00" with no reason is a change, not evidence.
--           NULLABLE, because every row written before this column existed
--           genuinely has no reason and defaulting one would fabricate it.
--
--   kind    'correction' (the value changed) or 'verification' (a human ticked
--           `verified_by` on a value they did not change — the per-field tick of
--           D5). Explicit, NOT inferred from `before` and `after` being equal:
--           a reader that infers it would call a correction-that-restored-the-
--           same-value a verification, and this repository's standing fault is
--           exactly a system inferring a state it was never told.
--
-- BOTH ARE ADDITIVE. `document_corrections` carries an append-only trigger on
-- UPDATE and DELETE (`refuse_append_only_mutation`); ALTER TABLE ... ADD COLUMN
-- is DDL and does not fire a row trigger, so the append-only guarantee is
-- untouched — proven by T3 in the slice-1 SQL test file, which still runs, and
-- by T16/T17 in this migration's own test file.
--
-- The DEFAULT on `kind` is 'correction' because every row that existed before
-- this migration was written by no door at all (the table has zero writers on
-- `main` at the time of this migration) — and because the only door that could
-- have written one is the correction door. That default is stated here rather
-- than assumed by a reader.

alter table public.document_corrections
  add column if not exists reason text,
  add column if not exists kind   text not null default 'correction';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_corrections_kind_check') then
    alter table public.document_corrections
      add constraint document_corrections_kind_check
      check (kind in ('correction','verification'));
  end if;
end;
$$;

comment on column public.document_corrections.reason is
  'Why the human changed it, in their words (ADR 0104 D5). NULL means no reason was recorded — never "no reason existed".';
comment on column public.document_corrections.kind is
  'ADR 0104 D5. `correction` changed the value; `verification` is the per-field verified_by tick on a value that did not change. Stated, never inferred from before/after equality.';
