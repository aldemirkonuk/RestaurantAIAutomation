# 0191 — The recommendations catalogue is actionable, not a read-only leaf

- **Status:** Locked (founder, 2026-09-21).
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
  question, not decided by the build.
- **Revisit if:** a house asks to see *who* turned a type off and when
  beyond what `recommendation_actions.updated_at`/`created_by` already
  carries (a real audit trail, not just "audited" in the sense of "the actor
  is recorded"), or if Snooze/Done are asked for inside the live-items panel.
  [**First half CLOSED 2026-09-21, last call:** the catalogue toggle now
  files a `system_audit_log` row per change — see the Decision's amendment.
  The feed's own rule-scope dismiss still does not; see "The gate holds on
  one door".]

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | — | Created; built in lane `recs-catalogue` (`wt-recs-cat`) |
| 2026-09-21 | last call (Opus) | Amended before merge: (1) "audited" is a `system_audit_log` row per toggle, not the overwritten `created_by`; (2) the toggle refuses keys the catalogue does not list; (3) "open live items" narrows server-side before the five-per-category cap and never persists — the client-side filter called a fired type empty; (4) a failed live Pin/Dismiss is put back and said, as the feed does; unreadable dismissals and an unreadable on/off read are said, not shown as clean; (5) option 4's "trivially bypassed" and option 5's "every live insight" corrected in place; the one-door gate recorded as a founder fork. |
