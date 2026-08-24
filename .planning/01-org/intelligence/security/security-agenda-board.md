---
type: agenda-board
division: intelligence
department: security
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[security-charter]]", "[[security-agenda-full]]", "[[security-loops]]", "[[security-schedule]]", "[[security-premortem]]", "[[security-directive]]"]
---

# Security — Board

> **PROVISIONAL — no work done yet.**

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

## Standing counters (hand-entered until the jobs exist)

The two-number rule: exposure and coverage are always published **together**. A single
number here is the failure described in [[security-premortem]] M2.

- [ ] `sec.unguarded_authenticated_surface` — **94** of 448 · target **0**
- [ ] `sec.public_decorator_count` — **12** (`@Public()` rows in [[ENDPOINTS]]) · the number that must *not* rise while the first falls
- [ ] `sec.recurrence_guard_present` — **false** · no endpoint-guard CI check exists
- [ ] `sec.unverified_public_ingress` — **unmeasured** of 43 in-scope routes
- [ ] `sec.fail_open_defaults` — **4** · `tenant.guard.ts:38-46` + 3 × `JWT_SECRET` fallback
- [ ] `sec.checklist_12c_items_with_a_reading` — **8 of 15** ([[security-agenda-full]])
- [ ] `sec.injection_corpus_size` — **0** cases
- [ ] `sec.autonomous_send_rate` — **unmeasured** · replies sent with no human in the path
- [ ] `nf_a.unauthenticated_inference_spend` — **unmeasurable** · blocked on [[neural-footprint-instrumentation-charter]]
- [ ] `sec.tenants_with_inference_budget` — **0** of all

## Blocked, with an owner (not absorbed)

- 🔴 **OD-20** — `fix/analytics-endpoint-auth` (`99da5eb`) is **unmerged**. Owner: founder. One file, +7 lines.
- ⛔ **`nf_a.unauthenticated_inference_spend`** — blocked on RM-3 emitting cost events from NestJS callsites. Owner: [[neural-footprint-instrumentation-charter]]. Escalation loop: L-SEC-5, monthly.
- ⬦ **F-4** — merged-vs-split team shape. Owner: founder. Recommendation on record in [[security-charter]].

## Severity queue — live, ordered

| # | Item | Class | State |
|---|---|---|---|
| 1 | `/analytics/consult` + `/toggle` — paid model, anonymous | denial-of-wallet | fixed on branch, **unmerged** |
| 2 | `simpos` 11 routes — unguarded, server-signed webhook into stock movement | confused deputy | **open, unclassified** |
| 3 | JWT secret defaults to a public string in 3 places | fail-open credential | **open** |
| 4 | `accessToken` + `refreshToken` in `localStorage` | XSS → account takeover | **open, out of OD-19 scope** |
| 5 | 9 × `communications/test/e2e/*` public, trigger real vendor email | test harness in prod | **open, verdict may be `delete`** |
| 6 | `?secret=` query-string credential on `inbound-email` | credential in logs/proxies/referrers | **open** (fails closed, which is right) |
| 7 | `injection_suspected` self-reported by the model under attack, untested | prompt injection | **open, no corpus** |
