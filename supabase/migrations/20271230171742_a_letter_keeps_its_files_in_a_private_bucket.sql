-- A letter's files wait in a private bucket, one row each (g6b step 1,
-- DD-r107-11 / DD-r108-6, r109 mail-fix).
--
-- The gateway writes each upload to `letter-files/<restaurant_id>/<uuid>` and a
-- row here with the sha-256 and size IT computed. The seal a manager redeems
-- holds {id, sha256, size} of each file; at release the dispatcher re-reads the
-- rows by letter_id AND restaurant_id, re-hashes the bytes and refuses the whole
-- letter on any difference. Service role only: no client ever reads, writes or
-- lists these rows or objects.

CREATE TABLE IF NOT EXISTS public.house_letter_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- NULL until the letter that carries it is queued; set once (conditional
  -- update on letter_id IS NULL), so a file travels on one letter only.
  letter_id UUID REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT house_letter_files_path_in_its_house CHECK (path LIKE restaurant_id::text || '/%')
);

CREATE INDEX IF NOT EXISTS house_letter_files_letter_idx
  ON public.house_letter_files (restaurant_id, letter_id);

COMMENT ON TABLE public.house_letter_files IS
  'A file an owner or manager uploaded for a letter (g6b). sha256 and size are the gateway''s own, computed from the bytes; the release seal binds them. Service role only.';
COMMENT ON COLUMN public.house_letter_files.path IS
  'The object in the private letter-files bucket: always <restaurant_id>/<uuid>. Never supplied by a caller.';

ALTER TABLE public.house_letter_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.house_letter_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.house_letter_files TO service_role;

-- The private bucket. Guarded: a database built from migrations alone (CI's
-- guards, the local harness) has no storage schema.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('letter-files', 'letter-files', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END $$;
