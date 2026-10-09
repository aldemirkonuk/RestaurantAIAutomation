-- AN AGENT MARKS ONLY ITS OWN MESSAGES DONE. Sim S67 / F-456 (2026-10-09).
--
-- WHAT BROKE. idempotency_keys was keyed on message_id alone
-- (baseline_from_production.sql, idempotency_keys_pkey). One event fans out to
-- a queue per subscribing agent (stock.threshold.breached reaches the
-- notification, procurement and rfq agents), and BaseAgent checks the key
-- before it processes and marks it after. The first agent to finish marked the
-- event done for all of them, so the rest logged "Skipping duplicate message"
-- and never ran. agent_name was stored on every row and read by nothing.
--
-- THE KEY. (message_id, agent_name): an agent still skips a message it has
-- already processed itself, and no longer skips one another agent processed.
-- message_id leads, so a lookup by message_id alone keeps its index.
--
-- NO BACKFILL. Rows unique on message_id are unique on (message_id,
-- agent_name), and agent_name is already NOT NULL, so the swap cannot fail on
-- existing data. Rows expire after 24 hours (expires_at).

ALTER TABLE public.idempotency_keys DROP CONSTRAINT idempotency_keys_pkey;

ALTER TABLE public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (message_id, agent_name);

COMMENT ON CONSTRAINT idempotency_keys_pkey ON public.idempotency_keys IS
    'One row per (message, consuming agent): an event fanned out to several agents is processed by each (sim F-456).';
