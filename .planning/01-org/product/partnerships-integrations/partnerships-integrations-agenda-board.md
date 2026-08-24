---
type: agenda-board
division: product
department: partnerships-integrations
status: provisional
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, pi.unblocking_agreements]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-agenda-full]]"
  - "[[partnerships-integrations-loops]]"
---

# Partnerships & Integrations — Board

> **PROVISIONAL — no work done yet.**

## Every unit in this department, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, team AS Team, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations"
SORT team ASC, type ASC
```

## Charters only — grade at a glance

```dataview
TABLE WITHOUT ID
  file.link AS Unit, status AS Grade, updated AS Updated
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter"
SORT status ASC
```

## Drift watch — anything unchanged for 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops this department owns, and how fast they close

```dataview
TABLE WITHOUT ID
  file.link AS Doc, department AS Dept, team AS Team
FROM "01-org/product/partnerships-integrations"
WHERE type = "loops"
SORT team ASC
```

## Numbers

| Metric | Today | Target |
|---|---|---|
| `pi.merchant_backed_providers` | **0** | 1 |
| `pi.verified_ingress_ratio` | 1 of 3 ingress routes correct | 3 of 3 |
| `pi.live_counterparties` | **0** | 1 |
| `pi.unblocking_agreements` | **0** of 9 blocked | ≥0 — zero is an acceptable v0 result |

## Open

- [ ] **OD-07** — Beli: build independently vs collaborate. **Open; not ours to close.**
- [ ] **OD-23** — connector trust boundary. Asserted in charter, not decided.
- [ ] **CM-F3** — distributor connectivity: Sales or here? Seam proposed, not claimed.
- [ ] **OD-21** — Vendor Finder boundary vs [[supply-discovery-charter]].
- [ ] **OD-19** — endpoint classification; co-owned with [[perimeter-ingress-integrity-charter]].

## Next

- [ ] Verified ingress inventory → real baseline for `pi.verified_ingress_ratio`
- [ ] `toast.service.ts:189` call site made unconditional — unsigned must reject
- [ ] Guard `/pos-hub/catalog-match/.../approve|reject` (`ENDPOINTS.md:361-362`)
- [ ] CI recurrence guard, joint with Security + Engineering
- [ ] One named venue → one real `pos_checks` row
- [ ] CM-F3 boundary memo
- [ ] OD-07 option memo
- [ ] Carry 3 doc corrections back upstream

## Rules in force

- [ ] **No new provider adapter while `pi.merchant_backed_providers == 0`.**
- [ ] **Two-provider rule** — no field enters `pos-types.ts` for one vendor alone.
- [ ] **`scaffolded` does not score.** Only merchant-backed counts.
