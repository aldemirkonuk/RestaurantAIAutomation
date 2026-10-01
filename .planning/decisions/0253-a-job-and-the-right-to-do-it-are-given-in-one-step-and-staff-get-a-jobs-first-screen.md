# 0253 — A job and the right to do it are given in one step, and staff get a jobs-first screen

- **Status:** Locked in part, 2026-10-01: the direction, and where staff work. The rights list, how long a job's right lasts, order limits, late jobs, and what staff see outside their jobs stay open (see Open). Research is in progress.
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

## Open — the founder's to decide (sketch 125 forks 9–12, 14)

1. **The rights list.** The seven drawn in the sketch, more, or fewer.
2. **"Just for this job".** Does such a right end when the job is done, at a time, or at whichever comes first?
3. **Order limits.** Can a manager set a staff member's limit above their own?
4. **Late jobs.** Who is told when a job is late?
5. **Staff and other rooms.** Do staff see rooms outside their jobs?

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
