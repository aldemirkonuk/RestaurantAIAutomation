-- ADR 0104 D12 slice 2 — the per-restaurant switch for the canonical document
-- page, OFF by default (OD-106 keeps production brand builds gated).
--
-- Why a column at all: `settings.service.ts` joins EVERY key in
-- ACTIVE_FEATURE_FLAGS into one `.select()`, and PostgREST answers a missing
-- column with 42703 — so promoting `mudavym_design_document` to ACTIVE without
-- this column would 500 the whole Settings read for every restaurant, not just
-- fail this one flag. 20260831090000_mudavym_design_flags.sql was written after
-- exactly that defect; this is the eleventh column in the same shape.
--
-- FALSE is the default and the point. `/documents/:id` renders the Mudavym
-- canonical sheet only where a restaurant has deliberately opted in; everyone
-- else is redirected to `/receipts` by the gate's `legacy` branch.

alter table public.restaurant_feature_flags
  add column if not exists mudavym_design_document boolean not null default false;

comment on column public.restaurant_feature_flags.mudavym_design_document is
  'On the ''restaurant_settings'' row only. TRUE renders the canonical document page at /documents/:id for this restaurant (ADR 0104 D12 slice 2, D13 C-led synthesis); FALSE (default) redirects to /receipts.';
