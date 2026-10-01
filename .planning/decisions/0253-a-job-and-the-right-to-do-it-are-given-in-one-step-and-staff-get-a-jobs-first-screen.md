# 0253 — A job and the right to do it are given in one step, and staff get a jobs-first screen

- **Status:** Locked in part, 2026-10-01: the direction, and where staff work. The rights list, how long a job's right lasts, order limits, late jobs, and what staff see outside their jobs stay open (see Open). Research is in progress. **[2026-10-01, later: four more answered — staff acts closed until given, phone money closed to staff, late jobs go to the person then the giver, and a job's right is the giver's choice of permanent or for this job, with a jobs-or-labels section on /team still to research. See "Answered 2026-10-01 (round 2)".]** **[Later the same day, rounds 5–8: staff see only the rooms their rights open; a manager issues money or send rights only where an owner allowed it (amends ADR 0175 D10); /team gets a Jobs section where being listed is the right; managers get one of three packages, Full / Standard / Light, copied once and shown as adjusted. Still open: the full rights list (Open 1) and the research proposals listed under round 7. Nothing is built.]**
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder).
  - Voice note, 2026-10-01: *"also add a part where managers and owners can authrize tasks to their needed personnel"*.
  - On the direction, `AskUserQuestion` 2026-10-01: *"Both"*, meaning give someone a job and grant the right in the same step.
  - On per-role screens: *"you're going to be take care of how each visual looks like per user Owner -> manager -> staff and what happens when they get more access. more UI needs, it needs to bedynmaic therefore. Staff page will have different UI since they re only going to see what they need and complete certain actions"*.
  - On where staff work: *"Phone app and web (Recommended)"*.
- **Keywords:** people, jobs, tasks, rights, grants, delegation, capabilities, staff screen, per-role UI, owner, manager, staff
- **Links:** sketch [125](../sketches/125-all-houses-people-and-tips/README.md): `people-jobs-and-rights.html`, `people-role-screens.html`. Standing rules this sits on:
  - [[0162-managers-grant-manager-or-staff-on-both-doors]]: managers grant manager or staff.
  - [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]]: pay is the owner's.
  - [[0175-one-tap-from-the-notification-is-staged]] (D10): only an owner lets someone send to a vendor, and each send is sealed.
  - [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]]: area leads act on cards only.
  - [[0238-zone-setup-is-owners-managers-and-the-people-they-assign]]: its Consequences name the capabilities register this needs.

## Context

Measured on `fix/closed-stays-closed` (base `059169a59`), 2026-10-01:

- **Rights are per-person flags, one at a time.** There are two today, `team_pay_access` (ADR 0215) and `zone_setup_access` (ADR 0238). ADR 0238's Consequences say a register of rights starts paying for itself at the second per-person right. That point has been reached.
- **Screens differ by role only by hiding rooms.** The rail hides four rooms by `minRole` (`lib/mudavym/rooms.ts`): Promotions, Vendor prices, Connections and The desk. Only `/receiving` draws three ways by role (`ReceivingNext.tsx:56`). Staff see the manager's pages, minus those rooms.
- **There is no job with a right attached.** The nearest thing is a recommendation card, which can be assigned to a person (`recommendation_actions.assigned_to` / `assigned_at`, ADR 0191). It has no due time and carries no right. No migration creates a task or assignment table for other work (grep of `supabase/migrations`, 2026-10-01).

## Options considered

### How a job and its right relate

1. **Both, in one step.** Giving someone a job offers the missing right in the same sheet, either "just for this job" or "from now on". **Taken — the founder's answer.**
2. **Jobs only.** A job carries no right, and a person without the right cannot finish it. Not taken: the job would stall at the door it was given for.
3. **Rights only.** Rights are granted on their own; jobs come later. Not taken: it leaves the founder's "authorize tasks to their personnel" undone.

### Where staff work

1. **Phone app and web.** **Taken — the founder's answer.**
2. **Phone only.** Not taken.

## Decision

- **A job is a piece of work given to a person.** It says what, where, and by when. The person who gives it is an owner or a manager, within ADR 0162.
- **The right comes with it, in the same step.** If the person lacks a right the job needs, the sheet offers it: "just for this job" or "from now on". A grant never exceeds what the giver may grant (ADRs 0162, 0215, 0175 D10).
- **The server is the gate.** The server refuses what a person may not do. The page only hides what would be refused, and draws what the server says the person may do.
- **Staff get a jobs-first screen, on the phone app and on the web.** It opens on today's jobs and what each needs, not on the manager's pages.
- **The screen grows with the rights.** A new right adds what it needs to the person's screen, and a right that ends takes it away again. Owner, manager and staff screens differ by what each may do, not by a fixed layout per role.

Nothing is built yet.

## Answered 2026-10-01 (round 2)

Asked by `AskUserQuestion` after the people research; his words verbatim.

- **Acts staff do today** (receive at the door, count stock, create orders): *"Closed until given"*. He was told this takes them from every staff member on the day rights ship until someone grants them back, as zone setup did (ADR 0238), and that the recommendation was to leave them open. Consequence for the build: rights cannot ship without a way to grant these on the same day (a preset or a one-step "give everyone who did this last month" is a design question, not decided here).
- **Money on the phone for staff:** *"Close it to staff (Recommended)"*. `GET /mobile/feed` stops serving order amounts, approve cards and revenue to staff; a staff member with a money right sees what that right needs. This is a fix in its own right and need not wait for jobs.
- **Late jobs:** *"Person, then giver (Recommended)"*. A reminder before due; the giver is told once when late; the area lead only if the giver is away; the job is never locked.
- **How long a job's right lasts:** *"the job might be both so make it select, permanent and for this maybe we can in /team add a jobs or labels section where we can identify those people? with that each job could have the potential to add to this person to this job, with a dropdown right? research industry,, use case, test cases find the most plausible smooth route for this"*. Read as: (a) the giver picks **permanent** or **for this job** when granting; (b) `/team` gains a **jobs or labels** section that marks which people do which kind of work; (c) giving a job offers a **dropdown** of people, drawn from those labels. When a "for this job" right ends is not settled by this answer; research on (a)–(c) is owed before it is put back to him.

## Answered 2026-10-01 (round 5)

- **Staff and other rooms:** *"Only what rights open (Recommended)"*. Staff see their jobs, plus any room one of their rights needs; everything else is hidden and the server refuses it.
- **Order limits:** *"Yes, any amount"* — against the recommendation. **It collides with a locked rule:** money and send authority is issued by an owner only (ADR 0175 D10, his words 2026-09-21: *"only an owner issues, any owner revokes"*; ADR 0112 F12 ruling 2). The question asked about a manager setting a staff member's limit, which that rule does not allow; the question carried a wrong premise. Put back to him: does "any amount" mean managers may now issue money rights (superseding the owner-only rule), or that an owner may set any limit?
- **Order limits, re-asked (round 6):** *"managers can give only if the owner accpeted to give access for those actions"*. An owner may let a manager issue money or send rights for named actions; without that, only owners issue. This amends ADR 0175 D10 (bracketed 2026-10-01). Read with round 5's *"Yes, any amount"*, the amount such a manager may grant is not settled; it is designed with the packages.
- **Access packages** (from ADR 0252 round 5): *"come up with pacakgaes to give options, like full access, one low, one more lower"* — to be designed with the jobs-or-labels research.

**Third finding — jobs or labels on /team (Workflow `wf_a21c173e-781`, 2026-10-01: 4 finders, 3 candidate routes, 3 adversarial lenses, 1 judge; all nine verdicts WEAKENED, none killed; code read at the branch base, no tests run; findings `p4-scratch/takeover/houses-scratch/research-jobs-labels.md`).** Recommended route, put back to the founder (not decided here):
- **/team gets a Jobs section**, one row per kind of work that needs a right (Receive deliveries, Count stock, Place orders, Set up zones). Being listed on a row is the right "from now on", per person and house. No separate label list, no template.
- **A job carries its own right on its own object while it is open** — worked out from the open job, never stored. A receive job covers one vendor's truck on one day (an order is one wine), a count job a zone and the zones inside it, an order job a vendor. The right ends when the job is done, cancelled, moved, loses its object, or the person leaves; **never at the due time** (late is a notice, not a lock). Ending a job never touches a permanent right.
- **The dropdown has two groups**, "Does this" and "Everyone else" (each with why). A listed person gets one Give button; anyone else gets **For this job** and **From now on**, neither preselected.
- **Receive is the door count only**; invoice prices stay with owners, managers and grantees (ADR 0175 D9–D10).
- **Place orders closes only after two money holes are fixed**: `PATCH procurement/orders/:id` lets any member approve an order and set its price (re-read on `origin/main` `4bd11a00e`; filed in `.planning/tech-debt.d/2026-10-01-fix-closed-stays-closed.md`), and the create-order merge can overwrite approved orders.
- Four questions from it go to the founder: what being listed means, an offline act from someone never given the right, how day one switches on, and who acts at a shared door tablet.

## Answered 2026-10-01 (round 7) — the jobs-and-labels research's four questions, verbatim

- **What being listed means:** *"Listed means allowed (Recommended)"*. /team's Jobs section has one row per kind of work (Receive deliveries, Count stock, Place orders, Set up zones); being listed is the right from now on, per person and house; no separate label list, no template. A job carries its own right on its object while open, ending when the job ends, never at the due time. The give sheet's dropdown groups "Does this" and "Everyone else"; for someone not listed it offers **For this job** and **From now on**, neither preselected. (This settles Open 2 and the founder's round-2 "make it select, permanent and for this".)
- **An offline act from someone never given the right:** *"Keep until given (Recommended)"*. The server refuses; the phone keeps it as "not sent" naming who can give the work; once given, it goes through by itself (ADR 0241 rule (a)). A job moved away within the last day is booked and its giver told.
- **Day one:** *"Each house answers first (Recommended)"*. Each house's owners or managers answer an unticked "who did this last month" list, person by person or with one deliberate "give all listed"; a house closes only once it has answered.
- **The shared door tablet:** *"Tap name, enter PIN (Recommended)"*. Each person taps their name and a 4-digit PIN and acts as themselves; the tablet returns to the list when idle. Receiving closes only once this is built.

Still to confirm from the research (§8.2, its proposals): Receive is the door count only; Place orders stays open until the two money holes are fixed; a receive job covers one vendor's truck for a day; a job may name a backup; only the giver, an owner or a manager may move or cancel a job.

## Answered 2026-10-01 (round 8) — access packages for managers, verbatim

Asked for in ADR 0252 round 5 (*"come up with pacakgaes to give options, like full access, one low, one more lower"*); proposed and confirmed:
- **The three packages:** *"Yes, as drawn (Recommended)"*.
  - **Full:** "All houses" with profit and pay (owners' wages still hidden, ADR 0215 item 24); may give money and send rights (the owner's allowance of round 6); every job.
  - **Standard:** "All houses" with sales, goals and decisions, no profit or pay; gives receive, count, order and zone rights, not money.
  - **Light:** their own house only; runs jobs and gives receive, count and zone rights there; no money, no pay, no "All houses". A manager with no package gets Light.
- **Adjusting one person:** *"Yes, shown as adjusted (Recommended)"*. A package fills in the rights once; single rights can then be added or removed, and /team shows "Standard, adjusted".
- **Changing a package later:** *"No, you're asked (Recommended)"*. Managers keep what they were given; the owner sees who is on the old version and applies the new one per person.
- **Staff:** *"Jobs list only (Recommended)"*. Packages are for managers; staff rights come from the Jobs rows and from jobs.

## Answered 2026-10-01 (round 9) — the phone's money, after the fix was built

The phone-feed fix (branch `fix/phone-feed-no-money-for-staff`) left three questions the round-2 ruling did not settle:

- **Vendor reply cards:** *"Keep them (Recommended)"*. Staff keep the cards for a drafted letter to a vendor, though its text may name a price; they are letters, which ADR 0175 lets staff hold as a request.
- **A staff member given a right:** *"What they can approve (Recommended)"*. A send right alone shows no money. Once ADR 0175 D7 lets someone given the right approve orders, they see approve cards and amounts only for the orders their right covers.
- **The phone's other money:** *"Close all three (Recommended)"*. The Supply tab's order amounts, the Insights tab's cellar value, and the credit due and unit cost on delivery-difference notices close to staff too: server first, as its own fix.

## Open — the founder's to decide (sketch 125 forks 9–12, 14)

1. **The rights list.** The seven drawn in the sketch, more, or fewer.
2. ~~**"Just for this job".** Does such a right end when the job is done, at a time, or at whichever comes first?~~ Answered (rounds 2 and 7): the giver selects; a job's right ends with the job, never at the due time.
3. **Order limits.** Can a manager set a staff member's limit above their own? Answered (round 6): managers issue money rights only where an owner allowed them; the amount goes with the packages.
4. **Late jobs.** ~~Who is told when a job is late?~~ Answered (round 2).
5. ~~**Staff and other rooms.** Do staff see rooms outside their jobs?~~ Answered (round 5).

Research on these runs as parallel agents, not a Workflow fan-out. The first finished one (access and delegation products, 2026-10-01; scratchpad `ext-C-jit-capability-ui.md`) found:

- **A lapsing right blocks the next request, not work in flight.** Most products do this; Teleport alone documents a switch to cut a live session.
- **Nothing published ties a right to a job's lifecycle.** Single-resource, time-bound grants exist (Teleport, GCP conditions, OpenFGA). Fork 2 is ours to design. Teleport ends a grant at the earliest of several caps, a rule worth copying.
- **Delegates are usually held to the giver's limits.** Toast refuses to grant what you do not hold, and NetSuite and Azure keep the delegator's limits. Ramp has no cap, and its customers are asking for one. Whether the delegate's own cap also applies is split, which is fork 3.
- **The server decides and the page draws.** Products send the allowed actions, check them in batches, and enforce again on every call. This matches "the server is the gate".
- **A right can arrive from two sources.** Ending a job's right must not strip the same right held another way (Salesforce permission sets).
- **A certificate can be a second expiry.** California requires RBS alcohol training within 60 days of hire, valid 3 years. A right that needs it can lapse while the giver's grant is live. No Turkish server certificate was found.

**Second finding (people research, 2026-10-01; code read at `1c1a676f8`, an independent adversarial agent checked it; no tests run).**
- **Staff already do most of the drawn "rights".** Receiving at the door, counting stock and creating orders carry no `@Roles` today (`receiving.controller.ts:245-254`, `procurement.controller.ts:123`). A register that turns them into granted rights takes them away from every staff member on the day it ships, as ADR 0238 did for zone setup. Default-open or default-closed is the founder's call.
- **Approving an order is already ruled owner, manager or grantee** (ADR 0175 D7), but it is unbuilt. Today a staff member can seal an order in a house whose thresholds do not fire (`order-approval-gate.spec.ts:449-457` asserts it; CLAIMS row `ADR-0175-APPROVE-ORDER-ALWAYS-NEEDS-AUTHORITY` is open).
- **The phone shows staff money the web hides.** The Today feed (`GET /mobile/feed`, `mobile.service.ts`) has no role logic. It serves order amounts, approve cards and today's revenue to every member. Re-checked on `origin/main` 2026-10-01.
- **Recommendations (proposals, not decided):**
  - Authority rights (approve, send, money) stay in owner-issued, sealed `authority_grants`. Duty rights (receive, count, zones) go in a record managers can grant, or come from area membership.
  - A money limit is the lowest of the house rule, the person's limit and the giver's own, checked at the act.
  - "Just for this job" rights apply only to acts on the job's object.
  - A job names a person, falling back to whoever is scheduled in the area. A late job is never locked: the giver is told once at due.
  - Navigation follows a coarse list from the server, and every money decision stays a per-object server field.
- **Twenty forks** are listed in the research (scratchpad `research-people-rights.md` §9). The ones that gate a first build are put to the founder first.

## Consequences

- The capabilities register that ADR 0238 forecast becomes the next build. `team_pay_access` and `zone_setup_access` fold into it.
- A staff screen means a second layout to keep honest. Every new right must say what it adds to a screen.
- Revisit when the open forks are answered, or if staff on the web want the manager's pages back.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Aldemir (founder, voice note + `AskUserQuestion`) + Claude (Opus 5.5; branch `fix/closed-stays-closed`, uncommitted at this row) | Created — direction and staff surface locked; forks 9–12 and 14 open; nothing built |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 2) + Claude (Opus 5.5, taking over on a second account; branch `fix/closed-stays-closed` on top of `cc06e8b86`) | Answered — staff acts closed until given, phone money closed to staff, late jobs to person then giver; job right = permanent or for this job, with a /team jobs-or-labels section to research |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 5) + Claude (Opus 5.5) | Answered staff rooms; order-limit answer collides with ADR 0175 D10, re-asked; packages asked |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 6) + Claude (Opus 5.5) | Order limits: owner-allowed manager grants; ADR 0175 bracketed |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 7) + Claude (Opus 5.5) | Jobs-and-labels research folded; its four questions answered (all recommended); PATCH approval hole filed |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 8) + Claude (Opus 5.5) | Manager packages Full / Standard / Light confirmed; copy-once, adjustable, never live; staff use the Jobs list |
