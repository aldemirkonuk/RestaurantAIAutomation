-- Vendor portal — a hosted catalogue page for vendors without a usable website.
--
-- Why host a page for them at all
-- -------------------------------
-- Most of vendor_catalogue is small distributors whose "website" is a PDF, a
-- Facebook page, or nothing. Scraping those yields tier-4 observations with
-- poor parse confidence, and no amount of parser work fixes a source that does
-- not publish structured prices.
--
-- Giving a vendor a page they control inverts the problem. They type the price
-- once; we read it back as structured data rather than guessing at HTML. That
-- is the difference between a website_scrape observation (trust tier 4,
-- 30-day half-life) and an api_catalog one (tier 3, 45 days) — and it costs a
-- vendor less effort than answering the phone about a price.
--
-- The page is deliberately public and machine-readable
-- ----------------------------------------------------
-- vendor_portal_pages.slug resolves on a subdomain. The rendered page carries
-- schema.org Product/Offer JSON-LD, so reading it back is a JSON parse, not an
-- LLM extraction, and so does every other crawler — which is the vendor's
-- incentive to keep it current.
--
-- Consequence worth stating plainly: everything a vendor puts here is public.
-- The table therefore holds list prices and catalogue facts only. Negotiated
-- rates belong in vendor_price_observations tied to a restaurant, never here.

CREATE TABLE public.vendor_portal_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_catalogue_id uuid,
    provider_id uuid,

    -- Subdomain label: <slug>.vendors.<domain>. Lowercase, hyphenated.
    slug text NOT NULL,
    display_name text NOT NULL,
    tagline text,
    about text,
    logo_url text,
    contact_email text,
    contact_phone text,
    website_url text,

    -- Unpublished pages are editable but do not resolve publicly, so a vendor
    -- can prepare a list without a half-finished catalogue being crawled.
    is_published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,

    -- Opaque token a vendor uses to edit without an account. Vendors are not
    -- tenants of this system and forcing them through registration is the
    -- reason a portal like this usually sits empty.
    edit_token uuid DEFAULT gen_random_uuid() NOT NULL,
    edit_token_expires_at timestamp with time zone,

    -- Set when our own reader last ingested this page into
    -- vendor_price_observations, so a re-read can be skipped when nothing changed.
    last_ingested_at timestamp with time zone,
    content_version integer DEFAULT 1 NOT NULL,

    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT vendor_portal_pages_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_portal_pages_slug_key UNIQUE (slug),
    CONSTRAINT vendor_portal_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'),
    CONSTRAINT vendor_portal_pages_catalogue_fkey FOREIGN KEY (vendor_catalogue_id)
        REFERENCES public.vendor_catalogue(id) ON DELETE SET NULL
);

CREATE INDEX idx_vendor_portal_published
    ON public.vendor_portal_pages (is_published, updated_at DESC);

CREATE TABLE public.vendor_portal_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_id uuid NOT NULL,

    -- What the vendor typed. Kept verbatim: this is the vendor's claim and
    -- must not be silently rewritten by our matcher.
    product_name text NOT NULL,
    producer text,
    vintage integer,
    region text,
    country text,
    grape_varieties text,

    price numeric,
    currency character varying(3) DEFAULT 'USD' NOT NULL,
    pack_size integer DEFAULT 1 NOT NULL,
    volume_ml integer,
    unit_label text,

    in_stock boolean,
    min_order_quantity integer,
    lead_time_days integer,
    notes text,

    -- Resolution against our library, when we manage it. Nullable forever is
    -- fine — an unmatched listing is still a price observation, it just cannot
    -- enrich a specific master wine yet.
    master_wine_id uuid,
    match_confidence numeric,
    -- 'exact' | 'fuzzy' | 'manual' | 'unmatched'
    match_method text,

    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT vendor_portal_listings_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_portal_listings_page_fkey FOREIGN KEY (page_id)
        REFERENCES public.vendor_portal_pages(id) ON DELETE CASCADE,
    CONSTRAINT vpl_price_check CHECK (price IS NULL OR price >= 0),
    CONSTRAINT vpl_pack_check CHECK (pack_size > 0),
    CONSTRAINT vpl_vintage_check CHECK (vintage IS NULL OR (vintage BETWEEN 1800 AND 2200)),
    CONSTRAINT vpl_match_method_check CHECK (
        match_method IS NULL
        OR match_method IN ('exact', 'fuzzy', 'manual', 'unmatched')
    )
);

CREATE INDEX idx_vendor_portal_listings_page
    ON public.vendor_portal_listings (page_id, sort_order, product_name);

-- "which listings still need matching" — the library-enrichment work queue.
CREATE INDEX idx_vendor_portal_listings_unmatched
    ON public.vendor_portal_listings (page_id)
    WHERE master_wine_id IS NULL;

CREATE INDEX idx_vendor_portal_listings_wine
    ON public.vendor_portal_listings (master_wine_id)
    WHERE master_wine_id IS NOT NULL;

ALTER TABLE public.vendor_portal_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_portal_listings ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies. Public reads go through the API's published
-- endpoint, which filters to is_published and returns only catalogue fields —
-- never edit_token. Exposing this table directly to anon would publish every
-- vendor's edit token, which is the whole authentication mechanism.

COMMENT ON TABLE public.vendor_portal_pages IS
    'Hosted vendor catalogue pages resolved by slug on a subdomain. Public and '
    'machine-readable by design; list prices only, never negotiated rates.';
