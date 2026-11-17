-- Mail: a reply that cites a letter we never stored falls back to its subject
-- (r39 walk-w6 F1, second half).
--
-- What went wrong. A root letter that carries a Message-ID but no In-Reply-To
-- or References is keyed by its subject ("subj:<vendor>:<subject>"). Its reply
-- cites the root's Message-ID, so it was keyed "mid:<root message-id>": a
-- second thread, and a second bell. 20270913100000 already makes a reply join
-- the thread of the stored letter it cites (mail_joined_thread_key), which
-- closes that case when the cited letter is stored.
--
-- What is left. A reply can cite a letter the house never stored (the vendor
-- answers a letter sent from outside Mudavym, or a letter older than the
-- mailbox). Nothing is found to join, and conversation_thread_key() then keyed
-- the reply by the cited id ("mid:<unknown>"), which no root carries, so the
-- reply opened a thread of its own even when it plainly belongs to a subject
-- the house already holds.
--
-- The rule now, when the letter has no Gmail thread key and cites no stored
-- letter: if it has a subject, it is keyed by that subject exactly as a root
-- is ("subj:<vendor>:<subject>", "Re:"/"Fwd:" prefixes ignored), so it meets
-- the root there. A letter with no subject keeps the cited id as its key, as
-- before. Letters with a Gmail thread, and letters that cite a stored letter,
-- are unchanged. conversation_thread_key() itself is not changed.
--
-- Not done here: replies already keyed "mid:<unknown>" are not re-keyed; their
-- cited letter is not stored, and the subject they would join may hold
-- unrelated letters of the same wording.

CREATE OR REPLACE FUNCTION public.set_conversation_thread_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gm  text := NULLIF(btrim(COALESCE(NEW.gmail_thread_id, '')), '');
  v_key text;
  v_subj text;
BEGIN
  IF NEW.thread_key IS NULL OR btrim(NEW.thread_key) = '' THEN
    v_key := public.mail_joined_thread_key(NEW.id, NEW.restaurant_id, NEW.gmail_thread_id, NEW.email_headers);
    IF v_key IS NULL AND v_gm IS NULL THEN
      -- No Gmail thread and no stored letter it answers: the subject, as a
      -- root's (the cited ids, if any, are left out of the key).
      v_subj := public.conversation_thread_key(
        NEW.id, NULL, COALESCE(NEW.email_headers, '{}'::jsonb) - 'in_reply_to' - 'references',
        NEW.provider_id, NEW.message_text);
      IF v_subj LIKE 'subj:%' THEN
        v_key := v_subj;
      END IF;
    END IF;
    NEW.thread_key := COALESCE(
      v_key,
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
