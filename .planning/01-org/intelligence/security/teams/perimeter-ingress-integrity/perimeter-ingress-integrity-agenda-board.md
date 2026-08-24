---
type: agenda-board
division: intelligence
department: security
team: perimeter-ingress-integrity
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-agenda-full]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-premortem]]", "[[security-agenda-board]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Perimeter & Ingress Integrity — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/security/teams/perimeter-ingress-integrity"
SORT type ASC
```

## Where this team sits in the department

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/security"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/security/teams/perimeter-ingress-integrity"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/security/teams/perimeter-ingress-integrity"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Ingress baseline — 43 routes, provisional

| Module | Routes | Sender | Proof | Fail mode | State |
|---|---|---|---|---|---|
| `pos-hub` | 10 | POS bridges + SimPOS | HMAC-SHA256 raw body | closed | ✅ verified, tested |
| `toast` | 10 | Toast | HMAC-SHA256 raw body | closed | ✅ verified |
| `simpos` | 11 | **nobody — not a webhook** | none | n/a | 🔴 misclassified |
| `communications/test/e2e/*` | 9 | a developer, manually | none | n/a | 🔴 verdict may be `delete` |
| `vendor-portal` | 2 | crawlers, customers | publish-state | unaudited | ❓ enumeration risk |
| `inbound-email` | 1 | inbound-parse provider | shared secret, header **or `?secret=`** | closed | ⚠️ credential in URL |
| **Total** | **43** | | | | **20 verified · 23 not** |

## Standing counters (hand-entered until the jobs exist)

- [ ] `sec.unverified_public_ingress` — **≈23 of 43, provisional** · confirming it is deliverable #1
- [ ] `sec.fail_open_defaults` — **4** · `tenant.guard.ts:38-46` + 3 × JWT-secret fallback
- [ ] `sec.distributed_rate_limit_present` — **false** · effective limit is `tier × instances`
- [ ] `sec.instances_in_production` — **unknown** · without it, no rate limit has a value
- [ ] `sec.secrets_in_url_or_bundle` — **2** · `?secret=` query; `VITE_DEV_AUTH_BYPASS_SECRET`
- [ ] `sec.env_vars_with_named_consumer` — **0 of 80**
- [ ] `sec.cors_unscoped_origin_patterns` — **1** · `/^https:\/\/.*\.vercel\.app$/` with `credentials: true`, in prod

## Severity queue

| # | Item | Why it is ranked here | State |
|---|---|---|---|
| 1 | `simpos` — 11 unguarded routes; our own server signs a stock movement for an anonymous caller | Confused deputy: the control is green and answers the wrong question | **open** |
| 2 | Three `\|\| "your-secret-key-change-in-production"` JWT fallbacks | An environment missing `JWT_SECRET` accepts tokens anyone can mint | **open** |
| 3 | 9 × `communications/test/e2e/*` — public, send real vendor email | `@Public()` reads as a vouched decision | **open** |
| 4 | `?secret=` query credential on `inbound-email` | Lands in access logs, proxies, `Referer`; rotation cannot reach history | **open** (fails closed, which is right) |
| 5 | In-memory rate-limit store | Was the *only* brake on the analytics denial-of-wallet hole | **open** |
| 6 | `vercel.app` CORS regex with `credentials: true` in prod | Not `*`, but every app on a shared domain | **open** |
| 7 | `VITE_DEV_AUTH_BYPASS_SECRET` in the web bundle | Contained by a fail-closed `NODE_ENV` gate; still a secret in a bundle | **open** |

## The standing counter-example

**`simpos` stays on this board until it is resolved**, even after remediation, as the
worked instance of [[perimeter-ingress-integrity-premortem]] M2: a signature that is
correct, fail-closed, tested — and authenticates the sender rather than the originator. A
new teammate should meet it in week one.
