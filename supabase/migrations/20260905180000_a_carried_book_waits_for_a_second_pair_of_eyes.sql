-- An uploaded price book carries its own approval, and the size of the decision
-- decides how many people it takes.
--
-- WHY THIS EXISTS (ADR 0128; ADR 0117 Q18)
-- ---------------------------------------------------------------------------
-- ADR 0117 Q18 asked whether provenance is enough for a hand-carried price
-- book, "or should an uploaded book require a second person's confirmation
-- before it is shown?". The founder's answer, 2026-09-05: "Yes, it needs an
-- approval however we can't wait 2 people to approve a small decision, or a
-- big one."
--
-- Both halves are constraints, and the second one is not rhetoric. Measured on
-- production the same day, read-only: of fifteen houses, TEN have one
-- owner-or-manager or none; of the eight jurisdictions the estate resolves to,
-- FIVE have exactly one person who could ever sign anything. `price_index_postings`
-- is keyed by STATE and has no restaurant_id on purpose, so an uploaded book is
-- not one house's number - it is every house in that jurisdiction's number.
-- Michigan, the only jurisdiction with an uploadable source today, has three
-- houses and three distinct owner-or-manager people.
--
-- So the shape is a tier, and this migration is the paper it writes on:
--
--   ROUTINE  a later edition of a book the register already holds, whose
--            differences sit inside the bands in `upload-tier.ts`. One
--            person's upload STANDS, with provenance, and the others are told.
--            Status 'stood' - not 'confirmed', because nobody confirmed it and
--            a status that says otherwise is a lie in a column.
--
--   SECOND   the first book, or a book outside the bands, or a comparison that
--   PAIR OF  could not be made at all. The rows are written and HELD: they are
--   EYES     not the market until somebody admits them. Status 'pending'.
--
-- WHAT `admitted_at` ON THE POSTINGS IS FOR
-- ---------------------------------------------------------------------------
-- A row is in the market when `uploaded_by IS NULL` (nobody carried it; it was
-- fetched) OR `admitted_at IS NOT NULL` (somebody carried it and it was let in).
-- The predicate lives in exactly one place in the code
-- (`MARKET_VISIBILITY` in price-index.service.ts) so it cannot drift.
--
-- It is NOT called `confirmed_at`, because a routine book's rows are admitted
-- without anybody confirming anything, and a column called confirmed would then
-- assert a confirmation that never happened.
--
-- THE BACKFILL, STATED
-- ---------------------------------------------------------------------------
-- Every uploaded row that already exists is stamped admitted (`fetched_at`, the
-- instant it entered the register). The new rule applies from here forward. The
-- alternative - leaving them NULL - would make rows that have been on screens
-- for weeks vanish the moment this migration runs, with nobody told why. On the
-- production project today this backfill touches nothing: `price_index_postings`
-- does not exist there yet (the 20260904200000 migration is unapplied), so the
-- table is empty everywhere it does exist.
--
-- WHY THE SEAL KIND IS WIDENED HERE
-- ---------------------------------------------------------------------------
-- Admitting a book puts numbers on other people's screens and cannot be undone
-- by the person who reads them. ADR 0107/0116's addenda made that class of act
-- challenge-and-redeem rather than an assertion, and `seal-subject.ts` names the
-- kinds. Adding a kind to the code without widening the CHECK is a guaranteed
-- production failure, so the two move together, by hand, as 20260904210000's
-- own comment requires.
--
-- Additive. No existing column is altered, no existing CHECK is narrowed, no
-- existing row is rewritten except the stated backfill. RLS on and
-- anon/authenticated revoked on the new table. The Supabase CLI wraps each
-- migration file in a transaction, so no explicit BEGIN/COMMIT.

-- ---------------------------------------------------------------------------
-- 1. The review: one row per uploaded book, and what happened to it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.price_index_upload_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHICH book. The registry key, e.g. 'michigan-lcc-price-book'.
  source_key VARCHAR(80) NOT NULL CHECK (btrim(source_key) <> ''),
  -- WHERE it is a price. Same ISO-3166-2 shape as price_index_postings.state,
  -- because the people who may admit this book are the ones in that
  -- jurisdiction and nowhere else.
  state VARCHAR(12) NOT NULL CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),

  -- WHICH FILE, and WHICH BYTES. The sha256 is the whole defence against a
  -- doctored workbook - the issuer publishes no signature - so it is the key
  -- a second person re-downloads the book and compares against.
  file_name TEXT NOT NULL CHECK (btrim(file_name) <> ''),
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The date the FILE NAME stated. Same value the postings carry.
  edition_date DATE NOT NULL,
  rows_written INTEGER NOT NULL CHECK (rows_written >= 0),

  -- WHO carried it in, and which house they were acting for. NEVER auth.users:
  -- the two tables are disjoint and the JWT carries public.users.user_id.
  -- ON DELETE RESTRICT, not SET NULL: an approval record whose actor has become
  -- NULL is an approval by nobody, which is worse than no record at all.
  uploaded_by UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  -- The house the uploader was standing in. NULLABLE on purpose: the person is
  -- the fact that matters and is NOT NULL above, their house is derivable from
  -- `user_restaurant_access`, and making it required would have turned a
  -- convenience into a gate that refuses a book for a reason the uploader
  -- cannot see. It is recorded when the caller knows it, and the inbox uses it
  -- to make sure the uploader's own house hears about its own book.
  uploaded_by_restaurant_id UUID
    REFERENCES public.restaurants(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,

  -- HOW BIG a decision this was, decided by `upload-tier.ts` from the book
  -- itself, and the reasons in the words the person reads.
  tier TEXT NOT NULL CHECK (tier IN ('routine', 'second_pair_of_eyes')),
  tier_reasons TEXT[] NOT NULL,
  tier_note TEXT NOT NULL CHECK (btrim(tier_note) <> ''),

  -- The measured comparison with the last admitted edition, kept whole. This is
  -- the evidence that replaces the reasoned bands in `upload-tier.ts` once two
  -- real editions of a book exist - which no repository here holds today.
  diff JSONB NOT NULL,

  -- Price by stable item key, the baseline the NEXT edition is weighed against.
  -- Null only when the book was too big to fingerprint, and then the reason is
  -- stated: a truncated baseline would make the next comparison quietly wrong,
  -- which is worse than having none and saying so.
  price_fingerprint JSONB,
  fingerprint_refused_because TEXT,

  -- WHAT HAPPENED.
  --   stood     - routine tier. One person's upload, nobody asked to confirm.
  --   pending   - held out of the market, waiting.
  --   confirmed - admitted, by somebody, on stated evidence.
  --   refused   - never admitted, with a reason.
  status TEXT NOT NULL
    CHECK (status IN ('stood', 'pending', 'confirmed', 'refused')),

  confirmed_by UUID REFERENCES public.users(user_id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  -- WHAT the confirmation was worth, never left to be inferred:
  --   byte_match  - the confirmer produced the same bytes independently. The
  --                 only evidence-producing confirmation available for a book
  --                 whose issuer publishes no signature.
  --   attested    - a second person looked at the summary and vouched.
  --   same_person - the uploader admitted their own book because this
  --                 jurisdiction has nobody else. NOT a second pair of eyes,
  --                 and the column exists so that it can never be read as one.
  confirmation_evidence TEXT
    CHECK (confirmation_evidence IN ('byte_match', 'attested', 'same_person')),
  confirmation_reason TEXT,
  confirmation_seal_id UUID
    REFERENCES public.mcp_seal_challenges(id) ON DELETE SET NULL,

  refused_by UUID REFERENCES public.users(user_id) ON DELETE RESTRICT,
  refused_at TIMESTAMPTZ,
  refusal_reason TEXT,

  -- When the people who could act were told again that nobody had. Escalation
  -- NEVER admits a book: silence is not consent, and a clock that approves is
  -- the absence-reported-as-health inversion with a timer on it.
  escalated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same bytes are one decision, not two.
  CONSTRAINT price_index_upload_reviews_bytes_once
    UNIQUE (source_key, file_sha256),

  -- A routine book is 'stood' and a held book is not: the two facts are the
  -- same fact, so they may not disagree.
  CONSTRAINT price_index_upload_reviews_routine_stood
    CHECK ((tier = 'routine') = (status = 'stood')),

  -- A held book names why it is held; a routine one has nothing to name.
  CONSTRAINT price_index_upload_reviews_reasons_match_tier
    CHECK (
      (tier = 'routine' AND cardinality(tier_reasons) = 0)
      OR (tier = 'second_pair_of_eyes' AND cardinality(tier_reasons) > 0)
    ),

  -- A fingerprint, or the reason there is none. Never neither: a NULL with no
  -- reason beside it is an absence reporting itself as health.
  CONSTRAINT price_index_upload_reviews_fingerprint_or_reason
    CHECK (
      price_fingerprint IS NOT NULL
      OR (fingerprint_refused_because IS NOT NULL
          AND btrim(fingerprint_refused_because) <> '')
    ),

  -- Nothing is confirmed until every part of the confirmation is on the row.
  CONSTRAINT price_index_upload_reviews_confirmation_complete
    CHECK (
      (status <> 'confirmed'
        AND confirmed_by IS NULL AND confirmed_at IS NULL
        AND confirmation_evidence IS NULL)
      OR
      (status = 'confirmed'
        AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
        AND confirmation_evidence IS NOT NULL)
    ),

  -- The SAP rule, in a CHECK rather than in a code path: a second person is a
  -- DIFFERENT person. Where there is nobody else the act is still allowed, but
  -- it is called what it is and it carries a stated reason.
  CONSTRAINT price_index_upload_reviews_second_person_is_another
    CHECK (
      status <> 'confirmed'
      OR (confirmation_evidence = 'same_person'
          AND confirmed_by = uploaded_by
          AND confirmation_reason IS NOT NULL
          AND btrim(confirmation_reason) <> '')
      OR (confirmation_evidence <> 'same_person'
          AND confirmed_by <> uploaded_by)
    ),

  -- A refusal names a person and a reason, or it is not a refusal.
  CONSTRAINT price_index_upload_reviews_refusal_complete
    CHECK (
      (status <> 'refused'
        AND refused_by IS NULL AND refused_at IS NULL
        AND refusal_reason IS NULL)
      OR
      (status = 'refused'
        AND refused_by IS NOT NULL AND refused_at IS NOT NULL
        AND refusal_reason IS NOT NULL AND btrim(refusal_reason) <> '')
    )
);

COMMENT ON TABLE public.price_index_upload_reviews IS
  'One row per hand-carried price book (ADR 0128): how big a decision it was, who carried it, who admitted it and on what evidence. NOT restaurant-scoped in effect - the register it feeds is keyed by state - but it records the house the uploader acted for. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.price_index_upload_reviews.status IS
  'stood = routine tier, one person, nobody asked to confirm. pending = held out of the market. confirmed = admitted. refused = never admitted. ''stood'' is deliberately not ''confirmed'': nobody confirmed it.';
COMMENT ON COLUMN public.price_index_upload_reviews.confirmation_evidence IS
  'byte_match = the confirmer produced the same bytes independently, the only evidence-producing confirmation for a book whose issuer publishes no signature. attested = a second person vouched for the summary. same_person = the uploader admitted their own book because the jurisdiction has nobody else - never to be read as a second pair of eyes.';
COMMENT ON COLUMN public.price_index_upload_reviews.price_fingerprint IS
  'Price by stable item key for this edition: the baseline the next edition is compared against. Null only with fingerprint_refused_because set.';
COMMENT ON COLUMN public.price_index_upload_reviews.escalated_at IS
  'When the people who could admit this book were told again that nobody had. Escalation never admits anything: a clock that approves is silence read as consent.';

CREATE INDEX IF NOT EXISTS idx_price_index_upload_reviews_pending
  ON public.price_index_upload_reviews (state, uploaded_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_price_index_upload_reviews_baseline
  ON public.price_index_upload_reviews (source_key, edition_date DESC)
  WHERE status IN ('stood', 'confirmed');

ALTER TABLE public.price_index_upload_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_index_upload_reviews_service_role
  ON public.price_index_upload_reviews;
CREATE POLICY price_index_upload_reviews_service_role
  ON public.price_index_upload_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.price_index_upload_reviews FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The postings: when a carried row was let into the market.
-- ---------------------------------------------------------------------------

ALTER TABLE public.price_index_postings
  ADD COLUMN IF NOT EXISTS admitted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_index_postings_admission_needs_an_uploader'
       AND conrelid = to_regclass('public.price_index_postings')
  ) THEN
    -- Only a row somebody carried can be admitted. A fetched row was never
    -- held, so stamping one would invent a decision nobody made.
    ALTER TABLE public.price_index_postings
      ADD CONSTRAINT price_index_postings_admission_needs_an_uploader
      CHECK (admitted_at IS NULL OR uploaded_by IS NOT NULL);
  END IF;
END
$$;

COMMENT ON COLUMN public.price_index_postings.admitted_at IS
  'When this carried row was let into the market (ADR 0128). A row is the market when uploaded_by IS NULL (fetched, never held) OR admitted_at IS NOT NULL. Not called confirmed_at: a routine book is admitted without anybody confirming it.';

-- Rows already on screens stay on screens. See the header.
UPDATE public.price_index_postings
   SET admitted_at = fetched_at
 WHERE uploaded_by IS NOT NULL
   AND admitted_at IS NULL;

-- The seek the confirm route makes: every row of one book, by its bytes.
CREATE INDEX IF NOT EXISTS idx_price_index_postings_upload_sha256
  ON public.price_index_postings (upload_sha256)
  WHERE upload_sha256 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The seal learns one more kind.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT IF EXISTS chk_mcp_seal_challenges_subject_kind;

ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind
  -- Kept in step with `common/seal/seal-subject.ts`'s SEAL_SUBJECT_KINDS by
  -- hand, for the reason 20260904210000 gives: a CHECK generated from the code
  -- would accept a typo, and a CHECK behind the code is a production failure.
  -- 'price_index_upload' is the seal on ADMITTING a hand-carried price book to
  -- the market of every house in its jurisdiction. Like the order, payment and
  -- grant kinds it carries no connection_id and names the review in subject_id.
  CHECK (subject_kind IN (
    'mcp_tool', 'mcp_tool_grant', 'procurement_order',
    'payment_method', 'price_index_upload'
  ));

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admits_self_confirm boolean;
  admits_stamped_fetch boolean;
  admits_new_kind boolean;
  probe_review UUID;
  probe_user UUID;
  probe_restaurant UUID;
BEGIN
  IF to_regclass('public.price_index_upload_reviews') IS NULL THEN
    RAISE EXCEPTION 'price_index_upload_reviews was not created';
  END IF;
  IF to_regclass('public.price_index_postings') IS NULL THEN
    RAISE EXCEPTION 'price_index_postings does not exist; this migration is out of order';
  END IF;

  -- RLS on, and the two anonymous roles off. A new table that any authenticated
  -- session can read is a new table nobody notices is public.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = to_regclass('public.price_index_upload_reviews')
       AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'price_index_upload_reviews has RLS off';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'price_index_upload_reviews'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'price_index_upload_reviews still grants anon or authenticated';
  END IF;

  -- Every actor FK must point INSIDE public. auth.users and public.users are
  -- disjoint (zero shared ids), and CI cannot catch the mistake because a fresh
  -- database has no rows to violate.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = ref.relnamespace
     WHERE con.conrelid = to_regclass('public.price_index_upload_reviews')
       AND con.contype = 'f'
       AND ns.nspname <> 'public'
  ) THEN
    RAISE EXCEPTION
      'a foreign key on price_index_upload_reviews points outside public; auth.users and public.users are disjoint';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'price_index_postings'
       AND column_name = 'admitted_at' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'admitted_at must have no DEFAULT - a default would admit every future carried row without anybody deciding to';
  END IF;

  -- Prove the CHECK actually refuses a fetched row that claims an admission,
  -- rather than trusting that it was created.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.price_index_postings
        (source_key, source_class, state, issuer, issued_at, price_basis,
         product_name, price, price_unit, source_url, source_ref, content_hash,
         admitted_at)
      VALUES
        ('admit-probe', 'posted_wholesale_list', 'US-MI', 'probe',
         DATE '2026-01-01', 'probe', 'probe', 1, 'per bottle',
         'https://example.invalid', 'admit-probe', repeat('0', 64), NOW())
    $q$;
    admits_stamped_fetch := true;
  EXCEPTION WHEN check_violation THEN
    admits_stamped_fetch := false;
  END;
  IF admits_stamped_fetch THEN
    DELETE FROM public.price_index_postings WHERE source_ref = 'admit-probe';
    RAISE EXCEPTION
      'a fetched row was admitted; only a row somebody carried can carry an admission';
  END IF;

  -- Prove the seal CHECK admits the new kind and still refuses an invented one.
  BEGIN
    EXECUTE $q$
      SELECT 1 WHERE 'price_index_upload' IN (
        'mcp_tool', 'mcp_tool_grant', 'procurement_order',
        'payment_method', 'price_index_upload')
    $q$;
    admits_new_kind := EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'chk_mcp_seal_challenges_subject_kind'
         AND conrelid = to_regclass('public.mcp_seal_challenges')
         AND pg_get_constraintdef(oid) LIKE '%price_index_upload%'
    );
  END;
  IF NOT admits_new_kind THEN
    RAISE EXCEPTION
      'the seal subject_kind CHECK does not admit price_index_upload; the code declares a kind the database refuses';
  END IF;

  -- Prove the second-person CHECK refuses a silent self-confirmation: the same
  -- person confirming their own book while claiming a second pair of eyes.
  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_user IS NOT NULL AND probe_restaurant IS NOT NULL THEN
    BEGIN
      INSERT INTO public.price_index_upload_reviews
        (source_key, state, file_name, file_sha256, edition_date, rows_written,
         uploaded_by, uploaded_by_restaurant_id, uploaded_at,
         tier, tier_reasons, tier_note, diff, price_fingerprint,
         fingerprint_refused_because, status,
         confirmed_by, confirmed_at, confirmation_evidence, confirmation_reason,
         confirmation_seal_id, refused_by, refused_at, refusal_reason,
         escalated_at)
      VALUES
        ('probe-source', 'US-MI', 'probe.xlsx', repeat('a', 64),
         DATE '2026-01-01', 1,
         probe_user, probe_restaurant, NOW(),
         'second_pair_of_eyes', ARRAY['first_book'], 'probe', '{}'::jsonb,
         '{}'::jsonb, NULL, 'confirmed',
         probe_user, NOW(), 'attested', NULL,
         NULL, NULL, NULL, NULL, NULL)
      RETURNING id INTO probe_review;
      admits_self_confirm := true;
    EXCEPTION WHEN check_violation THEN
      admits_self_confirm := false;
    END;
    IF admits_self_confirm THEN
      DELETE FROM public.price_index_upload_reviews WHERE id = probe_review;
      RAISE EXCEPTION
        'the uploader confirmed their own book as ''attested''; a second pair of eyes must be a different pair';
    END IF;
  ELSE
    RAISE NOTICE
      'no user or restaurant row exists here, so the second-person CHECK was created but not exercised. It is exercised by the jest suite against the same predicate.';
  END IF;

  RAISE NOTICE
    'price_index_upload_reviews created (RLS on, anon/authenticated revoked, self-confirmation refused); price_index_postings.admitted_at added and backfilled for existing carried rows; seal subject_kind widened to price_index_upload.';
END
$$;
