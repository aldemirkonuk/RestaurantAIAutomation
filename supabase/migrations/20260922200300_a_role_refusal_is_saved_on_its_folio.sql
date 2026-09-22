-- ADR 0145, 2026-09-21 amendment (founder's option "Rules in code, label rows").
--
-- The blocker. `ReadingFolioStore.finish` writes `reply_kind: answer.kind`, and
-- a Reading the asker's role may not receive answers `not_permitted`
-- (bound-reply.ts). 20260922200000:19 listed nine kinds and not that one, so
-- in a real database every staff refusal failed the CHECK, the folio stayed
-- `pending`, and the person got a 503 "saved state is uncertain" instead of a
-- refusal -- measured in PGlite 2026-09-21 (23514 on
-- ask_reading_folios_reply_kind_check). Jest missed it: the store specs use a
-- client double with no CHECK.
--
-- Additive and idempotent: the constraint is dropped by its generated name and
-- re-added with the same nine kinds plus `not_permitted`. A re-run drops and
-- re-adds the identical list. No row can fail it: the old list is a subset.
alter table public.ask_reading_folios
  drop constraint if exists ask_reading_folios_reply_kind_check;
alter table public.ask_reading_folios
  add constraint ask_reading_folios_reply_kind_check check (reply_kind in (
    'reading', 'model_knowledge', 'clarify', 'not_built', 'no_reading_matched',
    'requirements_unsatisfied', 'not_in_your_books', 'could_not_read', 'could_not_answer',
    'not_permitted'
  ));
