-- Vendor price observations — one store, many sources, every source labelled.
--
-- Why this is not price_history
-- -----------------------------
-- price_history already exists and stays: it records what we actually PAID,
-- tied to an order. This table records what a price was OBSERVED to be,
-- anywhere, including places we never bought from. "What you paid" and "what
-- is available" are different questions and conflating them makes both
-- unanswerable.
--
-- Why every row is an immutable observation rather than a current price
-- --------------------------------------------------------------------
-- Sources disagree, constantly. A scraped site, a rep's WhatsApp quote and a
-- signed invoice for the same bottle will differ, and the disagreement is
-- information — it is the negotiating position. Storing a single "current
-- vendor price" would silently pick a winner. Storing observations and
-- computing consensus at read time keeps the disagreement visible and lets the
-- weighting change without a backfill.
--
-- Trust tiers
-- -----------
-- Sources are not equally believable and must never be averaged as if they
-- were. Lower number = higher trust:
--   1 invoice        we paid this; ground truth
--   2 quote          a vendor committed to it in writing
--   3 api_catalog    vendor's own structured feed
--   4 website_scrape parsed from their site; correct until their markup changes
--   5 chat           WhatsApp/email message from a rep; real but informal
--   6 social         public post; promotional, often conditional
--   7 manual         someone typed it in
--
-- Normalisation is where the errors actually live
-- -----------------------------------------------
-- A "case of 12 × 750ml at $240" and a "bottle at $22" are not comparable
-- until both become price per 750ml ($20 vs $22). Ranking raw price without
-- this reliably recommends the wrong vendor. normalized_unit_price is the only
-- column the comparison should ever sort on, and normalization_note records
-- how it was derived so a wrong answer is debuggable rather than mysterious.
--
-- The food case, noted now because it changes this table's shape later
-- -------------------------------------------------------------------
-- Wine is an identity match: a producer/vintage/format is the same good
-- everywhere, so yield is 1 and price-per-750ml is a fair ranking. Food is a
-- specification match — grade, origin and trim differ, so the comparable unit
-- is price per USABLE unit after yield loss, and a $40 case at 85% yield beats
-- a $36 case at 70%. yield_factor defaults to 1 so wine is unaffected, and the
-- column exists now because retrofitting it after the ranking logic ships
-- means re-deriving every stored comparison.

CREATE TABLE public.vendor_price_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,

    -- Nullable: market intelligence is not always tenant-scoped. A scraped
    -- public list price belongs to everyone; an invoice belongs to one
    -- restaurant.
    restaurant_id uuid,
    provider_id uuid,
    vendor_catalogue_id uuid,
    -- Free text for sources that name a vendor we have not yet matched to a row.
    vendor_name_raw text,

    -- What product. master_wine_id when resolved; signature_hash is the
    -- content-addressed fallback so an unmatched observation is still
    -- comparable against others of the same bottle.
    master_wine_id uuid,
    signature_hash text,
    product_name_raw text,

    source_type text NOT NULL,
    trust_tier smallint NOT NULL,
    -- URL, message id, invoice id — whatever makes this observation traceable
    -- back to the thing it was read from.
    source_ref text,
    source_url text,

    -- When we saw it vs when the price applies. A scrape observed today may
    -- quote a list effective last quarter.
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_date date,

    raw_price numeric NOT NULL,
    currency character varying(3) DEFAULT 'USD' NOT NULL,

    -- Packaging as stated by the source.
    pack_size integer DEFAULT 1 NOT NULL,
    unit_volume_ml integer,
    -- 1.0 for wine. < 1 for food, where part of the purchase is trim/waste.
    yield_factor numeric DEFAULT 1.0 NOT NULL,

    -- The only column the comparison sorts on.
    normalized_unit_price numeric,
    normalization_note text,

    -- How much to believe the parse itself, separate from how much to believe
    -- the source. A confident source badly scraped is still a bad number.
    parse_confidence numeric,
    -- Set by the consensus pass, not at write time — outlier-ness is a
    -- property of the group, not of the row.
    is_outlier boolean DEFAULT false NOT NULL,

    -- Scrape hygiene: content_hash lets a re-scrape that found nothing new be
    -- discarded instead of inflating the observation count and making a stale
    -- price look repeatedly confirmed.
    content_hash text,
    http_status integer,
    scrape_job_id uuid,

    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT vendor_price_observations_pkey PRIMARY KEY (id),
    CONSTRAINT vpo_source_type_check CHECK (
        source_type IN ('invoice', 'quote', 'api_catalog', 'website_scrape',
                        'chat', 'social', 'manual')
    ),
    CONSTRAINT vpo_trust_tier_check CHECK (trust_tier BETWEEN 1 AND 7),
    CONSTRAINT vpo_price_check CHECK (raw_price >= 0),
    CONSTRAINT vpo_pack_check CHECK (pack_size > 0),
    CONSTRAINT vpo_yield_check CHECK (yield_factor > 0 AND yield_factor <= 1)
);

-- The comparison query: every observation for one product, newest first.
CREATE INDEX idx_vpo_product
    ON public.vendor_price_observations (master_wine_id, observed_at DESC)
    WHERE master_wine_id IS NOT NULL;

CREATE INDEX idx_vpo_signature
    ON public.vendor_price_observations (signature_hash, observed_at DESC)
    WHERE signature_hash IS NOT NULL;

-- "who sells this and for how much", the vendor-ranking read.
CREATE INDEX idx_vpo_vendor
    ON public.vendor_price_observations (provider_id, master_wine_id, observed_at DESC);

-- Trend windows (7/30/90d) scan by time within a tenant.
CREATE INDEX idx_vpo_restaurant_time
    ON public.vendor_price_observations (restaurant_id, observed_at DESC)
    WHERE restaurant_id IS NOT NULL;

-- Re-scrape dedup: same source, same content, same day is not new evidence.
CREATE UNIQUE INDEX idx_vpo_scrape_dedup
    ON public.vendor_price_observations (source_ref, content_hash)
    WHERE content_hash IS NOT NULL AND source_ref IS NOT NULL;

ALTER TABLE public.vendor_price_observations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.vendor_price_observations IS
    'Immutable, multi-source vendor price sightings. Consensus is computed at '
    'read time from these rows; never store a single "current vendor price".';
