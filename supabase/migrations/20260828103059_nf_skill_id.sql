-- neural_footprint_event.skill_id — the column skill-firing telemetry is blocked on.
-- ADR 0039 Track A4. Schema authored under RM-3's schema ownership (R&M owns NF
-- methodology); the requester is skills-lifecycle, which cannot own the event table.
--
-- Why this column exists
-- ---------------------
-- Three charters name `nf_a.skill_id` as a dependency and none of them could
-- create it. The consequence is measurable today, not hypothetically:
-- `scripts/agents/run_card.py` (staleness-reaper) reports
--
--     skills.firing_rate_30d = "unmeasurable — nf_a.skill_id does not exist"
--
-- on every run, and the anti-sprawl charter escalates `unmeasurable` rather than
-- counting it stale or fresh. So the skill registry can grow and nothing can ever
-- justify a deletion: the deletion side of the ratio has no instrument.
--
-- Why a column and not a context key
-- ----------------------------------
-- `context` jsonb would have worked and needs no migration, which is exactly why
-- the alternative deserves stating rather than skipping. It was not chosen because
-- every other *attributional* field on this table is a column — subject_id,
-- correlation_id, restaurant_id — while `context` holds per-call payload
-- (provider, model, attempts, stop_reason). "Which skill fired" is attribution,
-- and grouping telemetry by a jsonb key means every reader repeats
-- `context->>'skill_id'` and each one gets to spell it differently. The two
-- existing NF readout views already demonstrate the cost: both hand-repeat
-- `context->>'task_type'` in their GROUP BY.
--
-- NULLABLE FOREVER. This is a property of the column, not a migration-time
-- convenience to be tightened later. Most rows on this table are not a skill
-- firing at all — a document extraction, a vendor email draft, a search call —
-- and there is no honest value for them. NULL here means "not a skill task",
-- which is a different statement from `outcome`'s NULL ("unknown"), and neither
-- is ever a failure. A NOT NULL with a sentinel like 'none' would make the two
-- indistinguishable in a count.
--
-- `text`, not varchar(n): a skill id is a registry slug (`.claude/skills/<name>`)
-- with no length contract anyone has written down, and varchar(n) buys nothing
-- over text in Postgres except a future migration when a slug gets longer.
--
-- NO INDEX, DELIBERATELY. Saying so explicitly because the omission would
-- otherwise read as an oversight next to the five partial indexes this table
-- already carries. There is no query yet: zero call sites set this column on the
-- day it ships, so any index would be built on a column that is 100% NULL and
-- would cost every insert on the hottest write path in the instrument. The
-- indexes this table does have were each added for a named reader. When a skills
-- readout exists and its query is known, it gets the index its predicate
-- actually needs — most likely a partial one, `where skill_id is not null`,
-- matching the nfe_correlation pattern above it.
--
-- Purely additive and non-blocking: ADD COLUMN of a nullable column with no
-- default takes ACCESS EXCLUSIVE only for the catalog update (no table rewrite,
-- Postgres 11+), so this is a sub-millisecond lock on a table that is
-- append-only. Existing rows are untouched and read back NULL. Both writers are
-- passthrough-optional, so nothing breaks if the column is never written.
--
-- RLS is inherited: `neural_footprint_event` is RLS-enabled with a service_role
-- policy and grants revoked from anon/authenticated (20260824153600), and a new
-- column adds no new exposure. Neither readout view selects it, so PostgREST's
-- surface is unchanged.

alter table public.neural_footprint_event
  add column if not exists skill_id text null;

comment on column public.neural_footprint_event.skill_id is
  'Which registry skill fired for this event, or NULL when the task was not a '
  'skill firing (ADR 0039 A4). NULLABLE FOREVER — NULL means "not a skill task", '
  'which is NOT the same as outcome''s NULL ("unknown"), and neither is a '
  'failure. Requested by skill-lifecycle-anti-sprawl for skills.firing_rate_30d, '
  'which reads "unmeasurable" until call sites populate this. Deliberately '
  'unindexed: no reader query exists yet, and an index on a 100%-NULL column '
  'would tax every insert on the instrument''s hottest write path. Add a partial '
  'index (where skill_id is not null) when a real readout query names one.';
