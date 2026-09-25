-- A stored insight carries the item it is, so its state holds on every read.
--
-- WHY
-- ---
-- The founder, 2026-09-21 (ADR 0191): "Build it right, in order" -- the
-- engine gets ONE shared per-item state (dismissed with a reason /
-- snoozed-until / done) that the feed, the catalogue, reports and the rails
-- all read.
--
-- An item's state is written against a key of the form
-- `insight:<candidate>#<subject>#<period>` (insights/suppression.ts), at the
-- scope the person chose: this finding, this subject, or the whole type. The
-- live compute knows the subject and the period of every sentence, so it can
-- resolve that state. `analytics_insights` -- the stored read that Reports'
-- register, the contextual rails, the mobile tab, the overview and the goal
-- suggestions are served from -- stored neither. It could not tell whether a
-- row had been dismissed "for this Wednesday" or snoozed "for this week", so
-- it applied nothing: a dismissal made at 10:05 stood on every stored surface
-- until the category's next cadence run.
--
-- WHY COLUMNS AND NOT `evidence`
-- ------------------------------
-- Same reason `generator_version` is a column (20260903130000): `evidence` is
-- the insight's own rendered payload, a typed contract with the verbalizer.
-- The subject and the period are the row's identity, read on every stored
-- read to build the key; they are not evidence about the restaurant.
--
-- NO BACKFILL
-- -----------
-- Every row already in the table was written by generator version 2, which
-- stored neither field. INSIGHT_GENERATOR_VERSION is 3 in the same change, so
-- `getStored()` treats those rows as absent the moment the code deploys and
-- the next read recomputes and replaces them with both fields filled -- a row
-- whose state cannot be resolved at the scope it was written is withheld, not
-- served unfiltered. Nothing here writes a row.
--
-- Additive and re-runnable: `add column if not exists`, nullable, no default
-- to backfill. RLS on `analytics_insights` is unchanged.

alter table analytics_insights
  add column if not exists subject text,
  add column if not exists period_key text;

comment on column analytics_insights.subject is
  'What the sentence is about ("Wednesday", "Table 4"), exactly as the generator''s record() resolved it -- half of the item''s key (insight:<candidate>#<subject>#<period>). Null when the type names no subject. ADR 0191.';
comment on column analytics_insights.period_key is
  'The period the sentence covers, at its own grain ("d:2026-09-02", "p7:2026-09-02") -- the other half of the item''s key. Null when the type is not about a period. ADR 0191.';
