-- ADR 0143 merges both admin routes into one operations desk. One switch owns
-- the page and its old bookmark redirect; no separate admin_health flag.
ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_admin boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_admin IS
  'ADR 0143. The unified operations desk at /admin and the /admin/health redirect. Off until the page and operator-boundary checks pass.';
