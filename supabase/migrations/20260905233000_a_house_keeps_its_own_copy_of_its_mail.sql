-- A house keeps its own copy of its mail (ADR 0118 D16 — founder, 2026-09-05).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- 20260905190000 gave a mirrored vendor reply a WINDOW and a TOMBSTONE: the raw
-- mail is deleted when the window runs out, and immediately on revocation. It
-- gave the house nothing to keep. Asked what a Turkish house does about TTK 6102
-- Art. 82's ten-year duty on RECEIVED commercial letters, the founder's answer
-- was to offer the house two ways to keep its own copy and to keep offering
-- neither by default:
--
--   A  own_cloud        the raw mail is EXPORTED to the house's own cloud
--                       through the Drive grant it already holds, and Mudavym
--                       keeps only the facts once the window ends.
--   B  mudavym_archive  Mudavym keeps the mail past the window in an archive of
--                       its own, and bills for it.
--   -  none             today's behaviour, stated rather than defaulted into.
--
-- A is built here end to end. B's SHAPE is here — this table, its price
-- columns, its refusal — and its ARMING is gated on OD-23 (who pays, and how
-- much). `house_mail_archive_settings_paid_tier_arms_only_with_a_price` is that
-- gate in the database rather than only in an `if`: a Mudavym-archive row may be
-- RECORDED (the house asked for it) and may not be ARMED until a price exists on
-- the row. A silent free tier is the one outcome neither the founder nor this
-- schema will produce.
--
-- WHAT IT ADDS
-- -----------
--   1. `house_mail_archive_settings` — one row per house: which of the three,
--      who chose it, which Drive grant carries it, where in that Drive, whether
--      it is ARMED, and — when it is not — the sentence saying why not.
--   2. `house_mail_exports` — one row per conversation per destination: what was
--      exported, where it landed, when, and the sha256 of the exact bytes that
--      were written and read back. THE SWEEP READS THIS TABLE. With an armed
--      archive, a conversation with no `status = 'exported'` row here is not
--      deleted; it is held back and said so.
--   3. `house_mail_export_runs` — a count recorded whether or not anything was
--      exported (ADR 0078). `considered`, `exported` and `failed` are NOT NULL
--      with NO DEFAULT, so a run that forgot its count fails at the write rather
--      than reading as a run that found nothing.
--   4. `house_mail_retention_sweeps.archive_mode` / `.held_for_export` — so a
--      sweep row says which archive was in force and how much mail it refused to
--      delete because the export had not landed. Both NULLABLE, and NULL means
--      "this sweep ran before the archive existed", NEVER "no archive" and never
--      zero.
--   5. The seal learns `house_mail_export`. Choosing an archive and running an
--      export are both sealed acts on the HOUSE (ADR 0107): an export copies
--      every vendor reply this house holds out to a third party's storage, and
--      the person who does it cannot un-copy it.
--
-- WHY THE EXPORT ROW IS THE PRECONDITION AND NOT A LOG
-- ---------------------------------------------------
-- The sweep's deletion is irreversible and the export is the only thing that
-- makes it survivable. An export the sweep does not READ is a promise; an export
-- row the sweep must find before it tombstones anything is a mechanism. So
-- `status = 'exported'` demands `drive_file_id` AND `content_sha256` AND no
-- failure reason, and `status = 'failed'` demands a reason in words — a failed
-- export is a FAILURE with a stated cause, never "nothing to export".
--
-- ADDITIVE, NULLABLE, NO BACKFILL
-- ------------------------------
-- The three tables start empty: no house has chosen an archive, and nothing has
-- been exported. The two added sweep columns are nullable because NULL is the
-- true answer for every sweep row already written — those runs did not evaluate
-- an archive, and stamping them 'none' would be a claim about a decision nobody
-- made.
--
-- Idempotent and safe to re-run: CREATE TABLE / ADD COLUMN / CREATE INDEX use IF
-- NOT EXISTS, every CREATE POLICY is preceded by DROP POLICY IF EXISTS, the CHECK
-- widening drops before it adds, and REVOKE of an absent privilege is a no-op. No
-- explicit BEGIN/COMMIT — the Supabase CLI wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The house's choice.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_mail_archive_settings (
  -- ONE row per restaurant, for 20260905190000's reason: the archive is a fact
  -- about the HOUSE's records, not about one person's grant. Two people
  -- consenting does not give the house two archives.
  restaurant_id UUID PRIMARY KEY
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- 'own_cloud'       — exported to the house's own Drive through its grant.
  -- 'mudavym_archive' — kept here past the window, billed. Gated on OD-23.
  -- 'none'            — today's behaviour: the window applies and nothing is
  --                     exported. A RECORDED 'none' is a choice; NO ROW AT ALL
  --                     is a house that was never asked, and the service says
  --                     which of the two it is rather than printing 'none' for
  --                     both.
  mode TEXT NOT NULL
    CHECK (mode IN ('own_cloud', 'mudavym_archive', 'none')),

  -- Who chose it, and when. `public.users.user_id`, NEVER auth.users: the two
  -- are disjoint on this deployment and an actor FK to auth.users 23503s on
  -- every write.
  chosen_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  chosen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The seal spent to choose it. ON DELETE SET NULL: the record that a house
  -- chose an archive must outlive the challenge row it was chosen with.
  chosen_seal_id UUID,

  -- ARMED means "this mode is actually operating". A mode that is recorded and
  -- not armed changes nothing: the window still applies exactly as it does for
  -- 'none'. Never a boolean — the timestamp says WHEN, and `refused_because`
  -- says why not.
  armed_at TIMESTAMPTZ,
  refused_because TEXT,

  -- own_cloud only. The Drive grant that carries the export, and where in that
  -- Drive the files land. `drive_folder_id` is Google's own file id for the
  -- house's archive folder; `drive_folder_path` is the same place in words, so
  -- a person can find it without asking Google what an id means.
  connection_id UUID REFERENCES public.integration_oauth_connections(id)
    ON DELETE SET NULL,
  drive_folder_id TEXT,
  drive_folder_path TEXT,

  -- mudavym_archive only, and the reason this table can refuse. A tier with no
  -- price is a free tier nobody agreed to give away, so arming demands both.
  -- OD-23 is open (2026-09-05) and these are therefore NULL on every row this
  -- deployment can currently write.
  price_minor_units INTEGER,
  price_currency CHAR(3),
  price_unit TEXT,
  -- Which decision fixed that price. A price with no decision behind it is the
  -- same "sensible default" this repo forbids.
  price_decision TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Every settings row is EITHER armed OR says why it is not. A row that is
  -- neither armed nor refused is a mode nobody can act on and nobody can
  -- explain, which is the silence this whole ADR exists to end.
  CONSTRAINT house_mail_archive_settings_armed_or_said
    CHECK (
      (armed_at IS NOT NULL AND refused_because IS NULL)
      OR (armed_at IS NULL AND refused_because IS NOT NULL)
    ),

  -- THE OD-23 GATE. A Mudavym archive may be chosen and may not begin to
  -- operate until somebody has decided what it costs.
  CONSTRAINT house_mail_archive_settings_paid_tier_arms_only_with_a_price
    CHECK (
      mode <> 'mudavym_archive'
      OR armed_at IS NULL
      OR (price_minor_units IS NOT NULL
          AND price_currency IS NOT NULL
          AND price_unit IS NOT NULL
          AND price_decision IS NOT NULL)
    ),

  -- An armed own_cloud archive must name the FOLDER it writes into. Arming
  -- without one would be a promise to export to somewhere nobody named.
  --
  -- IT DOES NOT NAME THE GRANT, AND THAT WAS MEASURED, NOT ASSUMED. This CHECK
  -- first read `connection_id IS NOT NULL AND drive_folder_id IS NOT NULL`, and
  -- the PGlite probe caught what that costs: `connection_id` is ON DELETE SET
  -- NULL, so deleting the Drive grant row makes Postgres run
  -- `SET connection_id = NULL` on an armed row and the DELETE itself fails with
  -- 23514. A constraint that makes a grant undeletable is a constraint that
  -- traps a person inside a consent they want out of. So the service refuses to
  -- ARM without a grant, and a NULL `connection_id` on an armed row afterwards
  -- means the grant it was armed with is GONE — which the export path reports
  -- as a failure naming that, never as "nothing to export".
  CONSTRAINT house_mail_archive_settings_own_cloud_names_its_destination
    CHECK (
      mode <> 'own_cloud'
      OR armed_at IS NULL
      OR drive_folder_id IS NOT NULL
    ),

  CONSTRAINT house_mail_archive_settings_price_is_positive
    CHECK (price_minor_units IS NULL OR price_minor_units > 0)
);

COMMENT ON TABLE public.house_mail_archive_settings IS
  'Which of the three archive answers this house chose (ADR 0118 D16): own_cloud (exported to the house''s own Drive), mudavym_archive (kept here past the window and billed — arming gated on OD-23), or none (the window applies as today). NO ROW means the house was never asked, which the service reports differently from a recorded ''none''. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_mail_archive_settings.armed_at IS
  'When this mode began to OPERATE. NULL with refused_because set means the mode is recorded and doing nothing — the window applies unchanged. A mudavym_archive row cannot be armed until a price is on the row (OD-23).';
COMMENT ON COLUMN public.house_mail_archive_settings.refused_because IS
  'Why this mode is not armed, in words, for the person who chose it. Never NULL on an unarmed row: a mode that is off for a reason nobody wrote down is indistinguishable from a mode that is off by accident.';
COMMENT ON COLUMN public.house_mail_archive_settings.price_minor_units IS
  'What the Mudavym archive costs this house, in the currency''s minor units, per price_unit. NULL on every row this deployment can write, because OD-23 (who pays, and how much) is open. The CHECK above turns that NULL into a refusal to arm rather than into a free tier.';

CREATE INDEX IF NOT EXISTS idx_house_mail_archive_settings_armed
  ON public.house_mail_archive_settings (mode)
  WHERE armed_at IS NOT NULL;

ALTER TABLE public.house_mail_archive_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_archive_settings_service_role
  ON public.house_mail_archive_settings;
CREATE POLICY house_mail_archive_settings_service_role
  ON public.house_mail_archive_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_archive_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. What was exported, per conversation. The sweep's precondition.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_mail_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- CASCADE: an export row describes ONE conversation's raw mail, and the row
  -- has no meaning once the conversation is gone. The FILE in the house's own
  -- Drive is unaffected — it is the house's, in the house's storage, and
  -- nothing here can reach it.
  conversation_id UUID NOT NULL
    REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,

  destination TEXT NOT NULL
    CHECK (destination IN ('own_cloud_google_drive', 'mudavym_archive')),

  -- 'exported' — the bytes were written AND read back and the hash matched.
  -- 'failed'   — it did not happen, and failure_reason says what stopped it.
  -- There is no third state, and in particular no 'skipped': a conversation
  -- that was not exported has either a failed row or no row, and the sweep
  -- treats both as "not exported" rather than as "nothing to do".
  status TEXT NOT NULL CHECK (status IN ('exported', 'failed')),

  connection_id UUID REFERENCES public.integration_oauth_connections(id)
    ON DELETE SET NULL,
  drive_file_id TEXT,
  -- The documented layout, in words, so a person can find the file without
  -- resolving an id: <archive>/<restaurant>/<vendor>/<YYYY-MM>/<conversation>.json
  file_path TEXT,
  content_sha256 TEXT,
  bytes BIGINT,

  -- Attachments are inside the exported document, so these two are a claim
  -- about completeness: `considered` is how many the conversation had,
  -- `exported` is how many bytes could actually be read out of the bucket. They
  -- differ when an object is missing, and that difference must be visible
  -- rather than rounded away.
  attachments_considered INTEGER NOT NULL,
  attachments_exported INTEGER NOT NULL,

  -- Which retention rule was in force when the copy was made. The house's own
  -- copy has to be able to say what duty it was made under, years later.
  jurisdiction TEXT NOT NULL,
  window_days INTEGER,

  failure_reason TEXT,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An 'exported' row without a file id or a hash is a claim, not a receipt.
  CONSTRAINT house_mail_exports_exported_is_evidenced
    CHECK (
      status <> 'exported'
      OR (drive_file_id IS NOT NULL
          AND content_sha256 IS NOT NULL
          AND file_path IS NOT NULL
          AND failure_reason IS NULL)
    ),
  -- A 'failed' row without a reason is a silent skip wearing a status column.
  CONSTRAINT house_mail_exports_failure_says_why
    CHECK (
      status <> 'failed'
      OR (failure_reason IS NOT NULL AND drive_file_id IS NULL)
    ),
  CONSTRAINT house_mail_exports_attachment_counts
    CHECK (
      attachments_considered >= 0
      AND attachments_exported >= 0
      AND attachments_exported <= attachments_considered
    )
);

COMMENT ON TABLE public.house_mail_exports IS
  'One row per conversation per destination recording that its raw mail was written to the house''s own archive, where, when, and the sha256 of the exact bytes written and read back (ADR 0118 D16). THE RETENTION SWEEP READS THIS TABLE: with an armed archive it will not tombstone a conversation that has no status=''exported'' row here. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_mail_exports.content_sha256 IS
  'sha256 of the exact bytes uploaded, re-computed from the bytes READ BACK out of the house''s Drive. An upload that returned 200 and stored something else fails verification and is recorded as failed, because a 200 is the provider''s claim and the hash is the evidence.';
COMMENT ON COLUMN public.house_mail_exports.failure_reason IS
  'Why this conversation was NOT exported, in words. A conversation the export could not write is a FAILURE with a cause, never "nothing to export".';
COMMENT ON COLUMN public.house_mail_exports.attachments_exported IS
  'How many of attachments_considered had their bytes read out of the vendor-attachments bucket and written into the exported document. Fewer than considered means an object was missing or unreadable, and the export row says so rather than reporting a short copy as a complete one.';

-- The sweep's own lookup: "which of these conversations have a successful
-- export to this destination".
CREATE INDEX IF NOT EXISTS idx_house_mail_exports_conversation_exported
  ON public.house_mail_exports (conversation_id, destination)
  WHERE status = 'exported';

CREATE INDEX IF NOT EXISTS idx_house_mail_exports_restaurant
  ON public.house_mail_exports (restaurant_id, exported_at DESC);

-- Exactly one SUCCESSFUL export per conversation per destination. Failures may
-- repeat — a retry that fails again is a second real event — but a second
-- success would mean two files claiming to be the house's copy of one reply.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_house_mail_exports_one_success
  ON public.house_mail_exports (conversation_id, destination)
  WHERE status = 'exported';

ALTER TABLE public.house_mail_exports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_exports_service_role
  ON public.house_mail_exports;
CREATE POLICY house_mail_exports_service_role
  ON public.house_mail_exports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_exports FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Every export run leaves a count, including the ones that exported nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_mail_export_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- 'scheduled' — the daily job ahead of the sweep.
  -- 'requested' — a person pressed export on /connections, under a seal.
  -- 'revocation' — the last pass before a revoked grant's mail is deleted.
  trigger TEXT NOT NULL
    CHECK (trigger IN ('scheduled', 'requested', 'revocation')),
  mode TEXT NOT NULL CHECK (mode IN ('own_cloud', 'mudavym_archive', 'none')),
  armed BOOLEAN NOT NULL,

  connection_id UUID REFERENCES public.integration_oauth_connections(id)
    ON DELETE SET NULL,
  -- The seal spent on this run, or the seal that armed the mode a scheduled run
  -- inherits. NULL on a run nothing sealed, which is itself a fact worth seeing.
  seal_id UUID,

  -- NOT NULL with NO DEFAULT, for 20260905190000's reason applied to exports: a
  -- default of 0 would let a run that forgot its count look exactly like a run
  -- that found nothing to export, and the difference between those two is the
  -- whole reason this table exists.
  considered INTEGER NOT NULL,
  exported INTEGER NOT NULL,
  failed INTEGER NOT NULL,

  -- What happened, in words, on EVERY path out — including the paths that
  -- exported nothing and the paths that could not run at all.
  says TEXT NOT NULL,
  error TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT house_mail_export_runs_counts_nonneg
    CHECK (considered >= 0 AND exported >= 0 AND failed >= 0),
  CONSTRAINT house_mail_export_runs_outcomes_within_considered
    CHECK (exported + failed <= considered)
);

COMMENT ON TABLE public.house_mail_export_runs IS
  'One row per archive export run per house, written whether or not anything was exported (ADR 0078''s count-is-recorded rule). A table holding only the runs that exported something would make every success rate over it 1.0 by construction. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_mail_export_runs.armed IS
  'Whether the mode was actually operating on this run. FALSE with mode = ''mudavym_archive'' is the ordinary state on this deployment: the house chose the paid archive and OD-23 has not fixed a price, so the run refuses and records the refusal instead of silently exporting nothing.';

CREATE INDEX IF NOT EXISTS idx_house_mail_export_runs_restaurant
  ON public.house_mail_export_runs (restaurant_id, ran_at DESC);

ALTER TABLE public.house_mail_export_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_export_runs_service_role
  ON public.house_mail_export_runs;
CREATE POLICY house_mail_export_runs_service_role
  ON public.house_mail_export_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_export_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A sweep row says which archive was in force and what it refused to delete.
-- ---------------------------------------------------------------------------

ALTER TABLE public.house_mail_retention_sweeps
  ADD COLUMN IF NOT EXISTS archive_mode TEXT;

ALTER TABLE public.house_mail_retention_sweeps
  ADD COLUMN IF NOT EXISTS held_for_export INTEGER;

DO $add_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'house_mail_retention_sweeps_archive_mode_known'
       AND conrelid = to_regclass('public.house_mail_retention_sweeps')
  ) THEN
    ALTER TABLE public.house_mail_retention_sweeps
      ADD CONSTRAINT house_mail_retention_sweeps_archive_mode_known
      CHECK (archive_mode IS NULL
             OR archive_mode IN ('own_cloud', 'mudavym_archive', 'none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'house_mail_retention_sweeps_held_nonneg'
       AND conrelid = to_regclass('public.house_mail_retention_sweeps')
  ) THEN
    ALTER TABLE public.house_mail_retention_sweeps
      ADD CONSTRAINT house_mail_retention_sweeps_held_nonneg
      CHECK (held_for_export IS NULL OR held_for_export >= 0);
  END IF;
END
$add_check$;

COMMENT ON COLUMN public.house_mail_retention_sweeps.archive_mode IS
  'Which archive was in force when this sweep ran. NULL means the sweep ran BEFORE the archive existed and evaluated none — it does NOT mean ''none'', and a reader must not collapse the two.';
COMMENT ON COLUMN public.house_mail_retention_sweeps.held_for_export IS
  'How many expired conversations this sweep REFUSED to delete because their raw mail had not been exported to the house''s armed archive yet. NULL means the sweep ran before the archive existed; 0 means it evaluated an archive and held nothing back. The two are different facts.';

-- ---------------------------------------------------------------------------
-- 5. The seal learns one more kind.
-- ---------------------------------------------------------------------------

-- 'house_mail_export' is the seal on choosing a mail archive and on running an
-- export. Like the order, payment, grant and price-book kinds it carries no
-- connection_id and names the RESTAURANT in subject_id: the act copies every
-- vendor reply the house holds out to storage the house controls and Mudavym
-- does not, and no request can pull it back.
--
-- READ-AND-APPEND, NOT A LITERAL (corrected 2026-09-05). The first cut of
-- this file rewrote the CHECK from a hand-typed list of six kinds. Replayed in
-- prefix order after 20260905225000 (which appends 'text_credit_purchase')
-- that literal DROPPED the peer's kind, so the database would have refused a
-- kind the code declares. Three sessions wrote migrations into this tree on
-- one day; whichever sorted last silently deleted the others' vocabulary. The
-- shape 20260905225000 and 20260906070000 use is the only safe one: read the
-- kinds the constraint admits today, append this one, rebuild.
DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'house_mail_export';
  rebuilt TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'chk_mcp_seal_challenges_subject_kind is absent: this migration extends a constraint that must already exist (20260904210000)';
  END IF;

  SELECT array_agg(DISTINCT m[1]) INTO kinds
  FROM regexp_matches(existing_def, '''([a-z_]+)''', 'g') AS m;

  -- Four kinds existed on 2026-09-04 before any of today's work; reading fewer
  -- than four means the parse failed, and rewriting a constraint from a failed
  -- parse would delete the seal's entire vocabulary.
  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" - refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(kinds) THEN
    RETURN;  -- already extended; re-running this file changes nothing
  END IF;

  kinds := kinds || wanted;

  SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
  INTO rebuilt
  FROM unnest(kinds) AS k;

  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind';
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind '
       || format('CHECK (subject_kind IN (%s))', rebuilt);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  leaky   text;
  t       text;
  admits_new_kind boolean;
  one_success_unique boolean;
BEGIN
  -- 6a. Three new tables exist, carry RLS, and grant a client role nothing.
  FOREACH t IN ARRAY ARRAY['house_mail_archive_settings',
                           'house_mail_exports',
                           'house_mail_export_runs']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION '% was created without row-level security', t;
    END IF;

    SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ')
      INTO leaky
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = t
       AND grantee IN ('anon', 'authenticated');
    IF leaky IS NOT NULL THEN
      RAISE EXCEPTION '% grants privileges to a client role: %', t, leaky;
    END IF;
  END LOOP;

  -- 6b. Every column the service reads or writes.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_archive_settings'
      AND column_name='mode')
  THEN missing := missing || 'house_mail_archive_settings.mode'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_archive_settings'
      AND column_name='armed_at')
  THEN missing := missing || 'house_mail_archive_settings.armed_at'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_archive_settings'
      AND column_name='refused_because')
  THEN missing := missing || 'house_mail_archive_settings.refused_because'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_archive_settings'
      AND column_name='drive_folder_id')
  THEN missing := missing || 'house_mail_archive_settings.drive_folder_id'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_archive_settings'
      AND column_name='price_minor_units')
  THEN missing := missing || 'house_mail_archive_settings.price_minor_units'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_exports'
      AND column_name='content_sha256')
  THEN missing := missing || 'house_mail_exports.content_sha256'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_exports'
      AND column_name='drive_file_id')
  THEN missing := missing || 'house_mail_exports.drive_file_id'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_exports'
      AND column_name='failure_reason')
  THEN missing := missing || 'house_mail_exports.failure_reason'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_export_runs'
      AND column_name='considered')
  THEN missing := missing || 'house_mail_export_runs.considered'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_export_runs'
      AND column_name='says')
  THEN missing := missing || 'house_mail_export_runs.says'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name='archive_mode')
  THEN missing := missing || 'house_mail_retention_sweeps.archive_mode'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name='held_for_export')
  THEN missing := missing || 'house_mail_retention_sweeps.held_for_export'; END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the archive columns did not apply: %',
      array_to_string(missing, ', ');
  END IF;

  -- 6c. The three counts must have NO default, for the same reason
  --     house_mail_retention_sweeps.considered has none.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_export_runs'
      AND column_name IN ('considered', 'exported', 'failed')
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'house_mail_export_runs.considered/exported/failed must have no default: an omitted count must fail, not read as zero';
  END IF;

  -- 6d. The two added sweep columns must be NULLABLE, because NULL is the true
  --     answer for every sweep row written before the archive existed.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name IN ('archive_mode', 'held_for_export')
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'the added house_mail_retention_sweeps columns must be nullable';
  END IF;

  -- 6e. THE OD-23 GATE, executed rather than described. A Mudavym-archive row
  --     may not be ARMED while the price columns are empty. CHECK constraints
  --     are evaluated before foreign keys, so the bogus restaurant id below
  --     never reaches the FK.
  BEGIN
    INSERT INTO public.house_mail_archive_settings (
      restaurant_id, mode, chosen_at, armed_at, refused_because
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', 'mudavym_archive', NOW(),
      NOW(), NULL
    );
    RAISE EXCEPTION 'house_mail_archive_settings armed a paid archive with no price: OD-23 is open and this row is a free tier nobody agreed to';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- correct
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the FK was checked before the paid-tier CHECK, so the OD-23 gate is unproven here';
  END;

  -- 6f. A settings row that is neither armed nor explained is refused.
  BEGIN
    INSERT INTO public.house_mail_archive_settings (
      restaurant_id, mode, chosen_at, armed_at, refused_because
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', 'none', NOW(), NULL, NULL
    );
    RAISE EXCEPTION 'house_mail_archive_settings accepted a row that is neither armed nor explained';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the FK was checked before the armed-or-said CHECK, so that guard is unproven here';
  END;

  -- 6g. An 'exported' row with no hash is a claim, not a receipt.
  BEGIN
    INSERT INTO public.house_mail_exports (
      restaurant_id, conversation_id, destination, status,
      drive_file_id, file_path, content_sha256,
      attachments_considered, attachments_exported, jurisdiction
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      'own_cloud_google_drive', 'exported',
      'drive-file-1', 'archive/x.json', NULL,
      0, 0, 'TR'
    );
    RAISE EXCEPTION 'house_mail_exports accepted an exported row with no content hash';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the FK was checked before the evidence CHECK, so that guard is unproven here';
  END;

  -- 6h. A 'failed' row with no reason is a silent skip.
  BEGIN
    INSERT INTO public.house_mail_exports (
      restaurant_id, conversation_id, destination, status,
      attachments_considered, attachments_exported, jurisdiction, failure_reason
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      'own_cloud_google_drive', 'failed',
      0, 0, 'TR', NULL
    );
    RAISE EXCEPTION 'house_mail_exports accepted a failed row with no reason';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the FK was checked before the failure-says-why CHECK, so that guard is unproven here';
  END;

  -- 6i. Exactly one SUCCESSFUL export per conversation per destination.
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uniq_house_mail_exports_one_success'
       AND i.indisunique
       AND i.indpred IS NOT NULL
  ) INTO one_success_unique;
  IF NOT one_success_unique THEN
    RAISE EXCEPTION 'uniq_house_mail_exports_one_success is missing, not unique, or not partial — two files could both claim to be the house''s copy of one reply';
  END IF;

  -- 6j. The seal CHECK admits the new kind.
  admits_new_kind := EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_mcp_seal_challenges_subject_kind'
       AND conrelid = to_regclass('public.mcp_seal_challenges')
       AND pg_get_constraintdef(oid) LIKE '%house_mail_export%'
  );
  IF NOT admits_new_kind THEN
    RAISE EXCEPTION
      'the seal subject_kind CHECK does not admit house_mail_export; the code declares a kind the database refuses';
  END IF;

  RAISE NOTICE 'archive: settings, per-conversation exports, run counts, sweep columns and the house_mail_export seal kind created and locked down.';
END
$$;
