-- An emailed attachment is read once, and every one says what became of it.
--
-- Proposal-receipt row 1.2 (2026-11-07), built 2026-11-11 under the founder's
-- 2026-11-07 /goal.
--
-- Why: the PR body for proposal-receipt row 1.2 (the sweep re-read papers
-- already on file every run, and a failed download said nothing).
--
-- AFTER: each attachment carries its own outcome. The sweep reads only
-- `pending` rows and writes an outcome for every row it touches.
--
--   pending         not read yet (the default for every writer)
--   ingested        became a document (`ingested_document_id`)
--   duplicate       these bytes, or this vendor's paper number, were already
--                   on file (`ingested_document_id` names the paper that holds it)
--   failed          could not be read after its attempts; `last_ingest_reason`
--                   says why in words (bytes removed under retention, download
--                   or reading failure)
--   not_a_document  not a PDF, image, XML or EDI file
--   backlog         older than the window the sweep read on the day this
--                   shipped; counted, not swept (releasing it is a later act)
--
-- The default 'pending' is what the sweep assumed of every row before, so no
-- writer of this table has to change.

ALTER TABLE public.conversation_attachments
  ADD COLUMN IF NOT EXISTS ingest_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ingested_document_id UUID,
  ADD COLUMN IF NOT EXISTS ingest_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ingest_reason TEXT,
  ADD COLUMN IF NOT EXISTS ingest_decided_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_attachments_ingest_state_check'
  ) THEN
    ALTER TABLE public.conversation_attachments
      ADD CONSTRAINT conversation_attachments_ingest_state_check
      CHECK (ingest_state IN (
        'pending', 'ingested', 'duplicate', 'failed', 'not_a_document', 'backlog'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_attachments_ingested_document_id_fkey'
  ) THEN
    ALTER TABLE public.conversation_attachments
      ADD CONSTRAINT conversation_attachments_ingested_document_id_fkey
      FOREIGN KEY (ingested_document_id)
      REFERENCES public.procurement_documents(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.conversation_attachments.ingest_state IS
  'What became of this attachment at intake. The sweep reads only pending rows and writes an outcome for each (proposal-receipt row 1.2).';
COMMENT ON COLUMN public.conversation_attachments.ingested_document_id IS
  'The procurement_documents row this attachment became (ingested) or the paper already on file that holds it (duplicate). NULL otherwise.';
COMMENT ON COLUMN public.conversation_attachments.last_ingest_reason IS
  'The last outcome, in words, for failed and duplicate rows. Never a code alone.';

-- The sweep's read: newest pending first.
CREATE INDEX IF NOT EXISTS idx_conversation_attachments_ingest_pending
  ON public.conversation_attachments (created_at DESC)
  WHERE ingest_state = 'pending';

-- The arrivals list on /receipts: one house, newest first.
CREATE INDEX IF NOT EXISTS idx_conversation_attachments_house_created
  ON public.conversation_attachments (restaurant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Backfill, mirroring what the sweep did the day before this shipped, so the
-- migration reads nothing that sweep would not have read.
-- ---------------------------------------------------------------------------

-- 1. Bytes that already have a document in the same house: done.
UPDATE public.conversation_attachments a
SET ingest_state = 'ingested',
    ingested_document_id = d.id,
    ingest_decided_at = now()
FROM public.procurement_documents d
WHERE a.ingest_state = 'pending'
  AND a.sha256 IS NOT NULL
  AND d.restaurant_id = a.restaurant_id
  AND d.sha256 = a.sha256;

-- 2. Outside the 200 newest rows the old sweep looked at: counted, not swept.
UPDATE public.conversation_attachments a
SET ingest_state = 'backlog',
    last_ingest_reason = 'Arrived before the intake sweep kept an outcome per attachment, and outside the window it read; not read yet.',
    ingest_decided_at = now()
WHERE a.ingest_state = 'pending'
  AND a.id NOT IN (
    SELECT id FROM public.conversation_attachments
    ORDER BY created_at DESC NULLS LAST
    LIMIT 200
  );
