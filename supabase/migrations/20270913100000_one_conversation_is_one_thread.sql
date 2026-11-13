-- Mail: one conversation is one thread (r28 mail audit, gap 1).
--
-- What went wrong. set_conversation_thread_key() gave a row its thread_key
-- once, on insert, from that row alone. An order letter is stored before it is
-- sent, so it was keyed by its subject ("subj:<vendor>:order po-12") or by its
-- own id ("msg:<id>"); the send writes gmail_thread_id afterwards and the key
-- stayed. The vendor's answer was then keyed by its Gmail thread
-- ("gm:<thread>") when the house reader read it, or by the Message-ID it
-- answers ("mid:<id>") when it came through the house's Mudavym address. Mail
-- groups letters on (vendor, thread_key), so the house saw its letter as
-- "You wrote last" with no answer, and the answer as a second thread. One
-- conversation measured three keys (r28 probe).
--
-- The rule now. Two letters of one house are in one thread when they share a
-- Gmail thread, or when one answers the other (its In-Reply-To or References
-- names the other's stored Message-ID). A letter joins the thread of a letter
-- it is connected to, and a key that other letters carry is never changed by
-- the trigger:
--
-- * Insert, no key given: the key of the house's earliest letter in the same
--   Gmail thread; else the key of the letter it answers (In-Reply-To first,
--   then References from the newest); else the key conversation_thread_key()
--   derives from the row alone, as before.
-- * Update that gives the row its Gmail thread (the send), and does not set a
--   key itself: the key of the house's earliest other letter in that Gmail
--   thread; else the key of the letter it answers; else "gm:<thread>", so the
--   answer that arrives later in that Gmail thread, or through the Mudavym
--   address naming this letter's Message-ID, finds it. A subject key shared
--   with another letter is not a link (two order letters can share a
--   subject), so it does not hold the letter back.
-- * A key the writer sets in a write is kept in that write. No product
--   writer sets one today (grep of apps/ and services/, 2026-11-13).
--
-- Every lookup is inside the row's own house (restaurant_id): two houses never
-- share a thread through this rule.
--
-- Rows already stored. mail_threads_rejoin() joins the letters already split:
-- it connects letters by the same two links, and in each connected set that
-- carries more than one key it writes one key on every letter: "gm:<thread>"
-- of the set's earliest letter that has a Gmail thread, else the earliest
-- letter's key. Sets with one key are not touched. It runs once below and
-- stays (service role only), so it can be run again for letters written by
-- two writers at the same moment, which can still miss each other.
--
-- Not done here: a letter whose Message-ID was stored in an odd shape before
-- #1032 (e.g. "junk <a@b> <c@d>") is not found by an answer; the lookup takes
-- "<id>" and "id".

CREATE OR REPLACE FUNCTION public.mail_bare_message_id(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(p, E'<> \t\r\n'), '')
$$;

COMMENT ON FUNCTION public.mail_bare_message_id(text) IS
  'A Message-ID without its angle brackets and blanks, or NULL (20270913100000).';

-- The Message-IDs a letter answers, nearest first: In-Reply-To, then
-- References from the newest. Tokens are the <...> ones; a field with none is
-- split on blanks. At most 20, no repeats.
CREATE OR REPLACE FUNCTION public.mail_answered_message_ids(p_headers jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH fields AS (
    SELECT 1 AS f, COALESCE(p_headers ->> 'in_reply_to', '') AS v
    UNION ALL
    SELECT 2, COALESCE(p_headers ->> 'references', '')
  ),
  toks AS (
    SELECT fl.f, t.ord, public.mail_bare_message_id(t.tok) AS id
    FROM fields fl
    CROSS JOIN LATERAL (
      SELECT m.arr[1] AS tok, m.ord
      FROM regexp_matches(fl.v, '<([^<>]+)>', 'g') WITH ORDINALITY AS m(arr, ord)
      UNION ALL
      SELECT s.tok, s.ord
      FROM regexp_split_to_table(btrim(fl.v), '[[:space:]]+') WITH ORDINALITY AS s(tok, ord)
      WHERE fl.v !~ '<[^<>]+>' AND btrim(fl.v) <> ''
    ) t
  ),
  ranked AS (
    SELECT id, min(CASE WHEN f = 1 THEN ord ELSE 1000000 - ord END) AS pos
    FROM toks
    WHERE id IS NOT NULL
    GROUP BY id
  )
  SELECT COALESCE(
    (SELECT array_agg(id ORDER BY pos) FROM (SELECT id, pos FROM ranked ORDER BY pos LIMIT 20) r),
    ARRAY[]::text[])
$$;

COMMENT ON FUNCTION public.mail_answered_message_ids(jsonb) IS
  'Message-IDs a letter answers, bare, nearest first: In-Reply-To, then References newest first; at most 20 (20270913100000).';

-- The key of the house's thread this letter joins, or NULL when it joins none.
CREATE OR REPLACE FUNCTION public.mail_joined_thread_key(
  p_id uuid,
  p_restaurant_id uuid,
  p_gmail_thread_id text,
  p_email_headers jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gm  text := NULLIF(btrim(COALESCE(p_gmail_thread_id, '')), '');
  v_key text;
  v_ref text;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_gm IS NOT NULL THEN
    SELECT c.thread_key INTO v_key
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
      AND c.gmail_thread_id IN (v_gm, p_gmail_thread_id)
      AND c.id IS DISTINCT FROM p_id
      AND NULLIF(btrim(COALESCE(c.thread_key, '')), '') IS NOT NULL
    ORDER BY c.created_at ASC NULLS LAST, c.id ASC
    LIMIT 1;
    IF v_key IS NOT NULL THEN
      RETURN v_key;
    END IF;
  END IF;

  FOREACH v_ref IN ARRAY public.mail_answered_message_ids(p_email_headers) LOOP
    SELECT c.thread_key INTO v_key
    FROM public.procurement_conversations c
    WHERE c.message_id IN ('<' || v_ref || '>', v_ref)
      AND c.restaurant_id = p_restaurant_id
      AND c.id IS DISTINCT FROM p_id
      AND NULLIF(btrim(COALESCE(c.thread_key, '')), '') IS NOT NULL
    ORDER BY c.created_at ASC NULLS LAST, c.id ASC
    LIMIT 1;
    IF v_key IS NOT NULL THEN
      RETURN v_key;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.mail_joined_thread_key(uuid, uuid, text, jsonb) IS
  'The thread_key of the house''s letter this one is connected to (same Gmail thread, else the letter it answers), or NULL (20270913100000).';

CREATE OR REPLACE FUNCTION public.set_conversation_thread_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gm  text := NULLIF(btrim(COALESCE(NEW.gmail_thread_id, '')), '');
  v_key text;
BEGIN
  IF NEW.thread_key IS NULL OR btrim(NEW.thread_key) = '' THEN
    NEW.thread_key := COALESCE(
      public.mail_joined_thread_key(NEW.id, NEW.restaurant_id, NEW.gmail_thread_id, NEW.email_headers),
      public.conversation_thread_key(NEW.id, NEW.gmail_thread_id, NEW.email_headers, NEW.provider_id, NEW.message_text)
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.thread_key IS NOT DISTINCT FROM OLD.thread_key
        AND v_gm IS NOT NULL
        AND NULLIF(btrim(COALESCE(OLD.gmail_thread_id, '')), '') IS NULL THEN
    -- The send gave this letter its Gmail thread.
    SELECT c.thread_key INTO v_key
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = NEW.restaurant_id
      AND c.gmail_thread_id IN (v_gm, NEW.gmail_thread_id)
      AND c.id <> NEW.id
      AND NULLIF(btrim(COALESCE(c.thread_key, '')), '') IS NOT NULL
    ORDER BY c.created_at ASC NULLS LAST, c.id ASC
    LIMIT 1;
    IF v_key IS NULL THEN
      -- No letter of the house holds that Gmail thread yet. A letter that
      -- answers one of the house's letters stays in (or moves to) that
      -- letter's thread; any other key (its subject, its own id) moves to
      -- the Gmail thread, which the answer will carry.
      v_key := COALESCE(
        public.mail_joined_thread_key(NEW.id, NEW.restaurant_id, NULL, NEW.email_headers),
        'gm:' || v_gm
      );
    END IF;
    NEW.thread_key := v_key;
  END IF;

  IF NEW.order_id IS NOT NULL AND NEW.order_number_snapshot IS NULL THEN
    SELECT order_number INTO NEW.order_number_snapshot
    FROM public.procurement_orders
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Letters already split: join them.
CREATE OR REPLACE FUNCTION public.mail_threads_rejoin()
RETURNS TABLE(letters_rekeyed bigint, threads_joined bigint)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed bigint;
  v_rounds  int := 0;
  v_rekeyed bigint;
  v_joined  bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mt_rows (
    rk bigint PRIMARY KEY,
    id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    thread_key text NOT NULL,
    gm text,
    mid text,
    label bigint NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mt_edge (a bigint NOT NULL, b bigint NOT NULL) ON COMMIT DROP;
  TRUNCATE pg_temp.mt_rows, pg_temp.mt_edge;

  INSERT INTO pg_temp.mt_rows (rk, id, restaurant_id, thread_key, gm, mid, label)
  SELECT row_number() OVER (ORDER BY c.created_at ASC NULLS LAST, c.id ASC),
         c.id, c.restaurant_id, c.thread_key,
         NULLIF(btrim(COALESCE(c.gmail_thread_id, '')), ''),
         public.mail_bare_message_id(c.message_id),
         0
  FROM public.procurement_conversations c
  WHERE NULLIF(btrim(COALESCE(c.thread_key, '')), '') IS NOT NULL;
  UPDATE pg_temp.mt_rows SET label = rk;
  CREATE INDEX IF NOT EXISTS mt_rows_mid ON pg_temp.mt_rows (restaurant_id, mid);

  -- Same Gmail thread, same house: each letter to the earliest one.
  INSERT INTO pg_temp.mt_edge (a, b)
  SELECT r.rk, min(r.rk) OVER (PARTITION BY r.restaurant_id, r.gm)
  FROM pg_temp.mt_rows r
  WHERE r.gm IS NOT NULL;

  -- A letter to every stored letter of its house it answers.
  INSERT INTO pg_temp.mt_edge (a, b)
  SELECT r.rk, t.rk
  FROM pg_temp.mt_rows r
  JOIN public.procurement_conversations c ON c.id = r.id
  CROSS JOIN LATERAL unnest(public.mail_answered_message_ids(c.email_headers)) AS ref(id)
  JOIN pg_temp.mt_rows t ON t.restaurant_id = r.restaurant_id AND t.mid = ref.id
  WHERE t.rk <> r.rk;

  DELETE FROM pg_temp.mt_edge WHERE a = b;

  LOOP
    v_rounds := v_rounds + 1;
    WITH nb AS (
      SELECT a AS n, b AS m FROM pg_temp.mt_edge
      UNION ALL
      SELECT b, a FROM pg_temp.mt_edge
    ),
    best AS (
      SELECT nb.n, min(r.label) AS l
      FROM nb JOIN pg_temp.mt_rows r ON r.rk = nb.m
      GROUP BY nb.n
    )
    UPDATE pg_temp.mt_rows r SET label = best.l
    FROM best
    WHERE r.rk = best.n AND best.l < r.label;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    EXIT WHEN v_changed = 0 OR v_rounds >= 1000;
  END LOOP;

  WITH sets AS (
    SELECT r.label
    FROM pg_temp.mt_rows r
    GROUP BY r.label
    HAVING count(DISTINCT r.thread_key) > 1
  ),
  keyed AS (
    SELECT s.label,
           COALESCE(
             (SELECT 'gm:' || g.gm FROM pg_temp.mt_rows g
              WHERE g.label = s.label AND g.gm IS NOT NULL
              ORDER BY g.rk LIMIT 1),
             (SELECT e.thread_key FROM pg_temp.mt_rows e WHERE e.rk = s.label)
           ) AS key
    FROM sets s
  ),
  done AS (
    UPDATE public.procurement_conversations c
    SET thread_key = k.key
    FROM pg_temp.mt_rows r
    JOIN keyed k ON k.label = r.label
    WHERE c.id = r.id
      AND c.thread_key IS DISTINCT FROM k.key
    RETURNING r.label
  )
  SELECT count(*), count(DISTINCT label) INTO v_rekeyed, v_joined FROM done;

  TRUNCATE pg_temp.mt_rows, pg_temp.mt_edge;
  RETURN QUERY SELECT v_rekeyed, v_joined;
END;
$$;

COMMENT ON FUNCTION public.mail_threads_rejoin() IS
  'Joins letters of one house split across thread keys (same Gmail thread, or one answers the other) under one key (20270913100000). Idempotent. Service role only.';

REVOKE ALL ON FUNCTION public.mail_threads_rejoin() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mail_threads_rejoin() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mail_threads_rejoin() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mail_threads_rejoin() TO service_role';
  END IF;
END
$$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mail_threads_rejoin();
  RAISE NOTICE 'one_conversation_is_one_thread: % letter(s) rekeyed, % thread(s) joined',
    r.letters_rekeyed, r.threads_joined;
END
$$;
