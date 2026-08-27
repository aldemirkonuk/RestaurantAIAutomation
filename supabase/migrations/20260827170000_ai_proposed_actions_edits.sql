-- ai_proposed_actions: record what was EXECUTED when it differs from what was
-- proposed (P3.C, FUTURES §8).
--
-- Founder call 2026-08-27: the confirm card is editable — a near-miss should be
-- one tap, not a re-ask. The measurement consequence is the reason this
-- migration exists rather than an in-place overwrite.
--
-- WHY NOT JUST OVERWRITE `payload`
-- --------------------------------
-- Because then the proposal record stops being evidence of what the MODEL said,
-- and `confirmation_v1` starts scoring the operator's corrections as the model's
-- successes. A grader that cannot tell "the model was right" from "a human made
-- it right" is measuring nothing, which is the whole defect OD-59 exists to
-- eliminate — and this repo has already found it in four other places today.
--
-- So: `payload` stays immutable and means "what was proposed". `executed_payload`
-- is NULL when the action ran exactly as proposed, and holds the operator's
-- version when it did not. The difference between them IS the signal.

alter table public.ai_proposed_actions
  add column if not exists executed_payload jsonb;

comment on column public.ai_proposed_actions.executed_payload is
  'What actually ran, when the operator edited the proposal before confirming. NULL = executed exactly as proposed. `payload` is never overwritten: the difference between the two is how confirmation_v1 tells "the model was right" from "a human made it right".';

-- A payload can only have been executed if something was executed.
--
-- Same posture as the confirm gate this table already carries: the invariant
-- lives where it cannot be walked around, not in a comment a future call site
-- forgets.
alter table public.ai_proposed_actions
  drop constraint if exists ai_proposed_actions_edit_requires_execution;

alter table public.ai_proposed_actions
  add constraint ai_proposed_actions_edit_requires_execution check (
    executed_payload is null
    or status in ('confirmed', 'executed', 'failed')
  );

-- Reading "how often is the model edited rather than accepted" is the point of
-- the column, so make that query cheap. Partial: unedited rows are the majority
-- and are never scanned this way.
create index if not exists ai_proposed_actions_edited
  on public.ai_proposed_actions (restaurant_id, created_at desc)
  where executed_payload is not null;
