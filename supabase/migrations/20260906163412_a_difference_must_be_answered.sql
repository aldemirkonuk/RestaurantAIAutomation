-- ---------------------------------------------------------------------------
-- A DIFFERENCE MUST BE ANSWERED (ADR 0103 A11).
--
-- WHAT THIS IS
-- ------------
-- The vendor lens (2026-09-06, finding 1) drove a real short ship through the
-- doors: a door count of 10 against an invoice of 12, the `delivery_differs`
-- notification persisted by the gateway itself — and then
-- `POST /procurement/deliveries/:id/agree` returned 201 under rule A
-- (`both_sides_recorded`) with no proposal ever filed. Rule A asks only whether
-- A restaurant position and A vendor position exist and nothing is open; that
-- the two CONTRADICT EACH OTHER on a line the system had already flagged was
-- never part of the test. The one case the ADR exists for could pass its gate.
--
-- The founder's answer (2026-09-06, recorded verbatim in ADR 0103 A11):
-- "Difference must be answered — AGREED is refused while any recorded
-- difference (door count vs paperwork, or invoice vs PO) has no accepted
-- proposal or an explicit 'accept as billed' from the restaurant. Rule A stays
-- for deliveries with no difference."
--
-- A proposal already answers a difference. What had nowhere to live is the
-- OTHER answer: the restaurant looking at a real difference and saying "we are
-- not disputing this one — bill it as it stands". That is not a proposal. A
-- proposal is a POSITION somebody is asking the other side to accept; an
-- accept-as-billed is a decision NOT to raise one, and recording it as a
-- proposal (side restaurant, status accepted, reason SHORT_SHIP) would put a
-- claim on the record that the restaurant deliberately did not make — the same
-- shape of lie as a silence that reads as agreement.
--
-- WHY IT IS KEYED (delivery, document, line_no) AND NOT (delivery, line)
-- ---------------------------------------------------------------------
-- ADR 0103 A2: N documents per delivery. A delivery's "line 3" is not a thing —
-- line 3 OF the invoice and line 3 OF the door count are different lines that
-- can disagree with each other. The key is the line of the document the
-- difference was found on, which is also what `delivery_proposals` already uses.
--
-- IDEMPOTENCY IS THE UNIQUE INDEX, NOT A CODE PATH. A second accept-as-billed
-- on the same line returns the first record unchanged: the fact recorded is
-- "on <date> <person> decided not to dispute this line", and a second write
-- would move that moment to one at which nobody decided anything (the same rule
-- `accept()` and `verify()` already follow).
-- ---------------------------------------------------------------------------

create table if not exists public.delivery_line_acceptances (
  id             uuid primary key default gen_random_uuid(),

  delivery_id    uuid not null
                 references public.deliveries(id) on delete cascade,

  -- The line this decision is about. Both are NOT NULL: an "accept as billed"
  -- with no line is a blanket waiver, and a blanket waiver of differences
  -- nobody has read is exactly the door A11 closes.
  document_id    uuid not null
                 references public.procurement_documents(id) on delete cascade,
  line_no        integer not null,

  -- WHY, in the person's own words. Required, and not free-form decoration:
  -- six months later "we accepted a 2-bottle short ship" has to be readable as
  -- a decision somebody made for a reason, not as a row that appeared.
  reason         text not null check (length(btrim(reason)) > 0),

  -- WHO, always. There is no system actor here: D6 makes every acceptance a
  -- human gate, and the door refuses a call that carries no user rather than
  -- attributing the decision to the platform.
  accepted_by    uuid not null references public.users(user_id) on delete restrict,
  accepted_at    timestamptz not null default now()
);

create unique index if not exists delivery_line_acceptances_line
  on public.delivery_line_acceptances (delivery_id, document_id, line_no);

comment on table public.delivery_line_acceptances is
  'ADR 0103 A11 — the restaurant''s explicit "accept as billed" on ONE line of ONE document of a delivery. The second of the two answers a recorded difference will take (the first is an accepted proposal). Never written by the system: D6 makes it a human gate, and the row records who and when.';
comment on column public.delivery_line_acceptances.reason is
  'The person''s own sentence. Required — an acceptance with no reason is indistinguishable from a click.';
comment on column public.delivery_line_acceptances.line_no is
  'The line of `document_id`, not of the delivery. ADR 0103 A2: N documents per delivery, so a delivery has no line numbering of its own.';

alter table public.delivery_line_acceptances enable row level security;
drop policy if exists delivery_line_acceptances_service_role on public.delivery_line_acceptances;
create policy delivery_line_acceptances_service_role
  on public.delivery_line_acceptances for all to service_role using (true) with check (true);
