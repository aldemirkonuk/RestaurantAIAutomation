# 0089 — A page can start the engine it reports on

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — the P1 call: *distinguish the two states **and** give the page a way to create a coverage rule*
- **Keywords:** team, coverage templates, staffing engine, idle, empty state, broadcast, targeting, tenant leak, query key, credentials, certification, onError, confirmation, copy week, schedule receipts, role split, /team
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0020-no-fabricated-answers]], [[0083-a-page-may-not-claim-a-write-it-never-makes]], [[0086-a-count-confesses-what-it-could-not-count]], `.planning/06-pages/team.md`, `.planning/08-softwares/team-command.md`

## Context

`/team` was measured against the tenant it actually runs in. Production holds
**zero** `coverage_templates`, **zero** `schedules`, **zero** `shifts`, **zero**
`team_certifications`, **zero** `server_sales`, **zero** `team_settings`, **zero**
`schedule_receipts`, and an 11-person roster that is 8 `owner` + 3 `manager` with
**no `staff` role at all**. Every region of this page therefore renders over
nothing, which means the page's own sentences are the entire product.

Those sentences were wrong in a specific, repeating way:

- `TeamNext.tsx:296-299` printed **"Every required slot this week is staffed.
  Nothing is waiting on you here."** whenever `gaps` was empty — including when
  it is empty because no coverage rule has ever existed. The staffing engine has
  never been *asked* for anything, and the page reported that as a result.
  `TeamNext.tsx:377-380` did the same for credentials: **"Every credential on
  file is valid through this week"** over an empty file. The legacy Ops drawer
  had this right the whole time (`OpsRulesPanel.tsx:109-111`: *"No coverage rules
  yet — the staffing engine stays idle and gaps stay empty"*) and the redesign
  dropped it.
- `TeamNext.tsx:394-397` said **"N shifts this week are held by an expired
  credential — this schedule should not be published as it stands"**, where N
  came from `useTeamNextData.ts:186` counting *every* shift the member holds.
  `team_certifications` has no role and no applies-to column (baseline
  `:5609-5620`); nothing in the data connects a credential to a shift. The
  sentence asserted a link the schema does not have.
- `ManagerShiftDesk.tsx:710-718` → `doBroadcast` (`:335-345`) sent a message
  labelled **"Message {firstName}"** with **no `memberIds`**, so
  `team.controller.ts:345-347` fell through to every active linked member across
  four channels — no confirmation, no undo, no recipient list. The targeting
  existed and the redesigned half used it correctly (`TeamNext.tsx:157-165`).
- Five query keys carried no restaurant id (`useTeamNextData.ts:66-72`,
  `OpsRulesPanel.tsx:70-73,170-173`, plus `PerformancePanel.tsx:22`). The branch
  switcher is in the **global** header and `AuthContext.tsx:419-441` re-issues
  the JWT without clearing the query cache, so after a switch the redesigned page
  rendered the previous tenant's week, roster and credentials — and an Ops-drawer
  delete fired with the old tenant's id, no-opped server-side, and toasted
  **"Rule removed"**.
- None of the legacy desk's four reads had an `isError` branch
  (`ManagerShiftDesk.tsx:66-85`). A dead gateway rendered *"No team members yet"*,
  **`0 active`**, an empty task rail under a **green tick**, and **Publish
  readiness: Clear** on all three rows (every one a `?? 0`). `MyShifts.tsx:29-33`
  rendered seven days of *"Off"*.
- Seven mutations had no `onError` at all, and two documents asserted the
  opposite: `.planning/06-pages/team.md:182` and
  `.planning/08-softwares/team-command.md:115` both claimed *"Every mutation
  carries an onError toast"*.
- `copy-week` **DELETEs the entire target week** before inserting
  (`schedule.service.ts:202-207`) and re-publish **wipes every
  `schedule_receipts` row** (`:248-251`), destroying the record of who has seen
  the schedule. Both were a single click, on a page that already confirms member
  removal properly (`editors.tsx:265-284`).
- `App.tsx:305` routed the whole `/team` route to the redesigned manager surface
  with no role split, while the legacy entry split correctly
  (`TeamCommandPage.tsx:36-37`). Most manager writes 403, but `GET
  certifications` carries **no** role requirement server-side
  (`team.service.ts:397`), so the whole credential file rendered to any member.

The through-line is [ADR 0051](0051-rebuilt-pages-show-live-data-only.md)'s
clause 1 wearing new hats — *unknown is not zero* — plus a shape 0051 did not
name: **a surface that reports on an engine, over a tenant where that engine has
never been switched on, and cannot switch it on.**

## Options considered

1. **Say the engine is idle, and stop there.** Restores the legacy drawer's
   honest sentence to the redesign. Cheap, and strictly better than the lie. But
   the only route to *fixing* the state it describes is the legacy Ops drawer —
   the surface this page's own flag replaces. The page would name its declared
   first object ("coverage gaps") and be unable to produce one.
2. **Say the engine is idle AND let the page start it.** Same sentence, plus a
   minimal role/day/service/min-staff form on the panel that owns the gap list,
   posting to the `coverage-templates` endpoint that already exists. Costs a form
   on a page that did not have one, and duplicates a capability the legacy drawer
   also has while both halves are live.
3. **Link out to the legacy Ops drawer.** No new surface. But it hands the user
   to the screen the flag exists to retire, and a link out of a rebuilt page into
   a legacy one is a migration that never finishes.
4. **Do nothing about the engine; fix only the wording.** Production keeps a page
   that says the week is staffed against zero requirements, or (option 1) says it
   is idle and offers nothing. Both leave `coverage_templates` at zero rows
   indefinitely, which is why every gap-shaped feature on this page is dark.

## Decision

**Option 2, on the founder's call.** A rebuilt page distinguishes *"the engine
has not been asked"* from *"the engine answered nothing"*, **and** carries the
control that starts it. Concretely, and binding beyond this page:

- **An empty derived list must name its cause.** Where a list is produced by a
  configured engine, "empty because unconfigured" and "empty because satisfied"
  are two sentences, and the page must query the configuration to tell them
  apart. `/team` now reads `coverage_templates` as a first-class query and prints
  one of three sentences: the rules could not be read; no rule exists so the
  engine is idle; or the week meets all N rules.
- **If a page names a job, it can start that job.** A rebuilt surface may not
  route the user to the legacy screen it replaces in order to do the thing it is
  about.
- **A claim may not out-run its schema.** The credentials block now counts
  *people scheduled with a lapsed card* and states plainly that *which shifts
  require it is not recorded*. No count of "blocked shifts" exists, because no
  such relation exists. (Recorded as a gap, not filled with a plausible number —
  ADR 0051, clause 4.)
- **A send that names one person sends to one person, and shows the list first.**
  The `prompt()` is replaced by a composer that resolves recipients live from the
  roster, states the channel fan-out, and counts the recipients on the send
  control itself.
- **Every read on a tenant-scoped page is tenant-keyed, on both halves of a
  flagged route.** Extended into `scripts/check_windowed_figures.py` as a fourth
  `PAGES` entry covering `pages/team/next` *and* `pages/team/command` — the leak
  was on the redesigned half while the legacy half had it right, so guarding only
  the half being rebuilt would have made a green run meaningless.
- **A destructive action names what it destroys.** Copy-week and re-publish now
  say which rows are deleted and wait for a second, labelled click.

The reasoning that carried it: on a tenant with zero rows everywhere, the page
*is* its sentences. Fixing the sentence without fixing the reachability of the
state it describes would produce an honest page that is permanently, correctly,
empty — and the founder's own framing was that a page which names a job it
cannot start is worse than one that admits the engine is off.

## Consequences

- **Easier:** `/team` can be brought to life from `/team`. The three dark
  features on the page (gaps, suggested cover, day-by-day coverage) become
  reachable without visiting the screen they replace, and the guard now holds the
  tenant-keying rule mechanically on both halves rather than by review.
- **Easier:** the four honest surfaces already on this page —
  `PerformancePanel`'s *"We never show estimated numbers"*, `TeamNext`'s
  two-sentence error banner, `membersCount === null → —`, the labour-off
  *"a withheld number, not a zero"* — are now the page's whole register rather
  than four exceptions in it.
- **Harder:** the credentials block is weaker than it was. It used to say "this
  schedule should not be published"; it now says "check before publishing". That
  is a real loss of force and it is deliberate: the strong version was not true.
- **Harder / given up:** coverage-rule creation now exists in two places while
  both halves of `/team` are live. That duplication ends when the flag flips and
  the legacy desk retires, and is not worth a shared component before then.
- **Given up:** the redesigned surface has no Mudavym `MyShifts`; a non-manager
  on the rebuilt route gets the legacy staff view. That is the correct trade
  against showing them the manager desk and the whole credential file, but it
  means the redesign is not yet complete for staff. On this tenant no `staff`
  role exists, so nobody sees it today.
- **Named and NOT fixed here** (`apps/api-gateway` belongs to a sibling branch):
  `GET certifications` still carries no role requirement server-side
  (`team.service.ts:397`), so the client-side split is defence in depth and not
  access control; and nothing records that a renewal was requested, so the
  redesign's "Request renewal" reports only what it just did, never a state.
  Both carry marked TODOs in the code.
- **A merge ORDER, not just a dependency.** `fix/team-gateway` (ADR 0088, filed
  the same day) makes copy-week 409 without `replaceTarget: true`, publish 409
  without `resetReceipts: true`, and broadcast 400 without `memberIds` or
  `audience: "everyone"`. This branch does **not** send those three fields,
  because the gateway runs `forbidNonWhitelisted: true`
  (`apps/api-gateway/src/main.ts:54`) and an unknown field 400s every one of
  those calls against the gateway deployed today. **The gateway PR must land
  first; the next change to `services/api/team.ts` adds the three fields.** Until
  both are in, the confirmations added here are client-side and therefore not a
  control — they are one half of a two-half fix, and the TODO in
  `services/api/team.ts` says so at the call site.
- **Revisit when:** `team_certifications` gains a role or applies-to column. At
  that point the credentials block can make the strong claim again, and this
  decision's "a claim may not out-run its schema" clause becomes the reason it is
  finally allowed to.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir | P1 decided (distinguish the states **and** ship rule creation); the rest filed as defects and fixed on the same branch |
