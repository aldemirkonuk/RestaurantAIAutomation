-- Conversation threading: give messages a durable identity that does not depend on
-- an order existing.
--
-- Why: a negotiation exists BEFORE an order does (a DEMAND_OFFER is the thing you send
-- to decide whether to order at all). Keying thread identity on order_id therefore
-- guarantees every pre-order message is homeless — 25 of 26 rows today. gmail_thread_id
-- already describes the real threads; this migration promotes that into a first-class
-- column, enforces it in the database so no writer can skip it, and backfills history.
--
-- See .planning/CONVERSATION_THREADING_PLAN.md for the premortem behind these choices.

-- ── L0. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.procurement_conversations
    ADD COLUMN IF NOT EXISTS thread_key TEXT;

-- Denormalized so a deleted order still renders its number in history (premortem P3).
ALTER TABLE public.procurement_conversations
    ADD COLUMN IF NOT EXISTS order_number_snapshot TEXT;

-- order_id was ON DELETE CASCADE: deleting one order silently destroyed the entire
-- negotiation history with that vendor, which would make the backfill below one DELETE
-- away from worthless. SET NULL is strictly more permissive, so no existing row can
-- violate it. Constraint is looked up rather than assumed by name.
DO $$
DECLARE
    v_conname TEXT;
    v_attnum  SMALLINT;
BEGIN
    SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
    JOIN pg_class rel ON rel.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'procurement_conversations'
      AND a.attname = 'order_id';

    SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'procurement_conversations'
      AND con.contype = 'f'
      AND con.conkey = ARRAY[v_attnum]
    LIMIT 1;

    IF v_conname IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.procurement_conversations DROP CONSTRAINT %I',
            v_conname
        );
    END IF;
END $$;

ALTER TABLE public.procurement_conversations
    ADD CONSTRAINT procurement_conversations_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.procurement_orders(id) ON DELETE SET NULL;

-- ── L1. Thread key resolution ─────────────────────────────────────────────────

-- Resolution order, most authoritative first. Steps 1-2 are exact identifiers.
-- Step 3 is the only heuristic and is deliberately narrow (premortem P1). Step 4
-- guarantees a non-null key, so an unthreadable message becomes a thread of one
-- rather than joining a shared "Unassigned" dumping ground.
CREATE OR REPLACE FUNCTION public.conversation_thread_key(
    p_id              UUID,
    p_gmail_thread_id TEXT,
    p_email_headers   JSONB,
    p_provider_id     UUID,
    p_message_text    TEXT
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_root    TEXT;
    v_subject TEXT;
BEGIN
    -- 1. Gmail already threaded it.
    IF p_gmail_thread_id IS NOT NULL AND btrim(p_gmail_thread_id) <> '' THEN
        RETURN 'gm:' || btrim(p_gmail_thread_id);
    END IF;

    -- 2. RFC-822 threading: root of References, else In-Reply-To.
    v_root := NULLIF(btrim(split_part(COALESCE(p_email_headers ->> 'references', ''), ' ', 1)), '');
    IF v_root IS NULL THEN
        v_root := NULLIF(btrim(COALESCE(p_email_headers ->> 'in_reply_to', '')), '');
    END IF;
    IF v_root IS NOT NULL THEN
        RETURN 'mid:' || btrim(v_root, '<>');
    END IF;

    -- 3. Provider + normalized subject. Scoped by provider so it cannot merge across
    --    tenants, and only fires when no exact identifier exists. A no-op on current
    --    data (outbound drafts store no subject) — it exists for channels that carry
    --    no Gmail identifiers.
    IF p_provider_id IS NOT NULL THEN
        v_subject := COALESCE(
            NULLIF(btrim(p_email_headers ->> 'subject'), ''),
            NULLIF(btrim(substring(p_message_text FROM 'Subject:[ \t]*([^\r\n]+)')), '')
        );
        IF v_subject IS NOT NULL THEN
            v_subject := lower(regexp_replace(v_subject, '^((re|fwd|fw|aw|sv)[ \t]*:[ \t]*)+', '', 'i'));
            v_subject := btrim(regexp_replace(v_subject, '[ \t]+', ' ', 'g'));
            IF v_subject <> '' THEN
                RETURN 'subj:' || p_provider_id::TEXT || ':' || v_subject;
            END IF;
        END IF;
    END IF;

    -- 4. Singleton thread.
    RETURN 'msg:' || p_id::TEXT;
END;
$$;

-- Enforcement lives here rather than in application code: there are at least four
-- writers today (NestJS bridge, inbound responder, communications controller, the
-- Python provider_communication_agent) plus test endpoints and manual SQL. Enforcing
-- per-caller means the next writer added reintroduces the bug (premortem P4).
CREATE OR REPLACE FUNCTION public.set_conversation_thread_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.thread_key IS NULL OR btrim(NEW.thread_key) = '' THEN
        NEW.thread_key := public.conversation_thread_key(
            NEW.id, NEW.gmail_thread_id, NEW.email_headers, NEW.provider_id, NEW.message_text
        );
    END IF;

    IF NEW.order_id IS NOT NULL AND NEW.order_number_snapshot IS NULL THEN
        SELECT order_number INTO NEW.order_number_snapshot
        FROM public.procurement_orders
        WHERE id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_procurement_conversations_thread_key
    ON public.procurement_conversations;

CREATE TRIGGER trg_procurement_conversations_thread_key
    BEFORE INSERT OR UPDATE ON public.procurement_conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.set_conversation_thread_key();

-- ── L2. Backfill ──────────────────────────────────────────────────────────────

UPDATE public.procurement_conversations
SET thread_key = public.conversation_thread_key(
        id, gmail_thread_id, email_headers, provider_id, message_text
    )
WHERE thread_key IS NULL OR btrim(thread_key) = '';

-- Propagate order_id across a thread ONLY when the thread is identified by an exact
-- Gmail thread id AND that thread references exactly one order. Without both guards
-- this step would stamp every pre-order inquiry with the single order that happens to
-- exist, corrupting order history (premortem P2). Verified no-op against current data.
WITH thread_orders AS (
    SELECT thread_key,
           MIN(order_id::TEXT)::UUID AS order_id
    FROM public.procurement_conversations
    WHERE order_id IS NOT NULL
      AND thread_key LIKE 'gm:%'
    GROUP BY thread_key
    HAVING COUNT(DISTINCT order_id) = 1
)
UPDATE public.procurement_conversations c
SET order_id = t.order_id
FROM thread_orders t
WHERE c.thread_key = t.thread_key
  AND c.order_id IS NULL;

UPDATE public.procurement_conversations c
SET order_number_snapshot = o.order_number
FROM public.procurement_orders o
WHERE c.order_id = o.id
  AND c.order_number_snapshot IS DISTINCT FROM o.order_number;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_thread_key
    ON public.procurement_conversations (thread_key);

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_provider_created
    ON public.procurement_conversations (provider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_order_number_snapshot
    ON public.procurement_conversations (order_number_snapshot);

COMMENT ON COLUMN public.procurement_conversations.thread_key IS
    'Durable conversation-thread identity, independent of order_id. Set by trigger; never null.';
COMMENT ON COLUMN public.procurement_conversations.order_number_snapshot IS
    'Order number captured at write time so history survives deletion of the order.';
