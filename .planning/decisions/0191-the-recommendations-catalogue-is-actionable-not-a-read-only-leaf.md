# 0191 — The recommendations catalogue is actionable, not a read-only leaf

- **Status:** Locked (founder, 2026-09-21). Both forks it left open were answered by the founder the same day and are built — see "Round 2" below.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** recommendations, catalogue, insight catalog, candidate type, on/off, toggle, recommendation_actions, insight prefs, rule toggle, suppression, audited, owner/manager, one-tap acts, CatalogView, InsightCatalog, NEW-434, NEW-707, ADR 0149
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
  it off instead of being shown a control the gateway would refuse; the bulk
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
  offered (`not_relevant`, `already_handled`, `disagree`, `not_now`). A
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
3. **A CHECK constraint on `recommendation_actions.reason`.** Rejected for
   now: legacy rows hold free text (the feed's and the legacy page's snoozes
   wrote "until tomorrow", "1 week" into `reason`), so a constraint needs a
   production data rewrite. Enforced at the one write path instead.
4. **`@Roles` on the POST route, or gating by the key's prefix.** Rejected:
   staff keep one-finding and one-subject acts on the same route; the gate
   reads the key's shape and the row's current state, server-side.
5. **Gate a rule-wide snooze or done too.** Not done: the answer names
   dismiss and restore. Left to the founder.

### Founder questions round 2 leaves open (not decided by the build)

1. **Whole-rule snooze and done are open to staff** — the answer named
   dismiss and restore. The gateway takes any future `snoozeUntil`, so a
   staff snooze of a whole rule to a far date, or a done on it, hides the
   rule house-wide with no house-log row: in effect the dismissal the answer
   reserved for owner/manager. Gate them too, cap the snooze, or keep?
2. **A card whose rule names no subject and no period** (most deterministic
   feed rules: `plowhorse_repricing`, `vendor_concentration`, …) has only the
   whole-rule key, so staff can no longer dismiss it at all — only snooze it
   or mark it done. Is such a card "a single finding" staff keep, or "the
   whole rule"?
3. **Done on such a card** hides the rule until someone returns it. Keep, or
   should done end when the rule next fires?
4. **Labels are overwritten**: the label lives on the state row, so restore
   then re-dismiss replaces the earlier one. Is an append-only history of
   labels wanted for the model?
5. **"Already handled"** is a dismissal label but means what done means
   (completion, no negative signal). Keep it as a label, or record done?
6. **Legacy `/recommendations`** (what a house sees until the page is in
   `LIVE_PAGES`) dismisses whole rules: staff now get a refusal there. Patch
   the legacy page, or accept until go-live?
7. **"Restore all"** in the relay is read as the Dismissed leaf's Restore —
   no control by that name exists. Confirm, or was a bulk control wanted?

### Consequences of round 2

- Staff cannot dismiss a rule that names no subject and no period — most of
  the deterministic feed rules. They can snooze it or rule it off.
- The legacy `/recommendations` page (`Recommendations.tsx`, still what a
  house sees until `recommendations` is in `LIVE_PAGES`) dismisses on the
  bare rule key: for staff that is now a 403 and its generic "Couldn't save
  that" toast, and its optimistic hide is not rolled back until a reload.
  Not rebuilt here — ADR 0149 governs the legacy page.
- Existing rows written as `snoozed` with no instant come back on every
  surface; before, they were invisible everywhere and listed nowhere.
- After deploy, every stored insight row is version 2 and is recomputed on
  its first read; until migration `20260921115500` is applied, `persist()`
  cannot write the new columns and each read computes live.
- A period-only finding's `suppression.scope` reads `insight`, not `rule`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created; built in lane `recs-catalogue` (`wt-recs-cat`) |
| 2026-09-21 | last call (Opus) | Amended before merge: (1) "audited" is a `system_audit_log` row per toggle, not the overwritten `created_by`; (2) the toggle refuses keys the catalogue does not list; (3) "open live items" narrows server-side before the five-per-category cap and never persists — the client-side filter called a fired type empty; (4) a failed live Pin/Dismiss is put back and said, as the feed does; unreadable dismissals and an unreadable on/off read are said, not shown as clean; (5) option 4's "trivially bypassed" and option 5's "every live insight" corrected in place; the one-door gate recorded as a founder fork. |
| 2026-09-21 | founder (relayed to lane `recs-catalogue`) | Answered both forks, verbatim as relayed: "(1) rule-wide dismiss and restore (the feed's 'dismiss the whole rule', Restore all, the catalogue toggle) are owner/manager only and audited EVERYWHERE; staff keep dismissing a single finding or subject; (2) "Build it right, in order": the engine gets ONE shared per-item state (dismissed with a reason / snoozed-until / done) that the feed, the catalogue, reports and the rails all read; build in order dismiss-with-reason (the reason is a labelled signal), then snooze (time suppression; the item returns after), then done (completion, no negative signal); show each action on the catalogue's live-items panel only once it is honoured on every surface." |
| 2026-09-21 | — | Round 2 built in lane `recs-catalogue` (`wt-recs-cat`): the gate in `setActionAs`/`bulkSetActionAs`, `item-state.ts`, the stored read, migration `20260921115500`, the four web surfaces. "Restore all" in the relay is read as the Dismissed leaf's Restore (no control by that name exists; the question put to him said "the Dismissed tab's Restore"). |
| 2026-09-21 | last call (Opus), round 2 | Amended before merge: (1) the stored cache is state-free — a rebuild stores what fired as well as what is shown, so a snooze that ends, or a dismissal or done returned to the book, is back on Reports and the rails without waiting for the category's next rebuild (the first build persisted only what was visible, so the founder's "the item returns after" did not hold on the stored surfaces); (2) the rails and the Reports panel say when the state could not be read; (3) two code citations the new lines shifted (`mcp-tool-readers.service.ts`, `house-letters.service.ts`) now name the function instead of a line range; (4) the round's founder questions are written here — the text pointed at a section that did not exist — with the subject-less-card question added. |
