---
type: agenda-board
division: product
department: partnerships-integrations
team: connector-platform-trust
status: provisional
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[connector-platform-trust-charter]]"
  - "[[connector-platform-trust-agenda-full]]"
  - "[[connector-platform-trust-loops]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[partnerships-integrations-agenda-board]]"
---

# Connector Platform & Trust — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations/teams/connector-platform-trust"
SORT type ASC
```

## Department charters — the units whose connectors we contract for

```dataview
TABLE WITHOUT ID
  file.link AS Unit, team AS Team, status AS Grade
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter"
SORT team ASC
```

## Drift watch

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations/teams/connector-platform-trust"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The number, honestly

| | |
|---|---|
| Routes in "webhook modules" | 32 |
| **Of those, actually inbound ingress** | **3** |
| Ingress verifying correctly | **1** — `pos-hub` webhook: HMAC-SHA256 + `timingSafeEqual`, fails closed |
| Ingress failing **open** on unsigned | **1** — `toast` (`toast.service.ts:189` verifies only `if (signature && timestamp)`) |
| Ingress with secret in a query string | **1** — `inbound-email` (`?secret=`, `:57-58`) |
| Management/simulator routes merely unauthenticated | **29** |
| Widely-cited figure that is wrong | *"0 of 32 verify"* — `product.md:783` |
| `integrations/` endpoints | 5, **all guarded** — the good pattern |
| OAuth providers today | **2** — `google`, `microsoft` |
| Env vars to inventory | **80** |

## The sharpest item, and it is not a webhook

- [ ] `POST /pos-hub/catalog-match/:restaurantId/proposals/:id/approve` + `/reject` — `ENDPOINTS.md:361-362`
  - The **human approval gate** over catalogue mapping, callable by anyone
  - Needs **authentication**, not signature verification — which is why a per-module label could never have found it

## Next

- [ ] Ingress inventory — route-level classification, real baseline
- [ ] Make the inventory **generated**, not written
- [ ] **CI guard spec** — unclassified or unverified ingress fails the build ← *the deliverable*
- [ ] Repair: toast call site unconditional
- [ ] Repair: guard the catalogue-match gate
- [ ] Repair: inbound-email secret header-only
- [ ] Trust-contract template + contracts for live connectors
- [ ] Credential-path decision before the first POS merchant token exists
- [ ] `/authorize/:integrationId` reachable + traceable (`PAGE_MAP.md:110, 156`)
- [ ] 80 env vars + third-party hosts inventoried; ngrok/placeholder domains flagged
- [ ] Carry the ingress-count correction upstream

## Rules in force

- [ ] **We own the contract. Security owns the control. Engineering owns the runtime.**
- [ ] **No second `verifyWebhookSignature`** — duplication is how the secret ends up unset
- [ ] **If our metric duplicates Security's, ours is deleted** — named in advance
- [ ] **The guard is the deliverable; the fix alone is not**
- [ ] **Inventory is generated from source, never hand-maintained**

## Open

- [ ] **PROD-F4** — connector trust boundary. Asserted in charter, not decided.
- [ ] **OD-19** — endpoint classification. Co-owned; our subset is *"public but verified"* only; the ~94-unguarded-by-omission set is [[access-control-tenant-isolation-charter]]'s.
