-- ============================================================================
-- Document intake — content-addressed deduplication
-- ============================================================================
--
-- The same invoice legitimately arrives more than once: the distributor emails a
-- PDF that night, the receiver photographs the paper copy at the door, and an
-- 810 lands on SFTP the next morning. All three are the same money.
--
-- Deduping on doc_number alone is not enough — a photographed packing slip often
-- has no number at all, and two distributors reuse each other's numbering. So
-- documents are content-addressed: identical bytes are the same document, full
-- stop. That also makes intake safely retryable, which is what lets the inline
-- best-effort hook and the reconciliation sweep both run without coordinating.
--
-- Deliberately scoped per restaurant rather than globally. Two restaurants
-- receiving the same vendor circular must each get their own row; a global
-- unique index would hand the second one the first one's document, across a
-- tenant boundary.
-- ============================================================================

ALTER TABLE procurement_documents
    ADD COLUMN IF NOT EXISTS sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_restaurant_sha256
    ON procurement_documents(restaurant_id, sha256)
    WHERE sha256 IS NOT NULL;

-- Which attachment/message/upload this document came from, so a reconciliation
-- sweep can tell what it has already handled without a second bookkeeping table.
CREATE INDEX IF NOT EXISTS idx_pd_source_ref
    ON procurement_documents(restaurant_id, source_ref);
