---
type: agenda-board
division: intelligence
department: security
status: active
metrics: []
updated: 2026-08-28
links: ["[[security-charter]]", "[[security-agenda-full]]", "[[security-loops]]", "[[security-schedule]]", "[[security-premortem]]", "[[security-directive]]", "[[security-agent-stack]]"]
---

# Security — Board

> **Active — agenda dated 2026-08-28** ([[security-agenda-full]]). Standing counters below
> are hand-entered until task **S19** gives each one a committed script. Every reading names
> its date; a number without one is not a reading.

## Every Security artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/security"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/security"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/intelligence/security"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/security"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Premortems whose counter-pressure is a document, not a mechanism

Counters [[security-premortem]] M5. A premortem is only load-bearing if something changes.

```dataview
LIST
FROM "01-org/intelligence/security"
WHERE type = "premortem" AND !contains(file.content, "Counter-pressure")
```

## Standing counters — read 2026-08-28

The two-number rule: exposure and coverage are always published **together**. A single
number here is [[security-premortem]] M2 happening. Six metrics, **never summed** — a
department that reports one security score has hidden which control failed.

| Metric | Founding (08-24) | **Now (08-28)** | Target | Task |
|---|---|---|---|---|
| `sec.unguarded_authenticated_surface` | 94 | **6** provisional | 0 | S2 |
| `sec.public_decorator_count` | 12 | **17** | must not rise while the first falls | S3 |
| `sec.recurrence_guard_present` | false | **false** | true **before** the first moves | S1 |
| `sec.unverified_public_ingress` | unmeasured of 43 | **unmeasured of 23** | a per-route verdict each | S6 |
| `sec.fail_open_defaults` | 4 | **1 live + 1 dev-only** ⚠️ pending escalation | 0 | S7 |
| `sec.checklist_12c_items_with_a_reading` | 8 of 15 | **11 of 15** | ≥12 by 09-25 | S18 |
| `sec.injection_corpus_size` | 0 | **0** | ≥60 dual-keyed cases | S12 |
| `sec.corpus_detection_rate` | undefined | **undefined** — no corpus | read only beside size | S13 |
| `sec.autonomous_send_rate` | unmeasured | **unmeasured** | a number, not an adjective | S14 |
| `sec.model_callsites_emitting_cost` | 0 of 7 | **25 of 25** ✅ | held by `check_model_calls_logged.sh` | — |
| `sec.tenants_with_inference_budget` | 0 | **10 of 10** ✅ | ceilings placeholder pending OD-23 | — |
| `sec.distributed_rate_limit_present` | false | **false** | a spec, not a build | S10 |
| `nf_a.unauthenticated_inference_spend` | unmeasurable | **0 — bounded by census, NOT measured** | measured | S16 |
| `sec.cross_tenant_write_paths` | unmeasured | **unmeasured** | a script behind the number | S4 |

**Denominator ledger — 86 → 103 → 94 → 40 → 6.** Five statements in four days, none of them
yet reproducible by a committed script. Task **S19** exists to end this line.

## Blocked, with an owner (not absorbed)

- ⛔ **`nf_a.unauthenticated_inference_spend`** — NF-A records *which agent*, never *whether
  the caller was authenticated*. Owner: [[neural-footprint-instrumentation-charter]] (RM-3).
  Escalation loop L-SEC-5, monthly; `sec.days_dependency_open` keeps counting. **Bounding by
  census is not measuring**, and the loop stays `blocked`.
- ⬦ **INTEL-F4** — merged-vs-split team shape. Owner: founder. The written split trigger is
  now six routes and one CI script away.
- ⚠️ **`sec.fail_open_defaults` republication at 1** — held pending the
  [[security-directive]] trigger-5 escalation (S7). The value moved; the metric may not be
  restated until the escalation is filed.

## Severity queue — live, ordered, re-read 2026-08-28

| # | Item | Class | State |
|---|---|---|---|
| 1 | `accessToken` + `refreshToken` in `localStorage` (`AuthContext.tsx:146-147`) | XSS → account takeover | **open** · unmoved · measured by no metric (finding F1) |
| 2 | Injection corpus size 0 while `injection_suspected` is self-reported by the model under attack | prompt injection | **open** · S12 |
| 3 | 6 `auth` routes public by intent, public by no declaration | undeclared intent | **open** · S2, founder Q2 |
| 4 | `?secret=` query-string credential (`inbound-email.controller.ts:57-58`) | credential in logs/proxies/referrers | **open** · fails closed, which is right · S8 |
| 5 | `GET /calendar/feed/:token.ics` capability URL — no rotation, no revocation | enumeration + log exposure | **open, never audited** · S9 |
| 6 | `GET /events/metrics` public ingestion counters | information disclosure | **open** · verdict may be `delete` · founder Q5 |
| 7 | In-memory rate-limit `Map` (`rate-limit.guard.ts:70`) | limit × instance count | **open** · S10 |
| 8 | CORS `*.vercel.app` + `credentials: true` in production (`main.ts:24`) | shared multi-tenant origin | **open** · S11, founder call |
| — | ~~`/analytics/consult` + `/toggle` — paid model, anonymous~~ | denial-of-wallet | ✅ closed PR #31 |
| — | ~~`simpos` 11 routes — server-signed webhook into stock movement~~ | confused deputy | ✅ closed — guarded (`simpos.controller.ts:54`) + non-prod gated (`app.module.ts:89`) |
| — | ~~3 × JWT secret defaulting to a published string~~ | fail-open credential | ✅ closed — `auth/jwt-secret.ts:21-25` refuses to start outside development |
| — | ~~9 × `communications/test/e2e/*` public, trigger real vendor email~~ | test harness in prod | ✅ closed — `NonProductionGuard`, ADR 0019 D2 |

## This agenda's close-times

| Close | Tasks |
|---|---|
| 2026-09-04 | S1 (guard check red) · S3 weekly starts · S21 weekly starts |
| 2026-09-11 | S2 (classify the 40) · S6 (ingress re-baseline) · S8 · S14 |
| 2026-09-18 | S7 (fail-open re-baseline + guard) |
| 2026-09-25 | S4 · S9 · S12 (corpus v1) · S18 (≥12 of 15) |
| 2026-09-30 | S13 · S16 (monthly, first run) |
| 2026-10-02 | S15 (allowlist coverage audit — audit only) |
| 2026-10-09 | S5 ◈ · S10 · S11 ◈ |
| 2026-10-16 | S19 ◈ (measurement ledger) |
| 2026-10-30 | S17 ◈ · S20 (Red Team handoff #1) |

**Canvas:** [`sketches/059-security-agenda-canvas/canvas.html`](../../../sketches/059-security-agenda-canvas/canvas.html)
