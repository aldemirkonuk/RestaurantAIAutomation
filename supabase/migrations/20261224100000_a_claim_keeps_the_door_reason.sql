-- A claim keeps the door's reason (F-158; founder ruling W54, ADR 0267
-- option 8, verbatim pick "Keep the door's reason").
--
-- THE FINDING (owner-quarter sim, 2026-10-02). A wrong-item refusal showed as
-- "damaged" on /receiving's drafted card and as "Refused at the door" on
-- /receipts › Credits; a broken bottle showed as "Refused at the door" too.
-- Cause: every `rejected` invoice-match verdict was filed with reason
-- `damaged` (credit-ledger.ts reasonForVerdict), whatever the door had said.
-- The door has recorded its own reason since 20260901220000
-- (procurement_receipt_events.refusal_reason: wrong_wine, broken_case,
-- temperature, other) — it just never reached the claim.
--
-- THE RULING: keep the door's reason on the claim — wrong item, broken,
-- temperature, other — with one wording on every page and in the letter.
-- Rejected: "one bucket" (wrong item and breakage still look the same) and
-- "words now, reasons later" (it still loses the reason).
--
-- WHAT THIS ADDS. Three reasons to `procurement_credits_reason_check`:
--   wrong_item   — the door refused it as not what was ordered (door:
--                  wrong_wine; named for every beverage, not wine only)
--   broken       — a broken-case refusal, or the door's broken count on a
--                  delivery it kept
--   temperature  — the door refused it for temperature
-- The door's `other` maps to the existing `other`. `damaged` stays, and keeps
-- meaning what every existing row means: refused or broken at the door, and
-- the claim does not know which. No row is rewritten (no backfill) — an old
-- row cannot be given a reason nobody recorded on it.
--
-- Additive and idempotent: the CHECK widen is read-and-append, the same shape
-- a_never_arrived_cancel_can_claim_a_refund used (never a hand-typed list, so
-- a reason added on another branch is not dropped). No row is written, moved
-- or deleted; no RLS, grant or index change. `reason` is varchar(30); the
-- longest new value is 11 characters.

SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Widen procurement_credits_reason_check by reading it first.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  reasons TEXT[];
  wanted TEXT[] := ARRAY['wrong_item', 'broken', 'temperature'];
  missing TEXT[];
  rebuilt TEXT;
  written TEXT[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.procurement_credits'::regclass
    AND conname = 'procurement_credits_reason_check';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'procurement_credits_reason_check is absent: this migration extends a constraint that must already exist (the baseline)';
  END IF;

  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO reasons
  FROM regexp_matches(existing_def, '''((?:[^'']|'''')+)''', 'g') AS m;

  IF reasons IS NULL OR array_length(reasons, 1) < 7 THEN
    RAISE EXCEPTION
      'could not read the admitted credit reasons out of "%" — refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  SELECT array_agg(w) INTO missing
  FROM unnest(wanted) AS w
  WHERE NOT (w = ANY(reasons));

  IF missing IS NULL THEN
    -- already extended; re-running this file changes nothing further below
    NULL;
  ELSE
    reasons := reasons || missing;

    SELECT string_agg(quote_literal(r), ', ' ORDER BY r)
    INTO rebuilt
    FROM unnest(reasons) AS r;

    EXECUTE 'ALTER TABLE public.procurement_credits '
         || 'DROP CONSTRAINT procurement_credits_reason_check';
    EXECUTE 'ALTER TABLE public.procurement_credits '
         || 'ADD CONSTRAINT procurement_credits_reason_check '
         || format('CHECK ((reason)::text IN (%s))', rebuilt);

    SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO written
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
    WHERE c.conrelid = 'public.procurement_credits'::regclass
      AND c.conname = 'procurement_credits_reason_check';

    IF written IS NULL OR NOT (written @> reasons AND reasons @> written) THEN
      RAISE EXCEPTION
        'rebuilding the credit reason CHECK did not keep exactly the reasons it read plus %: read %, wrote %',
        missing, reasons, written;
    END IF;
  END IF;
END
$$;

COMMENT ON COLUMN public.procurement_credits.reason IS
  'Why this claim was opened. never_arrived joined 2026-09-22 (ADR 0207 round 5) — a claim from the never-arrived cancel''s own box, for an order the house says it already paid for; distinct from never_ordered (billed for something never placed). wrong_item, broken and temperature joined 2026-10 (F-158, ADR 0267 option 8, founder: "Keep the door''s reason") — the door''s own reason for what it turned away or found broken. damaged is older rows and any rejection whose reason the door did not give: refused or broken at the door, not known which.';

-- ---------------------------------------------------------------------------
-- 2. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted TEXT[];
BEGIN
  SELECT array_agg(replace(m[1], '''''', '''')) INTO admitted
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
  WHERE c.conrelid = 'public.procurement_credits'::regclass
    AND c.conname = 'procurement_credits_reason_check'
    AND c.convalidated;
  IF admitted IS NULL OR NOT (admitted @> ARRAY['wrong_item', 'broken', 'temperature']) THEN
    RAISE EXCEPTION 'the credit reason CHECK does not admit the door''s reasons: %', admitted;
  END IF;
  IF NOT (admitted @> ARRAY['overbilled_vs_ship', 'qty_short', 'short_shipped', 'damaged',
                            'price_variance', 'never_ordered', 'other', 'never_arrived']) THEN
    RAISE EXCEPTION 'rebuilding the credit reason CHECK dropped an existing reason: %', admitted;
  END IF;
END
$$;
