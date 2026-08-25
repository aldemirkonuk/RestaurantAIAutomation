---
type: agenda-board
division: commercial
department: media-brand
team: customer-relationship-research
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[customer-relationship-research-charter]]"
  - "[[customer-relationship-research-agenda-full]]"
  - "[[media-brand-agenda-board]]"
---

# Customer Relationship Research (M4) — Board

> **PROVISIONAL — no work done yet.**
>
> ⛔ **GATE CLOSED.** No approval register exists. Every research request today is answered
> **no**.

## This team's documents

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## The units this team must coordinate with

```dataview
TABLE WITHOUT ID department AS "Department", team AS "Team", status AS "Grade"
FROM "01-org"
WHERE type = "charter" AND contains(list("compliance-and-privacy", "guest-experience", "outbound-engine"), default(team, department))
SORT department ASC
```

## Stale check

```dataview
TABLE type, updated
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Build the gate — in this order, nothing skipped

- [ ] Register proposal drafted — `approval_purpose`, `notice_version`, `captured_via`, `captured_at`, `withdrawn_at`
- [ ] Sent to Compliance & Privacy; four questions asked (same DB?, notice text, legal basis, withdrawal obligations)
- [ ] Compliance & Privacy review returned
- [ ] Findings format — subject ids and purpose as **required fields**, not prose
- [ ] Prospect-request refusal rule written **before** the first request arrives
- [ ] Ethics & Responsible AI discrepancy raised in OPEN-DECISIONS

## Hard rules — no exceptions, no judgement calls

- [ ] Zero customers researched who are not on the register
- [ ] Zero records touched with `consent_withdrawn_at` set
- [ ] Zero use of guest consent captured under `service_personalisation` for research
- [ ] "It's public" is not an argument
- [ ] A social reply, follow, or mention is not consent

## Blocked on the founder

- [ ] Where approval lives and who captures it
- [ ] What exactly the customer is approving — the notice text
- [ ] What withdrawal obliges us to do to existing findings
- [ ] Design partner in or out (a friend's informal yes still needs recording)
- [ ] Which guest consent purposes are in scope

## Not ours

- Legal basis, DPAs, the consent mechanism's legal shape → Compliance & Privacy
- The guest-facing product → Product → Guest Experience
- Prospect research → Sales S2, under their rules
- Shipping features from findings → Product

## Substrate that already exists

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` — `:55-57` the design
argument, `:58-64` the consent columns, `:79-81` and `:112-117` the erasure tombstone.
Guest-side only. Not a customer register.
