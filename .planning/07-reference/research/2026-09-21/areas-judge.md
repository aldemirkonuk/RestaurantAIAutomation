# Judge: STAFF SNOOZE + AREAS (2026-09-21)

Read-only. Inputs read in full: `snooze-sota.md`, `areas-model.md` (this folder).
Code read to check them: `wt-recs-cat` (branch `r5/recs-catalogue`, HEAD
`1f52dd7f5`, clean tree) and `origin/main` of the shared checkout via `git show`.
Nothing was edited outside this file.

---

## 0. Verdict

1. **Two snoozes, not one.** "Snooze for me" belongs to every role and hides the
   card only from the person who pressed it. "Snooze for everyone" is for owners
   and managers (and area leads inside their area, if Q4 says yes). Staff keep
   **Done** and **one-card Dismiss with a label**. Both of those hide the card for
   everyone, but both show the person's name and both can be undone.
2. **"Not now" should become "snooze for me"** by the same logic that turned
   "Already handled" into done. Otherwise it stays a back door: staff could hide
   a card from everyone and it would look like a model signal.
3. **Holiday = "Away" dates** that the person sets, or a manager sets for them.
   Away mutes that person's alerts only. Nothing is reassigned and nothing is
   hidden from the house. It is not switched on automatically from approved leave.
4. **Areas focus a card; they never filter it out.** A person's own area's cards
   come first and the rest sit below. Owners and managers always see everything.
   Areas stay switched off until a house turns them on, so a 3-person house sees
   no change.
5. **Every house-wide action goes into one append-only history** with the
   person's name. This extends the label history the founder already asked for.
   Personal snoozes and a person's own Away dates are not recorded against the
   house (KVKK: keep the data minimal and use it only for its stated purpose).

---

## 1. What I re-checked, and corrections to the inputs

- **"No record" is confirmed.** `recommendation_actions` holds one row per
  `(restaurant_id, rule_key)`, and each write upserts over it
  (`wt-recs-cat` `recommendation-actions.service.ts:333`). `created_by` is
  overwritten by whoever acted last, and no history exists. A staff snooze or
  done on a whole-rule key hides the card house-wide and leaves nothing in
  `system_audit_log`, which only rule-wide dismiss/restore and the catalogue
  toggle write (ADR 0191 round 2, `0191-...md:257-262`).
- **Correction to `areas-model.md` §B1.** It says the `"admin"` literal in
  `mayActRuleWide` "appears nowhere else". That is wrong. `RolesGuard` accepts
  `admin` as owner/manager too (`roles.guard.ts:29-34`), and `mayActRuleWide`
  says it copies "RolesGuard's own set" (`insights/item-state.ts:206-210`).
  `admin` is still missing from the `Role` type (`roles.guard.ts:5`), so what it
  means is an open question (§6). But it is a gateway-wide alias, not a
  recommendations-only trapdoor.
- **The three same-day rulings are not written down yet.** They are: every
  firing is its own card, dismiss labels are append-only, and "already handled"
  is recorded as done. ADR 0191 at `1f52dd7f5` still lists them as open round-2
  questions 2, 4 and 5 (`0191-...md:369-379`). This judgement treats them as
  decided because the brief says so. They need writing into the ADR
  (CLAUDE.md §0.2).
- **Not re-measured (§5b).** The production shape comes from memory
  `production-tenant-shape.md`, dated 2026-09-19: 15 access rows, split into
  10 owner, 4 manager and **1 staff**; the one real house has 3 members. The
  claim that `shifts`/`schedules` have **0 rows** comes from the `/team` dossier,
  quoted in `labor-page.md` (itself unmeasured). The Supabase connector is
  unauthenticated in this session, so I re-measured neither. Both numbers carry
  weight in §3.
- **Existing pieces the design reuses:**
  - `rosterAt`/`onShiftAt` (`notifications/producers/roster.ts`,
    `shift-window.ts`). Their written rule is that "the schedule names nobody"
    must never be read as "nobody was working".
  - `notification_preferences`, keyed per `(restaurant_id, user_id)`, which
    already has `quiet_hours_*` (baseline `:3899-3947`). This is the existing
    per-person "go quiet" setting.
  - `time_off_requests` (baseline `:5666-5677`). It has a **free-text
    `reason`** column.
  - `listMembers`, which is manager-gated "because the roster exposes wages"
    (`origin/main` `team/team.service.ts:135-136`).
- **Today, card alerts do not reach staff.** Cards reach staff only through the
  feed (pull). The only automatic send is a house-level digest to one
  `recipientEmail`, and that send is feature-flagged
  (`analytics.controller.ts:1269`). Any per-person routing is new build.

---

## 2. Draft design (v0), written before the attack

1. Snooze has two scopes. "For me" is open to anyone. "For everyone" is open to
   owner/manager, and to staff capped at 3 days with their name shown.
2. Away turns on automatically from approved `time_off_requests`.
3. Areas are a fixed 7-value list (areas-model §A2). Staff see only their areas'
   cards. House cards go to `management`.
4. Cards route to the people in the area who are **on shift**.
5. An `is_area_manager` flag gives manager powers inside one area.
6. Rule-wide acts go to `system_audit_log`. Everything else goes to the
   append-only history.

---

## 3. Adversarial pass: trying to kill v0

Limitation: this pass was run by the same agent as a separate step. No subagent
tool was available in this session, so it is not the independent reasoning
CLAUDE.md §3 asks for. That is stated here as a shortcut.

| # | Attack | Concrete scenario | Result on v0 | Fix carried into v1 |
|---|---|---|---|---|
| A1 | **A card nobody sees** | Sunday 23:00: `stockout_imminent` fires for the house gin. The bar has one member, who is off shift, away, or has no login (`team_members.user_id` is nullable). Under v0 staff see only their own area, and routing goes to whoever is on shift. `shifts` last had **0 rows**, so in the one real house shift routing reaches **nobody**. | **Kills** "route by shift" and "only your area". | Route by **membership**, never by shift. The audience can never be empty. The alert ladder is: area members with a login who are not away, then the area lead, then owners/managers not away, then every owner. Owners and managers see every card in their list whatever the routing says. Shifts can later change **when** someone is alerted, never **whether** a card is visible. |
| A2 | **Staff hides a card for everyone** | v0 leaves three doors open: the capped house snooze, done, and a one-card dismiss labelled `not_now`. Example: a waiter dismisses `sales_below_weekday_baseline` "not now" every Tuesday. The owner never sees it, and the model learns a negative signal that is really about timing. | **Wounds.** Gating snooze alone leaves the `not_now` door open. | Staff snooze is **for me only**. `not_now` leaves the dismiss labels and becomes snooze-for-me, the same move as `already_handled` becoming done. Staff can then hide a card for everyone only through **Done** or a **not_relevant/disagree** dismissal. Both are named in the history, both are undoable, and done ends when the next firing arrives. |
| A3 | **Manager who is also a bartender** | Ali is an account manager and works the bar on Friday and Saturday. If v0's area filter applies to him, he loses sight of the kitchen cards. With both the area flag and the manager role, it is unclear which rule wins, and he gets alerted twice. | **Survives if a rule is added.** | **Areas add focus and never remove power.** Your powers are the higher of your account role and any area lead mark. Areas change only the order of your list and which alerts you get. One alert per person per card. |
| A4 | **Small house of 3** | The real house has 3 members, and production has 1 staff login in total (memory, not re-measured). v0 makes a 7-area setup mandatory, and `dish` and `receiving` mean nothing there. | **Kills** mandatory areas. | Areas are **off by default**, behind a house switch like `team_settings.labor_tracking_enabled`. With areas off, everyone is in every area: today's behaviour plus snooze-for-me and Away. The starter list is short and renamable. |
| A5 | **KVKK / GDPR** | v0 auto-reads `time_off_requests`, which uses leave data for a new purpose, and its free-text `reason` can hold health information. Health data is special-category data (KVKK Art. 6). v0 also logs every personal snooze by name, which creates a monitoring surface, and sets no retention. An "area manager" who is really an account manager would see every wage (`listMembers` is manager-gated for exactly that reason). | **Wounds** auto-away, full logging and the manager-as-lead idea. | Away is set by the person, or by a manager for them (that one is logged), and holds **dates only**. `reason` is never read. Personal snoozes stay out of the house history and are deleted when they expire; at most an anonymous count per rule is kept. Retention is filed as open. The area lead gets **no pay or roster access**. Staff get a notice (§4.7). |
| A6 | **"One shared state" (the founder's words, ADR 0191)** | A personal layer adds a viewer to `resolveItemState`. The digest, the MCP reader and the stored rails read with no viewer. | **Wounds** unless the personal layer is kept apart. | House state stays the single source of truth, and `resolveItemState` is unchanged. A second pure step, `personalView(item, myBook, away)`, runs only where a named person is looking (their feed, their alerts) and nowhere else. The catalogue and Reports show house counts plus "N hidden just for you". |
| A7 | **Everyone snoozes the same card for themselves** | All three people in the small house, owner included, personal-snooze a card. It is hidden from everyone with no house record. Or the assignee personal-snoozes their own assigned task. | **Acceptable residual.** | A personal snooze holds only until the chosen time or the end of that firing, whichever comes first. It comes back early if the card becomes more urgent (Linear's Inbox does the same on new activity). An assigned card stays open, and its assignee is shown to managers. |
| A8 | **Wrong area label** | The rule map sends `stockout_imminent` to `cellar` (its copy talks about bottles). In a house where the item is kitchen stock, the card goes to the wrong people first. | **Wounds** a map-only design. | Derive the area from the **subject first** (the item's category), then from the rule map, then fall back to "House". Show the area on the card. Owners and managers can re-label a rule's area for their house. Because areas focus rather than filter, a wrong label never hides anything. |
| A9 | **What counts as one firing is undefined** | The per-firing card is decided. But if every compute is a new firing, snooze and done never hold. If a continuously true rule counts as one long firing, done hides `vendor_concentration` for months. | **Dependency, not a kill.** | Recommendation for the per-firing lane: a firing is the rule's own **period bucket** (for example its week), so done and snooze end when the period rolls over. Longer silence means a dismissal or turning the rule off, and both are recorded. |
| A10 | **Area lead granted by the wrong person** | A staff member promotes themselves or a friend to lead. | **Wounds** without a guard. | Only owners and managers edit areas and lead marks. Every grant and removal goes to `system_audit_log`. |
| A11 | **Assignee goes on holiday** | A card assigned to Ayşe while she is away. Zendesk leaves the ticket assigned (snooze-sota §5A). | **Survives.** | The card stays assigned, and the area still sees it as open. Owners and managers see "assignee away until 10 Oct". Nobody is shown why she is away. |

---

## 4. Revised design (v1)

### 4.1 The verbs

| Verb | Hides it for | Who may | How long | What is recorded |
|---|---|---|---|---|
| **Snooze for me** | the person only | anyone who can see the card | until the chosen time or the end of this firing; back early if it becomes more urgent | a per-person row, not in the house history, deleted when it expires; optionally an anonymous count per rule |
| **Snooze for everyone** | the whole house | owner/manager anywhere; area lead in their area | until the chosen time or the end of this firing | the history: who, until when, which areas |
| **Done** (and "already handled") | the whole house, for this firing | anyone in the card's area (areas off: anyone) | until the next firing; can be reopened | the history; the card shows "Done by Ayşe, 14:32" |
| **Dismiss one card, with a label** | the whole house | anyone in the card's area (areas off: anyone), as the founder ruled | until restored | the history, including the label (append-only, as decided) |
| **Whole-rule dismiss/restore, catalogue on/off** | the whole house, the whole rule | owner/manager only, as decided | standing | `system_audit_log` (exists today) and the history |
| **Away** | the person's alerts | the person, or an owner/manager for them | a from date and a to date | a per-person setting; written to the house log only when someone else sets it |

Dismiss labels become `not_relevant` and `disagree`. `already_handled` moves to
done (decided). `not_now` moves to snooze-for-me (proposed; this is Q1).

**Undo.** Staff undo their own acts. Undoing someone else's act takes an area
lead in that area, or an owner or manager. Today any member can restore
someone else's one-card dismissal, so this is a change. It stops two staff
members flipping the same card back and forth.

### 4.2 Areas

- A house switch, **"Use areas"**, off by default. While it is off, everyone
  counts as being in every area.
- **Starter list**, renamable and extendable: Kitchen, Bar, Wine/cellar,
  Floor, Receiving, plus **House** for the whole-house cards (money, vendors,
  goals).
  - Each starter area has a fixed *kind*, and the rule map points at kinds. A
    renamed area ("Garde manger") keeps its kind.
  - A custom area has no kind. It gets cards only when an owner re-labels a
    rule to it.
  - Dish is folded into Kitchen. The areas-model's 7-value list is too long for
    small houses.
- **Person to area.** A person can be in many areas, with one marked primary.
  Membership is edited on the Team page, which is manager-gated. Owners and
  managers are always in House.
  - This is the same vocabulary the labor page needs for cost by area. It
    should later replace the three free-text fields (`team_members.position`,
    `shifts.role`, `coverage_templates.role`). That replacement is not part of
    this build.
- **Card to area.** A card has zero or more areas, derived from its subject,
  then the rule map, then "House". There is one card row, never one copy per
  area.

### 4.3 Routing: who sees it first and who is alerted

- **Focus, not filter.** The list shows "Your areas" first and "Rest of the
  house" below, collapsed. Nobody loses sight of a card they can see today.
- **Alert ladder**, per card, one alert per person:
  1. members of the card's areas who have a login and are not away;
  2. otherwise the area's lead;
  3. otherwise owners and managers who are not away;
  4. otherwise every owner.
  A card always reaches someone.
- **Shifts are not used in v1.** Once `shifts` has real rows, a shift may
  delay an alert until someone's next shift starts. "The schedule names
  nobody" never hides a card.

### 4.4 Who may do what, with areas on

| Actor, card | Snooze for me | Snooze for everyone | Done | Dismiss one (label) | Whole rule / catalogue | Undo others' acts |
|---|---|---|---|---|---|---|
| Owner / manager, any card | yes | yes | yes | yes | yes | yes |
| Area lead, card in their area | yes | yes | yes | yes | no | yes, in that area |
| Staff, card in their area | yes | no | yes | yes | no | no (own acts only) |
| Staff, card outside their areas | yes | no | no | no | no | no |
| Staff, a House card | yes | no | no | no | no | no |

The last row applies only when areas are on and the owner has not added that
person to House. With areas off, staff are in House, so the founder's ruling
that staff can dismiss one finding holds unchanged by default.

**Manager who is also a bartender:** the manager row applies. Bar membership
only puts bar cards first and adds bar alerts.

### 4.5 Holiday / Away

- **Who sets it.** The person sets it in their own settings (dates only), or an
  owner/manager sets it for them, for example after a sick call, with no reason
  captured. When a manager sets it, a house log row is written.
- **While away:**
  - no alerts or digests reach the person;
  - the alert ladder skips them;
  - nothing is reassigned and nothing is hidden from the house;
  - assigned cards stay assigned, and owners/managers see "away until …";
  - other staff are shown nothing about the absence.
- **On return:** one line: "While you were away: N cards in your areas were
  done (by whom), M are still open." This can wait for a later build.
- **Not automatic from approved leave.** None of the surveyed products
  auto-mute from time off (snooze-sota §5). 7shifts states that approved leave
  does not mean unschedulable. The leave table is probably empty today. Later,
  approving a leave could *offer* the person "Set Away for these dates?", but
  only as a prefill that they confirm.
- **Storage:** per `(restaurant, user)`, next to `notification_preferences`'
  quiet hours.

### 4.6 The record

- **Append-only history.** This is the store already decided for labels,
  widened to cover every house-state act: dismiss with its label, restore,
  snooze for everyone with its end time, done, and reopen. Each entry holds
  the actor (`public.users.user_id`), the time, the card key, the scope and
  the card's areas at that moment. It replaces "whoever wrote the row last".
- **`system_audit_log`** keeps what it already records (rule-wide acts,
  catalogue on/off) and adds:
  - areas created, renamed or removed;
  - membership and lead grants and removals;
  - Away set on someone else's behalf;
  - the "Use areas" switch.
- **Not recorded against the house:** personal snoozes, and Away dates a
  person sets for themselves. Managers see only whether someone is away right
  now.
- **Who reads the history:**
  - owners and managers read all of it;
  - an area lead reads their own areas;
  - staff read their own acts;
  - every card shows the name on its latest act.

### 4.7 KVKK / GDPR

- **Who is responsible.** The house is the data controller for its staff's
  data, and Mudavym processes it on the house's behalf. The compliance charter
  already records "no policy, no DPA, no data-processing record"
  (`compliance-privacy-charter.md:202-203`). This feature adds personal data
  to that gap; it does not close it.
- **Notice to staff** (KVKK Art. 10 / GDPR Art. 13), shown once, draft text:
  "When you finish or dismiss a card, Mudavym records your name and the time
  so the house knows what was done. Snoozes you make for yourself and your Away
  dates are not shown to others. Managers see that you are away, not why."
- **Minimum data.** Away is two dates. Never read or copy
  `time_off_requests.reason`: it is free text and may hold health information,
  which is special-category data under KVKK Art. 6.
- **Purpose.** The history exists to show what was done and by whom. It is not
  a performance score. No per-person ranking of dismissals or snoozes without
  a new decision and a new notice.
- **Retention.** Needs a number. Open (§6).
- **Pay stays with owners and managers.** An area lead gets no roster or wage
  access. This is the reason an area lead should be a separate mark rather
  than "make them manager".
- **When someone leaves,** their personal rows are deleted with their
  membership. Their name stays on history rows until retention ends.
- **Access.** Staff can read their own acts (KVKK Art. 11).

### 4.8 Storage sketch (for the build lane; not a decided schema)

- **Personal snooze:** its own small table, `(restaurant_id, user_id, item
  key, snooze_until)`. It is separate from the history because it has
  different retention and is never visible to the house.
- **Away:** columns on `notification_preferences`, or one per-person row.
- **Areas:** `team_areas (restaurant_id, kind, name)` and `team_member_areas
  (member_id, area_id, is_primary, is_lead)`. A card's areas are computed at
  read time (areas-model §C4).
- **Resolver:** `resolveItemState` stays as it is. The pure `personalView`
  step runs only for a named viewer and for each alert recipient.

### 4.9 Build order (each step is useful on its own)

1. **Append-only history for every house act, and the name on the card.** This
   closes "no record" today whatever the answers to §5 are.
2. **Snooze for me**, `not_now` becomes a snooze, and staff lose snooze for
   everyone (if Q1 is answered as recommended).
3. **Away.**
4. **Areas:** the switch, the starter list, Team-page membership, the
   subject-then-rule-then-House derivation, the focused list and the alert
   ladder. Build this with or after the labor page's Team work, since both
   edit the roster.
5. **Area lead** (if Q4 is answered yes).

---

## 5. Founder questions (AskUserQuestion shape)

```json
[
  {
    "question": "When a staff member snoozes a card, who stops seeing it?",
    "header": "Snooze",
    "options": [
      {"label": "Only them (Recommended)", "description": "Everyone else still sees the card, and 'Not now' in the dismiss list becomes this same private snooze, just as 'Already handled' became done. Costs a small per-person store, and every list has to know who is looking."},
      {"label": "Everyone, up to 3 days", "description": "Staff can quiet a card for the whole house for at most 3 days, with their name on it. Cheaper to build, but one person still decides what the owner sees."},
      {"label": "Everyone, any date", "description": "Today's behaviour and no build cost. One staff member can hide a card from the whole house until it fires again."}
    ]
  },
  {
    "question": "When someone goes on holiday, how should their alerts go quiet?",
    "header": "Holiday",
    "options": [
      {"label": "They set Away dates (Recommended)", "description": "The person, or a manager for them, picks from and to dates; no alerts reach them and their area's cards go to the rest of the team, then to managers. One small setting to build, and nothing is moved or hidden from the house."},
      {"label": "Automatic from approved leave", "description": "Approved time off switches Away on by itself, saving a step. But approved leave does not always mean absent, the leave list is probably empty today, and reusing leave data for alerts must be told to staff under KVKK."},
      {"label": "No holiday mode", "description": "They snooze cards for themselves before leaving. Nothing to build, but alerts keep arriving and every card must be snoozed one by one."}
    ]
  },
  {
    "question": "Should staff see only their own area's cards (kitchen, bar, floor)?",
    "header": "Areas",
    "options": [
      {"label": "Their area first (Recommended)", "description": "Their area's cards come first, the rest of the house sits below, and owners and managers always see everything. Areas stay off until a house switches them on, so a 3-person house sees no change."},
      {"label": "Only their own area", "description": "Shorter lists, but a card with the wrong area label, or an area with nobody working, reaches no staff at all. Every house must set areas up before staff see anything useful."},
      {"label": "No areas for now", "description": "Add areas later with the team and labor page, where people's stations get set anyway. Nothing to build now, but kitchen, bar and floor cards stay mixed together."}
    ]
  },
  {
    "question": "Can a head chef or head bartender run their own area's cards without becoming a manager?",
    "header": "Area lead",
    "options": [
      {"label": "Yes, cards only (Recommended)", "description": "A 'lead' mark lets them snooze for everyone, finish, dismiss and undo in their area only, and every grant is logged. They get no pay or roster access, which keeps wages private under KVKK."},
      {"label": "No, managers only", "description": "Simpler: only owners and managers act for the whole house. A head chef who needs it must be made a manager, which also shows them the team's pay on the roster today and on the labor page later."}
    ]
  }
]
```

If Q1 is answered as recommended, `not_now` moves as well. That is stated in
the option itself, so it is not a second decision hidden inside the first.

---

## 6. Other forks: lower stakes, recommended here, not asked now

- **What counts as one firing** (A9). Recommend the rule's own period bucket.
  This belongs to the per-firing lane, and it decides how long done and snooze
  last.
- **Fixed area list or renamable** (areas-model §D1). Recommend a renamable
  starter list with fixed kinds (§4.2).
- **History retention.** No number exists anywhere in the repo. File as an OD,
  together with the charter's missing processing record.
- **Staff undoing other people's acts** is narrowed by §4.1. This changes
  today's behaviour and needs a line in the ADR.
- **Should staff see House cards (money, vendors, goals) at all?** They do
  today. This is not changed here.
- **The `admin` role literal** (§1): what it means, before an area-scoped gate
  is written next to it.
- **Nudging on unacted cards** (Jolt-style overdue alerts): later, not v1.

---

## 7. Shortcuts and limits (CLAUDE.md §0.5)

- The adversarial pass was run by the same agent, not an independent one (§3).
- I did no web research of my own. Every market claim comes from the two input
  files' citations, and I did not re-fetch those sources.
- Production counts (1 staff login, a 3-member house, empty `shifts`) come from
  memory and a dossier. They were not re-measured, because the Supabase
  connector was unauthenticated here.
- The KVKK/GDPR points are a reading of the articles named, not legal advice.
  The notice text needs counsel before it ships.
- The three same-day rulings are not yet in ADR 0191 (§1).
