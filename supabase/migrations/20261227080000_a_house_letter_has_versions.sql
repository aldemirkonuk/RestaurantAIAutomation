--
-- A HOUSE LETTER HAS VERSIONS. W25 F5, ADR 0313 (4a-ii).
--
-- WHAT THIS IS FOR. The founder ruled the order-request letter "Editable now"
-- (ADR 0266 F5), and ADR 0313 decided how: the house writes prose around
-- block tokens, and 0173 D2's guardrails apply (draft, preview, publish,
-- reset-to-default as a version, immutable history). Before this file a
-- template was edited in place and its previous body was lost
-- (house-letters.service.ts upsertTemplate); nothing could say which words a
-- vendor letter was rendered from.
--
-- WHAT IT ADDS
--   1. public.letter_template_versions -- append-only. One row per publish or
--      reset of a letter template: the body as published, its sha256, the
--      locale (ADR 0313 R4: default 'en', part of the unique key, so a
--      Turkish version is additive), the version number per (template,
--      locale), who published it and when. The template row's own `body`
--      stays the DRAFT; only a version is ever rendered to a vendor.
--   2. communication_templates.published_version_id -- the version the
--      renderer reads (order-request.service.ts). NULL means "the house has
--      published nothing": the renderer writes Mudavym's default. This file
--      sets it on NO row: a body a house saved before 4a-ii is never
--      published by a migration (ADR 0313, Split: "never auto-publishes a
--      body saved earlier"). No statement here writes the column; the
--      composite foreign key below makes a pointer without a version
--      impossible anyway.
--   3. One order letter per house: a partial unique index on
--      communication_templates (restaurant_id) WHERE type = 'letter' AND
--      category = 'order_request'. Today no such row can exist (the gateway
--      refused the category until 4a-ii); the file still checks first and
--      names the houses if any do, rather than failing on the index build
--      with a bare 23505.
--
-- TENANCY. A version carries restaurant_id, and a composite foreign key
-- (template_id, restaurant_id) -> communication_templates (id, restaurant_id)
-- makes a version of another house's template unwritable. The published
-- pointer is a composite foreign key too: (published_version_id, id) ->
-- letter_template_versions (id, template_id), so a template can only point at
-- one of ITS OWN versions. MATCH SIMPLE: a NULL pointer is not checked, which
-- is exactly "nothing published".
--
-- APPEND-ONLY, ENFORCED. A trigger refuses UPDATE and DELETE, except what a
-- foreign key does itself one trigger level down (pattern of
-- every_recommendation_act_is_kept): the author's user row deleted sets
-- `author` NULL and nothing else; the template or the house deleted removes
-- its versions. A restore is not an update of a version: it copies a
-- version's body into the draft, and publishing that makes a NEW version.
--
-- LOCK-DOWN. RLS on, a service_role policy only, anon and authenticated
-- revoked (check_new_tables_are_locked_down.py). The gateway is the only
-- writer, as for communication_templates (OD-72).
--
-- LOCKS. ADD COLUMN with no default and ADD CONSTRAINT UNIQUE (id,
-- restaurant_id) take an ACCESS EXCLUSIVE lock on communication_templates for
-- the file's transaction; the unique build reads the table once. NOT measured
-- against production's row count (no production reads from this lane); the
-- table holds per-house letter templates. statement_timeout follows the repo's
-- ALTER TABLE precedent. Re-runnable: every object is added only if absent.
-- No explicit BEGIN/COMMIT: the Supabase CLI wraps the file in a transaction.

SET local statement_timeout = '120s';

-- 1. The key a version's tenant-checked foreign key points at. (id) is
--    already the primary key, so (id, restaurant_id) is unique by
--    construction; the constraint only lets a foreign key name the pair.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.communication_templates'::regclass
      AND conname = 'communication_templates_id_restaurant_key'
  ) THEN
    ALTER TABLE public.communication_templates
      ADD CONSTRAINT communication_templates_id_restaurant_key UNIQUE (id, restaurant_id);
  END IF;
END
$$;

-- 2. The versions.
CREATE TABLE IF NOT EXISTS public.letter_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- ADR 0313 R4: the letter's language. 'en' unless the version says so.
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'tr')),
  version integer NOT NULL CHECK (version > 0),
  -- publish: the house's draft, after a preview; reset: Mudavym's default.
  kind text NOT NULL CHECK (kind IN ('publish', 'reset')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  body_hash text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  author uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT letter_template_versions_template_fkey
    FOREIGN KEY (template_id, restaurant_id)
    REFERENCES public.communication_templates (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT letter_template_versions_number_key UNIQUE (template_id, locale, version),
  CONSTRAINT letter_template_versions_id_template_key UNIQUE (id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_letter_template_versions_restaurant
  ON public.letter_template_versions (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_letter_template_versions_author
  ON public.letter_template_versions (author) WHERE author IS NOT NULL;

COMMENT ON TABLE public.letter_template_versions IS
  'Append-only: every publish and reset of a house letter template (ADR 0313, 0173 D2). The template row''s body is the draft; only a version is rendered to a vendor. A restore copies a version into the draft; publishing it makes a new version.';
COMMENT ON COLUMN public.letter_template_versions.locale IS
  'ADR 0313 R4: the language this version is written in, en or tr. Part of the unique key, so a Turkish version is additive.';
COMMENT ON COLUMN public.letter_template_versions.body_hash IS
  'sha256 hex of body, as the gateway computed it at publish. A staged letter names it in email_headers.template_hash.';
COMMENT ON COLUMN public.letter_template_versions.author IS
  'public.users.user_id of the owner or manager who published. Set NULL, by the foreign key only, when that user row is deleted.';

CREATE OR REPLACE FUNCTION public.letter_template_versions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- A foreign key's own action runs one trigger level down; a statement sent
  -- to this table directly runs at level 1.
  IF pg_trigger_depth() > 1 THEN
    IF tg_op = 'DELETE' THEN
      RETURN old; -- the template or the house was deleted
    END IF;
    -- The author's user row was deleted: their id leaves, nothing else moves.
    IF new.author IS NULL
       AND old.author IS NOT NULL
       AND (new.id, new.template_id, new.restaurant_id, new.locale, new.version,
            new.kind, new.body, new.body_hash, new.created_at)
           IS NOT DISTINCT FROM
           (old.id, old.template_id, old.restaurant_id, old.locale, old.version,
            old.kind, old.body, old.body_hash, old.created_at)
    THEN
      RETURN new;
    END IF;
  END IF;
  RAISE EXCEPTION
    'letter_template_versions is append-only: % is not permitted. A restore copies a version into the draft, and publishing it is a NEW version.',
    tg_op
    USING errcode = 'P0001';
END
$function$;

COMMENT ON FUNCTION public.letter_template_versions_append_only() IS
  'Refuses UPDATE and DELETE on letter template versions, except the two a foreign key makes itself: a deleted author set NULL, and a deleted template or house removing its versions. ADR 0313.';

REVOKE ALL ON FUNCTION public.letter_template_versions_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.letter_template_versions_append_only() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_letter_template_versions_append_only
  ON public.letter_template_versions;
CREATE TRIGGER trg_letter_template_versions_append_only
  BEFORE UPDATE OR DELETE ON public.letter_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.letter_template_versions_append_only();

ALTER TABLE public.letter_template_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS letter_template_versions_service_role
  ON public.letter_template_versions;
CREATE POLICY letter_template_versions_service_role
  ON public.letter_template_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.letter_template_versions FROM anon, authenticated;

-- 3. The published pointer: one of the template's own versions, or NULL.
ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS published_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.communication_templates'::regclass
      AND conname = 'communication_templates_published_version_fkey'
  ) THEN
    ALTER TABLE public.communication_templates
      ADD CONSTRAINT communication_templates_published_version_fkey
      FOREIGN KEY (published_version_id, id)
      REFERENCES public.letter_template_versions (id, template_id);
  END IF;
END
$$;

COMMENT ON COLUMN public.communication_templates.published_version_id IS
  'The version a vendor letter is rendered from (ADR 0313). NULL: nothing published, and the renderer writes Mudavym''s default. body is the draft. Set only by a publish or a reset, never by a migration.';

-- 4. One order letter per house. Checked first, so a duplicate is named.
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(restaurant_id::text || ' (' || n || ')', ', ')
    INTO dupes
    FROM (
      SELECT restaurant_id, count(*) AS n
      FROM public.communication_templates
      WHERE type = 'letter' AND category = 'order_request'
      GROUP BY restaurant_id
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'a_house_letter_has_versions: these houses hold more than one order_request letter template, so "one order letter per house" cannot be made true without choosing one: %. Nothing was changed.',
      dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS communication_templates_one_order_request
  ON public.communication_templates (restaurant_id)
  WHERE type = 'letter' AND category = 'order_request';

-- Said, not assumed: the lock-down and the trigger are in place.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.letter_template_versions'::regclass) THEN
    RAISE EXCEPTION 'letter_template_versions has RLS off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.letter_template_versions'::regclass
                   AND tgname = 'trg_letter_template_versions_append_only'
                   AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'letter_template_versions has no append-only trigger';
  END IF;
  IF has_table_privilege('authenticated', 'public.letter_template_versions', 'SELECT')
     OR has_table_privilege('anon', 'public.letter_template_versions', 'SELECT') THEN
    RAISE EXCEPTION 'letter_template_versions is still reachable by anon/authenticated';
  END IF;
END
$$;
