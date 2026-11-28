-- Every good, cocktail and dish can have a taste profile: layered and
-- append-only, so who said what is never lost.
--
-- A layer is (subject, source, stated_by). Two staff members are two layers; a
-- person's re-entry is a new VERSION of their own layer and supersedes only
-- their own. Nothing is updated or deleted: a wrong layer is outvoted by a
-- later one or flagged as a disagreement, not removed. The effective profile is
-- NOT stored; the gateway fuses the current layers on read, so refitting a
-- constant needs no data migration.
--
-- Unknown is an absent key in `axes`, never 0. The database holds only the
-- SHAPE of an axes object (key words, v 0..10, conf 0..1, sd > 0); the closed
-- list of axis names lives in the gateway (taste-axes.ts), because a list in
-- SQL would need a migration per tweak. ABV, proof, IBU, SRM, pH and Brix are
-- facts and go in `ext.facts`, never in `axes`.
--
-- `dish_id` has no foreign key yet: `dishes` is not on main. The stack that
-- carries it adds the FK. Additive; no existing table is altered.

CREATE OR REPLACE FUNCTION public.taste_axes_valid(a jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(a) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(a)) <= 40
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(a) AS e(k, val)
        WHERE NOT COALESCE(
          CASE
            WHEN e.k !~ '^[a-z_]{2,24}$' THEN false
            WHEN jsonb_typeof(e.val) IS DISTINCT FROM 'object' THEN false
            WHEN jsonb_typeof(e.val -> 'v') IS DISTINCT FROM 'number' THEN false
            WHEN jsonb_typeof(e.val -> 'conf') IS DISTINCT FROM 'number' THEN false
            WHEN (e.val ? 'sd') AND jsonb_typeof(e.val -> 'sd') IS DISTINCT FROM 'number' THEN false
            ELSE (e.val ->> 'v')::numeric BETWEEN 0 AND 10
             AND (e.val ->> 'conf')::numeric BETWEEN 0 AND 1
             AND (NOT (e.val ? 'sd') OR (e.val ->> 'sd')::numeric > 0)
          END, false)
     );
$$;

CREATE TABLE public.taste_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('good', 'cocktail', 'dish')),
  good_id uuid REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  cocktail_id uuid REFERENCES public.cocktails(id) ON DELETE CASCADE,
  dish_id uuid,
  source text NOT NULL CHECK (source IN
    ('house', 'recipe', 'measured', 'standard', 'dataset', 'note', 'ai_draft')),
  version integer NOT NULL CHECK (version >= 1),
  method text NOT NULL CHECK (method IN
    ('line', 'cata', 'ordinal', 'panel', 'instrument', 'computed')),
  axes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.taste_axes_valid(axes)),
  descriptors text[] NOT NULL DEFAULT '{}' CHECK (cardinality(descriptors) <= 12),
  texture text[] NOT NULL DEFAULT '{}' CHECK (cardinality(texture) <= 12),
  summary text,
  note_text text CHECK (note_text IS NULL OR char_length(note_text) <= 2000),
  ext jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ext) = 'object'),
  stated_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  stated_by_name varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- exactly one subject, and it is the one the kind names
  CONSTRAINT taste_profiles_one_subject CHECK (
    num_nonnulls(good_id, cocktail_id, dish_id) = 1
    AND ((subject_kind = 'good' AND good_id IS NOT NULL)
      OR (subject_kind = 'cocktail' AND cocktail_id IS NOT NULL)
      OR (subject_kind = 'dish' AND dish_id IS NOT NULL))
  )
);

-- A layer's versions are unique per (subject, source, who). A null author is
-- one shared "nobody" layer (coalesce to the zero uuid) so it cannot fork.
CREATE UNIQUE INDEX taste_profiles_layer_version_key ON public.taste_profiles (
  restaurant_id, subject_kind, COALESCE(good_id, cocktail_id, dish_id), source,
  COALESCE(stated_by, '00000000-0000-0000-0000-000000000000'::uuid), version
);
CREATE INDEX taste_profiles_subject_idx ON public.taste_profiles (
  restaurant_id, subject_kind, COALESCE(good_id, cocktail_id, dish_id)
);

-- The current layer: the highest version per (subject, source, author).
CREATE VIEW public.taste_profile_current WITH (security_invoker = true) AS
SELECT DISTINCT ON (
  restaurant_id, subject_kind, COALESCE(good_id, cocktail_id, dish_id), source,
  COALESCE(stated_by, '00000000-0000-0000-0000-000000000000'::uuid)
) *
FROM public.taste_profiles
ORDER BY
  restaurant_id, subject_kind, COALESCE(good_id, cocktail_id, dish_id), source,
  COALESCE(stated_by, '00000000-0000-0000-0000-000000000000'::uuid), version DESC;

ALTER TABLE public.taste_profiles ENABLE ROW LEVEL SECURITY;

-- Same shape as every other gateway-owned table (see
-- 20261116100400_an_auction_lot_keeps_its_own_details.sql): the gateway holds
-- the service_role key and scopes every query by the restaurant in the JWT.
DROP POLICY IF EXISTS taste_profiles_service_role ON public.taste_profiles;
CREATE POLICY taste_profiles_service_role ON public.taste_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.taste_profiles FROM anon, authenticated;
REVOKE ALL ON public.taste_profile_current FROM anon, authenticated;
GRANT SELECT ON public.taste_profile_current TO service_role;

COMMENT ON TABLE public.taste_profiles IS
  'One layer of a taste profile for a good, cocktail or dish. Append-only: a correction is a new version, nothing is updated or deleted (the gateway has no UPDATE or DELETE path). A layer is (subject, source, stated_by). The effective profile is computed on read by the gateway, never stored. Unknown is an absent key in axes, never 0.';
COMMENT ON COLUMN public.taste_profiles.axes IS
  'Object of axis name -> {v 0..10, conf 0..1, sd > 0 optional}. Shape checked here; the closed list of names is the gateway''s (taste-axes.ts). Facts (ABV, IBU, pH, Brix) belong in ext.facts, not here.';
COMMENT ON COLUMN public.taste_profiles.note_text IS
  'What the person wrote, verbatim. Never rewritten. Rendered as text, never as HTML.';
COMMENT ON COLUMN public.taste_profiles.dish_id IS
  'A dish. No foreign key until the table that holds dishes is on main.';
