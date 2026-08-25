-- ============================================================================
-- Vendor credit ledger
-- ============================================================================
--
-- Until this table existed, `creditDue` was an ephemeral boolean that reached a
-- notification and then vanished. No amount, no state, no age, no link to the
-- credit that eventually settled it — which means the headline metric of the
-- whole product, dollars recovered, could not be computed from the schema at all.
--
-- THE DISTINCTION THIS TABLE EXISTS TO ENFORCE: claimed is not recovered.
--
-- A restaurant that has asked for $4,200 back has recovered nothing. Money is
-- recovered when the distributor issues the credit and it lands on a later
-- invoice. Those are separate columns and separate states here, deliberately,
-- because a dollars-recovered figure a bookkeeper cannot tie to a vendor
-- statement destroys trust the first time they check — and they always check.
--
-- credited_amount is separate from claimed_amount rather than a flag, because
-- partial settlement is the norm: you claim 2 broken bottles at $22 and the
-- distributor allows one. Storing only the claim would overstate recovery by
-- exactly the amount that is in dispute.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),

    -- What went wrong, and on which paperwork.
    order_id UUID REFERENCES procurement_orders(id) ON DELETE SET NULL,
    -- The invoice being disputed.
    document_id UUID REFERENCES procurement_documents(id) ON DELETE SET NULL,
    document_line_id UUID REFERENCES procurement_document_lines(id) ON DELETE SET NULL,

    reason VARCHAR(30) NOT NULL,
    -- Free-text detail a human can read out to an AR desk over the phone.
    summary TEXT,

    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    claimed_amount DECIMAL(12,2) NOT NULL,
    claimed_qty NUMERIC(12,3),

    -- What the distributor actually allowed. NULL until they say.
    credited_amount DECIMAL(12,2),
    -- The credit memo (EDI 812 or a PDF) that settled it. This is the proof;
    -- without it a credit is a promise, and promises are not recovery.
    credit_document_id UUID REFERENCES procurement_documents(id) ON DELETE SET NULL,

    state VARCHAR(20) NOT NULL DEFAULT 'open',
    -- True only when the vendor's own packing slip proves the overbill. A claim
    -- carrying this needs no argument, only the attachment, and it is worth
    -- knowing which claims are winnable before spending a phone call on them.
    self_evidenced BOOLEAN NOT NULL DEFAULT false,

    -- Snapshot of the match that produced the claim. Kept because the underlying
    -- order can be corrected later, and a claim must still be able to say what
    -- it was based on at the time it was raised.
    evidence JSONB,

    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    requested_at TIMESTAMPTZ,
    promised_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    opened_by UUID,
    requested_by UUID,
    settled_by UUID,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT procurement_credits_reason_check CHECK (
        reason IN (
            'overbilled_vs_ship',
            'qty_short',
            'short_shipped',
            'damaged',
            'price_variance',
            'never_ordered',
            'other'
        )
    ),
    -- open      raised by the match, nobody has contacted the vendor
    -- requested we have asked
    -- promised  a rep said yes; still not money
    -- credited  a credit memo exists  <- the ONLY state that counts as recovered
    -- rejected  the vendor refused
    -- written_off  we gave up; kept, because a vendor whose claims never land is
    --              itself the finding
    CONSTRAINT procurement_credits_state_check CHECK (
        state IN ('open','requested','promised','credited','rejected','written_off')
    ),
    CONSTRAINT procurement_credits_claimed_positive CHECK (claimed_amount >= 0),
    -- A credited claim must carry both the money and the document proving it.
    -- Enforced here rather than in code so no code path can report recovery it
    -- cannot evidence.
    CONSTRAINT procurement_credits_credited_needs_proof CHECK (
        state <> 'credited'
        OR (credited_amount IS NOT NULL AND credit_document_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_pc_restaurant_state
    ON procurement_credits(restaurant_id, state);
CREATE INDEX IF NOT EXISTS idx_pc_provider
    ON procurement_credits(restaurant_id, provider_id, state);
CREATE INDEX IF NOT EXISTS idx_pc_order ON procurement_credits(order_id);
CREATE INDEX IF NOT EXISTS idx_pc_document ON procurement_credits(document_id);
-- Aging: open claims sorted oldest first is the manager's work queue.
CREATE INDEX IF NOT EXISTS idx_pc_open_age
    ON procurement_credits(restaurant_id, opened_at)
    WHERE state IN ('open','requested','promised');

-- One claim per line per reason. Re-running the match on a delivery must not
-- manufacture a second claim for money already being chased — which would both
-- double-count recovery and embarrass the restaurant in front of its distributor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_line_reason
    ON procurement_credits(document_line_id, reason)
    WHERE document_line_id IS NOT NULL AND state <> 'written_off';

DROP TRIGGER IF EXISTS trg_pc_updated_at ON procurement_credits;
CREATE TRIGGER trg_pc_updated_at BEFORE UPDATE ON procurement_credits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
