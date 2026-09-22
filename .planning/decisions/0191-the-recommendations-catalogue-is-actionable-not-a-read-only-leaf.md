# 0191 — The recommendations catalogue is actionable, not a read-only leaf

- **Status:** Locked (founder, 2026-09-21). Both forks it left open were answered by the founder the same day and are built — see "Round 2" below. The seven questions round 2 left open were answered the same day too — six answers, built in "Round 3" below.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** recommendations, catalogue, insight catalog, candidate type, on/off, toggle, recommendation_actions, insight prefs, rule toggle, suppression, audited, owner/manager, one-tap acts, CatalogView, InsightCatalog, NEW-434, NEW-707, ADR 0149, firing, fire:week, append-only history, recommendation_action_history, snooze for me, recommendation_personal_snoozes, already handled, not now, area lead hook
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
  `RuleWideActForbidden` → **403, before anything is written**. A bulk
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
  stores `subject` and `period_key` (migration `20260921115500`, additive,
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
   name. That is round 3's open question 4.]
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
  its first read; until migration `20260921115500` is applied, `persist()`
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
- **2 — keep every label.** Migration `20260921170400` adds
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
  ratings and assignments are notes, not acts, and file nothing. The
  `recommendation_actions` row keeps the latest state, as before.
- **3 — "Already handled" is done.** `DISMISS_REASONS` is two labels
  (`not_relevant`, `disagree`). The gateway routes a dismissal labelled
  `already_handled` to done with no label (`planAct`), so every door — the
  legacy page and older clients included — records done; every web dismiss
  list keeps the choice and posts `{ status: 'done' }` (`patchForChoice`).
- **4 — a staff snooze is "Only them".** Migration `20260921170410` adds
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
  the person's user row is deleted; there is no retention period yet.
- "Not now" from the legacy page's quick Dismiss, its `d` key and its bulk
  Dismiss (all of which send `not_now` without asking) is now a one-day snooze
  for the person who pressed it, not a house-wide dismissal.
- The legacy page still writes every act on the bare rule key: its Done, from
  any member, hides the whole rule house-wide until returned (now a history
  row with their name); its snooze from staff is theirs alone and is not
  listed on its Snoozed tab (that tab lists the house's).
- A history row can miss while the state change holds (the receipt says so);
  the state write and the history write are two statements, not one
  transaction.

### Founder questions round 3 leaves open (not decided by the build)

1. **Each rule's firing period.** Built as the horizon the rule declares —
   `now` → a day, `this_week` → a week, `this_month` → a month — and a week for
   catalogue types. Confirm, or name the period per rule.
2. **How long "Not now" hides a card** when no time is picked (the legacy
   page, its `d` key and bulk Dismiss): built as one day, the shortest snooze
   the product offers. Confirm, or name the length.
3. **The legacy page's quick Dismiss, `d` key and bulk Dismiss** send "Not
   now" without asking, so on the page houses see today they now hide a card
   from the person for a day instead of dismissing it for the house. Keep,
   or have those controls ask a label (a legacy-page change ADR 0149 would
   otherwise not make)?
4. **The legacy page's Done** is on the bare rule key, so it still hides the
   whole rule house-wide until returned — not "this firing". Move the legacy
   page's acts to the item key, or leave it to the page's retirement?
5. **Undoing someone else's act.** Any member may still restore another
   person's one-card dismissal or done (named in the history). The areas
   judgement proposed "staff undo their own acts only". Keep or narrow?
6. **History retention.** No number exists anywhere in the repo. How long
   are named acts kept?

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created; built in lane `recs-catalogue` (`wt-recs-cat`) |
| 2026-09-21 | last call (Opus) | Amended before merge: (1) "audited" is a `system_audit_log` row per toggle, not the overwritten `created_by`; (2) the toggle refuses keys the catalogue does not list; (3) "open live items" narrows server-side before the five-per-category cap and never persists — the client-side filter called a fired type empty; (4) a failed live Pin/Dismiss is put back and said, as the feed does; unreadable dismissals and an unreadable on/off read are said, not shown as clean; (5) option 4's "trivially bypassed" and option 5's "every live insight" corrected in place; the one-door gate recorded as a founder fork. |
| 2026-09-21 | founder (relayed to lane `recs-catalogue`) | Answered both forks, verbatim as relayed: "(1) rule-wide dismiss and restore (the feed's 'dismiss the whole rule', Restore all, the catalogue toggle) are owner/manager only and audited EVERYWHERE; staff keep dismissing a single finding or subject; (2) "Build it right, in order": the engine gets ONE shared per-item state (dismissed with a reason / snoozed-until / done) that the feed, the catalogue, reports and the rails all read; build in order dismiss-with-reason (the reason is a labelled signal), then snooze (time suppression; the item returns after), then done (completion, no negative signal); show each action on the catalogue's live-items panel only once it is honoured on every surface." |
| 2026-09-21 | — | Round 2 built in lane `recs-catalogue` (`wt-recs-cat`): the gate in `setActionAs`/`bulkSetActionAs`, `item-state.ts`, the stored read, migration `20260921115500`, the four web surfaces. "Restore all" in the relay is read as the Dismissed leaf's Restore (no control by that name exists; the question put to him said "the Dismissed tab's Restore"). |
| 2026-09-21 | last call (Opus), round 2 | Amended before merge: (1) the stored cache is state-free — a rebuild stores what fired as well as what is shown, so a snooze that ends, or a dismissal or done returned to the book, is back on Reports and the rails without waiting for the category's next rebuild (the first build persisted only what was visible, so the founder's "the item returns after" did not hold on the stored surfaces); (2) the rails and the Reports panel say when the state could not be read; (3) two code citations the new lines shifted (`mcp-tool-readers.service.ts`, `house-letters.service.ts`) now name the function instead of a line range; (4) the round's founder questions are written here — the text pointed at a section that did not exist — with the subject-less-card question added. |
| 2026-09-21 | founder (relayed to lane `recs3`) | Answered round 2's seven questions with six picks, verbatim as relayed: (1) "Each firing is one card"; (2) "Keep every label"; (3) "Already handled" recorded as DONE; (4) "Only them" — staff snooze is personal, "Not now" becomes it, snooze for everyone owners/managers (area leads once that lane lands); (5) "Fix the message" — 'Only an owner or manager can dismiss this for the whole house.'; (6) 'Restore all' = the per-card Restore as built, no bulk button. |
| 2026-09-21 | — | Round 3 built in lane `recs3` (`wt-recs-cat`): firing keys (`suppression.ts`, the feed, the generator), `recommendation_action_history` (20260921170400) and `recommendation_personal_snoozes` (20260921170410), `planAct` routing, the personal view on the two named-person reads, the legacy message, the four web surfaces; round 3's six open questions written above. |
| 2026-09-21 | last call (Opus), round 3 | Amended before merge: (1) "Only them" had no test that could fail: the write-path stub ignored every filter, so dropping the `user_id` or `restaurant_id` filter from `listForMe`, or the `user_id` filter from `wakeForMe`, left all 45 round-3 tests green. Each of those drops means one person's snooze hides the card from the whole house, or a wake ends someone else's snooze. A table stub that applies the filters, with rows for two people and two houses, now kills all three (`recommendation-round3.spec.ts`, "a snooze for me is read, applied and woken for me alone"). (2) The mapping of round 2's first question now says its done half is not closed at the gateway: a bare-key done from any member still hides the whole rule, and the legacy page sends one (round 3 open question 4). (3) The claim that every surface says an unreadable personal read is corrected: the legacy page says neither flag. |
