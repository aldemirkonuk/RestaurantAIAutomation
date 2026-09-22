-- A report export is written, or it says why not.
-- (2026-09-17. Additive: one new table, nothing altered, nothing dropped.)
--
-- WHAT THIS CLOSES
-- ----------------
-- OD-81. `POST /reports/generate` inserted a `generated_reports` row with
-- `status = 'pending'` and every file column NULL, and nothing in the repo ever
-- advanced it — so View / Download / Print could never work on either page that
-- listed those rows. The founder's answer on 2026-09-16 (ADR 0149, row 20):
-- "Build a real export: CSV plus a print-ready page, stored, with an honest
-- queued/ready/failed status".
--
-- An export here is ONE cutting of the /reports sheet (the reading, the till,
-- figures of record, ...) rendered by the gateway from the same analytics
-- services the page reads, to a CSV file and to a print-ready HTML page.
--
-- WHY A TABLE WITH TEXT COLUMNS, AND NOT A STORAGE BUCKET
-- -------------------------------------------------------
-- The only bucket the gateway uses is `vendor-attachments` — vendor paper that
-- arrived by mail. It holds nothing this product generates, and it is not
-- created by the applied migration chain at all (its CREATE lives in
-- `supabase/migrations_archive/`). A generated report does not belong in a
-- vendor's inbox, and a new bucket would need its own storage.objects policies
-- in a schema this corpus does not otherwise touch.
--
-- The artifacts are TEXT (a CSV and an HTML page), bounded (one cutting's rows,
-- capped below at 5 MB each), and meaningless without their lifecycle. Keeping
-- the bytes on the lifecycle row means one house-scoped read answers both "is
-- it ready" and "give it to me", a failed write cannot leave a file with no
-- status (or a status with no file), and a house's exports go when the house
-- goes (ON DELETE CASCADE) with no orphaned objects in a bucket.
--
-- WHY NOT MORE COLUMNS ON `generated_reports`
-- -------------------------------------------
-- That table's shape is a different product: `report_type` is a five-value
-- category the Sorting Office re-files between, the two period dates are
-- NOT NULL, and three `*_url` columns promise a hosted file. An export is a
-- cutting over a window the SERVER fixes, and its bytes are here, not at a URL.
-- Folding them together would make every existing read of that table silently
-- wrong about what a row is.
--
-- THE LIFECYCLE IS THE SCHEMA
-- ---------------------------
-- queued -> ready | failed. Each state's evidence is a CHECK, so a row cannot
-- claim a state it has no evidence for:
--   * ready  <=> both files are present;
--   * failed <=> a reason is written;
--   * queued <=> it has not finished.
-- A retry moves failed -> queued on the SAME row and counts the attempt.
--
-- FK TARGETS. `requested_by` references `public.users(user_id)` — NOT
-- `auth.users`. The two tables share zero ids in this deployment and the JWT
-- carries `public.users.user_id`, so a FK to `auth.users` would 23503 on the
-- first insert and no CI check would catch it.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

create table if not exists public.report_exports (
  id              uuid primary key default gen_random_uuid(),

  -- The house. The ONLY tenancy on this row: the gateway takes it from the
  -- token and scopes every read, retry and download by it.
  restaurant_id   uuid not null
                  references public.restaurants(id) on delete cascade,

  -- Who asked. Nullable so a departed member does not take the house's
  -- records with them.
  requested_by    uuid references public.users(user_id) on delete set null,

  -- The cutting id from the /reports catalogue. Not a CHECK listing the ids:
  -- the catalogue lives in source (apps/api-gateway/src/reports/exports/
  -- report-export-cuttings.ts) and grows, and a CHECK that has to be ALTERed
  -- for every new cutting is the kind that gets skipped and then silently
  -- refuses a write. The writing service validates against the catalogue.
  cutting         text not null check (cutting ~ '^[a-z_]{1,40}$'),

  -- The till window, in days, for the one cutting that takes one. NULL for
  -- every cutting whose window the server fixes.
  window_days     smallint check (window_days is null or window_days between 1 and 365),

  -- What the reader saw on the sheet, frozen at request time.
  title           text not null check (length(title) between 1 and 200),
  window_label    text not null check (length(window_label) between 1 and 300),

  status          text not null default 'queued'
                  check (status in ('queued', 'ready', 'failed')),
  failure_reason  text check (failure_reason is null or length(failure_reason) between 1 and 2000),

  csv             text check (csv is null or octet_length(csv) <= 5242880),
  html            text check (html is null or octet_length(html) <= 5242880),
  csv_bytes       integer check (csv_bytes is null or csv_bytes >= 0),
  html_bytes      integer check (html_bytes is null or html_bytes >= 0),

  -- How many figures the export wrote as WITHHELD rather than as a number.
  -- NULL until it is written.
  withheld_count  integer check (withheld_count is null or withheld_count >= 0),

  attempts        smallint not null default 1 check (attempts >= 1),
  requested_at    timestamptz not null default now(),
  -- When the CURRENT attempt began: a retry resets it, and the stale-queue
  -- sweep measures from it.
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,

  constraint report_exports_ready_has_both_files
    check ((status = 'ready') = (csv is not null and html is not null)),
  constraint report_exports_failed_says_why
    check ((status = 'failed') = (failure_reason is not null)),
  constraint report_exports_settled_has_finished
    check ((status = 'queued') = (finished_at is null))
);

comment on table public.report_exports is
  'One cutting of the /reports sheet rendered by the gateway to CSV and to a print-ready HTML page (OD-81, ADR 0149 row 20). '
  'Lifecycle queued -> ready | failed, each state enforced by a CHECK on its evidence. Bytes live on the row: '
  'no bucket in this product holds generated files. Read and written only by the gateway, scoped to the house on the token.';
comment on column public.report_exports.cutting is
  'The /reports catalogue id. Validated by the gateway against its closed catalogue; the column only bounds the shape.';
comment on column public.report_exports.failure_reason is
  'Why the export was not written, in words a manager can act on. Present exactly when status = failed.';
comment on column public.report_exports.withheld_count is
  'Figures written as WITHHELD (the engine returned null: no cost basis, no fitted model, a lens that did not answer) — never written as 0.';
comment on column public.report_exports.started_at is
  'When the current attempt began. A queued row older than the gateway''s stale limit is failed by the gateway with that reason, so a restart mid-render cannot leave a report queued forever.';

create index if not exists idx_report_exports_house_requested
  on public.report_exports (restaurant_id, requested_at desc);

create index if not exists idx_report_exports_queued
  on public.report_exports (started_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.report_exports enable row level security;

drop policy if exists report_exports_service_role on public.report_exports;
create policy report_exports_service_role
  on public.report_exports
  for all to service_role using (true) with check (true);

-- No `authenticated` policy: the browser reaches this only through the gateway,
-- which scopes every read and write to the restaurant on the token — the posture
-- ADR 0012 settled for generated_reports.
revoke all on public.report_exports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls      boolean;
  grants   int;
  parents  text;
  checks   int;
BEGIN
  IF to_regclass('public.report_exports') IS NULL THEN
    RAISE EXCEPTION 'report_exports was not created';
  END IF;

  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.report_exports');
  IF NOT rls THEN
    RAISE EXCEPTION 'report_exports has row level security OFF';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'report_exports'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'report_exports still holds % client grant(s) for anon/authenticated', grants;
  END IF;

  -- Both parents, by name. An actor-shaped uuid column in this codebase has
  -- twice been pointed at auth.users, which shares zero ids with the JWT's.
  -- `regclass::text` prints `public.users` or `users` depending on search_path;
  -- only the `public.` prefix is stripped, so `auth.users` stays distinguishable.
  SELECT string_agg(
           regexp_replace(confrelid::regclass::text, '^public\.', ''),
           ',' ORDER BY regexp_replace(confrelid::regclass::text, '^public\.', '')
         )
    INTO parents
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.report_exports')
     AND contype = 'f';
  IF parents IS DISTINCT FROM 'restaurants,users' THEN
    RAISE EXCEPTION 'report_exports foreign keys point at (%), not (restaurants, users)', coalesce(parents, 'none');
  END IF;

  -- The three lifecycle checks are the whole honesty contract of the table.
  SELECT count(*) INTO checks
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.report_exports')
     AND contype = 'c'
     AND conname IN (
       'report_exports_ready_has_both_files',
       'report_exports_failed_says_why',
       'report_exports_settled_has_finished'
     );
  IF checks <> 3 THEN
    RAISE EXCEPTION 'report_exports carries % of its 3 lifecycle checks', checks;
  END IF;

  RAISE NOTICE 'a report export is written or says why not: report_exports exists, RLS on, no client grants, lifecycle enforced.';
END
$$;
