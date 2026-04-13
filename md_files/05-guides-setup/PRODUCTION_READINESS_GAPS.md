## Production Readiness Gap Analysis

### Goal
Deliver a production-ready, fully migrated, reliably synced WineOps AI system with database-generated user IDs on signup and stable cross-page sync.

### Current Baseline (verified)
- Monorepo services: `apps/web`, `apps/api-gateway`, `services/agent-orchestrator`, `services/database`  
- CI/CD: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- Local infra: `docker-compose.yml`
- Environment template: `env.example`
- Migration runner: `services/database/migrate.py`
- Manual migration helper: `scripts/run_migration.sh`
- Database schemas in multiple sources:  
  - Versioned migrations: `services/database/migrations/*.sql`  
  - Base schema: `md_files/02-architecture/DATABASE_SCHEMA.sql`  
  - Manual SQL: `Supabase_SQL_Files/*.sql`
- Error tracking:  
  - Backend Sentry: `apps/api-gateway/src/common/error-tracking/sentry.service.ts`, `services/agent-orchestrator/utils/sentry_client.py`  
  - Frontend mock: `apps/web/src/lib/error-tracking.ts`
- Tests:  
  - Web: `apps/web/vitest.config.ts`  
  - Orchestrator: `services/agent-orchestrator/pytest.ini`

---

## Critical Gaps (must fix before production)

### 1) Migration source of truth and drift control
**Gap:** Schema exists in multiple sources (`migrations`, `DATABASE_SCHEMA.sql`, `Supabase_SQL_Files`).  
**Impact:** Drift between environments, broken migrations, and inconsistent schema across local/staging/prod.  
**Required:**  
- Choose a single source of truth (recommend: `services/database/migrations`).  
- Lock down manual SQL usage.  
- Generate a single “full migration” from migrations only and use it in Supabase SQL editor.
- Add migration validation in CI.

### 2) Supabase migration automation not wired
**Gap:** Deploy workflow runs `supabase db push`, but repo has no `supabase/config.toml`.  
**Impact:** Production deploy can fail or push the wrong schema; no environment isolation.  
**Required:**  
- Add Supabase CLI config and project refs.  
- Add a migration check job (dry-run) in CI before deploy.  

### 3) Rollback path missing
**Gap:** `services/database/migrate.py` reports rollback but exits with “not implemented”.  
**Impact:** No safe rollback if a migration breaks production.  
**Required:**  
- Add down migrations or snapshot-based rollback strategy.  
- Document restore process with verified steps.

### 4) Auth + user identity consistency (DB-generated IDs)
**Gap:** App uses a custom `users` table with `user_id` default (`services/database/migrations/012_create_users_table.sql`), while several migrations reference `auth.users` for RLS.  
**Impact:** Auth mismatch risks RLS failures and inconsistent identity.  
**Required:**  
- Keep user IDs **database-generated** only (no client-supplied IDs in DTOs).  
- Decide single identity source:  
  - Option A: use Supabase Auth (`auth.users`) and mirror to `public.users`.  
  - Option B: use only `public.users` and update RLS to use your own auth.  
- Verify signup endpoint in `apps/api-gateway/src/auth/auth.service.ts` never accepts `user_id` from input.  

### 5) RLS coverage gaps
**Gap:** RLS is enabled on some tables, but not consistently across all tenant data.  
**Impact:** Data leakage risk or blocked queries in production.  
**Required:**  
- Audit all tables that reference `restaurant_id`.  
- Add policies for tables created in newer migrations (e.g., providers, reports, P1 agent tables).  
- Add tests to verify RLS for authenticated roles.

### 6) Observability is partial
**Gap:** Backend Sentry is configured, but frontend uses a mock (`apps/web/src/lib/error-tracking.ts`). No metrics dashboards, no log aggregation.  
**Impact:** Failures and performance issues go undetected.  
**Required:**  
- Replace frontend mock with real Sentry SDK and enable tracing.  
- Add metrics (Prometheus or platform metrics) + dashboard.  
- Centralize logs (ELK/Datadog/CloudWatch).

### 7) Backup and recovery missing
**Gap:** No automated backups or restore procedures.  
**Impact:** Irrecoverable data loss in production incidents.  
**Required:**  
- Define daily backups + retention policy.  
- Configure PITR (Supabase if available).  
- Run and document restore drills.

---

## High Priority Improvements (next 1-2 sprints)

### Testing and release safety
- Add E2E tests (Playwright/Cypress) for core flows: auth, orders, providers, calendar.  
- Add integration tests for API + DB migrations.  
- Add staging environment with approval gates in CI.

### Performance and scalability
- Validate query patterns and add missing indexes.  
- Add caching strategy (Redis) for read-heavy endpoints.  
- Introduce rate limiting, request timeouts, and connection pooling.

### Infrastructure readiness
- Add Dockerfiles or formal runtime specs for each service.  
- Add infrastructure-as-code (Terraform/Pulumi) for reproducible deploys.  

---

## Recommended Migration Hardening Checklist
- [ ] Use only `services/database/migrations` as the schema source of truth.  
- [ ] Add Supabase CLI config and pin project refs.  
- [ ] Add migration dry-run to CI.  
- [ ] Implement rollback strategy (down migrations or restore).  
- [ ] Remove/retire manual SQL sources after consolidation.  

---

## Recommended Auth Hardening Checklist
- [ ] Ensure `user_id` is always generated by DB (never passed from client).  
- [ ] Add email verification + password reset flow.  
- [ ] Add login rate limiting and account lockout policy.  
- [ ] Clarify `auth.users` vs `public.users` and align RLS.  

---

## Recommended Observability Checklist
- [ ] Replace frontend mock error tracking with real Sentry.  
- [ ] Set up centralized logs + retention.  
- [ ] Add metrics dashboards and alert rules.  
- [ ] Add uptime checks for API + agent services.

---

## Recommended Backup/DR Checklist
- [ ] Daily backups + retention policy.  
- [ ] PITR configuration.  
- [ ] Scheduled restore drills.  
- [ ] Document RTO/RPO targets.

---

## Next Steps (Suggested Order)
1. Consolidate migrations and wire Supabase CLI.  
2. Align auth identity model (DB-generated IDs, consistent RLS).  
3. Add backups + restore plan.  
4. Add frontend Sentry + metrics/log aggregation.  
5. Add E2E + integration tests and staging pipeline.  
