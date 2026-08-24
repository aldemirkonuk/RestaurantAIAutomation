---
type: agenda-board
division: platform
department: engineering
team: integration-engineering
status: provisional
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration]
updated: 2026-08-24
links: ["[[integration-engineering-charter]]", "[[integration-engineering-agenda-full]]", "[[integration-engineering-loops]]", "[[engineering-agenda-board]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Integration Engineering — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE team = this.team
SORT type ASC
```

## Charters graded PARTIAL or NEW anywhere in the department

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence
FROM "01-org/platform/engineering"
WHERE type = "charter" AND status != "exists"
SORT status ASC, team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## Counters

- [ ] ⚠️ `abc123.ngrok.io` in source paths ([[EXTERNAL_CONNECTIONS]]:13) — **dead or live? unknown**
- [ ] ⚠️ `your-domain.com` in source paths ([[EXTERNAL_CONNECTIONS]]:21) — **unknown**
- [ ] `integration.verified_signature_coverage` — **unmeasured** of ≈51 public routes
- [ ] `POS_HUB_WEBHOOK_SECRET` 8 refs · `TOAST_WEBHOOK_SECRET` 2 refs — a hint, not a measurement
- [ ] Per-route "unsigned request is rejected" test — **none**
- [ ] `integration.webhook_silence_duration` — **not tracked**; silence produces no signal
- [ ] Per-integration silence baseline / alert threshold — **not set**
- [ ] Active polling where provider APIs allow — **none**
- [ ] Per-event delivery records — **absent**; blocks the substrate-seam triage question

## Public route inventory (all currently unguarded — by design, verification unproven)

- [ ] `toast/` — 10
- [ ] `simpos/` — 11
- [ ] `pos-hub/` — 10
- [ ] `vendor-portal/` — 2
- [ ] `common/orchestrator/inbound-email.controller.ts` — 1
- [ ] `integrations/integrations-oauth` — 5

## Groundwork, not integrations

- [ ] Square — referenced host only ([[EXTERNAL_CONNECTIONS]]:11)
- [ ] Lightspeed — referenced host only
