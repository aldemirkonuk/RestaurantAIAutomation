-- A promotion remembers being alerted, so the expiring-soon sweep does not
-- send the same "use it or lose it" notice to a manager twice.
--
-- Founder item 54 (2026-09-26, round 8, cutover-deletion-manifest ask):
-- "Promo-expiring alert: add `alerted_at` column to provider_promotions
-- (additive migration) and fix `_check_expiring_promos` (PR #485 lane)."
--
-- Why now, not before: PR #464 put ProviderConversationAgent back into
-- production on 2026-09-25/26, and its promo paths were rewritten to use the
-- table's real columns (fix/conversation-agent-promotions-columns, this same
-- PR #485). `_check_expiring_promos` was left reading a `status` column and
-- an `alerted_at` column that did not exist -- pinned as a strict xfail in
-- services/agent-orchestrator/tests/test_conversation_agent_promotions_columns.py
-- pending this decision. The founder has now decided: a column, not a second
-- ledger table.
--
-- Additive only: no ALTER of an existing column, no DROP, no RENAME. NULL
-- means "never alerted" -- every existing row reads that way, which is the
-- correct starting state (nothing has been alerted about yet under the new
-- code path).
alter table public.provider_promotions
  add column if not exists alerted_at timestamptz;

comment on column public.provider_promotions.alerted_at is
  'Set once the expiring-soon sweep (_check_expiring_promos) has notified the '
  'restaurant for this promotion, so the sweep does not alert on it again. '
  'NULL means not yet alerted. Written only after the alert publishes '
  'succeed (a failed publish leaves it NULL so the sweep retries next run). '
  'Founder item 54, 2026-09-26 round 8; ADR 0165 (provider_promotions).';
