---
type: agenda-board
division: commercial
department: sales
team: outbound-engine
status: provisional
metrics: [sales.sending_identity_isolated, sales.claim_provenance_rate, sales.qualified_conversation_rate, sales.suppression_integrity]
updated: 2026-08-24
links: ["[[outbound-engine-charter]]", "[[outbound-engine-premortem]]", "[[outbound-engine-agenda-full]]", "[[outbound-engine-loops]]", "[[outbound-engine-schedule]]", "[[outbound-engine-directive]]", "[[sales-agenda-board]]", "[[design-partner-operations-charter]]"]
---

# Outbound Engine — Board

> **PROVISIONAL — no work done yet.**

## Status: DORMANT BY CONSTRUCTION

**Zero sends and zero spend are the correct output for this quarter.** A busy version of
this board is a failed one.

**Entry trigger — both must hold before staffing, spend, tooling, domain purchase, or any
send:**

- [ ] `sales.verified_dollars_recovered > 0` — a **landed** credit from
      [[design-partner-operations-charter]] (`.planning/YC_WEDGE_PLAN.md:31-33`)
- [ ] Founder has **un-deferred the target list**

## Team docs — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/sales/teams/outbound-engine"
SORT type ASC
```

## Stale check — untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/commercial/sales/teams/outbound-engine"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Permitted work while dormant — design only

- [ ] **CI guard** — no outbound-path module may reach `GmailService`. Shape:
      `scripts/check_no_direct_stock_writes.sh`. *Highest value, zero cost, buildable now.*
- [ ] **Sending identity decided** (not purchased) — domain + backend. Seam exists:
      `env.example:165` `EMAIL_BACKEND=gmail`; `SENDGRID_API_KEY` `env.example:167`
- [ ] **Suppression design** — per-domain, 24h honour, wired to the sequence stop path.
      Copy the dedupe shape at `prospects.service.ts:36-42`
- [ ] **Qualification rubric, frozen** — with ≥1 hard disqualifier
- [ ] **Claim allowlist created, empty** — mechanism-only opening as its first entry
- [ ] **Legal-basis question filed** with [[compliance-privacy-charter]]
- [ ] **Procurement runbook note** — outbound reputation as a candidate cause of
      transactional delivery failure

## Counters

- `sales.qualified_conversation_rate` — **dormant**, undefined until the list un-defers
- `sales.sending_identity_isolated` — **false** (`gmail.service.ts:76-78`)
- `sales.complaint_rate` — n/a, **0 sends** · `sales.reply_rate` — n/a
- `sales.claim_provenance_rate` — n/a; allowlist **empty by design**
- `sales.suppression_integrity` — n/a, no suppression list exists
- emails sent — **0**. *This is the target, not a gap.*

## Forbidden until the trigger fires

- ✗ Any target list, segment, geography, cuisine filter, or restaurant count
- ✗ Any scraping script or directory export — **the first row is the signal**
      ([[outbound-engine-premortem]] M3)
- ✗ Any sequencing-tool subscription or domain purchase
- ✗ Any dollar figure in any copy ([[outbound-engine-premortem]] M2)
- ✗ Any send, test send included

## ⚠️ Do not miscite

`prospects` in this repo is **vendors emailing a restaurant**, not our pipeline
(`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`). A reusable shape,
not an inherited asset. See [[outbound-engine-charter]].

## Review

- [ ] **2026-11-24** — if [[design-partner-operations-charter]] has produced no landed
      credit, this team is the half of Sales that folds into [[growth-charter]]
      ([[sales-premortem]] M5). Pre-agreed.
