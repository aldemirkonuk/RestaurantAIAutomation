---
type: charter
division: advisory
department: red-team
status: new
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[red-team-premortem]]", "[[red-team-agenda-full]]", "[[red-team-agenda-board]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[ORG_STRUCTURE]]", "[[0007-org-structure]]", "[[0006-neural-footprint-architecture]]", "[[0001-mudavym-single-entity]]", "[[foundation-README]]", "[[compliance-privacy-charter]]", "[[research-math-charter]]", "[[skills-charter]]"]
---

# Red Team — Charter

Advisory function. **No parent division** — it sits outside the line by construction
([[ORG_STRUCTURE]] §3). Peer advisory functions: [[architecture-review-charter]],
[[decision-office-charter]].

> **Status: NEW, entirely.** Nothing in this charter describes work that has been done.
> There is no attack queue, no finding format in use, no finding ever filed under this
> name, and no skill in `.claude/skills/` (which contains exactly one tracked file —
> `.claude/skills/README.md`). What *does* exist is the surface: 7 ADRs, 23 open forks,
> and 82 explicit referral lines from 67 other units asking this function to attack
> something specific. The function is unbuilt; the queue is not.

## Mandate

Red Team is accountable for **attacking the reasoning behind decisions before reality
does it for free**. It selects a decision — locked, open, or undeclared — reconstructs
what would have to be true for it to be correct, tests those conditions against evidence
that exists rather than evidence that was assumed, and files a finding that says what
would break it and what to do next. It also runs premortems: the same operation applied
forward, against a plan that has not failed yet.

Its scope was narrowed deliberately by the founder ([[ORG_STRUCTURE]] §3,
`ORG_STRUCTURE.md:61`; [[0007-org-structure]], `0007-org-structure.md:45`) to *decisions
and premortem thinking* — not general security testing. That narrowing is the charter's
most important sentence and §Explicit non-goals below holds the line on it.

**The distinction that governs everything here: Security attacks *systems*. Red Team
attacks *reasoning*.** An unguarded controller is a system defect and belongs to
[[security-charter]]. *The reasoning that let 94 routes go unguarded by omission while the
org believed itself covered* is a decision defect and belongs here.

Two obligations sit alongside the attack itself, because a finding nobody can act on is
not a finding:

1. **Navigability.** The founder's stated requirement is that this function's output
   *"make 'what's next' easy to navigate"* (`ORG_STRUCTURE.md:61`). Every finding names
   the decision, the owner, the falsifier, and the single next action. A finding without
   a next step is rejected by this function before it leaves it.
2. **The record.** An attack that ends in *"the decision stands"* is a success, not a
   wasted cycle, **provided the argument is written down**. [[0001-mudavym-single-entity]]
   is the template: the one-entity decision was challenged, argued against in detail, and
   reaffirmed — and the reaffirmation is worth more than the original lock because the
   counter-argument is now on the record (`0001-mudavym-single-entity.md:50`).

## How a target is selected

**An attacker with no queue attacks nothing.** This section is the operational core of the
charter, not an appendix. The full graph is in [[red-team-directive]]; the selection rule
is here because it defines what the function *is*.

### Four intake channels

| # | Channel | Source | Volume today |
|---|---|---|---|
| **C1** | **Newly locked decisions** | `decisions/NNNN-*.md` reaching `Status: Locked` | 7 ADRs, all locked 2026-08-24 |
| **C2** | **The open-fork register** | `decisions/OPEN-DECISIONS.md` | **23 open** items (measured 2026-08-24; the file is being appended to by parallel sessions as this is written) |
| **C3** | **Referrals from the line** | Any unit naming `[[red-team-charter]]` in a premortem, directive, or loop `outputs_to` | **82 referral lines across 67 units** — before this function has filed one finding |
| **C4** | **Undeclared decisions** | Prose that decides something without an ADR or OD id. Detected by sweep, not submitted | Unknown. First sweep is [[red-team-loops]] L-RT-3 |

C4 is the channel nobody else has. C1–C3 are decisions that *announced themselves*.
[[decision-office-charter]] owns the register of those. The decisions that hurt are the
ones made inside a paragraph — a threshold chosen, a denominator picked, a default set —
that never became an entry anywhere. **Finding those is this function's least substitutable
job**, and the evidence that the channel is real is already on disk: eight decision-shaped
items (`OD-C1`–`OD-C8`) were staged inside Corporate's unit documents and never reached
`OPEN-DECISIONS.md`; `OD-C5` alone is referenced 38 times in documents that treat it as a
live fork the register has never heard of.

### The selection rule

Targets are scored, not queued in arrival order. Arrival order privileges whoever writes
most, which is the opposite of what an attacker should optimise for.

```
priority  =  irreversibility  ×  blast_radius  ×  (1 − evidence_strength)  ×  freshness
```

| Factor | Reads | Why it is in the product |
|---|---|---|
| **irreversibility** | Can this be unwound next quarter, and at what cost? | A reversible decision attacked late is a memo. An irreversible one attacked late is an autopsy |
| **blast_radius** | How many units, documents, or dollars inherit this if it is wrong? | ADR 0007 is inherited by 693 documents; OD-14 is inherited by one filename |
| **evidence_strength** | Does a `path:line` exist, or was this chartered against nothing? | The zero-evidence decisions are where attacking is cheapest and highest-yield |
| **freshness** | Days since lock, inverted, with a floor | Attacking within the window where unwinding is still cheap is the whole point |

Three standing overrides sit on top of the score, because a pure score has known failure
modes:

- **O1 — Newest lock first, inside a window.** Every decision reaching `Locked` is attacked
  within **7 days** ([[red-team-loops]] L-RT-1), regardless of score. This is the only
  period in which "we should not have decided that" is cheap. After 7 days the decision
  falls back to the score like everything else.
- **O2 — Oldest unresolved fork, one per cycle.** The highest-scoring item wins every time
  under a pure score, so the same three forks would be attacked forever and the rest would
  age out unexamined. One slot per cycle is reserved for the **oldest** open fork that has
  never been attacked. Fairness backstop, not fairness for its own sake: an item nobody
  will attack is an item nobody will resolve.
- **O3 — One founder-locked decision per cycle, mandatory.** See [[red-team-premortem]] M2.
  A red team that only attacks unowned NEW units is decorative. A cycle that produces zero
  attacks on a decision the founder personally locked is itself a recorded finding.

### The attack budget

**At most 7 open findings at any time.** This is a WIP limit, and it is the single
structural counter-pressure against [[red-team-premortem]] M1 (the objection machine).
The cap forces the score to do real work: to open finding #8, one of the seven must close.
A function that can file unlimited objections will, and the eighth objection is what
teaches every decision owner to stop reading the first seven.

## Boundaries

Owns outright:

- **The attack queue** — the scored target list, its four intake channels, and the
  standing overrides above. Nobody else sets this function's targets, including the units
  that referred them (see [[red-team-premortem]] M4).
- **The finding format** — what a finding must contain to be one: named decision, named
  owner, the reconstructed *what-would-have-to-be-true*, the evidence actually found, the
  falsifier, and the single next action. Findings not meeting the format do not ship.
- **The premortem standard** — the shape every unit's `premortem.md` is held to:
  concrete mechanisms, an *earliest observable signal* per mechanism, and a specific
  counter-pressure rather than a caution. Red Team does not write other units' premortems;
  it attacks them and facilitates the ones that ask.
- **The reaffirmation record** — when an attack fails and the decision stands, the
  argument is written into that decision's review trail. This is a durable asset:
  `0001-mudavym-single-entity.md:50` is worth more than the original ADR body.
- **The undeclared-decision sweep** — C4 above.
- **Its own honesty metrics** — `rt.reaffirmation_rate` and `rt.self_selected_target_share`
  exist to catch this function failing, and Red Team publishes them against itself.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Security testing of any kind** — endpoint sweeps, the §12C checklist, `TenantGuard` semantics, the `@Public()` allowlist, webhook signature verification, the prompt-injection corpus, denial-of-wallet controls | [[security-charter]] and its three teams | **Founder-scoped, explicitly** (`ORG_STRUCTURE.md:61`, `0007-org-structure.md:45`): *"not a general security-testing function — Security builds defenses in the line."* Security **attacks systems**; Red Team **attacks reasoning**. We do not run scans, do not classify routes, do not own OD-19, and do not grade controls. If a Red Team document ever cites a controller's `path:line` as its subject rather than as evidence about a *decision*, that document is a defect — see [[red-team-premortem]] M5 |
| **The ADR log, the open-fork register, and loop close-time tracking** | [[decision-office-charter]] | The Decision Office keeps the books and makes decisions *close*. Red Team makes them *hurt first*. We file into their register; we do not maintain it |
| **The L0–L6 layer-dependency rule** | [[architecture-review-charter]] | A layer violation is a structural defect in a build, not a defect in a reason |
| **Blocking, approving, or vetoing anything** | The **founder** | Advisory authority is **findings-only** and locked ([[0007-org-structure]] §Decision, OD-16). Findings land in the reviewed unit's `questions.md` and, where a decision is implied, in `OPEN-DECISIONS.md`. Nothing stops. The known risk of this — findings acknowledged and deferred forever — is named in `0007-org-structure.md:74-76` and carried here as [[red-team-premortem]] M3 |
| **Writing other units' premortems** | Each unit | A premortem written by the reviewer is a review. The unit must be able to state its own failure mode ([[ORG_STRUCTURE]] §4) — that is the point of the artifact |
| **Ethics and agent-autonomy limits** | [[compliance-privacy-charter]] | Ethics & Responsible AI was considered and **not adopted** as advisory (`0007-org-structure.md:40`); that scope sits in the line. Red Team attacks the *decisions* Compliance makes — it does not hold the ethics mandate itself |
| **Deciding anything** | The founder | An attacker who also decides is not attacking; they are negotiating with themselves |

## Metrics it moves

| Metric | Reads | Alarm |
|---|---|---|
| `rt.finding_return_hours` | Hours from attack complete → finding in the owner's `questions.md` | > 72h. See [[red-team-loops]] L-RT-2 |
| `rt.locked_decision_challenge_rate` | Share of newly locked decisions attacked inside the 7-day window | < 100%. There are 7 ADRs; the window is the cheap moment and it does not recur |
| `rt.reaffirmation_rate` | Share of attacks ending "decision stands unchanged" | **Both tails.** → 100% means politeness (M2); → 0% means the function is contrarian rather than analytic. Neither number is good alone, which is why it is reported beside `rt.finding_actionability` |
| `rt.finding_actionability` | Share of findings carrying a named owner **and** a single named next action | < 100%. The founder's navigability requirement, made countable |
| `rt.open_finding_age_days` | Median age of open findings | > 30 days → the finding auto-escalates to `OPEN-DECISIONS.md` (L-RT-6). This is the mechanical answer to `0007-org-structure.md:74-76` |
| `rt.undeclared_decision_count` | Decisions found in prose with no ADR or OD id | Trend, not threshold. Rising with a flat register means the register is fiction |
| `rt.self_selected_target_share` | Self-selected targets ÷ all targets | < 60% → the function has become a referral service desk (M4) |
| `nf_a.doneability_verdict` | On any attack run by an agent under a skill | NF-A is unemitted today (foundation README §1, L4: *"emits nothing yet"*) — recorded as a dependency, not a reading |

## Evidence today

**Grade: NEW — entirely, without qualification.** No part of this function exists as
practice. What follows separates *the function* (NEW) from *the surface it attacks*
(EXISTS), because conflating them is how a NEW unit gets dressed up as a live one.

### The function itself — NEW

| Item | Grade | Citation |
|---|---|---|
| Red Team as a chartered advisory function | **NEW** | `ORG_STRUCTURE.md:61`, `0007-org-structure.md:45`. Adopted 2026-08-24 (OD-15). Charter text only |
| Findings-only authority | **NEW** (locked, unexercised) | `0007-org-structure.md:48-52`; OD-16 in `OPEN-DECISIONS.md` Resolved table |
| Attack queue, finding format, premortem standard | **NEW** | Do not exist. Defined for the first time in this document and [[red-team-directive]] |
| Skills | **NEW** | `.claude/skills/` contains one tracked file, `README.md`. `git ls-files` returns **zero** `SKILL.md` in the repo (foundation README §3.1). Nothing this function proposes is built |
| Findings filed to date | **NEW — zero** | No unit has a `questions.md`. The word appears twice in the whole corpus, both times defining the convention (`ORG_STRUCTURE.md:67`, `0007-org-structure.md:49`), never as a file |

### The surface it attacks — EXISTS

| Item | Grade | Citation |
|---|---|---|
| Locked decisions available to attack | **EXISTS** | 7 ADRs in `.planning/decisions/`, all dated 2026-08-24 |
| Open forks available to attack | **EXISTS** | **23** rows in `OPEN-DECISIONS.md` §Open. Note: `decisions/README.md:45` says *"Currently 8 items"* — the index is stale by 15 against its own register, which is itself a target (see [[red-team-agenda-full]] T6) |
| Inbound referrals | **EXISTS** | **82 lines across 67 units** naming `[[red-team-charter]]` as the attacker of a specific mechanism — e.g. `platform/data/data-premortem.md:141`, `intelligence/research-math/teams/harness-model-routing/harness-model-routing-premortem.md:144`, `corporate/compliance-privacy/compliance-privacy-directive.md:68` |
| Precedent for challenge-and-reaffirm | **EXISTS** | `0001-mudavym-single-entity.md:50` — the two-company proposal argued in full and declined; the argument survives in the review trail |
| Precedent for a contrary recommendation on record | **EXISTS** | `0007-org-structure.md:84-88` — Claude proposed 9 departments and a Sales/Growth merge; the founder overruled; **both** are recorded. This is what a healthy attack looks like when it loses |
| Precedent for an argued gate | **EXISTS** | `0006-neural-footprint-architecture.md:80-83` — NF-C argued down from a v0 schema participant to a gated research track |

### The worked example — PARTIAL, and instructive precisely because it is not closed

An independent review agent found `apps/api-gateway/src/analytics/analytics.controller.ts`
carrying **zero** `@UseGuards` and **zero** `@Public()` — unguarded by omission. Combined
with `TenantGuard` returning `true` for unauthenticated requests by design
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`), anonymous callers can
`PUT /analytics/consultants/:restaurantId/toggle` to enable the paid consultant layer and
then drive `claude-opus-4-8` against the founder's own API key
(`apps/api-gateway/src/analytics/consultants.service.ts:28,156`). Recorded as OD-20,
flagged 🔴 in `foundation/README.md`.

**Correction to the brief that commissioned this unit: it is not fixed.** PR **#31**
(`fix/analytics-endpoint-auth`, *"fix(security): guard analytics routes — unauthenticated
paid-LLM access"*) is **OPEN and unmerged** as of 2026-08-24, and `main` still shows no
guard on that controller. Verified by `gh pr view 31` and
`git show main:apps/api-gateway/src/analytics/analytics.controller.ts`.

That correction is the more useful half of the example. The *system* defect belongs to
[[security-charter]]. The *reasoning* defects are ours, and there are three:

1. **A whole class of route was secured by each author remembering**, with a guard that
   fails open as the backstop. That is a decision, made somewhere, never recorded.
2. **"Found and fixed" was believed** while the fix sat unmerged. A finding that is
   authored is not a finding that has landed — and this is exactly [[red-team-premortem]]
   M3 happening to the function's own founding anecdote, before the function exists.
3. **The distance between OD-20's "Founder call — urgent"** and an open PR is the
   real measurement of findings-only authority. `rt.open_finding_age_days` exists to make
   that distance a number rather than an impression.

### What this evidence does not support

This charter cannot claim a hit rate, a calibration, or a track record. It has none. The
honest statement is: **the function is a hypothesis** — that a scored queue, a 7-finding
cap, a 72-hour return, and a mandatory attack on the founder's own locks will produce
signal rather than noise. [[red-team-premortem]] is where that hypothesis is attacked, and
the first thing this function should do once it exists is attack this charter.

## Entry and exit triggers

- **Entry: already met.** Seven locked decisions and 23 open forks are enough surface. No
  further trigger is required.
- **Exit — the merge condition, decided now while nobody is invested in it.** The corpus
  names split triggers in **15** documents and merge triggers in **3** (measured
  2026-08-24; `OPEN-DECISIONS.md` OD-26 recorded 11 and 3 a few hours earlier — *the
  asymmetry widened while the fork sat open*). Writing a split trigger without a merge
  trigger is the ratchet OD-26 describes, so this charter carries the reverse condition:

  > **If, at the second quarterly review, Red Team has filed fewer than 6 findings, or
  > `rt.finding_actionability` is below 80%, or `rt.reaffirmation_rate` is 100% across all
  > attacks, this function folds into [[decision-office-charter]] as a standing
  > "challenge" step in the ADR process, and this charter is rewritten to say so.**

  Each of those three is a different failure ([[red-team-premortem]] M4, M1, M2
  respectively). Any one of them means the independent function is not earning its
  separation from the Decision Office.
