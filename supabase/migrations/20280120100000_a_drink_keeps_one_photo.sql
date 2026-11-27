-- A drink's photo (r110 drinks-g3): one per drink, shown on its recipe sheet,
-- its recipe card and the spec book.
--
-- WHAT IS KEPT HERE: only the path of the stored file. The bytes live in the
-- private Storage bucket `drink-photos`, written and read by the gateway's
-- service key alone (drink-photo.service.ts). The path is always
-- `<restaurant_id>/<cocktail_id>/<uuid>.<ext>`; the CHECK below holds a row
-- to its own house's folder, so no row can ever point at another house's file.
--
-- WHY A PRIVATE BUCKET WITH NO storage.objects POLICIES: with none, neither
-- the anon key nor a signed-in browser can list, read or write it; only the
-- service key can, and the gateway hands out 10-minute signed URLs to the
-- house's own roles. A public bucket and a client upload with the anon key
-- were rejected (a house's specs are its own, and a client upload would skip
-- the gateway's EXIF strip).
--
-- The bucket is created only where the Storage schema exists (Supabase), so
-- the corpus still builds on a plain Postgres (pgtest, PGlite).

alter table public.cocktails
  add column if not exists photo_path text;

alter table public.cocktails
  drop constraint if exists cocktails_photo_path_is_the_house_s;
alter table public.cocktails
  add constraint cocktails_photo_path_is_the_house_s
  check (photo_path is null or (restaurant_id is not null and photo_path like restaurant_id::text || '/' || id::text || '/%'));

comment on column public.cocktails.photo_path is
  'The drink''s photo in the private drink-photos bucket: <restaurant_id>/<cocktail_id>/<uuid>.<ext>, metadata stripped by the gateway (r110 drinks-g3). Null: no photo.';

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('drink-photos', 'drink-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
