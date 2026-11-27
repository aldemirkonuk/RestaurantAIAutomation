-- house_letter_files (g6b step 1): a row's path is always in its own house, the
-- hash is a sha-256, the size is within the 5 MB cap, and no client role can
-- touch the table. Synthetic rows; run with p4-scratch/sim-run/fixes/db/pgtest.sh.
\set ON_ERROR_STOP on
SET session_replication_role = replica; -- the FKs are not under test
DO $$
DECLARE h uuid := 'c1090000-0000-4000-8000-000000000001'; ok boolean;
BEGIN
  INSERT INTO public.house_letter_files (restaurant_id, path, name, content_type, size, sha256)
  VALUES (h, h::text || '/f1', 'a.pdf', 'application/pdf', 3, repeat('a', 64));
  BEGIN
    INSERT INTO public.house_letter_files (restaurant_id, path, name, content_type, size, sha256)
    VALUES (h, 'c1090000-0000-4000-8000-000000000002/f2', 'b.pdf', 'application/pdf', 3, repeat('a', 64));
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'a path in another house must be refused';
  BEGIN
    INSERT INTO public.house_letter_files (restaurant_id, path, name, content_type, size, sha256)
    VALUES (h, h::text || '/f3', 'c.pdf', 'application/pdf', 5242881, repeat('a', 64));
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'over 5 MB must be refused';
  BEGIN
    INSERT INTO public.house_letter_files (restaurant_id, path, name, content_type, size, sha256)
    VALUES (h, h::text || '/f4', 'd.pdf', 'application/pdf', 3, 'not-a-hash');
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, 'a sha256 that is not 64 hex must be refused';
  ASSERT NOT has_table_privilege('anon', 'public.house_letter_files', 'SELECT'), 'anon can read';
  ASSERT NOT has_table_privilege('authenticated', 'public.house_letter_files', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated can touch';
  ASSERT has_table_privilege('service_role', 'public.house_letter_files', 'SELECT,INSERT,UPDATE'), 'service_role cannot write';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.house_letter_files'::regclass), 'RLS is off';
  DELETE FROM public.house_letter_files WHERE restaurant_id = h;
END $$;
SET session_replication_role = origin;
\echo 'PASS a_letter_keeps_its_files_in_a_private_bucket'
