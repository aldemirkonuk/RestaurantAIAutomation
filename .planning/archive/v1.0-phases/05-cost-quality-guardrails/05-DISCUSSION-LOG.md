# Phase 5: Cost & Quality Guardrails — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 05-cost-quality-guardrails
**Areas discussed:** Spend logging placement, Monthly cap trigger, Per-restaurant cap enforcement, Review queue scope, Quality verification layer

---

## Spend Logging Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Central SpendLogger service | One service all callers use — single place to change, easy to extend | ✓ |
| Inline in each service | Each service inserts to api_spend itself — simpler but duplicated logic | |
| Celery background task | Fire-and-forget spend_log.delay() — fully non-blocking but adds overhead | |

**User's choice:** Central SpendLogger service
**Notes:** Clean abstraction; all three API-calling services (Claude Vision, Haiku, Gemini) route through it.

---

## Monthly Cap Check Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Celery beat periodic check | Hourly scheduled task, idempotent alert deduplication | ✓ |
| Inline after every API call | Query monthly sum per call — most immediate but extra DB overhead | |

**User's choice:** Celery beat periodic check
**Notes:** Hourly cadence; alert fires once per month per threshold crossing, not repeatedly.

---

## Per-Restaurant Cap Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-flight check | Check before extraction starts — reject HTTP 402 if estimate would breach $2.00 | ✓ |
| Per-page abort mid-extraction | Check after each page logged — most accurate but complex abort logic | |

**User's choice:** Pre-flight check
**Notes:** Estimate based on page_count × $0.05/page. Simple, no mid-extraction abort needed.

---

## Review Queue Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full read + correct loop | GET queue + PATCH corrections + per-field acceptance rate | ✓ |
| Read queue only | GET only, corrections manual via Supabase dashboard — QUAL-02 deferred | |

**User's choice:** Full read + correct loop
**Notes:** User emphasized zero error space. Full loop closes the correction cycle; QUAL-02 acceptance rate tracking included.

---

## Quality Verification Layer

| Option | Description | Selected |
|--------|-------------|----------|
| Strict threshold escalation | Two tiers: < 0.5 needs_review, < 0.3 auto_blocked (held from master library) | ✓ |
| Secondary AI verification pass | Haiku cross-checks suspicious fields after extraction | |
| Human-gated persistence | All needs_review wines held until explicit PATCH approval | |

**User's choice:** Strict threshold escalation
**Notes:** User added: "Quality guardrails should have no error space whatsoever, minimal errors are acceptable but we have to perfect it. If we need to add a lean 4 type of verification layer then let's do it (only if we need it)." The two-tier gate (< 0.3 auto_blocked) implements the strict floor. Secondary AI verification deferred — revisit if QUAL-02 acceptance rate data reveals systematic patterns.

---

## Claude's Discretion

- `api_spend` table column names
- `field_corrections` table schema (migration)
- `auto_blocked` column migration on submissions table
- Alert deduplication storage mechanism
- Celery beat schedule registration
- Pre-flight cost estimate formula

## Deferred Ideas

- Secondary AI verification pass (Haiku field cross-check) — deferred pending QUAL-02 acceptance rate data
- Human-gated persistence for ALL wines (not just < 0.3) — too slow for MVP
- Real-time spend dashboard — v2 concern
