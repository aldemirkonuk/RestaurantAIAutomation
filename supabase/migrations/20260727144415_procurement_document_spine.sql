-- ============================================================================
-- Procurement document spine — the four-way match
-- ============================================================================
--
-- A beverage delivery is not two documents, it is four, and the app modelled
-- two of them:
--
--   ORDERED   purchase order (EDI 850)        what we asked for
--   SHIPPED   packing slip / ASN (EDI 856)    what the distributor says left
--   RECEIVED  physical count at the door      what actually arrived
--   BILLED    invoice (EDI 810)               what we are charged for
--   (+ credit memo, EDI 812 — what they agreed to give back)
--
-- Why the packing slip earns its own table rather than being folded into the
-- invoice: it is the distributor's OWN statement of what shipped. When their
-- ship notice says 22 and their invoice says 24, the discrepancy is proven by
-- their own paperwork and needs no argument from us. That is the strongest
-- attachment a credit claim can carry, and today it is thrown away.
--
-- Three structural problems this fixes:
--
--  1. procurement_orders is ONE wine and ONE quantity. A real Southern Glazer's
--     or Winebow invoice is 18-40 lines, spans several POs, and contains lines
--     nobody ordered. There was nothing to match lines *against*.
--  2. Documents arrive on four channels (email, photo, upload, EDI/SFTP) and
--     downstream code must not care which. One table, one shape, a channel tag.
--  3. Invoices arrive on their own schedule. DSD houses leave one with the
--     driver; some email a PDF that night; some invoice weekly in arrears, where
--     the paper at the door is a packing slip with NO PRICES AT ALL. So a
--     document must be able to attach to a delivery that already closed. That
--     late-arriving reconciliation is where most recoverable money lives.
--
-- Value lists below are mirrored in apps/api-gateway/src/procurement/documents/
-- document-types.ts. Keep them in sync — a CHECK constraint that drifts from the
-- code fails silently at write time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Purchase order lines — adopting a table that already existed
-- ---------------------------------------------------------------------------
-- procurement_order_items is present in production, holds 0 rows, is referenced
-- by NO application code, and appears in NO migration file — it was created
-- out-of-band. This block captures it into source control so a fresh database
-- matches production; IF NOT EXISTS makes it a no-op where it already stands.
--
-- We adopt it rather than adding a parallel procurement_order_lines. Two tables
-- for one concept is the dual-bookkeeping failure that already had to be
-- unwound in inventory, and this one is better than what was about to replace
-- it: bottles_per_unit/total_bottles are the unit-of-measure normalisation the
-- match needs, and received_sku/sku_match/vintage_match/received_vintage model
-- substitution — the case where a '22 Sancerre is delivered as a '23. That is a
-- DIFFERENT item with its own cost lot, not a price variance, and it is the
-- clearest thing that separates beverage software from generic food-cost tools.
CREATE TABLE IF NOT EXISTS procurement_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    master_wine_id UUID REFERENCES master_wine_library(id),

    sku VARCHAR(100),
    vendor_sku VARCHAR(100),
    upc VARCHAR(50),
    wine_name VARCHAR(255) NOT NULL,
    producer VARCHAR(255),
    vintage INTEGER,

    quantity INTEGER NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'bottles',
    bottles_per_unit INTEGER DEFAULT 1,
    -- Bottle-equivalent, enforced by the database rather than by whichever
    -- caller remembers to multiply. This is toBottles() in DDL form, and it is
    -- why 2 cases and 24 bottles compare equal instead of reporting a 22-unit
    -- overage — the most common false alarm in beverage receiving.
    total_bottles INTEGER GENERATED ALWAYS AS (quantity * bottles_per_unit) STORED,

    quoted_unit_price NUMERIC,
    negotiated_unit_price NUMERIC,
    final_unit_price NUMERIC,
    line_total NUMERIC,

    quantity_received INTEGER,
    quantity_accepted INTEGER,
    quantity_rejected INTEGER,
    rejection_reason TEXT,

    received_sku VARCHAR(100),
    sku_match BOOLEAN,
    vintage_match BOOLEAN,
    received_vintage INTEGER,

    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenancy scoped directly on the row rather than reached through a join to the
-- parent order. Every tenant-scoped query that has to remember a join is a
-- tenant leak waiting to be written; the ux_overrides leak fixed this week was
-- exactly that shape.
ALTER TABLE procurement_order_items
    ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE procurement_order_items
    ADD COLUMN IF NOT EXISTS line_no INTEGER;
-- Agreed free goods, so an 11-for-10 nets out instead of reading as an overage.
ALTER TABLE procurement_order_items
    ADD COLUMN IF NOT EXISTS free_goods_qty NUMERIC(12,3) NOT NULL DEFAULT 0;

UPDATE procurement_order_items i
SET restaurant_id = o.restaurant_id
FROM procurement_orders o
WHERE i.order_id = o.id AND i.restaurant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_poi_order ON procurement_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_poi_restaurant ON procurement_order_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_poi_inventory ON procurement_order_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_poi_vendor_sku ON procurement_order_items(restaurant_id, vendor_sku);

-- Backfill: every existing single-wine order becomes a one-line order, so the
-- new match path has something to read for orders placed before this migration.
--
-- Written against the LIVE schema, which has drifted from
-- 20260208024921_new-migration.sql: there is no procurement_orders.wine_name
-- (the name lives on restaurant_inventory), prices are quoted/negotiated/final
-- rather than target/negotiated_per_bottle, and `bottles_total` + `unit_type`
-- already carry the bottle-equivalent this table needs.
-- total_bottles is omitted deliberately: it is GENERATED ALWAYS and Postgres
-- rejects an explicit value for it.
INSERT INTO procurement_order_items (
    order_id, restaurant_id, line_no, inventory_id, wine_name,
    quantity, unit_type, bottles_per_unit,
    quoted_unit_price, negotiated_unit_price, final_unit_price, line_total
)
SELECT
    o.id,
    o.restaurant_id,
    1,
    o.inventory_id,
    COALESCE(inv.wine_name, 'Unknown item'),
    o.quantity,
    COALESCE(o.unit_type, 'bottles'),
    -- Recover pack size from the two numbers already stored: 24 bottles across
    -- 2 cases is a pack of 12. Anything that does not divide cleanly falls back
    -- to 1, because a guessed pack size produces confident, wrong cost maths.
    GREATEST(1, COALESCE(ROUND(o.bottles_total::numeric / NULLIF(o.quantity, 0)), 1))::int,
    o.quoted_price,
    o.negotiated_price,
    COALESCE(o.final_price, o.negotiated_price, o.quoted_price),
    COALESCE(o.total_cost, o.final_confirmed_cost, o.total_estimated_cost)
FROM procurement_orders o
LEFT JOIN restaurant_inventory inv ON inv.id = o.inventory_id
WHERE o.quantity IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM procurement_order_items l WHERE l.order_id = o.id
  );

-- ---------------------------------------------------------------------------
-- 2. Vendor documents — one table, every type, every arrival channel
-- ---------------------------------------------------------------------------
-- User columns are plain UUIDs with no FK, matching how procurement_orders
-- already treats approved_by / received_by / match_verified_by. (public.users
-- is keyed on user_id, not id — a REFERENCES users(id) here fails outright.)
CREATE TABLE IF NOT EXISTS procurement_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),

    doc_type VARCHAR(30) NOT NULL,
    source_channel VARCHAR(20) NOT NULL,

    -- Vendor's own identifiers. doc_number is what a human and a distributor's
    -- AR desk both quote on the phone, so a credit claim is worthless without it.
    doc_number VARCHAR(120),
    doc_date DATE,
    -- An 810 references the 856/850 it bills for; following that chain is how
    -- documents self-assemble into a delivery without anyone matching by hand.
    references_doc_number VARCHAR(120),

    -- The original is kept forever. A disputed credit is settled by producing
    -- the document, never by producing our JSON summary of it.
    storage_path TEXT,
    content_type VARCHAR(100),
    file_bytes INTEGER,
    -- Raw X12/EDIFACT payload when the document arrived electronically.
    raw_payload TEXT,

    -- Extraction is a PROPOSAL. Nothing here is trusted until a human verifies,
    -- and nothing here writes to inventory or the ledger on its own.
    extracted JSONB,
    extraction_model VARCHAR(100),
    extraction_confidence NUMERIC(4,3),

    -- Header financials. Freight is not a price variance — it is a landed-cost
    -- component to allocate across lines — so it gets a column instead of being
    -- explained away in a free-text override reason.
    currency VARCHAR(3) DEFAULT 'USD',
    subtotal DECIMAL(12,2),
    freight DECIMAL(12,2),
    fuel_surcharge DECIMAL(12,2),
    split_case_fee DECIMAL(12,2),
    delivery_fee DECIMAL(12,2),
    deposit_total DECIMAL(12,2),
    tax DECIMAL(12,2),
    other_charges DECIMAL(12,2),
    discount_total DECIMAL(12,2),
    total DECIMAL(12,2),

    -- Arithmetic self-check. A model that hallucinated a quantity usually breaks
    -- the sum; this is a free, deterministic detector for the failure mode that
    -- matters most, and it is also what lets a bookkeeper tie to a statement.
    computed_lines_total DECIMAL(12,2),
    tie_out_delta DECIMAL(12,2),
    ties_out BOOLEAN,

    status VARCHAR(20) NOT NULL DEFAULT 'received',
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    -- Where the document came in from, for provenance: message id, filename, etc.
    source_ref VARCHAR(500),
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT procurement_documents_doc_type_check CHECK (
        doc_type IN (
            'purchase_order',
            'packing_slip',
            'delivery_receipt',
            'invoice',
            'credit_memo',
            'statement',
            'unknown'
        )
    ),
    CONSTRAINT procurement_documents_source_channel_check CHECK (
        source_channel IN ('email','photo','upload','edi','sftp','manual','api')
    ),
    CONSTRAINT procurement_documents_status_check CHECK (
        status IN ('received','extracting','needs_review','verified','rejected','superseded')
    )
);

CREATE INDEX IF NOT EXISTS idx_pd_restaurant ON procurement_documents(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pd_provider ON procurement_documents(provider_id);
CREATE INDEX IF NOT EXISTS idx_pd_type_status ON procurement_documents(restaurant_id, doc_type, status);
CREATE INDEX IF NOT EXISTS idx_pd_doc_number ON procurement_documents(restaurant_id, doc_number);
CREATE INDEX IF NOT EXISTS idx_pd_references ON procurement_documents(restaurant_id, references_doc_number);

-- The same invoice must not land twice because it arrived by both email and
-- photo. Partial index so documents without a number (a photographed packing
-- slip, often) are still insertable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_restaurant_provider_type_number
    ON procurement_documents(restaurant_id, provider_id, doc_type, doc_number)
    WHERE doc_number IS NOT NULL AND status <> 'superseded';

-- ---------------------------------------------------------------------------
-- 3. Document lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurement_document_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES procurement_documents(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,

    vendor_sku VARCHAR(120),
    description VARCHAR(500),
    -- Vintage and format are how beverage differs from food: a substituted
    -- vintage is a DIFFERENT item with its own cost lot, not a price variance.
    vintage INTEGER,
    format_ml INTEGER,

    qty NUMERIC(12,3) NOT NULL DEFAULT 0,
    uom VARCHAR(20) NOT NULL DEFAULT 'bottle',
    pack_size INTEGER NOT NULL DEFAULT 1,
    qty_bottles NUMERIC(12,3) NOT NULL DEFAULT 0,

    -- Agreed free goods net out of the comparison instead of registering as an
    -- overage. Without this an "11 for the price of 10" deal fires a critical
    -- alert every single time, and two weeks of that trains the manager to
    -- ignore the app.
    free_goods_qty NUMERIC(12,3) NOT NULL DEFAULT 0,

    unit_price DECIMAL(12,4),
    line_total DECIMAL(12,2),
    -- Post-offs, depletion allowances and bill-backs are ordinary in beverage
    -- and are bigger money than billing errors. They are a discount, not an error.
    allowance DECIMAL(12,2),
    deposit DECIMAL(12,2),

    -- Link to what was ordered. NULL is legitimate and common: invoices carry
    -- lines nobody ordered. A low-confidence guess is never written here —
    -- a wrong link silently corrupts cost basis for months.
    order_line_id UUID REFERENCES procurement_order_items(id) ON DELETE SET NULL,
    match_confidence NUMERIC(4,3),
    match_method VARCHAR(30),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT procurement_document_lines_uom_check
        CHECK (uom IN ('bottle','case','keg','pack','split_case','each','liter')),
    CONSTRAINT procurement_document_lines_pack_size_check CHECK (pack_size >= 1),
    CONSTRAINT procurement_document_lines_match_method_check CHECK (
        match_method IS NULL OR match_method IN ('vendor_sku','description','qty_price','manual','edi_reference')
    ),
    UNIQUE (document_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_pdl_document ON procurement_document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_pdl_order_line ON procurement_document_lines(order_line_id);
CREATE INDEX IF NOT EXISTS idx_pdl_restaurant ON procurement_document_lines(restaurant_id);

-- ---------------------------------------------------------------------------
-- 4. Documents to orders — deliberately many-to-many
-- ---------------------------------------------------------------------------
-- One invoice routinely covers several POs, and one PO can be filled across two
-- trucks with two packing slips. A foreign key on either table would force a lie
-- in one direction or the other.
CREATE TABLE IF NOT EXISTS procurement_document_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES procurement_documents(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    linked_by UUID,
    link_method VARCHAR(30) NOT NULL DEFAULT 'manual',
    confidence NUMERIC(4,3),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT procurement_document_links_method_check CHECK (
        link_method IN ('manual','doc_reference','po_number','provider_date','line_overlap','edi_reference')
    ),
    UNIQUE (document_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_pdlink_order ON procurement_document_links(order_id);
CREATE INDEX IF NOT EXISTS idx_pdlink_document ON procurement_document_links(document_id);

-- ---------------------------------------------------------------------------
-- 5. Receiving events — a delivery is not one moment
-- ---------------------------------------------------------------------------
-- The driver is double-parked and the cases are shrink-wrapped, so what happens
-- at the door is a signature and a case count; bottles get counted at 2pm by
-- whoever breaks the cases. Recording those as one terminal transaction forces
-- the receiver to either lie or hold up the truck. It also makes a second drop
-- on the same invoice unrepresentable.
CREATE TABLE IF NOT EXISTS procurement_receipt_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    order_id UUID REFERENCES procurement_orders(id) ON DELETE CASCADE,
    document_id UUID REFERENCES procurement_documents(id) ON DELETE SET NULL,

    stage VARCHAR(20) NOT NULL,
    -- Counted in whatever unit the receiver could actually count.
    counted_qty NUMERIC(12,3),
    counted_uom VARCHAR(20) DEFAULT 'case',
    counted_qty_bottles NUMERIC(12,3),
    rejected_qty NUMERIC(12,3) DEFAULT 0,
    -- A photo of the damage, not a text field. A receiver cannot tell corked
    -- from broken from wrong-SKU, and asking costs forty seconds and yields
    -- the word "damage".
    damage_photo_path TEXT,

    received_by UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set when the event was captured offline and synced later.
    client_captured_at TIMESTAMPTZ,
    idempotency_key VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT procurement_receipt_events_stage_check CHECK (
        stage IN ('signed_at_door','case_count','bottle_count','reconciled')
    ),
    CONSTRAINT procurement_receipt_events_uom_check CHECK (
        counted_uom IN ('bottle','case','keg','pack','split_case','each','liter')
    )
);

CREATE INDEX IF NOT EXISTS idx_pre_order ON procurement_receipt_events(order_id);
CREATE INDEX IF NOT EXISTS idx_pre_restaurant ON procurement_receipt_events(restaurant_id, occurred_at DESC);
-- The door flow retries over bad signal; the same tap must not book twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_idempotency
    ON procurement_receipt_events(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers, matching the rest of the schema
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_poi_updated_at ON procurement_order_items;
CREATE TRIGGER trg_poi_updated_at BEFORE UPDATE ON procurement_order_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_pd_updated_at ON procurement_documents;
CREATE TRIGGER trg_pd_updated_at BEFORE UPDATE ON procurement_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
