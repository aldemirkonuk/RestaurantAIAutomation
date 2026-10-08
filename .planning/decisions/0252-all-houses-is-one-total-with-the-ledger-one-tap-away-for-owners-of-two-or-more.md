# 0252 — "All houses" is one total with the ledger one tap away, for owners of two or more houses

- **Status:** **[2026-10-02, PR #566 gate round 2 (audit at `65ddb2cd2`): Locked. Every fork in this record is answered, in rounds 2–6 and ADR 0253 round 8 (the last bracket on this line); Open 7 was later amended by ADR 0253 F14. Nothing is built. The rest of this line is the status as it grew.]** Locked in part, 2026-10-01: the direction and who sees it. Every other fork is open, and research on them is in progress (see Open). **[2026-10-01, round 2: four more answered — sales lead until profit can be subtracted in one currency, each currency shown in the owner's chosen currency through a popover on the currency sign at the owner's rate, an unread house is shown as "from N of M", and the view reads every house owned while a change lists its houses. See "Answered 2026-10-01 (round 2)". Open 5–8 and the forks the adversarial pass added remain.]** **[Later the same day: rounds 3–6 answered Open 5–13, and ADR 0253 round 8 set which managers get the view (Full and Standard; Light does not). Every fork in this record is answered. Nothing is built.]**
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder).
  - Voice note, 2026-10-01: *"I want to see all of their, all of our profits in just one go. So not like, okay, restaurant A is this, restaurant B is this … we're going to be able to set up global goals … restaurant A, restaurant B, restaurant C. And that way we will be able to decide on global decisions that will apply to all restaurants."*
  - `AskUserQuestion`, 2026-10-01, on the direction: *"research for all and more, even from this question i can say A with B one tap away is great"*.
  - On who sees it: *"Owners of 2+ houses (Recommended)"*.
- **Keywords:** all houses, group view, consolidation, multi-location, profit, goals, group decisions, owner, roll-up
- **Links:** sketch [125](../sketches/125-all-houses-people-and-tips/README.md): `houses-a-one-total.html`, `houses-b-the-ledger.html`, `houses-frames.html`. [Corrected 2026-10-02, gate at dde13f0de: sketch 125's folder is on PR #573 (open), not on main, so the link resolves only there.] Related records:
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
2. **Managers too, without money.** Not taken now. It stays open for a manager of two houses (Open 8). [Corrected 2026-10-02, gate at dde13f0de: this said "Open 9"; the fork is Open 8, and it is no longer open. Round 5 answered it: managers of two or more houses get the view, and ADR 0253 round 8 narrowed that to Full and Standard managers.]
3. **A new group role.** Not taken.

## Decision

- **What it is.** "All houses" opens on one total: profit for the houses chosen, with each house shown as its share. The per-house ledger is one tap away on the same page. [Corrected 2026-10-02, gate at dde13f0de: round 2 (below) put sales in the lead until profit can be subtracted in one currency.]
- **Who sees it.** It is offered only to a person who is an owner in two or more houses. [Corrected 2026-10-02, gate at dde13f0de: round 5 (below) widened this to managers of two or more houses, and ADR 0253 round 8 narrowed that to Full and Standard managers; Light managers do not get it.]
- **How it reads.** It reads each house with the reader's role in that house. A session stays in one house: "All houses" is a read across houses, not a session in all of them.
- **Honesty.** A house that cannot be read is named, never counted as zero. The total never shrinks without saying so (ADRs 0016, 0020). [Corrected 2026-10-01: this sentence and sketch 125 first cited ADR 0147 for that rule; 0147 holds no such rule. Found by the all-houses money research.] [Corrected 2026-10-02, gate at dde13f0de: "no such rule" was too broad. ADR 0147 does hold the failed-read rule: its Context names "A failed read reported as an empty one" (ADR 0147, line 22) and its Decision says "A failed read throws" (line 35). What 0147 does not hold is the rule for a group total: a house that cannot be read is named and the total says it shrank. That rests on ADRs 0016 and 0020.]

Nothing is built yet.

## Answered 2026-10-01 (round 2)

Asked by `AskUserQuestion` after the independent adversarial pass (below); his words verbatim.

- **What leads (Open 2):** *"Sales first, profit later (Recommended)"*. Sales net of tax and tips lead; goods bought and hours worked sit beside them as lines; a house shows profit only when all three exist and are in one currency. **This amends the Decision's "profit for the houses chosen"**: until that holds, the lead figure is sales. He was told so in the question.
- **Two currencies (Open 4):** *"per currency our rate, but a simple addition do not make this appeaing , but when you see the lira sign for example and click on it create a popover that will show our used currencies to choose from and the infos and numbers will be updated towards that"*. Read as: no extra combined line on the page; the currency sign on a figure opens a popover listing the currencies the owner's houses use; choosing one re-states every figure in that currency at **the owner's own rate** (a person-stated rate, ADR 0083; nothing inferred). What happens when no rate has been typed for a pair (ask for it in the popover, or leave that house in its own currency and say so) is not settled by this answer.
- **An unread house (Open 3):** *"Show it, from N of M (Recommended)"*. Three states: counted; **not read** (it read before and now fails — flagged); **not set up** (no till, no currency — listed under setup, outside "N of M").
- **Which houses (Open 1):** *"All you own; changes list houses (Recommended)"*. The view reads every house the person owns now, re-checked on every read. Anything that **changes** houses (a goal, a decision) lists the houses and asks to confirm; never "all" by default, because an owner can hold unrelated businesses. No saved sets in a first version.

**Round 3, same day, verbatim:**
- **Group goals (Open 5):** *"Each house its own, linked (Recommended)"*. Each house gets its own copy, linked as one group; the headline reads "N of M houses on target" with a third "not measured" state; a money goal takes a typed target per house.
- **Group decisions (Open 6):** *"Copy once, show drift (Recommended)"*. The value is copied into each chosen house, and the page later shows which houses have changed it. A money order limit copies only when the chosen houses share one known currency; otherwise the owner types it per house.
- **Who may change a group figure's inputs (Open 12):** *"Managers, but you're told (Recommended)"*. Managers keep the right to change currency, time zone and goals; every such change shows on "All houses" with who, what and when.
- **A currency with no typed rate (Open 13):** *"research how industry leaders handle this. do they use websearch tools or just simple apis to get try/usd stock chart rates? tell me and apply that"*. Research is running (Workflow, 2026-10-01). If the industry answer is an automatic published rate, applying it **supersedes ADR 0083's "nothing inferred" for display figures**; that consequence goes back to him with the finding before anything is built.

**Round 4, same day, verbatim:**
- **Readiness (Open 10):** *"Only when 2 can be read (Recommended)"*. Until two of the owner's houses can be measured, the entry opens a short setup list of what each house still needs.
- **Stake (Open 9):** *"Whole houses, said so (Recommended)"*. Totals add whole houses and say "whole houses, not your share". No ownership percentage is stored or asked for.
- **History (Open 11):** *"Houses you own today (Recommended)"*. Past totals cover the houses owned now, so periods compare the same houses; the page says "houses you own today".
- **Managers and profit (Open 7):** *"Only with pay access"* — against the recommendation ("owners only"). A manager the owner has given pay access (`team_pay_access`, ADR 0215) sees profit for their own house, with owners' wages left out of it (ADR 0215 item 24: an owner's wage is invisible to managers, pay access or not). Every other manager sees sales, goods and hours, not profit. [Amended 2026-10-02, gate at dde13f0de: ADR 0253 round 11 (F14) answered *"Needs money and pay (Recommended)"*, whose option read "Profit shows only to someone with both rights. The pay switch is then offered only to someone who sees money." So pay access alone no longer shows profit: a manager needs pay access and the house's money right. Not built.]

**Round 5, same day, verbatim:**
- **A manager of two houses (Open 8):** *"yes they see all with profit if authorized, come up with pacakgaes to give options, like full access, one low, one more lower"*. **This widens the locked audience** ("owners of two or more") to managers of two or more houses: they get "All houses", with profit where they are authorized (round 4: pay access, owners' wages left out) [amended 2026-10-02: ADR 0253 F14 makes it money and pay; see round 4]. He also asks for **access packages** an owner picks from — full access, a lower one, a lower one still. The packages are designed with ADR 0253's rights and labels research and put back to him; nothing about their contents is decided here. **[Answered the same day, ADR 0253 round 8: Full and Standard managers get "All houses" (Full with profit and pay, Standard without); Light managers do not.]**

**The exchange-rate research (2026-10-01, Workflow: 3 finders, 1 adversary, 1 judge; findings `p4-scratch/takeover/houses-scratch/research-fx-rate-source.md`, outside the repo, so not re-checkable from it).** No product sampled takes rates from web search or stock charts: each takes one dated rate a day from one named vendor through an API, stores it, and lets the user type over it. Its recommendation (the ECB daily reference rate, each day converted at that day's rate then summed, every converted figure saying "ECB rates, <dates>", a weekend using Friday's rate, a house with no usable rate left in its own currency and counted in "N of M", a rate the owner types winning from its date) would narrow ADR 0083's "nothing inferred" to records and ledgers and replace ADR 0117 §3 for display figures. Put back to the founder; not decided here.

**Round 6, same day, verbatim:**
- **A currency with no typed rate (Open 13):** *"Yes, ECB daily, dated (Recommended)"*. The ECB daily reference rate converts display figures when no rate is typed; every converted figure says "ECB rates, <dates>"; a weekend uses Friday's rate with Friday's date; a rate the owner types wins from its date; a house with no usable rate stays in its own currency and counts in "from N of M". **This narrows ADR 0083's "nothing inferred" to records and books and supersedes ADR 0117 rule 3 for display figures** (both bracketed 2026-10-01). It also reverses the adversarial pass's "rate source killed" verdict, which rested on that rule. The question stated the narrowing.
- **Which day's rate:** *"Each day at its own rate (Recommended)"*. Each day's sales convert at that day's rate, then add up.

**The independent adversarial pass (2026-10-01; read-only, code at `origin/main` `4bd11a00e`; no production query, no test run).** It attacked the money and structure recommendations above. Verdicts, and what changed:
- **Profit: weakened.** Inside one house, sales carry no currency (`pos_checks`), orders carry their own (`procurement_orders.currency`, nullable since 2026-09-06, no backfill), and wages carry none (`team_members.hourly_wage`). Subtracting them can take euros from lira. Shift pay prices hourly staff only, so salaried staff are uncounted. Led to the "sales first" answer.
- **Rate source: killed.** A daily published bank rate contradicts ADR 0083's "the exchange rate the person states … nothing inferred". Replaced by the owner's own rate (a bank rate may only be offered as a suggestion the owner accepts). Led to the currency answer.
- **Partial total: weakened.** "Not read" and "not set up" must be different states, or a house with no till reads "from 1 of 3" forever. Folded into the answer. A failed till read still returns 0 today, so the "N of M" machinery cannot see a failure until that is fixed.
- **Time: weakened.** No till feed carries a business date; a 04:00 day edge would be a default of the kind the founder removed. House-local midnight (ADR 0207 Q6) until a person states a cutoff.
- **Which houses: weakened.** "Owner of two houses" is not "one business". Folded into the answer (changes name their houses).
- **Entry gate: weakened.** It cannot be `@Roles('owner')`, which reads the session house's role; it must count live owner memberships in the handler, with its own spec.
- **Group decisions: copying an order limit across currencies is killed as written.** `restaurant_approval_thresholds.amount_limit` has no currency; copying 20,000 from a lira house to a dollar house hands a manager 20,000 dollars of authority. Copy it only when every chosen house has one known currency, else the owner types it per house.
- **Group goals: survives with amendments** — a third "not measured" state, and a typed target per house for money goals.
- **Forks it added (open, below):** stake and one business; readiness (offer the view only when two houses can be measured); history (houses held now or houses held then); who may change a group figure's inputs (currency and time zone are manager-writable today).

## Open — the founder's to decide (sketch 125 forks 3–8, 15–16)

1. ~~Which houses count as "all": every house owned, the organisation, or saved sets.~~ Answered (round 2).
2. ~~What "profit" means, given that no real P&L exists today (Context).~~ Answered (round 2): sales lead until profit holds in one currency.
3. ~~An unread house: hold the total back, or show it marked partial.~~ Answered (round 2).
4. ~~Two currencies: one total at an average rate, or a total per currency.~~ Answered (round 2): a currency popover at the owner's rate; the no-rate case is open.
5. ~~Group goals: each house rolling up, or one target on the total; and whether a house may change its own.~~ Answered (round 3).
6. ~~Group decisions, per kind: applies outright, applies with a manager's override, or each manager accepts.~~ Answered (round 3).
7. ~~Whether managers see profit.~~ Answered (round 4): only with pay access, owners' wages left out. [Amended 2026-10-02, gate at dde13f0de: ADR 0253 F14 makes it money and pay, not pay alone. See round 4.]
8. ~~Whether a manager of two houses gets "All houses".~~ Answered (round 5): yes, profit where authorized; access packages to design.

9. ~~Stake and one business: is a co-owner's total the whole house or their share; is an owner of unrelated houses one total?~~ Answered (round 4): whole houses, said so.
10. ~~Readiness: offer "All houses" only when two or more houses can be measured, else a setup list.~~ Answered (round 4).
11. ~~History: a past total counts the houses held now, or the houses held then.~~ Answered (round 4): houses held now.
12. ~~Who may change a group figure's inputs (currency, time zone and goals are manager-writable today).~~ Answered (round 3).
13. ~~A currency with no typed rate, in the popover.~~ Answered (round 6): ECB daily, dated.

Research on 1–8 was asked "for all and more". It runs as parallel research agents, not a Workflow fan-out. Its findings and an adversarial pass come before any of these is put to the founder. [Corrected 2026-10-02, PR #566 gate round 2 (audit at `65ddb2cd2`): true when written. All thirteen were put to him and answered, in rounds 2–6, so this no longer says what comes next. The findings below are kept as written.]

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

- The design question is settled. A build waits on Open 2 above all, because the lead figure is profit, and profit is not computed today. [Corrected 2026-10-02, gate at dde13f0de: stale after round 2, which put sales in the lead. Profit is still not computed. The first finding's money defects still stand, and a group total cannot be trusted until they are fixed.]
- Revisit if owners of a single house ask for the view, or if the research shows that leading with one figure hides a failing house.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Aldemir (founder, voice note + `AskUserQuestion`) + Claude (Opus 5.5; branch `fix/closed-stays-closed`, uncommitted at this row) | Created — direction and audience locked; forks open |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 2) + Claude (Opus 5.5, taking over on a second account; on top of `cc06e8b86`) | Answered Open 1–4; independent adversarial pass folded; forks 9–13 added |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 3) + Claude (Opus 5.5) | Answered Open 5, 6, 12; Open 13 sent to research |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 4) + Claude (Opus 5.5) | Answered Open 7, 9, 10, 11 (7 against the recommendation) |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 5) + Claude (Opus 5.5) | Answered Open 8 (widens the audience to managers of 2+, packages asked); exchange-rate research folded, put back to him |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 6) + Claude (Opus 5.5) | Answered Open 13 and the rate day; ADR 0083 and 0117 bracketed |
| 2026-10-02 | Claude (Opus 5.5; PR #566 gate round, audit at `dde13f0de`) | Corrected in brackets, no decision changed: Open 8 (was "Open 9"); who sees it and what leads, after rounds 2 and 5; the ADR 0147 bracket; Consequences after round 2. Round 4 and Open 7 amended for ADR 0253 F14 (profit needs money and pay). The fx research file marked as outside the repo |
| 2026-10-02 | Claude (Opus 5.5; PR #566 gate round 2, audit at `65ddb2cd2`) | Status line led with the record's true state (Locked, every fork answered, nothing built); the research paragraph's "before any of these is put to the founder" bracketed as stale. No decision changed |
