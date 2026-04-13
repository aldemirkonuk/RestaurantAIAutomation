CREATE TABLE IF NOT EXISTS sommelier_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Chat',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sommelier_conversations_user
    ON sommelier_conversations(user_id, updated_at DESC);

ALTER TABLE sommelier_conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sommelier_conversations'
      AND policyname = 'Users manage own sommelier conversations'
) THEN
    CREATE POLICY "Users manage own sommelier conversations"
        ON sommelier_conversations
        FOR ALL
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
END IF;
END $$;

DO $$ BEGIN
IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sommelier_conversations'
      AND policyname = 'Service role full access on sommelier_conversations'
) THEN
    CREATE POLICY "Service role full access on sommelier_conversations"
        ON sommelier_conversations
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
END IF;
END $$;
