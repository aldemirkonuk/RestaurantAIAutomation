---
type: schedule
division: platform
department: engineering
team: platform-api
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[platform-api-charter]]", "[[platform-api-loops]]", "[[engineering-schedule]]", "[[security-charter]]", "[[skills-charter]]"]
---

# Platform & API — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Route census — L-PA-1, over Nest metadata (same source as `apps/api-gateway/src/openapi.ts`) | Total / guarded / intentionally-public / unguarded counts; **fails on an increase in unguarded** |
| Per PR | Allowlist diff review — any change to the public-route file | Owning team + this team co-sign, visible in the diff |
| Per PR | Tenant-predicate static check | Domain queries filtering by id with no tenant scope |
| Per PR | Gateway spec suite — 64 `.spec.ts` files | Regression pass/fail |
| Weekly | Escape-hatch erosion — L-PA-2 | `@Public()` count, allowlist additions **per close-time** |
| Weekly | Tenant isolation — L-PA-3 | Cross-tenant reads; multi-tenant fixture coverage |
| Fortnightly | Find-versus-fix seam review with [[security-charter]] — L-PA-5 | Findings closed by mechanism vs one route at a time |
| Monthly | Cross-cutting default drift — L-PA-4 | Distinct idempotency derivations; routes with no declared cache/rate-limit policy |
| Monthly | OpenAPI surface vs implemented routes | Documented-but-absent, and present-but-undocumented |
| Quarterly | Crypto and secret-handling review — `common/crypto/` | Key rotation status, algorithm currency |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `endpoint-guard-census` | Per PR | Enumeration is scriptable; classifying "should this be public?" needs the allowlist reason and the owning team's context |
| `tenant-scope-audit` | Per PR touching a domain query | Must recognise scoping achieved indirectly — a join, a scoped repository, an RLS policy — not just a literal predicate |
| `cross-cutting-default-diff` | Monthly | Compares how modules derive idempotency keys and apply cache/rate-limit policy; the finding is a *difference*, which a linter cannot express |

**Constraint on all three:** a skill may **report** a route as unguarded; it may not
**allowlist** one. Automated allowlisting is premortem M1 with no human in the diff — the
single change that would make the escape hatch invisible. Nor may these skills classify
severity: [[security-charter]] classifies, this team builds
(`technology.md:864`).

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
