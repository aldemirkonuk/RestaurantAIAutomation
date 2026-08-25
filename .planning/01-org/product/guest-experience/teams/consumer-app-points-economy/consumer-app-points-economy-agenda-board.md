---
type: agenda-board
division: product
department: guest-experience
team: consumer-app-points-economy
status: provisional
metrics: [nf_b.points_confirm_rate, nf_b.events_per_active_guest_month, nf_b.abuse_hold_rate]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-agenda-full]]", "[[consumer-app-points-economy-premortem]]", "[[consumer-app-points-economy-directive]]", "[[guest-experience-agenda-board]]", "[[OPEN-DECISIONS]]", "[[FUTURES]]"]
---

# Consumer App & Points Economy — Board

> **PROVISIONAL — no work done yet.**

⬦ **UNSTAFFED. Gated on OD-07.** Two entry conditions, neither satisfied.

**Verification ships before earning.** Everything else on this board is downstream.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/product/guest-experience/teams/consumer-app-points-economy"
WHERE type != "agenda-board"
SORT type ASC
```

## Blockers, by owning unit

```dataview
TABLE team, status, updated
FROM "01-org/product/guest-experience"
WHERE type = "charter" AND team != this.team AND team
SORT status ASC
```

## Entry trigger — both required

- [ ] **OD-07 resolves** — build independently vs explore Beli · this team takes **no position** (an independent build maximises its own scope)
- [ ] `nf_b.subject_coverage` non-zero for ≥1 restaurant — somebody to attribute a choice to

## Status — **NEW as code, complete as design**

- [x] Design contract: [[FUTURES]] §7 · profiles · earning · integrity · redemption · MVP
- [x] **41 UX paths written**: §W `NEW-652…666` · §AB `NEW-861…885`
- [x] Scheduled as ROADMAP backlog **999.1**
- [ ] ⚠️ **No code**: grepped `points_ledger` · `guest_points` · `points_balance` — no matches anywhere
- [ ] `apps/mobile/src` is the **staff** app, not this
- [ ] No ledger · no ratings · no guest profile · no verification channel

## Integrity rules — [[FUTURES]] §7.3, non-negotiable

- [ ] Append-only ledger, **balance derived** · CI guard modelled on `check_no_direct_stock_writes.sh`
- [ ] **Verification gates value** · provisional → confirmed · unconfirmed expires
- [ ] No self-referral / duplicate-device farming
- [ ] Review quality gate before points confirm
- [ ] Consent-first

## Metrics — volume is never reported alone

- [ ] `nf_b.events_per_active_guest_month` — 0
- [ ] `nf_b.points_confirm_rate` — undefined · **must be computable before anything is earnable**
- [ ] `nf_b.verified_visit_rate` — undefined
- [ ] `nf_b.abuse_hold_rate` — undefined · reported **with appeal outcomes**
- [ ] `nf_b.review_quality_pass_rate` — undefined

## Forbidden until integrity is proven — [[FUTURES]] §10

- [ ] ~~Cash-value rewards~~
- [ ] ~~Redemption marketplace~~
- [ ] ~~Platform-funded perks~~ · restaurant-funded opt-in only, after a **full stable quarter** of confirm rate

## Escalate on sight

- [ ] Any credit path defaulting to `confirmed`
- [ ] `nf_b.abuse_hold_rate` flat or falling **while volume rises** — the C2 tell
- [ ] Any code path writing a balance instead of appending a credit
- [ ] A consumer surface built primarily from staff components
- [ ] Any implementation work starting while OD-07 is open

## The one act available now

- [ ] Write the no-direct-balance-write CI guard **before** the first ledger table exists
