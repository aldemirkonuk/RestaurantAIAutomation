---
type: charter
division: product
department: guest-experience
parent_department: product-vision
status: partial
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.event_completeness, nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.ops_conversion, nf_b.k_anonymity_pass_rate]
updated: 2026-08-24
links: ["[[guest-experience-premortem]]", "[[guest-experience-agenda-full]]", "[[guest-experience-agenda-board]]", "[[guest-experience-directive]]", "[[guest-experience-loops]]", "[[guest-experience-schedule]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[guest-value-monetization-charter]]", "[[product-vision-charter]]", "[[design-charter]]", "[[partnerships-integrations-charter]]", "[[compliance-privacy-charter]]", "[[analytics-bi-charter]]", "[[data-charter]]", "[[0006-neural-footprint-architecture]]", "[[FUTURES]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[product]]", "[[README]]", "[[DISH_IDENTITY_DESIGN]]", "[[UX_PATHS_CATALOG]]"]
---

# Guest Experience — Charter

> **This is a sub-layer under Product & Vision, not a standalone department.**
> [[ORG_STRUCTURE]] §2 lists it in the *Sub-layers* column of the Product row —
> *"Guest Experience (under Product & Vision)"* — and the org count is
> **19 departments + 2 sub-layers**, not 21 departments. It gets the full
> seven-artifact anatomy because it owns a distinct user and a distinct metric
> spine, not because it was promoted. Roadmap authority, module definition, and
> the surface portfolio remain [[product-vision-charter]]'s; this sub-layer
> answers to it.

> **Status is PARTIAL, and the honest reading is narrower than that.** One team of
> four has shipped code. Two are hard-blocked by decisions already made. One has
> zero groundwork of any kind. Read §Evidence today before reading anything here
> as a going concern.

## Mandate

Guest Experience owns the **third user type**. The product has always had two —
the owner and the staff member, both of whom are paid to be in it. The guest is
neither: nobody employs them, nobody trains them, and they will not tolerate a
business tool reskinned. The sub-layer is accountable for a deliberately
**consumer-grade** surface — closer to Beli than to a back-office console — and
for the fact that this surface is not a detour but the **demand-side input**
the autonomous backend consumes ([[FUTURES]] §7, `FUTURES.md:150`): which dishes
and bottles attract which segments, what to par, what to promote, what to 86.

Concretely: the guest identity spine and its consent record, the guest food-identity
profile (**NF-B**), the consumer app and its points economy, and everything the
guest side gives back to the restaurant.

## Boundaries

Owned outright:

- **NF-B, whole.** [[0006-neural-footprint-architecture]] defines a neural footprint
  as *stimulus → internal state → choice → outcome*, one shape across subjects.
  NF-B is that shape with `subject_type = 'guest'`. This sub-layer owns its event
  contract, its completeness definition, and the honesty of its denominators.
- **The guest identity spine** — `guests`, `guest_identifiers`, `guest_check_links`,
  and the rule that a merge happens on an exact verified key or not at all
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:27-35`).
- **The versioned consent record** and the erasure tombstone (`:54-64`, `:70-82`).
  Not the legal text — see non-goals — but the shape of the record and the promise
  that what a guest was told is reconstructible per guest, per version, per date.
- **The four staged questions.** The teams are ordered, not parallel:
  **who** ([[guest-identity-consent-charter]]) → **what they like**
  ([[taste-fingerprint-charter]]) → **where the signal comes from**
  ([[consumer-app-points-economy-charter]]) → **what the restaurant gets**
  ([[guest-value-monetization-charter]]). Reading them in that order is the roadmap
  ([[product]] §2).
- **The k-anonymity gate** on every restaurant-facing view of guest data, and the
  consent-to-reuse contract on guest photos.
- **The refusal budget.** This sub-layer is the only one in the division whose
  correctness is partly measured by what it declines to compute.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| Roadmap sequencing, module definition, surface portfolio | [[product-vision-charter]] | We are a sub-layer of it. It decides when 999.1 promotes; we decide what is inside it. |
| Consumer-app visual language, motion, component substrate | [[design-charter]] | A consumer-grade surface is a design outcome. We own that it *must* be consumer-grade and will reject a reskinned console; Design owns what it looks like. |
| Legal basis, DPA text, GDPR/CCPA interpretation, notice wording | [[compliance-privacy-charter]] | We own the *shape* of the consent record and that it is versioned. What the notice must say is not a product call. |
| The Beli relationship as a commercial negotiation | [[partnerships-integrations-charter]] (Partner & Alliance Development) | **OD-07 is open.** If it resolves toward collaboration, the deal is theirs and the product contract is ours. |
| Dish identity resolution | [[data-charter]] — deferred by A15 ([[DISH_IDENTITY_DESIGN]]) | We are the loudest *consumer* of a decision we do not own, and the deferral is a product-owner call we do not relitigate by building around it. |
| Segment analytics methodology and the metrics narrative | [[analytics-bi-charter]] | They own how a segment is computed and defended. We own that no segment renders below the k-threshold. |
| Pricing of anything, including advertising | Commercial (Finance & Pricing) | **Founder-deferred.** No pricing model is proposed anywhere in this sub-layer, deliberately. |
| Points ledger *infrastructure* (append-only write path, idempotency) | [[engineering-charter]] | The integrity *rules* are ours ([[FUTURES]] §7.3); the durable append-only mechanics are the same problem inventory already solved. |

## Metrics it moves

Every metric in this sub-layer is an `nf_b.*` metric, by design. They are staged
in the same order as the teams, and each is the denominator of the next.

| Metric | Definition | Owner | Today |
|---|---|---|---|
| `nf_b.subject_coverage` | % of `pos_checks` carrying a **consented** `guest_check_links` row | [[guest-identity-consent-charter]] | **0%** — no application code writes the table (verified, §Evidence) |
| `nf_b.false_merge_count` | Guests merged without an exact verified key | [[guest-identity-consent-charter]] | 0 — **hard gate, permanent** |
| `nf_b.event_completeness` | % of NF-B events carrying all four of `stimulus`, `choice`, `outcome`, `context` | [[taste-fingerprint-charter]] | undefined — no NF-B event has been emitted |
| `nf_b.divergence_within_cohort` | Spread of predicted preference among guests with **identical** exposure history | [[taste-fingerprint-charter]] | undefined — and the metric that catches regional averaging wearing a personalization label |
| `nf_b.events_per_active_guest_month` | Ratings, photos, verified visits per active guest | [[consumer-app-points-economy-charter]] | 0 — no consumer app exists |
| `nf_b.points_confirm_rate` | % of points reaching `confirmed` rather than expiring provisional | [[consumer-app-points-economy-charter]] | undefined — **integrity gate**; high volume + low confirm rate is farming |
| `nf_b.ops_conversion` | Restaurant decisions (par, promotion, menu experiment, 86) traceable to a named NF-B segment | [[guest-value-monetization-charter]] | 0 — **the number that decides whether this sub-layer is a social network** |
| `nf_b.k_anonymity_pass_rate` | Restaurant-facing renders passing the k-threshold | [[guest-value-monetization-charter]] | undefined — **privacy gate**, must be 100% with no admin exception |

`nf_b.subject_coverage` near zero makes every metric below it undefined rather
than bad. That distinction is load-bearing and this sub-layer will keep making it.

## Evidence today

Graded per [[product]] §0: **EXISTS** = running with an artifact · **PARTIAL** =
stub or fraction of mandate · **NEW** = *nothing in the repo backs this yet*.

**Roll-up: PARTIAL.** One shipped migration of genuine quality, a fully-written
design contract with 41 enumerated UX paths, and — beneath both — a corpus that
cannot support the modelling half.

### EXISTS — the identity slice, shipped and deliberately minimal

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` (564 lines,
commit `ce65715`). Three tables: `guests` (`:40`), `guest_identifiers` (`:122`),
`guest_check_links` (`:206`).

- **Consent is a versioned record, not a boolean** — `:54-64`:
  `consent_purpose`, `consent_notice_version`, `consent_captured_via` (CHECK-constrained
  to four capture channels), `consent_captured_at`, `consent_withdrawn_at`. The
  comment states the reason plainly: *a boolean cannot answer "what was this person
  told, on what date, and can we prove it"* (`:55-56`).
- **Erasure is a tombstone, not a soft delete** — `:70-82`, with the mechanical
  reason at `:71-74`: the application connects as `service_role`, which holds
  `rolbypassrls`, so every `deleted_at IS NULL` predicate lives in a policy the
  application never evaluates. A soft-deleted guest would still be returned by
  every query the app makes. `erased_at` means identifiers hard-deleted, label and
  consent nulled; the row survives only so historical links do not dangle (`:112-117`).
- **Four independent PII guards** — verified in this session, each closing a
  different hole, none dependent on another holding:
  1. **`display_label` is never a match key.** Declared at `:44-52`, enforced in CI
     by `scripts/check_no_guest_name_matching.sh` — regex at `:34`, `rg` sweep over
     `apps/ services/ scripts/` at `:52-53`, `exit 1` at `:74`.
  2. **Plaintext contact channels never become a column, a log line, or a jsonb
     payload.** `guest_link_identifier()` (`:375-427`) takes the raw value as an
     *argument* and persists only `hmac(canonical, per-restaurant pepper, sha256)`
     (`:405-411`); the comment at `:429-435` gives the payoff — erasure is a DELETE
     with nothing left to shred. Code-layer guard:
     `scripts/check_no_raw_guest_channels.sh`.
  3. **`guest_identifiers` is closed by grants *as well as* by policy.** `:477-485`:
     no `authenticated` policy at all, plus `revoke all ... from authenticated, anon`.
     The comment states why the belt needs braces — *"RLS-enabled-with-no-policy is
     closed only by ABSENCE, and the next person to add a policy would silently open
     the whole table."*
  4. **Cross-restaurant linkage is arithmetic, not policy.** `guest_pepper()`
     (`:338-367`) derives a per-restaurant HMAC key, so the same phone number at two
     restaurants produces two different hashes and cannot be joined even by accident
     (`:195-201`). It **raises** rather than falling back to a constant when the vault
     secret is absent (`:353-359`) — a predictable pepper on a phone hash is a
     rainbow table.
- **Merge eligibility is a generated column, not a convention** — `:168-169`,
  `GENERATED ... STORED` so a direct write fails at 42601 rather than vanishing on
  the next trigger fire. And `card_fingerprint` is quarantined as
  `shared_instrument` **regardless of verification** (`:414-420`), because a card
  fingerprint is perfectly verified and still identifies a household.
- **The evaluation gate shipped before the data** — `guest_copresence_negatives`
  (`:519-540`), the free-negative-label view: two guests on the same check are
  different people. Consumed by `scripts/eval_guest_merge_policies.py`. Ships empty
  on purpose.
- **RLS carries a `valid_until` check no other policy in the repo has** —
  `:465-475`. The comment records that all 14 live `user_restaurant_access` rows are
  `is_active=true, valid_until NULL`, so the deactivation path has never executed:
  for inventory an annoyance, for a guest list *an ex-employee retaining the customer
  database* (`:450-454`).

### ⚠️ The finding that changes how the above should be read

**The slice has zero application callers.** Grepped this session over
`apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` for
`guest_check_links`, `guest_link_identifier`, `guest_identifiers`, and
`from("guests")` — **no matches**. The schema is complete and the write path is
empty. So `nf_b.subject_coverage` is not "near zero because adoption is slow"; it
is **structurally zero** because nothing can write. That is a smaller, more
tractable problem than it sounds — and stating it correctly is the difference
between a backlog item and a mystery.

### PARTIAL — the taste side, and honestly blocked

- NF-B's event shape is defined ([[README]] §4.4) and named a priority track
  (`README.md:206`). Storage architecture is **resolved** — OD-11a, narrow polymorphic
  production table + wide append-only research log ([[0006-neural-footprint-architecture]]).
  The **column contract is not** — OD-11 open.
- ⛔ **Dish identity is DEFERRED** by explicit product-owner call, register A15,
  2026-08-20 ([[DISH_IDENTITY_DESIGN]]). Dishes stay raw POS strings, so
  `"Ribeye 12oz"` and `"Ribeye"` are different entities to any `GROUP BY`. A taste
  fingerprint over **food** cannot exist until this reverses.
- ⛔ **The corpus, measured** (`DISH_IDENTITY_DESIGN.md` §1.1): 47 `pos_checks`,
  1 restaurant, one day (2026-08-11 → 2026-08-11), 82 line items, **37 distinct
  item strings**, and no food/dish/recipe table in the schema at all.
- The **wine side is the exception and the opening**: `master_wine_library` plus
  beverage identity is the strongest data layer in the repo (`README.md:64`), and
  enrichment is in flight (commits `f7e0ea1`, `ef19b81` — 144/1,448).

### NEW — the consumer app, as code

Fully specified as design ([[FUTURES]] §7, `FUTURES.md:146-199`) and enumerated as
**41 UX paths** — §W `NEW-652…NEW-666` (`UX_PATHS_CATALOG.md:1471-1491`) and
§AB `NEW-861…NEW-885` (`:1771-1801`). Scheduled as ROADMAP backlog **999.1**
(`ROADMAP.md:639`). Grepped: **no `points_ledger`, `guest_points`, or
`points_balance` anywhere** in `apps/` or `supabase/migrations/`. `apps/mobile/src`
is the *staff* app — `api`, `components`, `design`, `guidance`, `lib`, `state`.
Greenfield, and gated on **OD-07**.

### NEW — advertising, with a live contradiction

Grepped `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src`,
`supabase/migrations/` for `advertis|sponsored|ad_slot|ad_campaign`: **no ad
inventory, no sponsor model, no placement schema.** Zero groundwork.

And a finding the team doc does not carry: the operator-facing consent copy in
`apps/web/src/components/settings/ServicesPermissions.tsx:41` lists
*"Any advertising or cross-site tracking"* under **exclusions**, and `:249` states
*"WineOps sets no tracking or advertising cookies."* That copy binds the operator
app, not a future guest app — but it is a written product promise about advertising
made on one surface while another surface charters advertising as its revenue model.
That boundary needs to be drawn deliberately, in writing, before any ad code exists.
Raised in [[guest-value-monetization-premortem]] and [[guest-experience-agenda-full]].

> `/promotions` exists as a route (`PAGE_MAP.md:120`) and
> `apps/api-gateway/src/providers/provider-intelligence.service.ts:135-222` reads
> `provider_promotions` — but that table is dormant and holds **provider** promotions,
> i.e. supply-side deals. It is **not** guest-facing advertising. Do not mistake one
> for the other; the name is the whole trap.

## Open, not decided

| ID | Fork | Where it bites |
|---|---|---|
| **OD-07** | **Beli** — build the consumer experience independently, or explore collaboration ([[OPEN-DECISIONS]]:18). Founder call after guest MVP scope exists. | [[consumer-app-points-economy-charter]]'s existence is downstream of it. **This charter takes no position.** |
| **OD-11** | NF production columns, partial-index strategy per `subject_type`, research-log retention. | Every NF-B event write. See the flag below. |
| **OD-22** | Guest monetization in Guest Experience or in Commercial? ([[product]] §5.2) | [[guest-value-monetization-charter]]. Reflected as open there. |
| **OD-20** | The 17-team Product layer as proposed, or the reduced set. | This sub-layer's headcount — see §Team count below. |

### ⚠️ Flag — the strongest human-preference signal we already collect has no `subject_type` home

`recommendation_actions` exists and carries real dispositions: a manager
dismissing, snoozing, marking done, pinning, assigning, and rating a recommendation
card `helpful` / `not_helpful` — table at
`supabase/migrations/20260805000000_baseline_from_production.sql:4908`, service at
`apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`. It is
shipped, it has been used, and it is by some distance the richest *human* preference
data in the repo — richer today than anything NF-B will hold for months.

And it does not fit. [[0006-neural-footprint-architecture]] fixes `subject_type` to
`agent | guest | bio`. An operator rejecting a recommendation is a human, but they
are not a guest and they are not an agent — and the natural-looking move (log it as
the *agent's* outcome) quietly changes the subject of the record from the person who
chose to the system that proposed, which is exactly the collapse the
stimulus → internal state → choice → outcome shape exists to prevent.

**This charter does not resolve it.** It records three live options —
(a) a fourth `subject_type` value, e.g. `operator`; (b) classify as an NF-A outcome
field and accept the subject shift; (c) a separate track outside the NF spine — and
notes that **it interacts with OD-11**: adding a `subject_type` value after the
partial-index strategy is built is a migration against live indexes, not a schema
edit. If OD-11 closes without asking this question, it closes wrong. Escalated in
[[guest-experience-agenda-full]] §Questions for the founder.

## Team count — the honest note required by the brief

**Four teams is the shape of this sub-layer, not its v0 headcount**, and the team
doc says so first ([[product]] §5.3). Each of the four can state why it is not its
sibling, and the statements hold: 2.1 is measured on **refusals**, 2.2 on
**modelling**, 2.3 faces a **different adversary** (humans farming points, not data
error), and 2.4's customer is the **restaurant**, which inverts every incentive in
the other three. None of them is a tidy-grid team.

But two of the four are hard-blocked *by decisions already made* — A15 for
[[taste-fingerprint-charter]], OD-07 for [[consumer-app-points-economy-charter]] —
and one ([[guest-value-monetization-charter]]) has zero groundwork of any kind.
Standing all four up now produces three charters with nothing to charter.

**v0 activation, recommended:** [[guest-identity-consent-charter]] only — and to
*defend and connect* what shipped, not to extend it. [[taste-fingerprint-charter]]
enters as a **wine-only** track, which is the one place the data supports it. The
other two enter on their named unblockers, written into their charters as explicit
entry triggers.
