# 0252 — "All houses" is one total with the ledger one tap away, for owners of two or more houses

- **Status:** Locked in part, 2026-10-01: the direction and who sees it. Every other fork is open, and research on them is in progress (see Open).
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder).
  - Voice note, 2026-10-01: *"I want to see all of their, all of our profits in just one go. So not like, okay, restaurant A is this, restaurant B is this … we're going to be able to set up global goals … restaurant A, restaurant B, restaurant C. And that way we will be able to decide on global decisions that will apply to all restaurants."*
  - `AskUserQuestion`, 2026-10-01, on the direction: *"research for all and more, even from this question i can say A with B one tap away is great"*.
  - On who sees it: *"Owners of 2+ houses (Recommended)"*.
- **Keywords:** all houses, group view, consolidation, multi-location, profit, goals, group decisions, owner, roll-up
- **Links:** sketch [125](../sketches/125-all-houses-people-and-tips/README.md): `houses-a-one-total.html`, `houses-b-the-ledger.html`, `houses-frames.html`. Related records:
  - [[0164-sessions-follow-membership-and-several-houses-choose]]: one house per session.
  - [[0016-ledgers-must-express-unknown]] and [[0020-no-fabricated-answers]]: an unknown is never a zero, and nothing fails quietly.
  - [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]]: a read answers only for the caller's house.
  - [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]]: prices are advised.
  - [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]].
  - [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]: nothing converts between currencies today (Open 4).

## Context

An owner of several houses sees them one at a time. A session is in one house (ADR 0164). Measured at `origin/main` `1c1a676f8`, as cited in sketch 125's README:

- **There is no profit figure today.** Revenue is a bottle-price proxy (`analytics.service.ts:431`). Labour is a typed `?labor=`. Till revenue is null for a house without a till.
- **Goals are per house.** `analytics_goals` covers seven metrics, and none of them is profit, cost or labour (`goals.service.ts:74`).
- **A house's currency and time zone may be NULL.**

## Options considered

### What the page leads with

1. **A · One Total.** One profit figure first, with the houses as its parts. **Taken, with B one tap away.**
2. **B · The Ledger.** A totals row, then one row per house. Taken as the second view, one tap from A, not as the lead.
3. **C · The Letter.** A written morning briefing. Not taken.

### Who sees it

1. **Owners of two or more houses.** **Taken.**
2. **Managers too, without money.** Not taken now. It stays open for a manager of two houses (Open 9).
3. **A new group role.** Not taken.

## Decision

- **What it is.** "All houses" opens on one total: profit for the houses chosen, with each house shown as its share. The per-house ledger is one tap away on the same page.
- **Who sees it.** It is offered only to a person who is an owner in two or more houses.
- **How it reads.** It reads each house with the reader's role in that house. A session stays in one house: "All houses" is a read across houses, not a session in all of them.
- **Honesty.** A house that cannot be read is named, never counted as zero. The total never shrinks without saying so (ADRs 0016, 0020). [Corrected 2026-10-01: this sentence and sketch 125 first cited ADR 0147 for that rule; 0147 holds no such rule. Found by the all-houses money research.]

Nothing is built yet.

## Open — the founder's to decide (sketch 125 forks 3–8, 15–16)

1. Which houses count as "all": every house owned, the organisation, or saved sets.
2. What "profit" means, given that no real P&L exists today (Context).
3. An unread house: hold the total back, or show it marked partial.
4. Two currencies: one total at an average rate, or a total per currency.
5. Group goals: each house rolling up, or one target on the total; and whether a house may change its own.
6. Group decisions, per kind: applies outright, applies with a manager's override, or each manager accepts.
7. Whether managers see profit.
8. Whether a manager of two houses gets "All houses".

Research on 1–8 was asked "for all and more". It runs as parallel research agents, not a Workflow fan-out. Its findings and an adversarial pass come before any of these is put to the founder.

**First finding (money research, 2026-10-01; read from code, not measured).** Today's money figures are wrong before anything is added up, so no group total can be trusted until they are fixed:
- the three margin ratios divide stock on hand by sales, not by cost of goods sold;
- till revenue includes tax (and tips on Toast);
- a failed till read comes back as 0;
- till reads stop at 1,000 rows and cut days on UTC.

Its recommendations per fork (profit as a staged, named measure; "from N of M houses" inside the figure; one total per currency until ADR 0117 is narrowly superseded; the POS business date or house-local time, never UTC) wait for the adversarial pass and the founder.

**Second finding (group structure research, 2026-10-01; read from code, adversarial pass run by the same agent).** Its recommendations, also waiting for the independent adversarial pass and the founder:
- **Which houses:** the houses the person owns now, re-checked on every read. Saved sets only filter inside that, and a house dropped is named.
- **How it reads:** one read route that works out the houses on the server and reads each with that house's own role. No new token or role.
- **Group goals:** each house keeps its own goal, linked by one group id. The headline reads "N of M houses on target".
- **Group decisions:** copy the value into each chosen house, then show which houses have drifted from it. Nothing inherits live in a first version.
- **Two preconditions, both read from code:**
  - No route can write to a house other than the session's (`assert-tenant-match.ts:136`).
  - The gateway's role lookup checks `is_active` but not `valid_until` (`organizations.service.ts:45`), so a membership past its end date still acts. The calendar feed and RLS honour it. Flagged as a separate task, not fixed here.

## Consequences

- The design question is settled. A build waits on Open 2 above all, because the lead figure is profit, and profit is not computed today.
- Revisit if owners of a single house ask for the view, or if the research shows that leading with one figure hides a failing house.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Aldemir (founder, voice note + `AskUserQuestion`) + Claude (Opus 5.5; branch `fix/closed-stays-closed`, uncommitted at this row) | Created — direction and audience locked; forks open |
