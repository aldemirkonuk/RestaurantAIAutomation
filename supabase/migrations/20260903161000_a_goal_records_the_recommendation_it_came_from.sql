-- A goal records the recommendation it came from.
--
-- WHY
-- ---
-- `/recommendations` grew a "Make this a goal" control on 2026-09-03
-- (`apps/web/src/pages/recommendations/next/rec-forward.ts`). It writes a real
-- `analytics_goals` row through `POST /analytics/goals/:rid`. The row it wrote
-- carried no trace of where it came from, and the consequences were not
-- cosmetic:
--
--   * the entry that produced the goal could not say it had been acted on.
--     `analytics_goals` had one column a page could match against —
--     `metric_key` — so the strongest true sentence the goal sheet could show
--     was "you already hold a goal on Wine revenue", never "this entry is
--     already being watched". Two different recommendations that both land on
--     `wine_revenue` were indistinguishable, and a manager could set the same
--     goal twice without the page being able to say so.
--   * the `goal_behind_<id>` rule (`recommendations.service.ts`) fires a NEW
--     recommendation when a goal falls behind its pace. With no provenance,
--     that entry cannot name the recommendation whose goal it is chasing, and
--     the loop from finding → goal → finding stays broken in the middle.
--   * Reports is being taught to open on a named cutting (`?cutting=…&rec=…`).
--     Without this column the goal on the other side of the same journey
--     cannot be named in the same words.
--
-- NULLABLE, NO BACKFILL, ON PURPOSE
-- ---------------------------------
-- Every row already in the table was set by hand, by an owner typing a target
-- into Reports — not by a rule. NULL is the true value for all of them, and
-- inventing a rule key for a goal nobody created from a recommendation would
-- be exactly the fabricated provenance this column exists to make unnecessary.
-- A reader must therefore treat NULL as "set by hand", never as "unknown".
--
-- WHY A COLUMN AND NOT A JOIN TABLE
-- ---------------------------------
-- The relation is at most one recommendation per goal, and the recommendation
-- side has no row of its own: a recommendation is computed on every read from
-- `recommendations.service.ts`, and the only thing that persists about it is
-- the manager's disposition in `recommendation_actions`, keyed by the same
-- string this column stores. A join table would have exactly one foreign key
-- and one text column with nothing to point at.
--
-- THE CATALOGUE
-- -------------
-- The valid values are the `rule("…")` keys evaluated in
-- `apps/api-gateway/src/analytics/recommendations.service.ts`, plus the
-- `goal_behind_<uuid>` family that file generates per goal. The gateway
-- validates against that catalogue in `GoalsService.createGoal` and refuses an
-- unknown key with words rather than storing a string nothing can resolve —
-- there is deliberately no CHECK constraint, because the catalogue is code
-- that changes with each new rule and a constraint would turn adding a rule
-- into a migration.

alter table analytics_goals
  add column if not exists source_rule_key text;

comment on column analytics_goals.source_rule_key is
  'The recommendation rule this goal was created from — one of the rule("…") keys in apps/api-gateway/src/analytics/recommendations.service.ts, or a goal_behind_<uuid> key it generates. NULL means the goal was set by hand and is NOT an unknown. Validated against the catalogue in GoalsService.createGoal; no CHECK constraint, because the catalogue is code.';

-- The question the page asks is "which of THIS restaurant's live goals came
-- from a rule?", once per page load, so the tenant leads and the rule key
-- follows it. Partial on NOT NULL: the hand-set rows are the majority today
-- and none of them is ever the answer to that question.
create index if not exists idx_analytics_goals_source_rule
  on analytics_goals (restaurant_id, source_rule_key)
  where source_rule_key is not null;
