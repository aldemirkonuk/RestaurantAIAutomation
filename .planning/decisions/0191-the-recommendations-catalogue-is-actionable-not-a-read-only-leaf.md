# 0191 — The recommendations catalogue is actionable, not a read-only leaf

- **Status:** Locked (founder, 2026-09-21). Both forks it left open were answered by the founder the same day and are built — see "Round 2" below. The seven questions round 2 left open were answered the same day too — six answers, built in "Round 3" below. The seven round 3 left open (six here, the seventh — the platform `admin` — in the lane's report) were answered the same day with "Take all seven", built in "Round 4" below. Round 4 left three questions open; the founder answered all three on 2026-09-22 — built in "Round 5" below. Round 5 left one question open; the founder answered it on 2026-09-22 — built in "Round 6" below. No open founder question remains. [**RENUMBERED 2026-09-25** (lane L10a, ADR 0212): the seven migrations this record cites were built on 2026-09-21/22 and still dated behind main's newest version `20260922231300` when they reached a PR, so each moved past it with its order kept, and every citation in this record, the code, the SQL tests and CLAIMS now reads the new version: `20260921115500`→`20260925120000`, `20260921170400`→`20260925120100`, `20260921170410`→`20260925120200`, `20260921171100`→`20260925120300`, `20260922010000`→`20260925120400`, `20260922010001`→`20260925120500`, `20260922021000`→`20260925120600`. Production had applied none of the old versions (read-only `list_migrations`, 2026-09-25: newest `20260922231300`), so nothing runs twice. No SQL statement changed; only comments that cite a version.]
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** recommendations, catalogue, insight catalog, candidate type, on/off, toggle, recommendation_actions, insight prefs, rule toggle, suppression, audited, owner/manager, one-tap acts, CatalogView, InsightCatalog, NEW-434, NEW-707, ADR 0149, firing, fire:week, append-only history, recommendation_action_history, snooze for me, recommendation_personal_snoozes, already handled, not now, area lead hook, undo own acts, not_your_act, platform admin, mayActForTheHouse, retention, two years, recommendation_action_history_forget_old_names, cardKeyOf, notes gated like acts, pinned_by, rated_by, assigned_by, not_your_note, mayTouchNote, recommendation_note_changed, recommendation_actions_forget_old_creators, created_by retention
- **Links:** [[recommendations]] (page note, §"Forks built on a DEFAULT" — the fork this closes), [[recommendations-catalog]] (legacy page note, addended), `.planning/handoff/PROGRESS.md` §6 (struck), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (why the legacy `InsightCatalog.tsx` stays in the tree, untouched), `apps/web/src/pages/recommendations/next/CatalogView.tsx`, `apps/web/src/pages/recommendations/next/rec-catalog.ts`, `apps/api-gateway/src/analytics/analytics.controller.ts` (new `PUT insight-catalog/types/:restaurantId/:candidateKey/toggle`), `apps/api-gateway/src/analytics/recommendation-actions.service.ts`, `apps/api-gateway/src/analytics/insights/suppression.ts` (`insightRuleId`, rule-scope `buildSuppressionKey`). Referenced but not present in this worktree: ADR 0160 §108 (the founder's 2026-09-19 sketch-120 feedback batch, on `train/finish-2`).

## Context

`CatalogView.tsx` — the P4 rebuild of `/recommendations/catalog` — shipped
2026-09-19 as sketch 120 item 5, "the catalogue as a leaf — the same
rail-and-rows shape, read-only" (the README's own cheaper drawn option, not a
founder pick). The page note recorded this honestly as an open fork, not a
decision: *"The catalogue's read-only-ness is a standing open fork, not a
build default: `.planning/handoff/PROGRESS.md` §6 still lists 'Recommendations
catalog: is it actionable?' among the forks not yet asked."*
(`recommendations.md:829-831`, pre-correction).

The founder answered it today, verbatim:

> the /recommendations catalogue (browse-all list of every recommendation
> type) is ACTIONABLE, not a read-only leaf: each type can be turned on or
> off for the house and opened to its live recommendations, with the same
> one-tap acts as the feed. Find the catalogue page and the existing
> per-house type preferences (recommendation_actions / insight prefs / rule
> toggles - reuse, do not invent a parallel store), wire on/off (owner/manager
> only, audited) and "open live items", keep the page dark behind its
> existing flag.

Two things had to be found, not assumed, before this could be built:

1. **Which "type" he means.** The catalogue enumerates *insight candidate
   types* (dimension × measure × comparator, `insight-catalog.ts`) — a
   different, larger space than the deterministic *recommendation rules*
   `RecommendationsService` fires (`ruleKey`s like
   `sales_below_weekday_baseline`). The catalogue page only ever lists the
   former, so "each type" means a candidate type, keyed by its `candidateKey`.
2. **Which existing store already fits.** Three were named. `analytics_
   insight_prefs` keys on `(restaurant_id, category)` — 10 broad categories,
   not per-type; it answers a different question (refresh cadence) and is the
   wrong grain. `recommendation_actions` already has exactly the right shape:
   NEW-434 (2026-07-20, `recommendation-actions.service.ts:61-62`) made it
   generic on an arbitrary `rule_key`, and the Reports insight panel already
   writes it with `insight:<candidate_key>` for a raw insight. The
   suppression grammar built on top of it (`suppression.ts`) already
   distinguishes three scopes by key shape, and the **bare** key —
   `insight:<candidate_key>`, no `#subject#grain` suffix — is defined as
   **rule scope**: "this rule, entirely." `InsightGeneratorService.generate()`
   already filters every live instance against that exact key, everywhere it
   is read (the feed, Reports, the contextual rails on Inventory/Orders/
   Providers). Writing that one row **is** a house-wide on/off switch for a
   whole type. It was already built; nobody had wired a button to it yet.

## Options considered

1. **Leave it read-only.** Cheapest, but the founder's own words above rule
   it out, and the page note already flagged shipping the read-only default
   as an unanswered fork rather than a decision — leaving it stood would be
   re-reading his silence as agreement, which CLAUDE.md §0.1 forbids.
2. **A new `recommendation_type_prefs` table, keyed `(restaurant_id,
   candidate_key)`.** Cleaner grain on paper, but the founder's instruction is
   explicit — reuse, do not invent a parallel store — and it would fork the
   truth: a manager could dismiss a type from the feed (rule-scope
   dismissal, existing mechanism) while a *different* table said it was
   "on," and the two would silently disagree about what the feed shows.
   **Rejected.**
3. **Reuse `recommendation_actions` at rule scope for the write; reuse the
   existing `GET …/actions?status=dismissed` read for state.** *Chosen.* No
   new table, no migration (checked against the 20260921114000–114200 window
   given for this lane — genuinely not needed). One `status='dismissed'` row
   at the bare `insight:<candidate_key>` key already means "this whole type,
   everywhere" to every reader of that store today; a toggle is just a
   purpose-built, role-gated front door onto a write that store already
   supports.
4. **Gate the write on the existing generic `POST …/action` endpoint by
   inspecting the `ruleKey` prefix.** Rejected: that endpoint is also the
   ordinary per-card dismiss/snooze/pin any signed-in member already uses
   from the main feed, unrestricted. Bolting a role check onto it by string-
   sniffing the body would either lock staff out of their existing dismiss/
   pin (wrong) or be trivially bypassed by a client that doesn't set the
   prefix (not real access control — "a hidden route is not access control,"
   `App.tsx`'s own vendor-prices comment). [**CORRECTED 2026-09-21, last
   call:** the bypass half is wrong — the bare `insight:<candidate_key>` key
   IS the type, so a write without that exact key cannot turn the type off,
   and a gate on "a dismissed/active write at a bare `insight:` key" could
   not be sidestepped that way. The real cost is only the first half: it
   would take the feed's existing "the whole rule" dismiss and the Dismissed
   tab's Restore away from staff. That is the founder's call, not a build
   default — see Consequences, "The gate holds on one door".] A **separate**, `@Roles("owner",
   "manager")`-gated endpoint (`PUT insight-catalog/types/:restaurantId/
   :candidateKey/toggle`) that internally calls the same
   `RecommendationActionsService.setAction` keeps the shared write path
   untouched and makes the policy boundary a real one, enforced server-side
   via the existing `RolesGuard`/`@Roles` decorator (the same pattern
   `vendor-intel.controller.ts` already uses for commercially sensitive
   pricing).
5. **"Open live items" by adding a `?candidateKey=` filter to a new read
   endpoint.** Rejected as unnecessary: `GET /analytics/insights/:id
   ?categories=&refresh=true` already returns every live insight with its
   `candidateKey` and a server-computed `suppression.key` per instance
   (`insight-generator.service.ts` `record()`); the catalogue only needed to
   filter that existing response client-side to one type. No backend read
   endpoint was added. [**CORRECTED 2026-09-21, last call:** it does not
   return every live insight — `generate()` ranks and keeps the top **five
   per category** (`maxPerCategory ?? 5`) before it returns, so a type whose
   instances ranked sixth or lower in its category read "Nothing live for
   this type right now" while it had fired: absence reported as health. Fixed
   with an optional `candidateKey` query on the SAME endpoint (still no new
   endpoint): `generate({ candidateKeys })` filters BEFORE the cap, is
   uncapped for a one-type read, and is **never persisted** — `persist()`
   replaces every stored row of the requested categories, so writing one
   type's list back would have erased every other type's stored insights.
   Pinned by `insights/insight-narrowed-read.spec.ts`, mutation-tested.]

## Decision

**Actionable, built exactly on the named stores, no new table:**

- **On/off** writes `recommendation_actions` at rule scope
  (`insight:<candidate_key>`, `status: 'active' | 'dismissed'`) through a new,
  owner/manager-gated endpoint, `PUT /analytics/insight-catalog/types/
  :restaurantId/:candidateKey/toggle` (`RolesGuard` + `@Roles("owner",
  "manager")`; the actor is read from the JWT via `@CurrentUser()`, never the
  body — the existing `goal-scenarios/requests` precedent in the same
  controller). [**AMENDED 2026-09-21, last call — "audited" now means an
  audit row.** As first built, "audited" was `recommendation_actions.
  created_by`: one upserted row per key, so turning a type back on
  overwrote who had turned it off — the ADR's own "Revisit if" admitted it
  was not a trail. The write now goes through `RecommendationActionsService.
  setTypeEnabled`, which (a) refuses any key the catalogue does not list,
  (b) writes the same row as before, and (c) files a `system_audit_log` row
  (`recommendation_type_turned_on|off`, `actor_id` = the JWT's
  `public.users.user_id`, the type in `changes`) — the house's trail, the
  one `recordAccessChange` and the settings register write and `/logs`
  reads. The audit write never throws (the `recordAccessChange` contract);
  its receipt comes back as `audit` and the page says "Saved, but not written
  to the house log" when it did not land. No actor → refused before any
  write.] "Off" holds house-wide the moment it lands, because
  `generate()` was already filtering on this exact key. State is read from
  the existing `GET …/actions?status=dismissed` endpoint, client-filtered to
  bare `insight:` keys so an individual card dismissed from the feed is never
  mis-read as the whole type being off.
- **Open live items** reads the existing `GET /analytics/insights/:id
  ?categories=&refresh=true`, filtered client-side to the selected
  `candidateKey` [**CORRECTED 2026-09-21:** narrowed SERVER-side by the
  new `candidateKey` query, not client-side — see option 5's correction],
  live-generated (not the persisted `analytics_insights`
  rows, which never carry a computed `suppression` key — `persist()` does not
  write one) so every item carries the exact key a one-tap act needs. Pin and
  Dismiss on each item write the same `POST …/action` endpoint the main feed
  and the contextual rails already use, at instance scope
  (`item.suppressionKey`) — the same one-tap acts, narrower target.
  [**CORRECTED 2026-09-21, last call:** not always instance scope — an
  instance with no subject and no period has only the bare key
  (`buildSuppressionKey` degrades upward), so its "Dismiss" silenced the
  whole type, house-wide, for any member, under a one-item label. Such an
  item now offers no Dismiss and says "Dismissing this one hides the whole
  type — that is the On/Off above". A failed Pin/Dismiss is now put back and
  said ("Not saved … the item is back where it was"), as the feed's
  `setDisposition` does; it was swallowed.] **A
  scope choice narrower than the feed's own scope-picker sheet**: Snooze,
  Done and the assignment act were left out of this panel (Pin + Dismiss
  only), because they are card-specific workflow the catalogue's browse
  context does not carry (no docket entry to snooze against). Named here per
  CLAUDE.md §0.5, not silently dropped. [**Added 2026-09-21, last call —
  the stronger reason:** the insight generator this panel reads honours only
  `dismissed` (`RecommendationActionsService.listSuppressions`); a snoozed or
  done row is not a suppression there. A Snooze or Done written from this
  panel would change nothing the panel, Reports or the contextual rails
  show — a fake control. Whether the founder wants them anyway, which means
  teaching the generator to honour snoozes, is left open for him; the
  founder's "the same one-tap acts as the feed" is met for Pin and Dismiss
  only.]
- **Not built:** an "Open live items" affordance for a type that is
  `blocked` or `not_built` — there is nothing live to open, and the panel
  says so without a network call, honoring ADR 0020 (no fabricated
  availability).
- **The page stays dark** behind its existing `mudavym_design_recommendations`
  flag — no new flag, no new route gate, unchanged from sketch 120's original
  wiring.

## Consequences

- Turning a type off from the catalogue is now indistinguishable, to every
  other reader of `recommendation_actions`, from a rule-scope dismissal made
  from the feed or a contextual rail — which is the point: one truth, one
  store, three doors onto it.
- The legacy `InsightCatalog.tsx` is untouched and stays read-only (ADR 0149
  governs its deletion, not this decision); a house on the legacy flag sees
  no toggle.
- A manager can now suppress an entire type house-wide from a browse screen
  with two clicks — worth naming as the cost of the convenience: it is the
  same power a rule-scope dismiss from the feed already had, just easier to
  reach. No new blast radius, but a shorter path to the existing one.
- **The gate holds on one door (added 2026-09-21, last call).** "Owner/
  manager only" is enforced on the catalogue's toggle route and nowhere else.
  The same row — and so the same house-wide on/off — is still written by
  **any signed-in member** through `POST /analytics/recommendations/
  :restaurantId/action`: the feed's dismiss sheet offers "the whole rule"
  scope (`Entry.tsx` `scopesFor`) and a type with no subject and no period
  collapses even "this finding" to the bare key; the Dismissed tab's Restore
  sets it back to active. Those writes are also not filed in
  `system_audit_log`. Closing that means taking rule-scope dismiss and
  Restore of a bare `insight:` key away from staff, which changes the feed
  the founder already approved — so it is left open here, as the founder's
  question, not decided by the build. [**CLOSED 2026-09-21 by the founder
  — see "Round 2", answer 1: owner/manager only and audited on every door.**]
- **Revisit if:** a house asks to see *who* turned a type off and when
  beyond what `recommendation_actions.updated_at`/`created_by` already
  carries (a real audit trail, not just "audited" in the sense of "the actor
  is recorded"), or if Snooze/Done are asked for inside the live-items panel.
  [**First half CLOSED 2026-09-21, last call:** the catalogue toggle now
  files a `system_audit_log` row per change — see the Decision's amendment.
  The feed's own rule-scope dismiss still does not; see "The gate holds on
  one door".] [**Both halves CLOSED 2026-09-21 — "Round 2": every door's
  rule-wide dismiss and restore is audited, and Snooze and Done are in the
  panel now that every surface honours them.**]

## Round 2 — the founder's answers, and what was built (2026-09-21)

Both forks above went to the founder and came back the same day. His
answers, as relayed to this lane (the founder's own words are the quoted
ones; the verbatim relay is in the review trail):

1. **Rule-wide dismiss and restore** — the feed's "dismiss the whole rule",
   the Dismissed leaf's Restore, and the catalogue's toggle — are owner/
   manager only and audited **everywhere**; staff keep dismissing a single
   finding or subject.
2. **"Build it right, in order":** the engine gets ONE shared per-item state
   (dismissed with a reason / snoozed-until / done) that the feed, the
   catalogue, reports and the rails all read. In order: dismiss-with-reason
   (the reason is a labelled signal), then snooze (time suppression; the item
   returns after), then done (completion, no negative signal). Each action
   shows on the catalogue's live-items panel only once it is honoured on
   every surface.

### What "rule-wide" is, and where the gate sits

- **Rule-wide** is a key with no subject AND no period — the bare rule key or
  `rule#*#*` (`insights/item-state.ts` `isRuleWideKey`). Not
  `parseSuppressionKey().scope === 'rule'`: `scopeOf` called a period-only
  key (`rule#*#p7:…`, one period of a rule that names nothing) "rule", which
  would have gated a one-finding dismiss. `scopeOf` is corrected in the same
  change (rule scope is both wildcards), pinned by `suppression.spec.ts`.
- **A rule-wide dismiss** is `dismissed` written at such a key; **a rule-wide
  restore** is any status written over such a key while it is dismissed
  (`isRuleWideDismissOrRestore`). A snooze or done of a live rule that is
  not dismissed is neither, and stays open to staff — the answer names
  dismiss and restore only (see founder questions).
- **The gate is in the one write path every door uses**:
  `RecommendationActionsService.setActionAs` / `bulkSetActionAs`, called by
  `POST /analytics/recommendations/:id/action` and `…/bulk-action` with the
  actor read from the JWT (`actorOf(@CurrentUser())`; a body `createdBy` is
  ignored). Owner, manager or admin — `RolesGuard`'s own set — else
  `RuleWideActForbidden` → **403, before anything is written** [**round 4,
  answer 7:** owner or manager only (`mayActForTheHouse`). The platform
  `admin` is refused here too, although `RolesGuard` still admits it to the
  route]. A bulk
  selection holding any rule-wide item is refused whole. Whether a status
  write is a restore depends on the row already there, so it is read first; a
  failed read refuses the write.
- **Audited**: each rule-wide dismiss or restore files a `system_audit_log`
  row (`recommendation_rule_dismissed` / `recommendation_rule_restored`,
  actor = the JWT's `public.users.user_id`, the key, the status from/to and
  the reason). Same never-throw + receipt contract as the toggle; the feed
  says "not written to the house log" when the receipt says so. The toggle
  keeps its own `recommendation_type_turned_on|off` rows.
- **What each surface stops offering**: the feed's dismissal sheet drops "the
  whole rule" for staff and says why; a rule that names no subject and no
  period has only the whole-rule key, so staff are told to snooze it or rule
  it off instead of being shown a control the gateway would refuse [**round
  3:** such a rule's card is now keyed by its firing (`rule#*#fire:…`), so
  staff dismiss THIS firing and the "whole-rule only" sheet is left for keys
  written before round 3]; the bulk
  bar's "whole rules" is dark for staff; "Return it to the book" on a
  whole-rule dismissal is dark for staff. The catalogue, the rails and the
  Reports panel never offer a one-item act on a whole-type key at all.

### One shared per-item state

- **One resolver**: `insights/item-state.ts` `resolveItemState(target,
  book)` — dismissed, then done, then a snooze whose instant is still ahead,
  each at every scope its key can carry (`suppressingKeysFor`). A snooze with
  no instant, or a passed one, is not a snooze: the item is back.
- **Every reader calls it**: `InsightGeneratorService.generate()` (the feed's
  sentences, Reports' live reads, the catalogue's live items) and the NEW
  `readStored()` behind `getStored()` (Reports' register, the rails, the
  mobile tab, the overview, the goal suggestions, the MCP reader) withhold by
  it and count what they withheld by state (`withheld`); the feed's own
  deterministic rules resolve their state with it too
  (`RecommendationsService`), so a snooze or done written at a finding's key
  holds there. Before: the generator honoured dismissals only, the feed read
  snooze and done off the bare rule row only, and the stored read honoured
  nothing written since its last persist.
- **The stored read needed the item's identity**: `analytics_insights` now
  stores `subject` and `period_key` (migration `20260925120000`, additive,
  no backfill) and `INSIGHT_GENERATOR_VERSION` is 3, so a version-2 row —
  which cannot be resolved at the scope a state was written — is withheld and
  recomputed on first read, never served unfiltered. Stored rows go out with
  their `suppression` keys, like live ones.
- **The stored cache is state-free** [last call, 2026-09-21]: a rebuild
  stores what fired (capped per category as if nothing were hidden) together
  with what is shown, and every stored read applies the state. As first
  built, the rebuild stored only what was visible at that moment, so a
  finding snoozed across a rebuild was missing from the cache when its
  snooze ended and did not "return after" on Reports or the rails until the
  category's next rebuild — a day for `daily`, a week for `weekly`, never for
  `manual`; the same held for a dismissal or a done returned to the book.
  Bounded at twice the per-category cap; pinned by
  `insight-shared-state.spec.ts` ("snoozed while the cache is rebuilt").
- **An unreadable state is said on the rails and the Reports panel**
  [last call]: both now print that what was dismissed, snoozed or done could
  not be read when the gateway answers `suppressionsReadable: false`. Not
  done for the headline bar and command palette (`useEngineInsights`) or the
  `getStored()` callers (overview, goal suggestions, MCP, main's report
  exports), which still cannot tell that case from a clean list.
- **The rails and the Reports panel stop filtering by themselves**:
  `ContextualInsights`, `EngineInsightsPanel` and `useEngineInsights` built
  `insight:<candidate>:<entity>` keys that nothing server-side ever wrote or
  matched, filtered on them, and wrote dismissals under them — a rail
  dismissal held on that rail alone. They now act at the row's gateway-built
  key (`@/lib/recommendationState` `insightActKey`) and filter nothing.
- **1 — dismiss with a reason (the labelled signal)**: `DISMISS_REASONS` is
  a closed set — the four labels the feed and the legacy page already
  offered (`not_relevant`, `already_handled`, `disagree`, `not_now`).
  [**Round 3:** two — `not_relevant`, `disagree`. "Already handled" is
  recorded as done and "Not now" is the person's own snooze; both labels are
  still accepted at the door and routed (`planAct`).] A
  dismissal without one is a 400 from every door, the catalogue's "Off"
  included. The rails, Reports and the catalogue used to stamp
  `not_relevant` and the bulk bar `not_now` without asking; each now asks. A
  row's `reason` is non-null exactly when it is dismissed: a snooze, a done
  and a restore write it back to null, so a label is never left on an item
  that is not dismissed.
- **2 — snooze (time suppression; the item returns after)**: needs a future
  `snoozeUntil` (400 otherwise — a snooze with no instant was hidden for
  ever: `listByStatus('snoozed')` dropped it and nothing woke it). The feed's
  snooze and bulk snooze now write the finding's own key, so snoozing "this
  Wednesday" leaves next Wednesday standing.
- **3 — done (completion, no negative signal)**: carries no reason and is
  never counted as a dismissal (`withheld.done`, not `suppressed`). The
  feed's rule-off writes the finding's key.
- **The catalogue's live-items panel** now offers Snooze (the feed's three
  instants), Done, and Dismiss-with-a-reason on every item narrower than its
  type, and says how many of the type the state is holding back and that
  they are hidden everywhere. All three are shown because all three are now
  honoured on the feed, the catalogue, Reports (live and stored) and the
  rails.

### Options considered in round 2

1. **Each surface filters by the state itself** (as the rails and Reports
   did). Rejected — that is the defect: three readers, three meanings, and a
   key shape no one else wrote.
2. **An append-only table of dismissal labels**, so a restore and a
   re-dismissal do not overwrite the signal. Not built: the answer asks for
   ONE shared state, and a second table is a second store the founder has
   not asked for. The label lives on the state row while the item is
   dismissed; whether a history of labels is wanted is his question.
   [**Round 3: asked and answered — "Keep every label"; built as
   `recommendation_action_history`.**]
3. **A CHECK constraint on `recommendation_actions.reason`.** Rejected for
   now: legacy rows hold free text (the feed's and the legacy page's snoozes
   wrote "until tomorrow", "1 week" into `reason`), so a constraint needs a
   production data rewrite. Enforced at the one write path instead.
4. **`@Roles` on the POST route, or gating by the key's prefix.** Rejected:
   staff keep one-finding and one-subject acts on the same route; the gate
   reads the key's shape and the row's current state, server-side.
5. **Gate a rule-wide snooze or done too.** Not done: the answer names
   dismiss and restore. Left to the founder. [**Round 3:** a staff snooze is
   now the person's own ("Only them"); snooze for everyone is owner/manager.
   Done stays open to staff, named in the history and undoable.]

### Founder questions round 2 left open — all answered 2026-09-21 (round 3)

Moved out of "open": each is answered below, in "Round 3", in the founder's
words. What each asked, and which answer closed it:

1. Whole-rule snooze and done open to staff → **answer 4** (a staff snooze
   is the person's own; snooze for everyone is owner/manager) and **answer
   1** (done on a card that names nothing hides only this firing).
   [**Last call, round 3:** answered, not fully closed in the build. The
   snooze half is closed at the gateway. The done half holds on the new
   feed, the rails, Reports and the catalogue, which post the firing's key;
   the gateway still takes a done on a BARE rule key from any member, and
   the legacy page's Done (and its "Already handled", now recorded as done)
   sends exactly that, so a staff member there still hides the whole rule
   house-wide until someone returns it — now as a history row with their
   name. That is round 3's open question 4.] [**Round 4, answer 4:** the
   legacy page's Done and "Already handled" now post the card's own key
   (`cardKeyOf`), so no web surface sends a bare-key done. The gateway still
   takes one from any member, from an older client or a direct call. Round 4
   did not gate it: the founder's gate names dismiss and restore only.]
2. A card whose rule names no subject and no period: one finding or the
   whole rule? → **answer 1**, "Each firing is one card".
3. Done on such a card: keep until returned, or end when it next fires? →
   **answer 1**: it returns when the rule fires again.
4. Labels overwritten: an append-only history? → **answer 2**, "Keep every
   label".
5. "Already handled": a label, or done? → **answer 3**, done.
6. Legacy `/recommendations` refusal → **answer 5**, "Fix the message".
7. "Restore all" → **answer 6**: the per-card Restore as built.

### Consequences of round 2

- Staff cannot dismiss a rule that names no subject and no period — most of
  the deterministic feed rules. They can snooze it or rule it off.
  [**Superseded by round 3:** each firing is one card, so staff dismiss this
  firing; only the whole rule stays owner/manager.]
- The legacy `/recommendations` page (`Recommendations.tsx`, still what a
  house sees until `recommendations` is in `LIVE_PAGES`) dismisses on the
  bare rule key: for staff that is now a 403 and its generic "Couldn't save
  that" toast, and its optimistic hide is not rolled back until a reload.
  Not rebuilt here — ADR 0149 governs the legacy page. [**Round 3, answer
  5:** the 403 now says the founder's sentence and the card comes back.]
- Existing rows written as `snoozed` with no instant come back on every
  surface; before, they were invisible everywhere and listed nowhere.
- After deploy, every stored insight row is version 2 and is recomputed on
  its first read; until migration `20260925120000` is applied, `persist()`
  cannot write the new columns and each read computes live.
- A period-only finding's `suppression.scope` reads `insight`, not `rule`.

## Round 3 — the founder's six answers, and what was built (2026-09-21)

The seven questions round 2 left open went to the founder and came back the
same day. His picks, verbatim as relayed to this lane (the quoted words are
his; the rest is the relay's gloss, kept because it carries the detail he
chose):

1. **A subject-less rule's card** — **"Each firing is one card"**: key it by
   the rule plus the rule's own firing period (e.g. its week), so dismiss or
   done hides only this firing, and it returns when the rule fires again
   with new numbers.
2. **Labels** — **"Keep every label"**: an append-only history of every
   dismiss, restore, done and snooze, with the reason label, who and when.
   The state row may keep the latest; the history is the record.
3. **"Already handled"** is recorded as DONE, not as a dismissal.
4. **Staff snooze** — **"Only them"**: a snooze by staff is personal — it
   hides the card only for that person and is not written to the house
   history; "Not now" in the dismiss list becomes this personal snooze.
   Snooze for everyone is owners/managers, and area leads in their area once
   the areas lane lands (a typed hook here, no areas built). Staff keep Done
   and one-card Dismiss, both named in the append-only history and undoable.
5. **Legacy `/recommendations`** — **"Fix the message"**: a staff whole-rule
   dismissal there shows *"Only an owner or manager can dismiss this for the
   whole house."* instead of "try again".
6. **"Restore all"** = the per-card Restore as built; no bulk button.

### What was built

- **1 — each firing is one card.** `suppression.ts` `firingGrain` names a
  firing `fire:day:2026-09-21`, `fire:week:2026-W39` (ISO week) or
  `fire:month:2026-09`, in UTC like every business date the engine computes;
  `withFiring` keys a target by it only when the target names no subject and
  no period — anything that names either keeps the key it had. The feed
  (`RecommendationsService`) keys each such rule by the horizon the rule
  itself declares — `now` a day, `this_week` a week, `this_month` a month
  (`firingPeriodOf`); the generator's `record()` keys such a catalogue type by
  its week, the founder's own example (the catalogue carries no per-type
  horizon). The card's default key is then `rule#*#fire:…`, which is not a
  whole-rule key (`isRuleWideKey` false), so staff may dismiss or finish it,
  and a dismissal or done of this firing does not match next period's key.
  A firing is deliberately not a `d:`/`m:` data grain: `dateOfGrain` never
  matches it, so no surface offers to exclude "the day a warning was
  dismissed" from the baselines. `INSIGHT_GENERATOR_VERSION` stays 3: no
  version-3 row has been served (`main` is at 2), so the change of key needs
  no second recompute. Keys written before round 3 keep meaning what they
  meant: a bare-key dismissal still hides the whole rule.
- **2 — keep every label.** Migration `20260925120100` adds
  `recommendation_action_history`: act (`dismiss | restore | done |
  snooze`), the status it lifted (read before the write), the status it
  wrote, the label (on a dismiss, and only there — CHECKed to the two
  labels), the instant (on a snooze), whether the key is a whole rule, the
  actor (`public.users(user_id)`, ON DELETE SET NULL) and when. Append-only
  by trigger: a direct UPDATE or DELETE is refused, for the service role too;
  only a foreign key's own action passes (a deleted user's name leaves, a
  deleted house's rows go) — told apart by `pg_trigger_depth()`. RLS on,
  service role only, anon/authenticated revoked. Every house status write —
  `setActionAs`, `bulkSetActionAs` and the catalogue toggle — files a row
  and returns its receipt (`history`), on the audit contract (never throws;
  the page says "not kept in the history" when it missed). A status write
  with no signed-in person is refused (403): the history names who. Pins,
  ratings and assignments are notes, not acts, and file nothing. [Round 5,
  2026-09-22: still not acts and still no history row, but each note now
  names its author, needs a signed-in person, and files a `system_audit_log`
  row — "Gate like acts".] The
  `recommendation_actions` row keeps the latest state, as before.
- **3 — "Already handled" is done.** `DISMISS_REASONS` is two labels
  (`not_relevant`, `disagree`). The gateway routes a dismissal labelled
  `already_handled` to done with no label (`planAct`), so every door — the
  legacy page and older clients included — records done; every web dismiss
  list keeps the choice and posts `{ status: 'done' }` (`patchForChoice`).
- **4 — a staff snooze is "Only them".** Migration `20260925120200` adds
  `recommendation_personal_snoozes` — house, person, key, until, and the
  card's own words for the person's Snoozed leaf; no reason (KVKK: the
  minimum); deleted when woken, cleared once ended on the person's next
  snooze, and with the person or the house. `planAct` routes: a snooze
  `snoozeFor: 'me'` is personal for anyone; `'house'` needs owner/manager
  (`maySnoozeForEveryone`) and is refused (403), never narrowed; a snooze
  naming no audience is the house's from an owner or manager (what theirs has
  always done) and personal from anyone else; "Not now" is personal, until
  the instant sent or one day when none is (`NOT_NOW_DEFAULT_MS`, the
  shortest snooze the product offers). A personal snooze is never written to
  `recommendation_actions`, its history or the house log. It is applied only
  where a named person looks — `GET recommendations/:id` (the feed, new and
  legacy) and `GET insights/:id` (the catalogue's live items, the rails,
  Reports) — after the house state, from the JWT's user
  (`RecommendationActionsService.viewFor`); the digest, the MCP reader and
  the stored cache stay the house's one truth. Each answer says
  `hiddenForYou` and `personalSnoozesReadable` (false is said on every
  surface, never shown as none) [**CORRECTED 2026-09-21, last call:** on
  every surface but the legacy page, which reads neither this flag nor the
  house's `suppressionsReadable` (that half predates round 3). There a
  failed read of a person's own snoozes shows the cards they hid, with no
  word — more cards than they chose, never fewer.]. `GET …/snoozed-for-me` lists a person's own
  snoozes on their Snoozed leaf; `POST …/snoozed-for-me/wake` ends one. The
  area-lead half is a typed hook only: `RecommendationActor.leadsAreas`
  (always empty from `actorOf`) and `cardAreasOf` (always none) —
  `maySnoozeForEveryone` lets a lead snooze for everyone a card in an area
  they lead, which nothing can be until the areas lane fills both.
  Staff keep Done and one-card Dismiss; both are history rows with their
  name, and both are undone by a restore, itself a history row.
- **5 — the legacy message.** `Recommendations.tsx` says
  *"Only an owner or manager can dismiss this for the whole house."* on a
  403 (its own sentence for a refused return), puts the card back by reading
  the feed again, offers no Undo for what did not happen, and only says
  "Restored" when the restore landed. It also words what round 3 recorded —
  "Recorded as done", "Hidden from you — everyone else still sees it" — and
  its Undo of a personal snooze wakes it rather than writing the house's
  state. Nothing else on the legacy page was rebuilt (ADR 0149).
- **6 — "Restore all".** Nothing to build: the per-card Restore on the
  Dismissed leaf, owner/manager for a whole rule (round 2).
- **The web.** One vocabulary, `@/lib/recommendationState`:
  `DISMISS_CHOICES` (the four choices and what each records, said under the
  choice), `patchForChoice`, `undoOf`, `maySnoozeForEveryone`,
  `paperMissOf`. The feed's sheet records done or hides-for-you without
  asking a scope; its Snooze offers "Just for you" to everyone and "For
  everyone" to owners and managers, and says why to staff; the Snoozed leaf
  lists the person's own snoozes with "Wake it for me"; the standing leaf
  says how many are hidden just for you. The catalogue's live items, the
  rails and Reports post the same bodies and undo the act each was.

### Options considered in round 3

1. **Firing = every compute** (a new key per request). Rejected: a dismiss
   or done would never hold past the next read.
2. **Firing = one long run while the rule stays true.** Rejected: a done on
   `vendor_concentration` would hide it for months — the defect answer 1
   closes.
3. **Firing = the rule's own period bucket.** Chosen, as the founder said
   ("e.g. its week"); for the feed's rules the bucket is the horizon each
   rule declares (its urgency), for catalogue types the week. The mapping is
   the build's reading and is put to the founder below.
4. **History by trigger on `recommendation_actions`.** Would be atomic with
   the state write, but the actor would have to ride on `created_by`, which a
   write without an actor leaves naming the previous one. Rejected for an
   application write with a receipt, the pattern the house log already uses;
   the gap it leaves is named below.
5. **A personal snooze on `recommendation_actions`** (a row per person).
   Rejected: every reader of that table — the digest, MCP, the stored cache —
   would hide the card from the house, which "Only them" rules out.
6. **Refuse "Not now" and "Already handled" at the door** instead of
   routing them. Rejected: the legacy page (what houses see) and older
   clients send them; a 400 there would break a working control. Routed
   server-side so every door records what the founder said it means.

### Consequences of round 3

- A card that names nothing is a new card every period: a dismissal or done
  of September's `vendor_concentration` does not hide October's. Rules
  declared `now` (e.g. `stockout_imminent`) are a new card every UTC day.
- UTC, not the house's clock: a week or a day rolls over at 00:00 UTC (03:00
  in Istanbul). No house time zone exists on the analytics path to use.
- Anything two people could previously disagree over silently — who put a
  card away and why — is now a row naming them. Names leave the history when
  the person's user row is deleted; there is no retention period yet
  [**round 4, answer 6:** two years, then the name is removed and the act is
  kept (migration `20260925120300`).]
- "Not now" from the legacy page's quick Dismiss, its `d` key and its bulk
  Dismiss (all of which send `not_now` without asking) is now a one-day snooze
  for the person who pressed it, not a house-wide dismissal [**round 4,
  answer 3:** confirmed. Precisely: those controls write the rule's key, so
  the snooze hides that rule's card from the person for the day, whatever
  subject or period it names. The feed shows one card per rule, so today that
  is the card they pressed on].
- The legacy page still writes every act on the bare rule key: its Done, from
  any member, hides the whole rule house-wide until returned (now a history
  row with their name); its snooze from staff is theirs alone and is not
  listed on its Snoozed tab (that tab lists the house's). [**Round 4, answer
  4:** its Done and "Already handled" now write the card's own key. Its
  snooze and its real dismissals still write the rule's key.]
- A history row can miss while the state change holds (the receipt says so);
  the state write and the history write are two statements, not one
  transaction.

### Founder questions round 3 left open — all answered 2026-09-21 (round 4)

Moved out of "open": the founder took all seven options with "Take all
seven". Each question is answered in "Round 4" below, and the seventh (the
platform `admin`) was put in the lane's report. What each asked, and the
answer that closed it:

1. **Each rule's firing period.** Built as the horizon the rule declares —
   `now` → a day, `this_week` → a week, `this_month` → a month — and a week for
   catalogue types. Confirm, or name the period per rule. → **Round 4,
   answer 1: confirmed.**
2. **How long "Not now" hides a card** when no time is picked (the legacy
   page, its `d` key and bulk Dismiss): built as one day, the shortest snooze
   the product offers. Confirm, or name the length. → **Round 4, answer 2:
   confirmed.**
3. **The legacy page's quick Dismiss, `d` key and bulk Dismiss** send "Not
   now" without asking, so on the page houses see today they now hide a card
   from the person for a day instead of dismissing it for the house. Keep,
   or have those controls ask a label (a legacy-page change ADR 0149 would
   otherwise not make)? → **Round 4, answer 3: kept.**
4. **The legacy page's Done** is on the bare rule key, so it still hides the
   whole rule house-wide until returned — not "this firing". Move the legacy
   page's acts to the item key, or leave it to the page's retirement? →
   **Round 4, answer 4: Done and "Already handled" move to the card's key.**
5. **Undoing someone else's act.** Any member may still restore another
   person's one-card dismissal or done (named in the history). The areas
   judgement proposed "staff undo their own acts only". Keep or narrow? →
   **Round 4, answer 5: narrowed.**
6. **History retention.** No number exists anywhere in the repo. How long
   are named acts kept? → **Round 4, answer 6: two years.**

## Round 4 — the founder took all seven (2026-09-21)

The six questions above and the seventh from the lane's report (the platform
`admin`) went to the founder as seven options. He answered, verbatim as
relayed to this lane: **"Take all seven"**. The seven options he took, in the
relay's words:

1. A card's firing lasts the rule's own period: `now` is a day, `this_week` a
   week, `this_month` a month, and catalogue rules a week. Confirm the build.
2. "Not now" hides a card for 1 day unless a time is picked. Confirm.
3. On the legacy `/recommendations` page, the quick Dismiss (and its `d` key
   and the bulk Dismiss) becomes that personal 1-day "Not now". Confirm.
4. Fix the legacy page so Done and "Already handled" act on the single
   card's item key, not the whole rule.
5. Staff can undo only their own acts; owners and managers can undo anyone's.
6. The action history keeps people's names for 2 years. After that the name
   is removed or pseudonymised, and the act is kept.
7. The platform `admin` role never acts for a house's cards unless that
   person is also an owner or manager of that house. This lines up with the
   areas lane's `mayActForEveryone`, which leaves `admin` out.

### What was built

- **1 and 2 — confirmed, nothing rebuilt.** The numbers are now pinned by a
  test, so the names alone can no longer carry them
  (`recommendation-round4.spec.ts`):
  - `firingPeriodOf` maps `now`, `this_week` and `this_month` to a day, a
    week and a month;
  - the generator keys a catalogue type by its week (round 3's spec);
  - `NOT_NOW_DEFAULT_MS` is 24 hours;
  - a picked time is kept, and a time already past counts as no pick, so the
    card hides for one day.
- **3 — confirmed.** The legacy page's `d` key, its right-click Dismiss and
  its bulk Dismiss send `not_now` with no instant. The gateway turns that
  into the person's own one-day snooze. This is pinned by
  `Recommendations.test.tsx`.
- **4 — the legacy Done is this card's.** `Recommendations.tsx` `cardKeyOf`
  reads the key the gateway built for the card (`suppression.key`: the exact
  finding, or the rule plus its firing).
  - Done and "Already handled" write that key, and their Undo returns it.
  - A card that arrives without a key writes nothing and says so
    (`NO_CARD_KEY`), so the page never falls back to the whole rule.
  - A real dismissal ("Not relevant", "Disagree") and "Not right now" keep
    the key they had: a real dismissal on the legacy page is still the
    owner/manager whole-rule door.
- **5 — staff undo only their own acts.** An *undo* is any house status
  write over a row that holds somebody's act (`holdsAnAct`): a dismissal, a
  done, or a house snooze that is still running. That covers a return to the
  book, and also a different act laid over the first (a done over a
  dismissal lifts it just the same).
  - **Whose act it is** comes from the append-only history (`authorOf`). The
    newest row for the key, in this house, names the person, but only when
    that row wrote the status the state row holds now.
  - **An act nobody can name** is not provably anyone's own, so only an
    owner or manager undoes it. This covers an act with no history row, an
    act whose newest row belongs to another act, and a name the two-year
    rule removed (`mayUndo`).
  - **The check runs before anything is written** (`assertMayUndo`, in
    `setActionAs` and `bulkSetActionAs`). A bulk selection that holds one
    such act is refused whole.
    - A refusal is a 403 whose body carries `code: "not_your_act"` next to
      the sentence (`refusedAct` in the controller).
    - For an owner or a manager, or a write over a row that holds nothing,
      the history is not read at all.
  - **A history read that fails refuses the write**, and so does a read
    that fills a whole page (PostgREST `max_rows`, 1000) before it reaches
    every key. The gate never opens on a partial answer.
  - **The tabs say it ahead of time.** `GET …/actions` gives each row an
    `undoableByYou` field:
    - true for an owner or a manager, and for anyone on a row that holds
      nothing;
    - for staff, true only on their own act;
    - false for the platform admin;
    - null when the history could not be read. Then the control stays open,
      and the gateway decides at the write.
  - **What the pages show.** The feed's Entry and the legacy tab row both
    show a dark "Return it to the book" / "Restore to feed" with *"Only the
    person who did this, or an owner or manager, can undo it."*. A refused
    write says the gateway's own sentence (`notYourActOf`), never the
    whole-house one.
- **6 — a name is kept two years.** Migration `20260925120300` (in the lane
  band; renumbered 2026-09-25, see Status) adds three things:
  - `recommendation_action_history_name_kept_for()` holds the period, two
    calendar years, in one place;
  - a replaced append-only trigger lets exactly one more change through, at
    any trigger depth: `actor_id` set to NULL on a row acted on more than two
    years ago, with every other column unchanged. Nothing younger than that
    can be touched, and no row can ever be deleted;
  - `recommendation_action_history_forget_old_names()` is the sweep. It
    returns how many names it removed, and only the service role may run it.
  - `RecommendationHistoryRetention` (in the gateway) runs the sweep daily at
    03:45 UTC. A name's two years end on its own date, so a yearly run would
    keep some names nearly three years. It says 0 as a real answer, reports
    a failed call as a failed run, and `lastRun()` is null until the first
    run.
  - **Removed, not pseudonymised.** The founder allowed either. A stable
    pseudonym can be joined back to the person by anyone who can compute it,
    so under KVKK it is still personal data; NULL keeps the minimum. The cost:
    after two years the history cannot tell two acts by one person from acts
    by two people.
  - The rule is proven by the self-asserting SQL test
    `supabase/tests/20260925120300_…_test.sql` (T1–T10) on a database built
    from every migration.
- **7 — the platform admin makes no house act.** `mayActForTheHouse` is
  owner or manager. It is the one set behind `mayActRuleWide`,
  `maySnoozeForEveryone`, the undo gate and the catalogue toggle, and it
  draws the same line as the areas lane's `mayActForEveryone`.
  - The role is the one the token's house gives (`JwtStrategy.validate` →
    `roleInHouse`, ADR 0162). An owner or manager of the house reads `owner`
    or `manager` from their access row there, so `admin` only reaches this
    code for a person with no role in the house.
  - `planAct` refuses the admin's dismiss, done, restore or snooze for
    everyone with a 403, before anything is read. Their own snooze and "Not
    now" hide a card from them alone, and a note (pin, rating, assignment)
    stays a note. [Round 5, 2026-09-22: no longer — `planAct` refuses the
    admin's notes too, a first note included.]
  - The catalogue toggle now takes the token's role and refuses anyone but
    an owner or manager inside the service (`setTypeEnabled`), because the
    route's `RolesGuard` still admits `admin`.
  - On the web, `mayActForTheHouse` in `@/lib/recommendationState` drops
    `admin` from `maySnoozeForEveryone`, the feed's `canActRuleWide` and the
    catalogue's on/off control.

### Options considered in round 4

1. **Whose act, from `recommendation_actions.created_by`.** Rejected. A write
   with no actor used to leave it naming the previous one (round 3, option
   4), and it holds one name for a row that many acts touch. The history is
   the record the founder asked for.
2. **An act nobody can name counts as anyone's.** Rejected: a gate that opens
   when it cannot see is not a gate. The cost is named below and put to the
   founder.
3. **Undo = only a return to the book.** Rejected. A done or a dismissal laid
   over someone's act lifts it just the same, so a narrower rule would leave
   an open door beside the gated one.
4. **A pseudonym instead of NULL** after two years. Rejected: it is still
   personal data (above).
5. **`pg_cron` for the sweep.** Not used. No migration in the repo schedules
   a job, and the gateway already runs the raw-mail retention the same way
   (`RawMailRetentionCron`), with a status someone can read.
6. **Take `admin` out of `RolesGuard`.** Not done. That guard gates every
   `@Roles` route in the gateway, and the founder's answer is about a house's
   cards. The refusal sits in the recommendation write path and the toggle.

### Consequences of round 4

- **Every act made before the history existed names nobody.** That is every
  `recommendation_actions` row a house has today. After this lands, only an
  owner or manager can return one of them. Staff lose Restore on their own
  pre-history dismissals and dones (the founder question below).
- A staff member's own act whose history row missed is also not provably
  theirs, so an owner or manager returns it. The receipt already says "not
  kept in the history" when that happens.
- Staff can no longer wake a house snooze from the Snoozed tab. Only an owner
  or manager can make one, so it is never staff's own.
- **The gateway still takes a done on a bare rule key from any member.**
  Nothing on the web sends one after answer 4, but a direct call can. The
  founder's rule-wide gate names dismiss and restore only.
- **The platform admin's legacy-page wording.** A refused admin Done on the
  legacy page says the page's whole-house sentence, not the gateway's
  admin sentence. The new feed says the gateway's.
- **The dark Restore's sentence on an unnamed act** is the general one ("Only
  the person who did this…"). The tab row does not say whether the author is
  unknown or someone else. The refused write does say which.
- Names leave the history only while the gateway runs. The trigger permits
  the removal, it does not perform it.
- **The two-year rule reaches the history table only.** The sweep clears
  `recommendation_action_history.actor_id`. Two other places still keep the
  person's id with no end date:
  - `recommendation_actions.created_by`, the state row's last writer (its
    `uuid` column in the baseline migration, set on every write,
    `recommendation-actions.service.ts` `setAction`). No page shows it,
    because `toRow` does not return it.
  - the `system_audit_log` rows for rule-wide acts and catalogue toggles
    (`actor_id`, written by `fileAudit` for both).

  Whether "the action history" in answer 6 covers these two as well is put
  to the founder below. The build did not decide it. [Answered 2026-09-22,
  round 5, answer 3: `created_by` is now cleared on the same two-year sweep;
  the `system_audit_log` rows keep the id, on the founder's word.]
- `latestActs` reads a key's whole history newest-first in one request. A
  selection whose history passes 1000 rows before it reaches every key is
  refused (write) or shown as "could not tell" (tabs). It is never guessed.

### Founder questions round 4 left open — all answered 2026-09-22 (round 5)

Moved out of "open": the founder took the "Recommended" option on all three
(round 6w). Each is answered in "Round 5" below. What each asked, and the
answer that closed it:

1. **Acts made before the history existed** (every row a house has today)
   name nobody. As built, only an owner or manager can return them. Keep
   that, or trust the state row's `created_by` for rows that have no history
   row? → **Round 5, answer 1: "Owner/manager only (Recommended)" — kept.**
2. **The platform admin's notes.** As built, a pin, a rating or an assignment
   from the platform admin is still accepted: round 3 called these notes,
   not acts. Refuse them too? The same line decides answer 5 for notes: as
   built, staff may also change or clear a note someone else made (an
   unpin, a reassignment), because the undo gate reads status writes only.
   → **Round 5, answer 2: "Gate like acts (Recommended)" — both closed; the
   "as built" above no longer holds.**
3. **What the two-year rule covers.** As built, it removes names from
   `recommendation_action_history` only. The state row's `created_by` and
   the `system_audit_log` rows of rule-wide acts and toggles keep the id with
   no end (Consequences above). Extend the rule to them, or keep it on the
   history alone? → **Round 5, answer 3: "History + created_by
   (Recommended)" — `created_by` too; `system_audit_log` keeps its own.**

## Round 5 — three of round 4's open questions answered (2026-09-22)

Round 4 left three questions open. They went to the founder as three options,
each with a "Recommended" pick. He took the recommended pick on all three,
verbatim as relayed, and the picks are given here as the option labels he
chose:

1. **Acts made before the history existed name nobody.** "Owner/manager only
   (Recommended)" — keep as built (round 4): only an owner or manager can
   return one of them.
2. **Notes (pin, rating, assignment).** "Gate like acts (Recommended)" — the
   platform admin is refused; staff change or clear only their own note;
   owners and managers change or clear anyone's; every note change is
   audited like an act. Server-side, tested per role, mutation-tested.
3. **The two-year name rule's reach.** "History + created_by (Recommended)"
   — also clear `recommendation_actions.created_by` after two years, on the
   same job and the same schedule as the history rule. `system_audit_log`
   keeps its own retention: his words, verbatim — **"an audit trail that
   forgets who acted is no longer an audit trail."**

### What was built

- **1 — kept as built, recorded with why.** No code changed for this answer.
  Every `recommendation_actions` row a house had before migration
  `20260925120100` landed (round 3) has no history row, so `authorOf` cannot
  name who dismissed or completed it, and `mayUndo` falls to owner/manager
  only (round 4, answer 5). The founder's pick keeps that.
  - **Why, as he put it in the option and as the build reads it:** it
    *fails closed* — a gate that cannot name an author defaults to the
    narrower door, never the wider one, the same rule round 4 already gives
    an act whose history row missed or whose name the two-year sweep
    removed. And it is a **small one-time set**: only rows written before
    round 3 landed are affected; every act made since carries its own
    history row and its own author, so the gap does not grow. A staff
    member who dismissed something before round 3 loses Restore on that one
    old act; an owner or manager can still return it for them.
- **2 — notes are gated like acts.**
   - **The platform admin makes no note at all**, the same line round 4
     drew for a status write. `item-state.ts`'s `planAct` now refuses the
     admin whenever a patch touches a note field (`touchesNotes`) — pinned,
     feedback, or an assignment — not only when it carries a status. This
     closes round 4's open question 2 ("a pin, a rating or an assignment
     from the platform admin is still accepted"): it no longer is, on a
     first note or a changed one alike.
   - **Each note field gets its own author column** —
     `recommendation_actions.pinned_by`, `.rated_by`, `.assigned_by`
     (migration `20260925120400`, each `uuid references
     public.users(user_id) on delete set null`) — set on every write to
     that field (`RecommendationActionsService.setAction`). This is
     deliberately **not** `created_by`: round 4's own "Options considered"
     (#1) rejected using that single shared column for act-authorship,
     because one row holds many acts and every write overwrites it. The
     same problem is sharper for notes — one row holds *three* notes plus
     the status act, all sharing one column — so a rating from an owner
     would silently take away a staff member's right to unpin their own
     earlier pin. Proven directly: `recommendation-round5.spec.ts`, "each
     note field has its own author — a rating from an owner does not make
     staff's own pin someone else's".
   - **The gate, `mayTouchNote`** (`item-state.ts`): an UNSET field (an
     unpinned card, no rating, no assignee) is anyone's — not the admin's —
     first note to make, whatever a stale author column says. A SET field
     defers to the acts' own rule, reused: `mayUndo(actor, owner)` — their
     own, or an owner's or manager's. A SET field with **no recorded
     author** (a row from before this migration, or one whose author was
     cleared) is not provably anyone's, so it fails closed to owner/manager
     only — the same reading answer 1 gives a pre-history act, and for the
     same reason. An assignment is SET when either half is — `assigned_to`
     or `assigned_name` — because the pages show the name as the
     assignment and the gateway takes a name alone (the last call found a
     name-only assignment readable as unset, so anyone could change it).
   - **`RecommendationActionsService.assertMayTouchNotes` /
     `assertMayTouchNotesBulk`** read the row's (or rows') current note
     authors and run the gate, after `assertMayUndo` and before any write.
     A single write touching more than one note field is refused **whole**
     when any one of them is someone else's — the same "half-applied write
     leaves the page unable to say which half moved" reasoning round 4 gives
     a bulk act. A bulk selection is refused whole the same way, across
     every item and every field.
   - **`assertNamedActor` now also requires a signed-in actor for a
     note-only write** (previously only a status write needed one) — a note
     with no actor can never be filed, and the note gate would have nothing
     to check next time.
   - **Every note change is audited.** `fileNoteAudit` files one
     `system_audit_log` row per write (`action: "recommendation_note_changed"`,
     naming which field(s) changed — each as `{ from, to, from_by }`, the
     value it replaced, the value it became, and whose note it was before;
     "like an act", whose rule-wide row says `status: { from, to }` — so an
     owner clearing a staff member's pin reads back as exactly that; added
     at the last call, when the row named only the to-values), the same
     `fileAudit` a rule-wide toggle already uses — "audited" is a
     `system_audit_log` row in this codebase's own vocabulary (round 2's
     last call fixed that once already). The receipt returns as `noteAudit`
     next to the existing `audit` and `history` receipts, on both the
     single write and the bulk write.
   - **Refused with a code**, the same pattern as `not_your_act`:
     `ActRefused`'s `code` gains `"not_your_note"`, so a page can word this
     one refusal as its own later, without a text match.
- **3 — `created_by` is kept two years too.**
   - Migration `20260925120500` adds
     `recommendation_actions_forget_old_creators()`, which clears
     `created_by` on every `recommendation_actions` row whose `updated_at`
     is older than `recommendation_action_history_name_kept_for()` — the
     **same function** `20260925120300` defined, read rather than restated,
     so the period still lives in one place. Service role only, the same
     grants as the history's sweep.
   - **`RecommendationHistoryRetention.sweep()`** now calls both
     `forgetOldNames()` and `forgetOldCreators()` on the same daily tick
     (03:45 UTC), **each its own call, its own try/catch, its own count**
     (`forgotten`/`error` and `creatorsForgotten`/`creatorsError` on
     `HistoryRetentionTick`) — one failing must never read as the other's
     answer, and neither stops the other running. Proven:
     `recommendation-history-retention.spec.ts`, "one function failing
     never reads as the other's answer, and does not stop it running".
   - **`system_audit_log` is deliberately untouched.** The founder's own
     words are the rationale, recorded verbatim above; the build did not
     second-guess it. `system_audit_log` is a real audit trail — append-only,
     purpose-built for who-did-what accountability — where
     `recommendation_actions.created_by` is a mutable current-state pointer
     that happens to name a person. The same distinction is why round 4's
     retention reached the history table but not the audit log, and answer
     3 extends it to `created_by` without moving that line.
   - **The clock.** `recommendation_actions` is one row per key, upserted
     — it has no per-event timestamp the way the history does, only
     `updated_at`. `setAction` writes `updated_at` on every write and
     `created_by` in the same upsert whenever the caller has a user id —
     and every caller does: the write routes sit behind `JwtAuthGuard`,
     whose `JwtStrategy.validate` always returns the user row's `user_id`,
     so even an Act deep-link click (`acted: true` alone) names its
     clicker. For every write the gateway makes today, `created_by` was set
     exactly when `updated_at` was. Only a row whose `created_by` older code
     set while bumping `updated_at` without it can be cleared **late** by
     this clock — never early. [Corrected at the last call: the build first
     said an Act click bumps `updated_at` without touching `created_by`,
     and put a "set at" timestamp to the founder on that ground. It does
     not, for any caller with a user id, so the question fell away.]
   - **`pinned_by`, `rated_by` and `assigned_by` are NOT cleared by this
     sweep.** The founder's answer named `created_by`, by that name; those
     three columns did not exist when he was asked, because they are what
     answer 2 of this same round introduced. See "Founder questions round 5
     leaves open" below — not decided by this build. [**SUPERSEDED
     2026-09-22, round 6 — "Clear them too (Recommended)."** They now are:
     migration 20260925120600 `CREATE OR REPLACE`s the SAME function
     (`recommendation_actions_forget_old_creators()`, still that name, still
     one daily call) to also null these three. `20260925120500` itself is
     unchanged — see "Round 6" below and the corrected claim
     `ADR-0191-R5-CREATED-BY-KEPT-TWO-YEARS`.]

### Options considered in round 5

1. **Trust `created_by` for a pre-history act's authorship** (answer 1, the
   un-taken option). Rejected by the founder's pick, and for the reason
   round 4 already gave rejecting it for acts generally (see round 4,
   "Options considered", #1): it names the row's last writer, not who made
   any one act on it.
2. **Refuse the platform admin's notes only on a change, not a first note**
   (answer 2, a narrower reading considered and rejected during the build).
   The founder's option said "the platform admin is refused", not
   "refused from someone else's note" — read as a blanket rule, matching how
   round 4 refuses the admin's status writes whole, not only undos. Proven:
   `recommendation-round5.spec.ts`, "the admin is refused even for a FIRST
   note on a card nobody has touched".
3. **One `pinned_by`-style column shared by all three notes** (answer 2).
   Rejected for the exact reason `created_by` was rejected for acts: one
   column, three note kinds, every write overwrites it.
4. **A full `recommendation_note_history` table, mirroring
   `recommendation_action_history`** (answer 2). Considered and set aside:
   the acts' history table exists because one `status` column takes many
   different values over a row's life and an owner/manager needs to see the
   sequence (`listHistory`, the Dismissed/Done tabs). A note field's
   *current* author is all the gate needs — the same fact `authorOf` reads
   off the acts' history is, for a note, already sitting in a plain column.
   A parallel table would answer a question ("who made this note, ever")
   the product does not currently ask.
5. **Clear `pinned_by`/`rated_by`/`assigned_by` on the same sweep as
   `created_by`** (answer 3). Not done — see "Founder questions round 5
   leaves open": the founder was not asked about these three, because they
   did not exist yet when he answered. Building it anyway would be
   deciding a retention-scope question in his place.
6. **A single `recommendation_note_changed` audit action per note field**
   (three actions instead of one) (answer 2). Rejected: a single write can
   touch more than one field at once (a pin-and-rate in one call), and
   `changes` already names which field(s) moved — three actions would only
   split one audited event into several rows for no reader that needs it.

### Consequences of round 5

- **Every note made before this round names nobody**, the same shape as a
  pre-history act (round 4). Every `pinned`, `feedback` or `assigned_to`
  value already on a `recommendation_actions` row when migration
  `20260925120400` lands has `pinned_by`/`rated_by`/`assigned_by` NULL —
  the row exists, the value exists, but the gate cannot name who set it, so
  only an owner or manager may change or clear it from here on. A staff
  member who pinned a card before this round lands loses the ability to
  unpin it themselves; an owner or manager still can.
- **`recommendation_actions.created_by` is cleared two years after the
  row's last write, never early.** Every write today names its caller in
  the same upsert as `updated_at` (the clock, above); only a row written by
  older code that bumped `updated_at` without `created_by` can be cleared
  late. [The last call corrected this bullet: it first blamed Act
  deep-link clicks, which name their clicker.] Note the clock is the ROW's
  last write, and the name is its last writer's — `created_by` is not who
  made any one act or note (round 4, "Options considered", #1).
- **Three new actor-bearing columns exist with no stated retention.**
  `pinned_by`, `rated_by`, `assigned_by` are personal data (a `user_id`) on
  a table with no other end-date for them. Whether they should age out the
  same way `created_by` now does, or are closer to `system_audit_log`'s
  "kept, because this IS the accountability record" — is not decided here.
  See "Founder questions round 5 leaves open". [**ANSWERED 2026-09-22, round
  6: they age out the same way, on the same sweep. See "Round 6" below.**]
- **A note-only write now requires a signed-in actor.** Before this round,
  `pinned`/`feedback`/`assignedTo` could be written with no `actor.userId`
  (silently skipping `created_by`); that door is closed.
- **A write mixing a note field with a status field is now gated on both.**
  `{ status: "done", pinned: true }` in one call must pass the status gates
  (rule-wide, undo) *and* the note gate; a refusal on either side refuses
  the whole write, before anything is written — no half-applied state.
- **The web surface changed only where the gate would have made it say
  something false** (added at the last call). The legacy page — what a
  house sees until the rebuilt one is live — said the whole-house DISMISS
  sentence for a refused pin, kept the optimistic pin or rating on screen,
  and toasted "Assigned to …" after a refused assignment. It now says the
  gateway's own sentence (`noteRefusalOf`, `@/lib/recommendationState`),
  puts the note back as it was, and says no success
  (`Recommendations.test.tsx`, round 5). The rebuilt page already put a
  refused write back with the gateway's sentence (`setDisposition`), and
  now also says a missed note audit (`paperMissOf` reads `noteAudit`; its
  bulk bar sends no note). The legacy page reads no receipt at all — not
  for acts, not for notes — as before this round. Still not
  built: no page darkens a note control ahead of time the way
  `undoableByYou` darkens Restore — a `noteEditableByYou`-style flag.
  Named, not built.

### Founder questions round 5 leaves open (not decided by the build)

1. **Do `pinned_by`, `rated_by` and `assigned_by` age out the same way
   `created_by` now does?** They did not exist when the founder answered
   "History + created_by", so his answer cannot be read either way for
   them. The KVKK-minimisation reasoning behind clearing `created_by`
   applies to them by the same logic — they are mutable current-state
   columns, not an audit trail — but his stated rule named `created_by`
   specifically, and the build did not extend it past what was asked.
   Clear them on the same two-year sweep, or leave them — like
   `system_audit_log` — because a note's authorship reads closer to an
   accountability record than a status pointer does? [**ANSWERED
   2026-09-22, round 6: "Clear them too (Recommended)."** See "Round 6"
   below.]
2. [Withdrawn at the last call, 2026-09-22 — its premise was wrong. It
   asked whether an Act deep-link click, "which needs no actor", holding
   `created_by`'s clearing open called for a "set at" timestamp. Every
   write route is `JwtAuthGuard`-only and `JwtStrategy.validate` always
   returns a `user_id`, so that click names its clicker in the same upsert
   that bumps `updated_at`: there is no gap for a founder to rule on.]

## Round 6 — the founder's one answer (2026-09-22)

Round 5 left one question open: whether `pinned_by`, `rated_by` and
`assigned_by` — round 5's OWN "Gate like acts" answer introduced these three
columns in the same round he was asked "History + created_by", so that
answer could not have named them — age out on the same two-year sweep as
`created_by`, or stay because a note's authorship reads closer to
`system_audit_log`'s accountability record than to a mutable state pointer.
Put to him as a recommended option, his pick, verbatim as relayed:

> **"Clear them too (Recommended)"**: the two-year sweep that clears
> `created_by` also clears `pinned_by`, `rated_by` and `assigned_by`; after
> clearing, the note gate treats that note as owner/manager-only to change
> (test it); `system_audit_log` keeps its own retention.

### What was built

- **One sweep, not two.** Migration `20260925120600` `CREATE OR REPLACE`s
  the SAME function `recommendation_actions_forget_old_creators()`
  (`20260925120500`) — same name, same daily call
  (`RecommendationHistoryRetention.sweep()`, unchanged in this round) — so
  its `set` clause also nulls `pinned_by`, `rated_by` and `assigned_by`, and
  its `where` clause widens from "`created_by is not null`" to "any of the
  four is not null". The widening matters on its own: a row whose
  `created_by` a PREVIOUS run already cleared, but whose `pinned_by` still
  names someone, would be silently skipped forever under the narrower
  clause, because nothing else ever re-sets `created_by`. `20260925120500`
  itself is untouched — the same move it made on `20260925120300`'s shared
  period function, not a rewrite of history.
- **No gateway code changed for "test it".** `mayTouchNote` (`item-state.ts`,
  round 5) already reads a SET note field with no recorded author as not
  provably anyone's and fails closed to owner/manager — the exact reading it
  gives a note made before the author columns existed at all. It cannot
  distinguish "never recorded" from "recorded, then cleared by this sweep":
  both are `owner: null` on a set field. So the founder's "test it" is
  satisfied by naming the connection explicitly and proving both halves:
  the SQL clearing (`supabase/tests/20260925120600_..._test.sql`, T1-T12 —
  T12 proving `system_audit_log` is left byte for byte, including a
  three-year-old row naming a pinner the sweep just cleared — and the
  mutation-tested PGlite probe
  `p4-scratch/pglite-probe/RECS6-note-authors-kept-two-years.mjs`) and the
  gate's reading of a cleared column
  (`apps/api-gateway/src/analytics/recommendation-round6.spec.ts`).
- **`system_audit_log` untouched**, as the founder's own words in round 5
  already settled and this answer repeats: "an audit trail that forgets who
  acted is no longer an audit trail."
- **The claim `ADR-0191-R5-CREATED-BY-KEPT-TWO-YEARS` is corrected, not
  rewritten.** Its text said these three columns "are deliberately NOT
  cleared by this sweep" — true when written, now superseded. Its `verify`
  is untouched, because it still greps migration `20260925120500`
  specifically, and that file did not change. See CLAIMS.jsonl's bracketed
  correction and the new row `ADR-0191-R6-NOTE-AUTHORS-KEPT-TWO-YEARS`.
  [**AMENDED 2026-09-25, lane L10a:** its `verify` is no longer untouched.
  A mutation test found it never read the `SET` clause — replacing
  `set created_by = null` with `set created_by = created_by` in
  `20260925120500` left it passing — so it now also requires that exact
  line (`grep -qxF`), and the same mutation fails it. The claim's text is
  unchanged.]

### Options considered in round 6

1. **A second, separate sweep function for the three note columns**,
   scheduled independently. Rejected: the founder's own words name ONE
   sweep — "the two-year sweep that clears `created_by` ALSO clears" the
   other three — and a second job doubles the failure surface
   (`RecommendationHistoryRetention.sweep()` already isolates the history
   sweep from the `created_by` sweep with independent try/catch; a third
   independent call would need the same, for no benefit this answer asked
   for).
2. **Rename `recommendation_actions_forget_old_creators()`** to something
   naming all four columns (e.g. `..._forget_old_authors`). Considered and
   set aside: the gateway's `FORGET_OLD_CREATORS_RPC` constant, every test
   that asserts it, and the CLAIMS verify scripts that grep the RPC name by
   string would all need to move for a naming nicety with no behavioural
   difference. The function's own `COMMENT ON FUNCTION` says what it now
   does; that is where a reader looks.
3. **Narrow the WHERE clause to `created_by is not null`, unchanged, and
   null the other three only as a side effect of rows that clause already
   matches.** Rejected: a row can reach two years old with `created_by`
   already cleared (by a previous run) while a note-author column still
   names someone — round 5's own build made this reachable the moment
   `20260925120500` first ran. The widened clause (any of the four) is
   proven necessary by the SQL test's T4/R2 fixture and the probe's `M1`
   mutation.
4. **Extend `mayTouchNote` or `assertMayTouchNotes` with an explicit
   "cleared by retention" case**, distinct from "never recorded". Rejected:
   nothing in the product needs to tell the two apart — both mean "not
   provably anyone's", and the founder's own round-5 reasoning (fails
   closed) already covers this exact shape. Adding a branch that behaves
   identically to the existing one would be an untested distinction with no
   caller.

### Consequences of round 6

- **A note made more than two years ago and never touched since is now
  owner/manager-only to change, even if it was staff's own.** Same shape as
  round 5's `created_by` consequence and round 4's pre-history act: a
  small, one-time, backward-looking set — every note this reaches was
  already at least two years old the day this migration lands, and the set
  does not grow, because any write refreshes `updated_at` and so the row's
  clock.
- **The four author columns now share one clock (`updated_at`), not four.**
  A write to ANY field on a `recommendation_actions` row — a status change,
  a different note — bumps `updated_at` for the whole row, which resets the
  two-year countdown for every column on it, author columns included. A
  card whose status is touched occasionally but whose pin was set once,
  long ago, keeps its `pinned_by` un-cleared for as long as the row itself
  stays active. This was already true of `created_by` alone (round 5); it
  now also governs the three note columns, together.
- **Restated for clarity, not new:** the sweep still never throws a false
  "removed none" — `parseCount` in `recommendation-history-retention.ts` is
  unchanged by this round, and a failed call is still a failed run.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created; built in lane `recs-catalogue` (`wt-recs-cat`) |
| 2026-09-21 | last call (Opus) | Amended before merge: (1) "audited" is a `system_audit_log` row per toggle, not the overwritten `created_by`; (2) the toggle refuses keys the catalogue does not list; (3) "open live items" narrows server-side before the five-per-category cap and never persists — the client-side filter called a fired type empty; (4) a failed live Pin/Dismiss is put back and said, as the feed does; unreadable dismissals and an unreadable on/off read are said, not shown as clean; (5) option 4's "trivially bypassed" and option 5's "every live insight" corrected in place; the one-door gate recorded as a founder fork. |
| 2026-09-21 | founder (relayed to lane `recs-catalogue`) | Answered both forks, verbatim as relayed: "(1) rule-wide dismiss and restore (the feed's 'dismiss the whole rule', Restore all, the catalogue toggle) are owner/manager only and audited EVERYWHERE; staff keep dismissing a single finding or subject; (2) "Build it right, in order": the engine gets ONE shared per-item state (dismissed with a reason / snoozed-until / done) that the feed, the catalogue, reports and the rails all read; build in order dismiss-with-reason (the reason is a labelled signal), then snooze (time suppression; the item returns after), then done (completion, no negative signal); show each action on the catalogue's live-items panel only once it is honoured on every surface." |
| 2026-09-21 | — | Round 2 built in lane `recs-catalogue` (`wt-recs-cat`): the gate in `setActionAs`/`bulkSetActionAs`, `item-state.ts`, the stored read, migration `20260925120000`, the four web surfaces. "Restore all" in the relay is read as the Dismissed leaf's Restore (no control by that name exists; the question put to him said "the Dismissed tab's Restore"). |
| 2026-09-21 | last call (Opus), round 2 | Amended before merge: (1) the stored cache is state-free — a rebuild stores what fired as well as what is shown, so a snooze that ends, or a dismissal or done returned to the book, is back on Reports and the rails without waiting for the category's next rebuild (the first build persisted only what was visible, so the founder's "the item returns after" did not hold on the stored surfaces); (2) the rails and the Reports panel say when the state could not be read; (3) two code citations the new lines shifted (`mcp-tool-readers.service.ts`, `house-letters.service.ts`) now name the function instead of a line range; (4) the round's founder questions are written here — the text pointed at a section that did not exist — with the subject-less-card question added. |
| 2026-09-21 | founder (relayed to lane `recs3`) | Answered round 2's seven questions with six picks, verbatim as relayed: (1) "Each firing is one card"; (2) "Keep every label"; (3) "Already handled" recorded as DONE; (4) "Only them" — staff snooze is personal, "Not now" becomes it, snooze for everyone owners/managers (area leads once that lane lands); (5) "Fix the message" — 'Only an owner or manager can dismiss this for the whole house.'; (6) 'Restore all' = the per-card Restore as built, no bulk button. |
| 2026-09-21 | — | Round 3 built in lane `recs3` (`wt-recs-cat`): firing keys (`suppression.ts`, the feed, the generator), `recommendation_action_history` (20260925120100) and `recommendation_personal_snoozes` (20260925120200), `planAct` routing, the personal view on the two named-person reads, the legacy message, the four web surfaces; round 3's six open questions written above. |
| 2026-09-21 | last call (Opus), round 3 | Amended before merge: (1) "Only them" had no test that could fail: the write-path stub ignored every filter, so dropping the `user_id` or `restaurant_id` filter from `listForMe`, or the `user_id` filter from `wakeForMe`, left all 45 round-3 tests green. Each of those drops means one person's snooze hides the card from the whole house, or a wake ends someone else's snooze. A table stub that applies the filters, with rows for two people and two houses, now kills all three (`recommendation-round3.spec.ts`, "a snooze for me is read, applied and woken for me alone"). (2) The mapping of round 2's first question now says its done half is not closed at the gateway: a bare-key done from any member still hides the whole rule, and the legacy page sends one (round 3 open question 4). (3) The claim that every surface says an unreadable personal read is corrected: the legacy page says neither flag. |
| 2026-09-21 | founder (relayed to lane `recs4`) | Answered round 3's seven questions, verbatim as relayed: "Take all seven" — (1) firing = the rule's own period, confirmed; (2) "Not now" = 1 day unless a time is picked, confirmed; (3) the legacy quick Dismiss, `d` key and bulk Dismiss are that personal Not now, confirmed; (4) legacy Done and "Already handled" act on the card's item key; (5) staff undo only their own acts, owners/managers anyone's; (6) names kept 2 years, then removed or pseudonymised, the act kept; (7) the platform `admin` never acts for a house's cards unless also its owner or manager. |
| 2026-09-21 | — | Round 4 built in lane `recs4` (`wt-recs-cat`): the undo gate (`holdsAnAct`, `authorOf`, `mayUndo`, `assertMayUndo`, `undoableByYou`, `not_your_act`), `mayActForTheHouse` without `admin` (gateway, toggle, web), the legacy page's `cardKeyOf`, migration `20260925120300` + `RecommendationHistoryRetention`; round 4's two open questions written above [a third, what the two-year rule covers, was added at round 4's last call]. |
| 2026-09-21 | last call (Opus), round 4 | Amended before merge, docs only: (1) the two-year rule clears `recommendation_action_history.actor_id` only; `recommendation_actions.created_by` and the `system_audit_log` rows of rule-wide acts and toggles keep the id with no end. This is now said under Consequences and put to the founder as question 3. (2) Question 2 now also says that, as built, staff may change a note someone else made, because the undo gate reads status writes only. (3) The page note's round-4 bracket said the admin "is offered no house act"; the new feed still offers a card's Done and Dismiss, which the gateway refuses, and the bracket now says so. Re-run on the staged tree: 5 gateway suites (121 tests) and 17 web files (313 tests) green. Two mutations, both killed: `authorOf` without its status match (2 tests), and the legacy Done on the rule key (1 test). |
| 2026-09-22 | founder (relayed to lane `recs5`, round 6w) | Answered round 4's three open questions, each as a "Recommended" option, all three taken verbatim as relayed: (1) "Owner/manager only (Recommended)" — keep as built, record why (fails closed; a small one-time set); (2) "Gate like acts (Recommended)" — the platform admin is refused, staff change or clear only their own notes, owners/managers any, every note change audited like an act, server-side, tested per role, mutation-tested; (3) "History + created_by (Recommended)" — also clear `recommendation_actions.created_by` on the same two-year job as the history rule; `system_audit_log` keeps its own retention — "an audit trail that forgets who acted is no longer an audit trail." |
| 2026-09-22 | — | Round 5 built in lane `recs5` (`wt-recs-cat`): `pinned_by`/`rated_by`/`assigned_by` + the note gate (`touchesNotes`, `mayTouchNote`, `noteRefusal`, `assertMayTouchNotes(Bulk)`, `not_your_note`, `recommendation_note_changed` → `noteAudit`), migrations `20260925120400` and `20260925120500`, `RecommendationHistoryRetention.forgetOldCreators()` on the same daily tick as `forgetOldNames()`; round 5's two open questions written above [the second withdrawn at the last call]. Two pre-existing CLAIMS rows (`ADR-0191-R3-EVERY-ACT-IS-KEPT`, `ADR-0191-R4-NAMES-KEPT-TWO-YEARS`) had their `verify` text repaired in place — a shared `assertNamedActor` condition and a `forgetOldNames` refactor (its count parsing moved into a shared `parseCount`; the RPC call itself stays literal) changed the literal code shape their greps matched; the claims they check were re-confirmed true, not reworded. |
| 2026-09-22 | last call (Opus), round 5 | Amended before merge: (1) a name-only assignment (`assigned_name` set, `assigned_to` null) read as unset, so staff could change or clear someone else's — `noteOwnershipFrom` now reads either half as set; (2) the note audit named only the to-values — each field is now `{ from, to, from_by }`, like an act's row; (3) the legacy page, what houses see, worded a refused pin as the whole-house dismiss sentence, kept the refused note on screen and toasted a refused assignment as done — fixed, with `noteRefusalOf`; the rebuilt page now reads `noteAudit` for a missed house-log row (the legacy page reads no receipt, as before); (4) round 4's open questions and the round 3/4 sentences the answers made false are bracketed, not rewritten; (5) the "Act click bumps `updated_at` without `created_by`" clock gap was false — every write route is `JwtAuthGuard`-only and names its caller in the same upsert — so the migration comment, the ADR and round 5's question 2 are corrected and that question withdrawn. Fixes (1)-(3) mutation-tested: 8 mutations, all killed. |
| 2026-09-22 | founder (relayed to lane `recs6`, round 6z) | Answered round 5's one open question with the recommended option, verbatim as relayed: **"Clear them too (Recommended)"** — the two-year sweep that clears `created_by` also clears `pinned_by`, `rated_by` and `assigned_by`; after clearing, the note gate treats that note as owner/manager-only to change (test it); `system_audit_log` keeps its own retention. |
| 2026-09-22 | — | Round 6 built in lane `recs6` (`wt-recs-cat`): migration `20260925120600` (written as `20260922021000`, in that lane's band `20260922021000`–`20260922021099`; renumbered 2026-09-25, see Status) `CREATE OR REPLACE`s `recommendation_actions_forget_old_creators()` (unchanged name) to also null `pinned_by`/`rated_by`/`assigned_by`, widening its `WHERE` to any of the four author columns; `20260925120500` itself is untouched. No gateway code changed — `mayTouchNote` already fails closed on a cleared author. Proof: `supabase/tests/20260925120600_..._test.sql` (T1-T11, then T12 — `system_audit_log` untouched by two sweeps — added the same morning), the PGlite probe `RECS6-note-authors-kept-two-years.mjs` (control + 4 mutations, all caught), and `recommendation-round6.spec.ts` (the gate's reading of a cleared column). The claim `ADR-0191-R5-CREATED-BY-KEPT-TWO-YEARS` is corrected in place, bracketed — its text said these three columns "are deliberately NOT cleared"; its `verify` is untouched because it still greps `20260925120500` alone, which did not change. New claim: `ADR-0191-R6-NOTE-AUTHORS-KEPT-TWO-YEARS`. Round 5's open question 1 (the one this round answers) is bracketed, not rewritten. |
| 2026-09-25 | lane L10a (`feat/recs-catalogue-round6`) | Carried the pushed rounds 1–5 (`origin/wip/2026-09-21/fin-recs-catalogue`, `c7db79871`) and the uncommitted round 6 (`wt-recs-cat`'s index plus its one unstaged edit, T12) onto `origin/main` `059169a59`; renumbered the seven migrations and four SQL tests past main's `20260922231300` (see the Status bracket). No decision changed. Two consequences of main having moved on, fixed here: (1) main's `/reports` export (`ReportCuttingReader`, OD-81, #391) still read the stored feed the pre-round-2 way (`getStored`, and "no rows" as a cold start), so it would recompute and persist the whole feed whenever every stored row was withheld, and dropped the withheld counts the page carries; it now makes the page's exact `readStored` call and returns the page's shape. It does NOT apply the person's own snoozes (round 3, answer 4): an export is queued, read later with no one looking, and its file can reach other people, so it is the house's answer, like the digest and the MCP reader. Whether an export should instead honour its requester's own snoozes is not decided here; it was reported to the register's owner as a candidate open decision. (2) The CLAIMS carry-over had kept round 1's `ADR-0191-CATALOGUE-TOGGLE-ROLE-GATED` beside round 2's rewrite of it; the stale row is removed. (3) `ADR-0191-R6-NOTE-AUTHORS-KEPT-TWO-YEARS`'s verify ended by testing for the p4-scratch probe file at an absolute local path; it passed on the machine that wrote it and failed CI ("Decision register matches reality", run 36192507398) as REGRESSED. That clause now checks the in-repo SQL test for T12; the row's text is bracketed, not rewritten. Proof on the carried tree: the full gateway jest run, 491 suites passed (2 skipped) / 7936 tests passed (14 skipped), 0 failed; web vitest 288 files / 3907 tests; the four SQL tests pass on a PGlite build of all 224 migrations and each fails on a build that stops before its own migration; `check_decision_claims.sh` 500/500 (locally, and after fix (3) in CI). |
