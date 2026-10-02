# 0253 — A job and the right to do it are given in one step, and staff get a jobs-first screen

- **Status:** Locked in part, 2026-10-01: the direction, and where staff work. The rights list, how long a job's right lasts, order limits, late jobs, and what staff see outside their jobs stay open (see Open). Research is in progress. **[2026-10-01, later: four more answered — staff acts closed until given, phone money closed to staff, late jobs go to the person then the giver, and a job's right is the giver's choice of permanent or for this job, with a jobs-or-labels section on /team still to research. See "Answered 2026-10-01 (round 2)".]** **[Later the same day, rounds 5–8: staff see only the rooms their rights open; a manager issues money or send rights only where an owner allowed it (amends ADR 0175 D10); /team gets a Jobs section where being listed is the right; managers get one of three packages, Full / Standard / Light, copied once and shown as adjusted. Still open: the full rights list (Open 1) and the research proposals listed under round 7. Nothing is built.]** [Corrected 2026-10-02, gate at dde13f0de: "issues money or send rights only where an owner allowed it" and "amends ADR 0175 D10" are this ADR's reading of his round-6 free text, quoted under round 5. The forks still open are filed as OD-208 (OPEN-DECISIONS.md:284) to OD-217 (OPEN-DECISIONS.md:293).] [Confirmed 2026-10-02 (round 12): the founder confirmed that reading, per action, so the amendment to ADR 0175 D10 is his. Round 12 also answered OD-209 (OPEN-DECISIONS.md:285), OD-210 (OPEN-DECISIONS.md:286) and OD-217 (OPEN-DECISIONS.md:293). Still open: OD-208 (OPEN-DECISIONS.md:284), and OD-211 (OPEN-DECISIONS.md:287) to OD-216 (OPEN-DECISIONS.md:292).]
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder).
  - Voice note, 2026-10-01: *"also add a part where managers and owners can authrize tasks to their needed personnel"*.
  - On the direction, `AskUserQuestion` 2026-10-01: *"Both"*, meaning give someone a job and grant the right in the same step.
  - On per-role screens: *"you're going to be take care of how each visual looks like per user Owner -> manager -> staff and what happens when they get more access. more UI needs, it needs to bedynmaic therefore. Staff page will have different UI since they re only going to see what they need and complete certain actions"*.
  - On where staff work: *"Phone app and web (Recommended)"*.
- **Keywords:** people, jobs, tasks, rights, grants, delegation, capabilities, staff screen, per-role UI, owner, manager, staff
- **Links:** sketch [125](../sketches/125-all-houses-people-and-tips/README.md): `people-jobs-and-rights.html`, `people-role-screens.html`. [Corrected 2026-10-02, gate at dde13f0de: sketch 125's folder is on PR #573 (open) and sketch 126's on PR #574 (open), not on main, so their links resolve only there.] Standing rules this sits on:
  - [[0162-managers-grant-manager-or-staff-on-both-doors]]: managers grant manager or staff.
  - [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]]: pay is the owner's.
  - [[0175-one-tap-from-the-notification-is-staged]] (D10): only an owner lets someone send to a vendor, and each send is sealed. [Amended by this ADR, rounds 6 and 12 (confirmed 2026-10-02): an owner may also allow a manager to give the send right, action by action. Each send is still sealed.]
  - [[0218-an-alert-finds-its-area-first-a-lead-acts-on-cards-only-and-away-is-dates]]: area leads act on cards only.
  - [[0238-zone-setup-is-owners-managers-and-the-people-they-assign]]: its Consequences name the capabilities register this needs.

## Context

Measured on `fix/closed-stays-closed` (base `059169a59`), 2026-10-01: [Corrected 2026-10-02, gate at dde13f0de: the base was not `059169a59`. The figures below hold at `1c1a676f8` (#560) and at `4bd11a00e` (#563, where this branch forked): `ReceivingNext.tsx:56` is `type Rendering = 'staff' | 'manager' | 'owner';`, and `rooms.ts` gives four rooms a `minRole`. At `059169a59` it gave three; Promotions had none.]

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
- **The right comes with it, in the same step.** If the person lacks a right the job needs, the sheet offers it: "just for this job" or "from now on". A grant never exceeds what the giver may grant (ADRs 0162, 0215, 0175 D10). [Corrected 2026-10-02, gate at dde13f0de: this is not his answer. In round 5 he picked *"Yes, any amount"* against *"No, capped at theirs (Recommended)"*. Round 6's free text settled who may give, not how much. Filed as OD-209 (OPEN-DECISIONS.md:285).] [Answered 2026-10-02 (round 12), OD-209 (OPEN-DECISIONS.md:285): *"Owner sets the cap (Recommended)"*. With the allowance, the owner says up to how much a manager may give, and it may be higher than the manager's own limit. So a manager's grant is capped by the owner's allowance, not by the manager's own limit.]
- **The server is the gate.** The server refuses what a person may not do. The page only hides what would be refused, and draws what the server says the person may do.
- **Staff get a jobs-first screen, on the phone app and on the web.** It opens on today's jobs and what each needs, not on the manager's pages.
- **The screen grows with the rights.** A new right adds what it needs to the person's screen, and a right that ends takes it away again. Owner, manager and staff screens differ by what each may do, not by a fixed layout per role.

Nothing is built yet. [Corrected 2026-10-01: true when written. Round 2's phone-money ruling is now built on two open PRs, #582 and #583 (see the fix-rounds section below). The jobs, the rights given with them and the jobs-first screens are not built.]

## Answered 2026-10-01 (round 2)

Asked by `AskUserQuestion` after the people research; his words verbatim.

- **Acts staff do today** (receive at the door, count stock, create orders): *"Closed until given"*. He was told this takes them from every staff member on the day rights ship until someone grants them back, as zone setup did (ADR 0238), and that the recommendation was to leave them open. Consequence for the build: rights cannot ship without a way to grant these on the same day (a preset or a one-step "give everyone who did this last month" is a design question, not decided here).
- **Money on the phone for staff:** *"Close it to staff (Recommended)"*. `GET /mobile/feed` stops serving order amounts, approve cards and revenue to staff; a staff member with a money right sees what that right needs. This is a fix in its own right and need not wait for jobs.
- **Late jobs:** *"Person, then giver (Recommended)"*. A reminder before due; the giver is told once when late; the area lead only if the giver is away; the job is never locked.
- **How long a job's right lasts:** *"the job might be both so make it select, permanent and for this maybe we can in /team add a jobs or labels section where we can identify those people? with that each job could have the potential to add to this person to this job, with a dropdown right? research industry,, use case, test cases find the most plausible smooth route for this"*. Read as: (a) the giver picks **permanent** or **for this job** when granting; (b) `/team` gains a **jobs or labels** section that marks which people do which kind of work; (c) giving a job offers a **dropdown** of people, drawn from those labels. When a "for this job" right ends is not settled by this answer; research on (a)–(c) is owed before it is put back to him.

## Answered 2026-10-01 (round 5)

- **Staff and other rooms:** *"Only what rights open (Recommended)"*. Staff see their jobs, plus any room one of their rights needs; everything else is hidden and the server refuses it.
- **Order limits:** *"Yes, any amount"* — against the recommendation. **It collides with a locked rule:** money and send authority is issued by an owner only (ADR 0175 D10, his words 2026-09-21: *"only an owner issues, any owner revokes"*; ADR 0112 F12 ruling 2). The question asked about a manager setting a staff member's limit, which that rule does not allow; the question carried a wrong premise. Put back to him: does "any amount" mean managers may now issue money rights (superseding the owner-only rule), or that an owner may set any limit?
- **Order limits, re-asked (round 6):** *"managers can give only if the owner accpeted to give access for those actions"*. An owner may let a manager issue money or send rights for named actions; without that, only owners issue. This amends ADR 0175 D10 (bracketed 2026-10-01). [Corrected 2026-10-02, gate at dde13f0de: the previous two sentences are this ADR's reading, not his words. His words are only the free text above. They answered a question that offered "Owner sets any limit (Recommended)", "Managers give money too" and "Managers, up to theirs". "For named actions" (for his "those actions") and the amendment to ADR 0175 D10 are how this record reads them; the question itself named "money or send rights". He has not confirmed that reading.] Read with round 5's *"Yes, any amount"*, the amount such a manager may grant is not settled; it is designed with the packages. [Confirmed 2026-10-02 (round 12): he confirmed the reading, per action, and the owner sets the amount with the allowance. See round 12 below.]
- **Access packages** (from ADR 0252 round 5): *"come up with pacakgaes to give options, like full access, one low, one more lower"* — to be designed with the jobs-or-labels research.

**Third finding — jobs or labels on /team (Workflow `wf_a21c173e-781`, 2026-10-01: 4 finders, 3 candidate routes, 3 adversarial lenses, 1 judge; all nine verdicts WEAKENED, none killed; code read at the branch base, no tests run; findings `p4-scratch/takeover/houses-scratch/research-jobs-labels.md`, outside the repo, so not re-checkable from it).** Recommended route, put back to the founder (not decided here):
- **/team gets a Jobs section**, one row per kind of work that needs a right (Receive deliveries, Count stock, Place orders, Set up zones). Being listed on a row is the right "from now on", per person and house. No separate label list, no template.
- **A job carries its own right on its own object while it is open** — worked out from the open job, never stored. A receive job covers one vendor's truck on one day (an order is one wine), a count job a zone and the zones inside it, an order job a vendor. The right ends when the job is done, cancelled, moved, loses its object, or the person leaves; **never at the due time** (late is a notice, not a lock). Ending a job never touches a permanent right.
- **The dropdown has two groups**, "Does this" and "Everyone else" (each with why). A listed person gets one Give button; anyone else gets **For this job** and **From now on**, neither preselected.
- **Receive is the door count only**; invoice prices stay with owners, managers and grantees (ADR 0175 D9–D10).
- **Place orders closes only after two money holes are fixed**: `PATCH procurement/orders/:id` lets any member approve an order and set its price (re-read on `origin/main` `4bd11a00e`; filed in `.planning/tech-debt.d/2026-10-01-fix-closed-stays-closed.md`), and the create-order merge can overwrite approved orders. [Corrected 2026-10-02, gate at dde13f0de: that tech-debt file exists only on the local branch `fix/closed-stays-closed`, not on origin. The PATCH hole is being fixed on PR #577 (open). This proposal is OD-213 (OPEN-DECISIONS.md:289).] [Corrected 2026-10-02, PR #566 gate round 2 (audit at `65ddb2cd2`): #577 (open, `d7ea20cb7`) fixes the merge too, as ADR 0254 rule 3: a new request folds only into a PENDING or NEGOTIATING order, else starts a second order. Left after it: rule 4 (moving an order off APPROVED needs an owner, a manager or a grantee), ruled, not built; and the two-edit reprice, `PATCH {status: "NEGOTIATING"}` then a price PATCH, which rule 4 puts behind the same people. OD-213 (OPEN-DECISIONS.md:289) is corrected to match.]
- Four questions from it go to the founder: what being listed means, an offline act from someone never given the right, how day one switches on, and who acts at a shared door tablet.

## Answered 2026-10-01 (round 7) — the jobs-and-labels research's four questions, verbatim

- **What being listed means:** *"Listed means allowed (Recommended)"*. /team's Jobs section has one row per kind of work (Receive deliveries, Count stock, Place orders, Set up zones); being listed is the right from now on, per person and house; no separate label list, no template. A job carries its own right on its object while open, ending when the job ends, never at the due time. The give sheet's dropdown groups "Does this" and "Everyone else"; for someone not listed it offers **For this job** and **From now on**, neither preselected. (This settles Open 2 and the founder's round-2 "make it select, permanent and for this".) [Corrected 2026-10-02, gate at dde13f0de: this bullet overstates what he picked. The option's text was: "Being listed means they may do that work from now on. With one list, "who does it" and "who may do it" can never disagree. Giving a job to someone not listed asks: for this job, or from now on?" The rest of the bullet is the research's proposal, not his answer: the four rows, a job's right on its object ending with the job and never at the due time, the two dropdown groups, and nothing preselected. It settles round 2's "select". It does not settle when a "for this job" right ends, which is OD-211 (OPEN-DECISIONS.md:287).]
- **An offline act from someone never given the right:** *"Keep until given (Recommended)"*. The server refuses; the phone keeps it as "not sent" naming who can give the work; once given, it goes through by itself (ADR 0241 rule (a)). A job moved away within the last day is booked and its giver told.
- **Day one:** *"Each house answers first (Recommended)"*. Each house's owners or managers answer an unticked "who did this last month" list, person by person or with one deliberate "give all listed"; a house closes only once it has answered.
- **The shared door tablet:** *"Tap name, enter PIN (Recommended)"*. Each person taps their name and a 4-digit PIN and acts as themselves; the tablet returns to the list when idle. Receiving closes only once this is built.

Still to confirm from the research (§8.2, its proposals): Receive is the door count only; Place orders stays open until the two money holes are fixed; a receive job covers one vendor's truck for a day; a job may name a backup; only the giver, an owner or a manager may move or cancel a job. [Filed 2026-10-02 as OD-212 (OPEN-DECISIONS.md:288), OD-213 (OPEN-DECISIONS.md:289), OD-214 (OPEN-DECISIONS.md:290), OD-215 (OPEN-DECISIONS.md:291) and OD-216 (OPEN-DECISIONS.md:292), in that order.]

## Answered 2026-10-01 (round 8) — access packages for managers, verbatim

Asked for in ADR 0252 round 5 (*"come up with pacakgaes to give options, like full access, one low, one more lower"*); proposed and confirmed:
- **The three packages:** *"Yes, as drawn (Recommended)"*.
  - **Full:** "All houses" with profit and pay (owners' wages still hidden, ADR 0215 item 24); may give money and send rights (the owner's allowance of round 6); every job. [Confirmed 2026-10-02 (round 12): round 8's option text did not carry the allowance. Round 12's first answer does, for every manager: an owner allows each money or send action separately, and without that only owners give them. The amount is the owner's cap, OD-209 (OPEN-DECISIONS.md:285).]
  - **Standard:** "All houses" with sales, goals and decisions, no profit or pay; gives receive, count, order and zone rights, not money. [Noted 2026-10-02, gate at dde13f0de: whether the "order" right is a money right, which round 6 lets a manager give only where an owner allowed it, is OD-210 (OPEN-DECISIONS.md:286).] [Answered 2026-10-02 (round 12), OD-210 (OPEN-DECISIONS.md:286), path (B): *"No amount of its own (Recommended)"*. Its text: "Standard's order right lets someone place orders, but the house's approval rule decides every amount. So it stays a non-money right, as round 8 says. Until approvals are built, orders wait for an owner or manager."]
  - **Light:** their own house only; runs jobs and gives receive, count and zone rights there; no money, no pay, no "All houses". A manager with no package gets Light. [Amended 2026-10-02, gate at dde13f0de: round 11's F2 (*"Every package turns it on (Recommended)"*) turns the money right on for every package. Its option text: "Light, too. Light's "no money" means it gives no money rights." So a Light manager sees the house's money unless an owner takes it.] [Added 2026-10-02, PR #566 gate round 2 (audit at `65ddb2cd2`): "unless an owner takes it" is narrower than round 11. F4 (*"Owners + allowed Full managers"*) lets a Full manager an owner allowed take it too, and F9 (*"Resets to the new role (Recommended)"*) resets it when the person's role changes.]
- **Adjusting one person:** *"Yes, shown as adjusted (Recommended)"*. A package fills in the rights once; single rights can then be added or removed, and /team shows "Standard, adjusted".
- **Changing a package later:** *"No, you're asked (Recommended)"*. Managers keep what they were given; the owner sees who is on the old version and applies the new one per person.
- **Staff:** *"Jobs list only (Recommended)"*. Packages are for managers; staff rights come from the Jobs rows and from jobs.

## Answered 2026-10-01 (round 9) — the phone's money, after the fix was built

The phone-feed fix (branch `fix/phone-feed-no-money-for-staff`) left three questions the round-2 ruling did not settle:

- **Vendor reply cards:** *"Keep them (Recommended)"*. Staff keep the cards for a drafted letter to a vendor, though its text may name a price; they are letters, which ADR 0175 lets staff hold as a request.
- **A staff member given a right:** *"What they can approve (Recommended)"*. A send right alone shows no money. Once ADR 0175 D7 lets someone given the right approve orders, they see approve cards and amounts only for the orders their right covers.
- **The phone's other money:** *"Close all three (Recommended)"*. The Supply tab's order amounts, the Insights tab's cellar value, and the credit due and unit cost on delivery-difference notices close to staff too: server first, as its own fix.

## Answered 2026-10-01 (fix rounds of the phone-feed fix) — the wage notice and a grantee's own limit, verbatim

These were asked by `AskUserQuestion` from the coordinating session while the phone-feed fix was built, after round 9. His answers are verbatim.

- **Staff notices.**
  - **Asked:** "Staff schedule, broadcast, note and Away notices share one notice type with the own-wage notice, so on staff phones those cards now show only their title. Fix that?"
  - **Answer:** *"Give wages its own type (Recommended)"*. Rejected: "Keep titles only".
  - **What it means:** the own-wage notice is stored under its own type, `team_member_own_wage_set`. So `system` notices show staff their sentence on the Today feed again. A wage notice written before the change is still blanked for staff, by its metadata.
  - **Built on:** `fix/phone-feed-no-money-for-staff` (PR #582, open).
- **A grantee's own limit.**
  - **Asked:** "A staff member given a money right (for example "approve up to 500 USD") gets a notice. Should their phone card show their own limit?"
  - **Answer:** *"Show their own limit (Recommended)"*. The recommended option was described as "Fits your earlier answer that staff see what they can approve. It is their own figure, not the house's money." Rejected: "Keep it off, as built".
- **How the feed knows whose grant it is.**
  - **Asked:** once the build found that a grant notice did not record whose grant it was.
  - **Answer:** *"Record the grantee (Recommended)"*. Rejected:
    - "Look it up each load". It covers older notices, but every feed read hits the grants table, and a deleted grant reads as not yours.
    - "Leave it".
  - **What it means:** new grant notices record the grantee. The Today feed shows an issued or re-approved grant's sentence to someone who does not see the house's money only when they are that grantee. Notices written before the change never show the limit there.
  - **Built on:** `fix/phone-feed-own-grant-limit` (PR #583, open), stacked on #582.

**How this fits round 9's "a send right alone shows no money".** Round 9 answered what a staff member given a right sees of the house's money on the feed: order amounts, approve cards and revenue. A send right alone still shows none of these. The own limit is a different figure: the bound of the grantee's own right, in the notice that tells them they hold it. The question was asked after round 9 and named that answer ("Fits your earlier answer…"). So the two read together: a grantee sees their own limit in their own grant notice, and nothing more of the house's money until ADR 0175 D7's approval exists. It also matches round 2's "a staff member with a money right sees what that right needs". *This reading is recorded, not separately confirmed. If the founder reads "shows no money" to cover a grantee's own limit, the stacked branch's gate is the one line to remove.* [Corrected 2026-10-02, gate at dde13f0de: round 11's F3 (*"Keep the narrow view (Recommended)"*) since confirmed the own limit. Its option text also gave amounts on "orders they may approve or place", which goes further than "nothing more" here. Filed as OD-217 (OPEN-DECISIONS.md:293).] [Answered 2026-10-02 (round 12), OD-217 (OPEN-DECISIONS.md:293), path (A): *"As F3 said (Recommended)"*. Its text: "They see amounts on the orders they may place or approve, plus their own limit. Nothing else of the house's money." So the reading above, "nothing more of the house's money until ADR 0175 D7's approval exists", does not hold for the orders they may place or approve.]

**Not covered by these answers.** The grant notice's full sentence still reaches every recipient on both Notifications screens and on the live `notification:new` event. That includes an owner who is later demoted. Grant notices are `low`, so they are never pushed. These are filed as open items 2 and 3 in `tech-debt.d/2026-10-01-fix-phone-feed-no-money-for-staff.md`. [Corrected 2026-10-02, gate at dde13f0de: that file is on PR #582's branch (open), not on main.]

## Answered 2026-10-01 (round 10) — who sees the house's money in notices, verbatim

Asked by `AskUserQuestion` after the phone-feed fix (#582) was opened. Its open item 3 (push and the live `notification:new` event) and item 2 (both Notifications screens) still carry money to staff: invoice totals, delivery credit due, goal figures and tonight's revenue.

- **Should the feed's rule cover them?**
  - **Answer:** *"owners and managers get it and some authorized staff this rule can be opt out for managers too"*. These are his own words, not one of the options.
  - **Options offered:** "Same rule everywhere (Recommended)", "Stop sending them to staff" and "Push and live only".
  - **Read as:** owners and managers see the money by default; an owner can let a staff member see it; an owner can turn it off for a manager. That was put back to him as two questions.
- **What makes a staff member authorized:** *"Its own right (Recommended)"*. A new right, "Sees the house's money", sits on /team's Jobs and packages. An owner gives it to staff or takes it from a manager. It is separate from approving or sending.
  - **Rejected:** "Any money right" (an approve or send limit would carry it) and "Follow the package" (Full sees money; Standard and Light do not).
- **Someone not allowed to see money:** *"Title, no figures (Recommended)"*. They still get the notice, with a neutral line and no amounts, as the Today feed does on #582.
  - **Rejected:** "Not sent at all".
- **What it means for the build:**
  - One rule decides who sees the house's money in every reader: the Today feed, push, the live `notification:new` event, and both Notifications screens.
  - The rule is the person's right in that house. Their role only sets the default: on for owners and managers, off for staff.
  - #582 decides by role alone (`seesHouseMoney(role)`). It is the first step, and this right replaces its test.
  - Not settled here:
    - whether an owner can turn it off for another owner;
    - how it reads beside round 8's packages (Standard and Light show no profit or pay);
    - whether round 9's "what they can approve" stays a separate, narrower view for grantees.
  - [Answered 2026-10-01 in round 11 below: F1, F2 and F3.]

## Answered 2026-10-01 (round 11) — the money right's design forks, verbatim

The design is in `p4-scratch/money-right-2026-10-01/README.md` and its forks in `forks.md` there (outside the repo, so not re-checkable from it) (a workflow: finders, attackers and a judge, who picked the minimal design over the structural register and grafted six parts from it; nothing was run and production was not read). Asked by `AskUserQuestion` in five batches. Every answer was the recommended option except F4 and F8. [Dated 2026-10-02, PR #566 gate round 2 (audit at `65ddb2cd2`): the heading's date is the evening's. By the session transcript's timestamps, F0–F10 were answered 23:47–23:55 local on 2026-10-01, and F11–F16 at 00:09–00:10 local on 2026-10-02 (03:47–03:55Z and 04:09–04:10Z, UTC−4).]

- **F0. Where the right lives:** *"Row now, fold later (Recommended)"*. A third switch on the membership row, beside pay and zone setup. It folds into the rights register when that is built.
- **F1. An owner turning it off for another owner:** *"No, owners always see it (Recommended)"*. Round 10's first open point.
- **F2. Beside the packages:** *"Every package turns it on (Recommended)"*, Light included. Light's "no money" is read as "gives no money rights". An owner can take the right from a person, and /team then shows the package as adjusted. Sketch 126's Light card text changes. Round 10's second open point.
- **F3. Round 9's narrower view:** *"Keep the narrow view (Recommended)"*. Someone without the right still sees amounts on the orders they may approve or place, and their own limit. Until ADR 0175 D7 is built, approve cards follow the role. Round 10's third open point. [Confirmed as worded 2026-10-02 (round 12), OD-217 (OPEN-DECISIONS.md:293).]
- **F4. Who may give or take it:** *"Owners + allowed Full managers"*, **not** the recommended "Owners only". As in round 6, a Full-package manager may give it only where an owner allowed them, so that allowance is built with the packages first.
- **F5. What a notice may still say to someone without it:** *"No figures; neutral titles (Recommended)"*. Counts, names and state stay ("3 bottles short"). Amounts, prices, percentages, totals, credit, unit cost and other people's limits do not. A title that can carry a figure is replaced by a neutral one. [Noted 2026-10-02, gate at dde13f0de: F13 below carves incoming vendor mail out of this. Its option text kept the vendor-mail subject ("A subject that states a price still reaches staff"), though F5's question had named "a vendor email's subject" among the titles that carry figures. F13 is the later and narrower answer, so it holds for vendor mail. That reading is this record's.]
- **F6. How far it reaches:** *"Everywhere (Recommended)"*: notices, round 9's three (Supply amounts, cellar value, delivery credit), the dashboard, Insights sentences, emails and live order events.
- **F7. Vendor and market prices:** *"No, by role (Recommended)"*. They stay with owners and managers by role.
- **F8. Menu prices:** *"Yes"*, **not** the recommended "No, staff need them". Menu prices are the house's money, so someone without the right loses them on Cellar and Insights.
- **F9. A role change:** *"Resets to the new role (Recommended)"*.
- **F10. A manager undoing an owner's "take it away":** *"Close both (Recommended)"*. A manager cannot remove someone whose money an owner took. Someone without the right may invite or add staff only. This changes ADR 0162 for those cases. [ADR 0162 bracketed 2026-10-02. Not built.]
- **F11. Who is told:** *"The person and every owner (Recommended)"*, as for grants (ADR 0175).
- **F12. Old notices:** *"Old notices follow (Recommended)"*, both ways.
- **F13. Vendor mail and AI summaries:** *"Mail kept, AI summaries neutral (Recommended)"*. [Added 2026-10-02, gate at dde13f0de: the option read "Incoming vendor mail is treated as a letter (subject and text kept), as round 9 kept drafted letters. AI summaries go neutral. A subject that states a price still reaches staff." See the note under F5.]
- **F14. Profit:** *"Needs money and pay (Recommended)"*. [Added 2026-10-02, gate at dde13f0de: the option read "Profit shows only to someone with both rights. The pay switch is then offered only to someone who sees money." This amends ADR 0252 round 4 and Open 7 (pay alone showed profit) and ADR 0215 (only the owner writes the pay switch, for any manager). Both bracketed 2026-10-02. Not built.]
- **F15. Others' limits in the grants register:** *"Limits hidden (Recommended)"*. Names and scope stay.
- **F16. The money emails:** *"Right-holders; staff no value (Recommended)"*. Owners start receiving the weekly report.

**What it means for the build.** The design's PR plan (13 PRs, 14 with the migration split) stacks after #582 and #583. F4's answer makes the allowance part of the packages build, and F8's adds the menu-price readers to the design's reader list. Neither is in that plan yet. Nothing is built.

## Answered 2026-10-02 (round 12) — readings confirmed, verbatim

Asked by `AskUserQuestion` after PR #566's gate re-audit (at `65ddb2cd2`) found readings of rounds 6, 8 and 11 that he had not confirmed. All four answers were the recommended option. His picks and the option texts are verbatim.

- **Round 6's reading.**
  - **Asked:** "Money right, readings to confirm. In round 6 you wrote "managers can give only if the owner accpeted to give access for those actions". We read it as: an owner can allow a manager to give money rights (place orders up to an amount) or send-to-vendor rights; without that, only owners give them. Right?"
  - **Answer:** *"Yes, per action (Recommended)"*: "The owner allows each action separately, e.g. 'may give Place orders' yes, 'may give Send to vendor' no."
  - **Rejected:** "Yes, one switch" ("One allowance covers every money and send right; a manager has all of them or none.") and "No, owners only" ("Only owners ever give money or send rights. Managers give non-money rights only.").
  - **What it means:** round 6's reading and its amendment to ADR 0175 D10 are his, action by action. Round 8's Full "may give money and send rights" holds for each action an owner allowed.
- **How much a manager may give** (OD-209 (OPEN-DECISIONS.md:285)).
  - **Asked:** "When an owner allows a manager to give 'place orders up to an amount', how high may the manager set that amount? (Round 5 you picked 'Yes, any amount'.)"
  - **Answer:** *"Owner sets the cap (Recommended)"*: "With the allowance, the owner says up to how much the manager may give. It can be higher than the manager's own limit if the owner wants."
  - **Rejected:** "Any amount" ("As in round 5: once allowed, the manager may give any amount.") and "Never above their own" ("A manager can never give more than their own order limit.").
- **Standard's order right** (OD-210 (OPEN-DECISIONS.md:286)).
  - **Asked:** "Round 8 says a Standard manager "gives receive, count, order and zone rights, not money". Does the 'order' right they give carry an amount?"
  - **Answer:** *"No amount of its own (Recommended)"*: "Standard's order right lets someone place orders, but the house's approval rule decides every amount. So it stays a non-money right, as round 8 says. Until approvals are built, orders wait for an owner or manager."
  - **Rejected:** "It's a money right" ("Placing orders carries an amount, so a Standard manager gives it only with the owner's allowance.") and "Owner sets per package" ("The owner sets an order amount that comes with each package.").
  - **Not asked:** the first answer's example names "Place orders" as a right an owner allows a manager to give, and this one names an order right Standard gives without it. Whether the register holds one order right or two is part of OD-208 (OPEN-DECISIONS.md:284), still open.
- **F3's narrower view** (OD-217 (OPEN-DECISIONS.md:293)).
  - **Asked:** "Someone without the money right, but allowed to place orders: what money do they see? (F3 you picked 'Keep the narrow view', whose text said amounts on orders they may approve or place, plus their own limit.)"
  - **Answer:** *"As F3 said (Recommended)"*: "They see amounts on the orders they may place or approve, plus their own limit. Nothing else of the house's money."
  - **Rejected:** "Own limit only for now" ("Only their own limit until approvals are built; order amounts stay hidden until then.").
  - **Not asked:** who counts as "allowed to place orders" while every member can still create one. Round 2 closes that act until given, and OD-213 (OPEN-DECISIONS.md:289) asks whether it stays open longer. #582 (open) hides order amounts on the Today feed from staff by role.

Still open: OD-208 (OPEN-DECISIONS.md:284), and OD-211 (OPEN-DECISIONS.md:287) to OD-216 (OPEN-DECISIONS.md:292). Nothing is built.

## Open — the founder's to decide (sketch 125 forks 9–12, 14)

1. **The rights list.** The seven drawn in the sketch, more, or fewer. [Filed 2026-10-02 as OD-208 (OPEN-DECISIONS.md:284).]
2. ~~**"Just for this job".** Does such a right end when the job is done, at a time, or at whichever comes first?~~ Answered (rounds 2 and 7): the giver selects; a job's right ends with the job, never at the due time. [Corrected 2026-10-02, gate at dde13f0de: answered in part. Round 2 settled that the giver selects. Round 7's option did not say when the right ends; "with the job, never at the due time" is the research's proposal. Open again as OD-211 (OPEN-DECISIONS.md:287).]
3. ~~**Order limits.** Can a manager set a staff member's limit above their own?~~ Answered (round 6): managers issue money rights only where an owner allowed them; the amount goes with the packages. [Corrected 2026-10-02, gate at dde13f0de: who may give is answered, in this ADR's reading of round 6. The amount is open as OD-209 (OPEN-DECISIONS.md:285), and whether Standard's order right is a money right is open as OD-210 (OPEN-DECISIONS.md:286).] [Answered 2026-10-02 (round 12): the reading is confirmed, per action. The owner sets the amount with the allowance, and it may be higher than the manager's own limit, OD-209 (OPEN-DECISIONS.md:285). Standard's order right carries no amount, OD-210 (OPEN-DECISIONS.md:286).]
4. **Late jobs.** ~~Who is told when a job is late?~~ Answered (round 2).
5. ~~**Staff and other rooms.** Do staff see rooms outside their jobs?~~ Answered (round 5).

Research on these runs as parallel agents, not a Workflow fan-out. The first finished one (access and delegation products, 2026-10-01; scratchpad `ext-C-jit-capability-ui.md`, outside the repo) found:

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
- **Twenty forks** are listed in the research (scratchpad `research-people-rights.md` §9, outside the repo). The ones that gate a first build are put to the founder first.

## Consequences

- The capabilities register that ADR 0238 forecast becomes the next build. `team_pay_access` and `zone_setup_access` fold into it.
- A staff screen means a second layout to keep honest. Every new right must say what it adds to a screen.
- Revisit when the open forks are answered, or if staff on the web want the manager's pages back.
- Three names sit close and mean different things. ADR 0215's `seesMoney` (`team/pay-rules.ts:128` at `a62dbd105`) is about pay. This ADR's "Sees the house's money" (rounds 10–11) is the house's money. #582's `seesHouseMoney(role)` (`mobile/mobile.service.ts:36` at `74d837c70`, open) is that right's first step, by role. A build that touches more than one keeps them apart.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Aldemir (founder, voice note + `AskUserQuestion`) + Claude (Opus 5.5; branch `fix/closed-stays-closed`, uncommitted at this row) | Created — direction and staff surface locked; forks 9–12 and 14 open; nothing built |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 2) + Claude (Opus 5.5, taking over on a second account; branch `fix/closed-stays-closed` on top of `cc06e8b86`) | Answered — staff acts closed until given, phone money closed to staff, late jobs to person then giver; job right = permanent or for this job, with a /team jobs-or-labels section to research |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 5) + Claude (Opus 5.5) | Answered staff rooms; order-limit answer collides with ADR 0175 D10, re-asked; packages asked |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 6) + Claude (Opus 5.5) | Order limits: owner-allowed manager grants; ADR 0175 bracketed |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 7) + Claude (Opus 5.5) | Jobs-and-labels research folded; its four questions answered (all recommended); PATCH approval hole filed |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 8) + Claude (Opus 5.5) | Manager packages Full / Standard / Light confirmed; copy-once, adjustable, never live; staff use the Jobs list |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 9) + Claude (Opus 5.5) | Answered — vendor reply cards stay for staff; someone given a right sees what they can approve; the Supply tab's order amounts, the cellar value and delivery-difference money close to staff, server first [row added late, with the next one: round 9 had none] |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, fix rounds of the phone-feed fix) + Claude (Opus 5.5; `fix/phone-feed-no-money-for-staff` at 7fdf4f95f, PR #582, and `fix/phone-feed-own-grant-limit` at e68bd3cdf, PR #583, neither merged) | Answered — the wage notice gets its own type; a grantee sees their own grant limit on the Today feed, by recording the grantee on new notices; read beside round 9 as their own right's bound, not the house's money |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 10) + Claude (Opus 5.5) | Answered — owners and managers see the house's money in notices by default; a new right, "Sees the house's money", lets an owner give it to staff or take it from a manager; anyone without it gets the title and no figures, in every reader; not built |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`, round 11) + Claude (Opus 5.5) | Answered — the money right's 17 design forks: a membership-row switch, owners always see it, every package turns it on, everywhere; F4 owners plus allowed Full managers and F8 menu prices are money (both not the recommended option); not built |
| 2026-10-02 | Claude (Opus 5.5; PR #566 gate round, audit at `dde13f0de`) | Corrected in brackets, no decision changed: the base commit; the grant cap (not his pick); round 6 and round 7 read too broadly, marked as this record's reading; Open 2 reopened in part; F5/F13 and F14 option texts added; F2 beside the Light bullet; outside-repo and unmerged evidence marked. Ten open forks filed as OD-208 to OD-217. ADRs 0112, 0162 and 0215 bracketed for rounds 5–6, F10 and F14 |
| 2026-10-02 | Aldemir (founder, `AskUserQuestion`, round 12) + Claude (Opus 5.5; PR #566 gate round 2 (audit at `65ddb2cd2`)) | Answered, all recommended — round 6's reading confirmed, per action; the owner sets the cap with the allowance, above the manager's own limit if he wants (OD-209); Standard's order right carries no amount (OD-210, path B); F3 as worded (OD-217, path A). Corrected in brackets: #577 carries the merge fix (OD-213 and the Place orders proposal); the link to ADR 0175 D10; round 11's dates; the F2 note beside F4 and F9. ADRs 0112 and 0175 brackets confirmed. Not built |
