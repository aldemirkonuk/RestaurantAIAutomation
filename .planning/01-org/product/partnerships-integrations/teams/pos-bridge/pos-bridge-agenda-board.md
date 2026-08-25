---
type: agenda-board
division: product
department: partnerships-integrations
team: pos-bridge
status: provisional
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-agenda-full]]"
  - "[[pos-bridge-loops]]"
  - "[[partnerships-integrations-agenda-board]]"
---

# POS Bridge — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations/teams/pos-bridge"
SORT type ASC
```

## Siblings — who we hand off to

```dataview
TABLE WITHOUT ID
  file.link AS Unit, team AS Team, status AS Grade
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter" AND team != this.team
SORT team ASC
```

## Drift watch

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations/teams/pos-bridge"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

| | Today |
|---|---|
| Providers in registry | **27** (2 available · 1 partial · 2 scaffolded · 22 planned) |
| `pi.merchant_backed_providers` | **0** ← the only number that counts |
| Real `pos_checks` rows | **0** (47 rows exist; all simulator, one 43-min window) |
| pos-hub routes verifying | **1 of 10** — the webhook. 9 unauthenticated. |
| `nf_a.task_success_rate` on catalogue match | no baseline — gate never ran on real data |

## Next

- [ ] Guard `POST /pos-hub/catalog-match/.../approve` + `/reject` — `ENDPOINTS.md:361-362`
- [ ] Classify all 10 pos-hub routes: ingress / management / simulator
- [ ] Instrument the catalogue-match gate with `nf_a` events **before** first real merchant
- [ ] Baseline `pi.canonical_shape_drift` across `pos-types.ts`
- [ ] Registry audit — 27 statuses vs what actually builds
- [ ] One named venue → one real `pos_checks` row
- [ ] Carry "27 not 30" + "0 of 32 verify is false" corrections upstream

## Rules in force

- [ ] **No new adapter while `pi.merchant_backed_providers == 0`**
- [ ] **Two-provider rule** on every `pos-types.ts` field
- [ ] **SimPOS is a simulator** — no feature justified only by real-service use
- [ ] **`scaffolded` does not score**

## Blocked / not ours

- [ ] 9 providers need a signature → [[partner-alliance-development-charter]]
- [ ] Verification *control* → [[perimeter-ingress-integrity-charter]]
- [ ] Route guards in runtime code → [[engineering-charter]]
- [ ] One named venue for step 6 → founder
