---
type: division-teams
division: product
status: proposed
date: 2026-08-24
departments: [product-and-vision, design, partnerships-and-integrations]
sub_layers: [guest-experience]
team_count: 17
links:
  - "[[ORG_STRUCTURE]]"
  - "[[README]]"
  - "[[PAGE_MAP]]"
  - "[[ENDPOINTS]]"
  - "[[FUTURES]]"
  - "[[UX_PATHS_CATALOG]]"
  - "[[AGENT_NATIVE_UI_DECISION]]"
  - "[[OPEN-DECISIONS]]"
keywords: [teams, product, design, partnerships, guest-experience, nf-b, pos-bridge]
---

# Product Division — Team Layer

- **Division:** Product ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md), row 30 — LOCKED)
- **Departments:** Product & Vision (+ Guest Experience sub-layer) · Design · Partnerships & Integrations
- **Status:** **PROPOSED.** The department layer is locked; this team layer is not. Per
  [ADR 0002](../../decisions/0002-documentation-first-operating-mode.md), every ⬦ FORK below is the founder's.
- **Proposed:** **17 teams** across 3 departments + 1 sub-layer.

---

## 0. How to read this

Every team below carries five fields, in this order:

| Field | Rule |
|---|---|
| **Mandate** | One sentence. What this team is accountable for. |
| **Why distinct** | Why this is not its sibling. A team that cannot answer this should be merged. |
| **Evidence** | `EXISTS` / `PARTIAL` / `NEW`, with `path:line` or a named artifact. `NEW` means *nothing in the repo backs this yet* — it is not a softer EXISTS. |
| **Primary metric** | One number. Tied to NF-B ([foundation §4.2](../README.md)) where guest taste is the subject. |
| **Premortem** | One line: how this team fails. Per [ORG_STRUCTURE §4](../ORG_STRUCTURE.md), failure is written before success is assumed. |

**Grounding note.** Every `path:line` in this document was read or grepped in this
session against the working tree at `docs/foundation-memory-instructions-decisions`.
Claims marked `NEW` were searched for and **not found** — they are ambition, cited as such.

**§5 is the honest part.** Four teams I considered and am recommending *against*, plus
three merge candidates. Read it before approving the count.

---

## 1. Product & Vision — 5 teams

Department mandate (foundation §2.2): module definitions, roadmap, brand direction.
Two scan findings are assigned here by name — the POS-bridge audit (README:38–41) and the
24 unlinked routes (README:50–52).

The five named modules of the vision — Floor Checker, Email Watcher, Order Watcher,
Invoice/Receipt Understanding, Vendor Finder — are **not** given one team each. They are
grouped by **module shape**, because shape is what determines the failure mode, the
latency budget, and the guardrail pattern. Three watchers that all run
*arrive → understand → propose → human approves* are one team's problem. A module that
must reach a named waiter within seconds of a plate hitting the pass is a different
problem wearing the same word "module".

---

### 1.1 Inbound Understanding

**Mandate.** Own the definition, boundary, and doneability criteria of the three modules
that turn something arriving from outside into a structured, human-gated proposal:
**Email Watcher**, **Order Watcher**, **Invoice/Receipt Understanding**.

**Why distinct.** All three share one shape and therefore one guardrail contract: input is
adversarial and unstructured, extraction is probabilistic, and the output must never
execute itself. They fail the same way (a confident wrong extraction that a human rubber-stamps),
so they need one confidence/gate standard, not three. Splitting them per-module would
produce three incompatible approval UXs — the exact failure FUTURES §8.3 names for chatbots.

**Evidence — PARTIAL (all three have running code):**
- Email Watcher: `apps/api-gateway/src/communications/gmail-watch.service.ts`, plus
  `apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts`
  (`POST /webhooks/inbound-email` — public webhook, [ENDPOINTS.md:120-124](../ENDPOINTS.md)).
  Phase 0 inbound-email intelligence (triage signals, shadow classification, durable
  notifications, conservative reply gate) shipped on `feat/inbound-email-intelligence-phase0`.
- Invoice/Receipt Understanding: `apps/api-gateway/src/procurement/documents/`
  (`document-extractor.service.ts`, `document-intake.service.ts`, `line-matcher.ts`,
  `credit-ledger.ts`, `x12/`) and `apps/api-gateway/src/procurement/invoice-match.ts`
  with a backtest spec (`invoice-match.backtest.spec.ts`).
- Order Watcher: `apps/api-gateway/src/procurement/` + `recurring-orders.controller.ts`
  + `apps/api-gateway/src/one-tap-actions/` (the human-gate primitive already exists).
- The guardrail pattern is already the house style — vendor-reply AI drafts, never auto-sends.

**Primary metric.** *Proposal acceptance rate without edit*, per module, per document type —
with a paired **false-accept audit** (accepted proposals later corrected). Feeds NF-A
(`outcome` + `doneability verdict`, foundation §4.4).

**Premortem.** Extraction accuracy is reported on the corpus it was tuned on; the first
real vendor with a two-column PDF and a credit memo halves it, and because acceptance was
the only metric, nobody notices until a restaurant's cost basis is wrong.

---

### 1.2 Service Floor (Floor Checker)

**Mandate.** Define **Floor Checker**: waiter check-in timing, and notifying *the specific
waiter* when *their* table's food is up.

**Why distinct.** It is the only named module with a real-time constraint and a
person-level routing requirement. Everything in §1.1 is asynchronous and tolerates
minutes; Floor Checker tolerates seconds, has no undo (a late ping is worthless, a
wrong-waiter ping is noise), and needs three data joins the rest do not: table→server,
server→device, kitchen-ready→ticket. Putting it under Inbound Understanding would let its
latency budget be traded away for extraction quality.

**Evidence — NEW.** Named at [foundation README:65](../README.md) as L2, state
"unbuilt". No `floor`/`floor-checker` module, service, or route exists — grepped across
`apps/`, `services/`, `supabase/` (only three doc mentions: README:65,
`decisions/0001-mudavym-single-entity.md:6,22`).
**PARTIAL adjacencies it must build on, not re-invent:**
- Tables + servers: `apps/api-gateway/src/pos-hub/pos-types.ts` (`CanonicalCheck` carries
  `tables`, `employees` capability flags — `pos-provider.registry.ts:17-23`).
- Push: `apps/api-gateway/src/push/`, `apps/api-gateway/src/websocket/`.
- Simulator: `apps/api-gateway/src/simpos/` (11 routes incl. `/simpos/:restaurantId/tables`).
- ⚠️ **The blocker, measured:** in the only POS corpus that exists,
  `server_name`, `covers`, `table_id` and `total` are **0 of 47 rows**
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`).
  Floor Checker's entire input is currently null.

**Primary metric.** *Time from kitchen-ready to the right waiter's device, p95* — and
**mis-route rate** (pinged the wrong server) as the paired quality gate. Zero is the only
acceptable mis-route target during service.

**Premortem.** It is built against `simpos` fixtures, demos beautifully, and dies on
contact with a real kitchen — because no shipped POS in the registry actually emits a
"food is up" event, and the team discovers that after building the notification layer
rather than before.

---

### 1.3 Supply Discovery (Vendor Finder)

**Mandate.** Define **Vendor Finder**: given what a restaurant needs, find distributors who
carry it, extract their catalogue and prices, and compare.

**Why distinct.** It is the only named module that goes *outbound*. §1.1 processes what
arrives; this crawls, extracts, and constructs the supply graph the rest of procurement
depends on. Its failure mode is coverage and staleness, not approval quality, and it is the
one module whose quality bar is set by an external corpus rather than by a restaurant's own
documents.

**Evidence — PARTIAL (substantial, and more than the docs credit):**
- `apps/api-gateway/src/distributor-discovery/` — controller, service, `distributor-query.ts`,
  three spec files.
- `apps/api-gateway/src/vendor-intel/` — `vendor-page-extractor.service.ts`,
  `vendor-comparison.service.ts`, `wine-identity.ts` + specs.
- `apps/api-gateway/src/common/orchestrator/prospects.service.ts` / `prospects.controller.ts`.
- Surfaces: `/distributors`, `/vendor-prices` (`VendorPriceCompare`), `/providers`
  ([PAGE_MAP.md:36-37,56](../PAGE_MAP.md)) — note `/distributors` and `/vendor-prices` are
  both cold-entry with no inbound link (PAGE_MAP.md:116,130).
- `.planning/07-reference/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md`.

**Boundary — read this with §3.3.** This team ships the *software that finds vendors*.
Partnerships' Supplier & Distributor Network team owns the *relationships those vendors
are in*. Overlap here is the single most likely duplication in this division.

**Primary metric.** *Catalogue coverage*: % of a restaurant's needed SKUs matched to at
least two live distributor prices — with **price freshness p50** as the paired guard.

**Premortem.** It builds a beautiful crawler for a supply graph nobody queries, because
procurement volume is `procurement_orders` = 1
([AGENT_NATIVE_UI_DECISION.md §2](../../decisions/AGENT_NATIVE_UI_DECISION.md)) and the founder's
actual distributors were reachable by phone the whole time.

---

### 1.4 Surface Portfolio

**Mandate.** Own the **route inventory** as a portfolio: which of the 51 routes should
exist, which module owns each, and which get killed, merged, or made reachable.

**Why distinct from Design (§2).** This team decides **whether a page should exist**;
Design decides **what is on it and how it behaves**. That split is not invented here —
foundation README:50-52 assigns the unlinked-route finding to Product & Vision by name,
while the UX catalogue and sketches are assigned nowhere yet (see §2).

**Evidence — EXISTS (the backlog is already enumerated):**
- 49 routes, 39 in-app navigation edges ([PAGE_MAP.md:5](../PAGE_MAP.md)).
- **22 routes with no inbound in-app link** (PAGE_MAP.md). Some are legitimate
  (`/v/:slug` vendor portal, `/invite/:code`); others are unowned surface.
- **12 route components could not be traced** (PAGE_MAP.md).
- Live duplication needing a product call, not a design call:
  `/inventory` vs `/inventory-legacy`; `/calendar` vs `/calendar-classic`. Both
  **failed the first 2026-08-26 parity check** — the legacy pages held working
  capabilities the replacements lacked ([ADR 0019](../../decisions/0019-p2-build-scope.md) §B-parity).
  **Both were retired later the same day** once their blockers were ported onto the
  canonical pages. `/wine-agent` + `/wineagent` were the third duplication; both are
  now **retired** too. No duplicated surface remains.
- Cross-check against 448 endpoints / 44 modules ([ENDPOINTS.md](../ENDPOINTS.md)) —
  a module with routes and no page, or a page with no module, is this team's finding.

**Primary metric.** *Unowned surface count* = (routes with no inbound link **and** no
named owning module) + (untraceable route components). Today: **24 + 13**. Target is a
number the team commits to, not zero — some cold entries are correct.

**Premortem.** It becomes a spreadsheet-keeping function. It re-generates PAGE_MAP monthly,
the count never moves, and after 60 days the agenda is fiction by foundation §3.3's own rule.

---

### 1.5 Ask AI — Action Composer

**Mandate.** Own the **single typed, allowlisted action schema** behind every AI entry
point: `ask → propose → confirm → execute` (FUTURES §8.1).

**Why distinct.** It is cross-module *by construction* — it composes actions that belong to
procurement, inventory, communications, and calendar. Housed inside any one module team it
becomes that module's chatbot, which is precisely the outcome FUTURES §8.3 forbids:
*"not three incompatible chatbots."* It is also the one Product team whose deliverable is a
**schema and a refusal policy**, not a screen.

**Evidence — PARTIAL (entry points exist; the composer does not):**
- Contract written: [FUTURES.md:203-245](../../FUTURES.md) §8 (principle, allowlist
  families, out-of-MVP list, complexity-easing contract).
- 25 paths specified: [UX_PATHS_CATALOG.md:1803-1830](../../07-reference/UX_PATHS_CATALOG.md) §AC
  `NEW-886…NEW-910`, incl. `NEW-903` (Wine Agent FAB and Ask AI share one action schema),
  `NEW-906` (dangerous intents refused), `NEW-907` (idempotent confirm).
- Divergent entry points live today: Reports `AICommandPill`/`AICommandPalette`
  (`apps/web/src/components/command/`), `apps/mobile/src/guidance/WineAgentFab.tsx`,
  and `/sommelier` (`SommelierAI`). The two placeholder routes `/wine-agent` and
  `/wineagent` were a fourth entry point until they were retired on 2026-08-26;
  every "Wine Agent" launcher now lands on `/sommelier`.
- The confirm-card primitive exists: `apps/api-gateway/src/one-tap-actions/` +
  `recommendation_actions` (shipped P0 Recommendations act/dismiss/snooze).
- Aligned with the AI-native definition at [foundation README:258-266](../README.md) — this
  is what "AI-native" was reduced to *after* the agent-native UI rewrite was rejected.

**Primary metric.** *Confirm-without-edit rate on proposed action cards*, with
**refusal correctness** (dangerous intents correctly refused / dangerous intents attempted)
as the hard gate. Both are NF-A events (`stimulus → internal_state → choice → outcome`).

**Premortem.** The allowlist grows one convenience at a time until something mutates stock
or sends vendor email without a human — FUTURES §8.1's one non-negotiable — and the audit
trail (`NEW-902`) was the deferred half.

---

## 2. Guest Experience — sub-layer under Product & Vision — 4 teams

Sub-layer mandate: the **third user type**. Not staff, not owner — the guest. Owns the
Beli-style consumer app, guest food-identity profiles, photo-upload-as-promotion, and
advertising monetization.

**This is the sub-layer where NF-B lives.** Every metric below is an NF-B metric, and they
are deliberately staged: identity (who), fingerprint (what they like), app (the signal
source), value (what the restaurant gets). Reading them in that order is the roadmap.

⚠️ **Honesty gate for the whole sub-layer.** `guests` has a schema and near-zero rows; the
POS corpus behind any taste signal is **47 checks, 1 restaurant, 1 day, 82 line items,
37 distinct item strings** (`.planning/07-reference/DISH_IDENTITY_DESIGN.md` §1.1). Four teams is the
*shape* of this sub-layer, not its v0 headcount — see §5.3.

---

### 2.1 Guest Identity & Consent

**Mandate.** Own the guest identity spine: who this guest is, by what verified key we know
it, what they were told, and — above all — **when not to merge**.

**Why distinct.** It is the only team in this division whose errors are irreversible.
A false bottle merge is a bounded data-quality cost; a false guest merge is a **disclosure
of one person's history to another, and no un-merge reverses a disclosure**
(`20260819000000_guest_identity_minimal_slice.sql:30-34`). That asymmetry demands an owner
who is measured on *refusals*, not on match rate — which is the opposite incentive from
every other identity team in the company.

**Evidence — EXISTS (shipped, deliberately minimal):**
- `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` — three tables:
  `guests` (:40), `guest_identifiers` (:122), `guest_check_links` (:206).
- Consent is a **versioned record, not a boolean** (`:53-60`:
  `consent_purpose`, `consent_notice_version`, `consent_captured_via`).
- `display_label` is display-only and **never a match key**, enforced in CI by
  `scripts/check_no_guest_name_matching.sh` (:44-52).
- Scope test applied: *build exactly what cannot be backfilled* (`:16-25`) — resolution
  beyond exact keys, merge queue, preference aggregates, and cross-restaurant sharing are
  all deliberately absent.
- Commit `ce65715 feat(a14): build real guest identity — the slice that cannot be backfilled`.
- Guest consent paths already specified: `NEW-658`, `NEW-662`, `NEW-663`, `NEW-666`
  ([UX_PATHS_CATALOG.md:1483-1491](../../07-reference/UX_PATHS_CATALOG.md)); `NEW-879`, `NEW-884` (§AB).

**Primary metric — NF-B subject coverage.** % of `pos_checks` carrying a *consented*
`guest_check_links` row. This is the denominator of every other NF-B metric in this
sub-layer; if it stays near zero, teams 2.2–2.4 have no subject.
**Hard gate:** false-merge count = 0, permanently.

**Premortem.** Coverage pressure from 2.2 and 2.4 turns "exact verified key or nothing"
into "high-confidence fuzzy match", one PR, one Friday — and the first disclosure is
discovered by a guest, not by us.

---

### 2.2 Taste Fingerprint (NF-B)

**Mandate.** Own the guest **food-identity profile**: the durable trace of exposure →
choice → repeat → rating, in context (region, season, companions). This *is* NF-B
([foundation README §4.2](../README.md)).

**Why distinct from 2.1.** 2.1 answers *who*; this answers *what they like*. They have
opposite risk postures: 2.1 is measured on refusing to guess, this one is measured on
modelling. The same team doing both will let the model's appetite for data set the identity
team's merge threshold — the exact conflict [ORG_STRUCTURE §3](../ORG_STRUCTURE.md) cites
for keeping Red Team out of Security.

**Evidence — PARTIAL, and honestly blocked:**
- Schema shape defined: `neural_footprint_event` with `subject_type = guest`
  ([foundation README:229-241](../README.md)); NF-B named a **priority** track (README:206).
- ⛔ **Hard blocker, decided:** dish identity is **DEFERRED** by explicit product-owner
  call — `.planning/07-reference/DISH_IDENTITY_DESIGN.md` (register A15, 2026-08-20). Dishes stay raw
  POS strings, so `"Ribeye 12oz"` and `"Ribeye"` are different entities to any `GROUP BY`
  (§1 of that doc). **A taste fingerprint over food cannot exist until this reverses.**
- ⛔ **Corpus blocker, measured:** 47 `pos_checks`, 1 restaurant, one day
  (2026-08-11 → 2026-08-11), 82 line items, 37 distinct item strings, **no food/dish/recipe
  table in the schema at all** (`DISH_IDENTITY_DESIGN.md` §1.1).
- Wine side is the exception and the opportunity: `master_wine_library` + beverage identity
  is the strongest layer (foundation README:64), and wine enrichment is in flight
  (commits `f7e0ea1`, `ef19b81` — 144/1,448 wines).
- Storage decision already made: OD-11a — narrow polymorphic production table + wide
  append-only research log ([OPEN-DECISIONS.md](../../decisions/OPEN-DECISIONS.md), Resolved).
  Column contract still open (OD-11).

**Primary metric — NF-B event completeness.** % of NF-B events carrying all four of
`stimulus`, `choice`, `outcome`, `context`. A rating with no identified dish is not an
NF-B event; counting it as one is how this metric lies.

**Premortem.** It ships a "taste graph" built on 37 raw POS strings and one day of
simulator traffic, personalization recommends the ribeye to everyone because the ribeye is
most of the corpus, and the model's confidence is mistaken for the data's.

---

### 2.3 Consumer App & Points Economy

**Mandate.** Own the guest-facing product: profile, rate a dish, follow a restaurant,
discover, share — and the **append-only points ledger** that pays for contribution.

**Why distinct.** Different user, different app, different business model, and — decisively —
a **different adversary**. Teams 2.1/2.2 defend against data-quality error; this team
defends against *humans farming points* (self-referral, duplicate devices, review spam).
FUTURES §7.3 makes abuse control a non-negotiable, and abuse defense is a full-time posture,
not a checklist item on a modelling team.

**Evidence — NEW as code, fully specified as design:**
- Design contract: [FUTURES.md:146-199](../../FUTURES.md) §7 — profile types (§7.1),
  earning rules (§7.2), integrity rules (§7.3: append-only ledger, verification gates value,
  no self-referral farming, review quality gate, consent-first), conservative redemption
  (§7.4), MVP vs north star (§7.5).
- **40 paths already written:** §W `NEW-652…NEW-666`
  ([UX_PATHS_CATALOG.md:1471-1491](../../07-reference/UX_PATHS_CATALOG.md)) and §AB `NEW-861…NEW-885`
  (:1771-1801) — including `NEW-871` (provisional vs confirmed visually distinct),
  `NEW-872` (expiry notice *before*, not after), `NEW-878` (suspected abuse → held + appeal
  path, not silent zeroing).
- Scheduled as ROADMAP backlog **999.1** (`.planning/ROADMAP.md:639`), `PROJECT.md:27`.
- ⚠️ No `points`, `ledger`, `ratings`, or guest-app code exists — grepped. The consumer app
  is greenfield; `apps/mobile` today is the staff app (`src/guidance/`, `src/design/`).
- ⬦ **Gated on OD-07** ([OPEN-DECISIONS.md:28](../../decisions/OPEN-DECISIONS.md)) — build
  independently vs explore Beli collaboration. This team's existence is downstream of that
  call; see §3.2.

**Primary metric — NF-B event volume per active guest per month** (rating, photo, verified
visit — each is a `stimulus → choice` record). **Integrity gate:** % of points that reach
`confirmed` rather than expiring provisional. A high volume with a low confirm rate is
farming, not engagement.

**Premortem.** Points ship before verification does, the ledger fills with provisional
credits from a device farm, and the first real restaurant perk is redeemed by an abuser —
after which no restaurant opts in again.

---

### 2.4 Guest Value & Monetization

**Mandate.** Own everything the guest side gives *back*: k-anonymized segment insight to
restaurants, **guest photos as restaurant promotional assets**, and the **advertising**
revenue model.

**Why distinct.** It is the only Guest team whose customer is the **restaurant**, not the
guest. That inverts every incentive in 2.1–2.3 — and that inversion is exactly why it needs
a separate owner with a separate premortem. FUTURES §10 non-goals bind it twice: the guest
side must not become a standalone social network, and no platform-funded rewards before
integrity is proven. It is also the team most likely to be reviewed by the Ethics &
Responsible AI advisory ([ORG_STRUCTURE §3](../ORG_STRUCTURE.md)) — *"the department that
benefits from a personalization feature cannot neutrally assess it"* describes this team
precisely.

**Evidence — mixed, and the monetization half is genuinely NEW:**
- Restaurant-side insight, specified: `NEW-659` (aggregated audience segments, privacy-safe),
  `NEW-660` (top preferences, k-anonymized), `NEW-661` (which menu items attract which
  segments), `NEW-664` (weekly digest → menu experiment), `NEW-665` (export anonymized
  segment report) — [UX_PATHS_CATALOG.md:1484-1490](../../07-reference/UX_PATHS_CATALOG.md).
  Plus `NEW-880`, `NEW-882`, `NEW-883` (advocacy signal feeds par/promotion suggestions),
  `NEW-885` (restaurant sees program cost, no platform liability) — §AB.
- Photo-as-promotion: `NEW-865` — *"Add a dish photo → bonus points; consent prompt for
  catalog reuse"* (:1781) and FUTURES §7.2 *"usable for catalog enrichment with consent"*.
  The enrichment pipeline it would feed **EXISTS** (FUTURES §4: photos first-class,
  `master_wine_library` pattern). The consent-to-reuse plumbing does **not**.
- Promotions surface PARTIAL: `/promotions` route exists (PAGE_MAP.md:36) and
  `apps/api-gateway/src/providers/provider-intelligence.service.ts:135-222` reads
  `provider_promotions` — but that table is **dormant** and, critically, is *provider*
  promotions (supply-side deals), **not** guest-facing advertising. Do not mistake one for
  the other.
- **Advertising: NEW.** Grepped `apps/`, `supabase/migrations/` for
  `advertis|sponsored|ad_slot|ad_campaign` — no ad inventory, no sponsor model, no
  placement schema anywhere. This is ambition with zero groundwork.
- ⬦ Boundary fork: advertising is a revenue model, which is Commercial's charter
  (Growth / Finance & Pricing). See §5.2.

**Primary metric — NF-B → ops conversion.** Count of restaurant decisions (par change,
promotion, menu experiment, 86) that are **traceable to a named NF-B segment**. Zero means
the whole sub-layer is a social app the vision says it must not be (FUTURES §10).
**Privacy gate:** every restaurant-facing view passes k-anonymity before render — no
exceptions, no "admin sees raw".

**Premortem.** The k-anonymity threshold gets lowered "just for the pilot restaurant" so a
segment card has something to show, a manager recognises a regular from a three-person
segment, and the consent record we so carefully versioned proves we said we wouldn't.

---

## 3. Design — 4 teams

**This department owns the largest ownerless body of work in the repo.** Measured this
session: **910 unique `NEW-` UX paths** across 29 lettered sections in a 154KB catalogue,
and **54 sketch directories / 51 HTML sketches / 97 files** in `.planning/sketches/`.
Neither is assigned to any department in foundation §2.2. That is the gap this department
fills.

**Design ≠ Media & Brand.** Media & Brand (Commercial division) owns outward creative:
decks, social, campaigns, and the `wineops.ai` → Mudavym brand migration
(foundation README:42-43). Design owns the product a user touches. They share a visual
language and nothing else; a shared *owner* would mean launch-deck deadlines outrank an
accessibility defect every single quarter.

---

### 3.1 UX Path Burn-Down

**Mandate.** Own the 910-path catalogue as a **live execution ledger**: which paths ship,
in what order, with what acceptance criteria, and — for every deferred path — the named
thing that unblocks it.

**Why distinct.** This is convergent delivery accounting, not design. Its unit of work is
a row that either exists in the product or does not, and it doubles as the E2E test spine —
the catalogue's own reading rule is *"Given I am on page X, When I <trigger>, Then
<outcome>"* ([UX_PATHS_CATALOG.md:70](../../07-reference/UX_PATHS_CATALOG.md)). Sibling 3.3 does the
opposite job (divergent exploration, most output discarded). One team cannot hold both
success criteria.

**Evidence — EXISTS, and unusually well-instrumented for a backlog:**
- 910 unique `NEW-` IDs, `NEW-001…NEW-910`, verified by count this session.
- A **consolidated Deferred Decisions Log** at `UX_PATHS_CATALOG.md:10-67` — every deferred
  item already carries *why deferred* **and** *unblocked by*. That is the rarest artifact in
  this repo: a backlog that knows its own dependencies.
- **22 section-level "Shipped" banners** (`:337` through `:1601`) — the burn-down is real
  and partly done (~90–100 paths: P0 Recommendations `NEW-284…308`, Browse-All §Z1,
  contextual rails, §A command palette, §K calendar).
- 🔎 **A live contradiction inside the catalogue, found this session — and it is the best
  possible argument for this team's existence.** The Deferred Decisions Log at `:49` still
  says the §AA rows are blocked because *"the Reports 'Seating Density' widget these rows
  reference **does not exist yet**"*. It does exist: `:1013` announces
  *"Seating Density widget (`SeatingDensityPanel`) — unblocks NEW-761–860"*, and the file is
  on disk at `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`.
  **The log's own instruction (`:15`) is "Update both places when a deferred item ships,"
  and it was not followed.** A 910-row ledger with no owner drifts against itself, and the
  drift is invisible until someone greps.
- The residual §AA blocker is real and differently shaped: ~70 of the rows are
  *"authored against data with no table: reservations, weather, labor, turn-time, per-seat
  pours, per-hour series, forecasts, host tablets"* (`:64`) — a **Data** dependency, not a
  design one.

**Tension to name, not hide.** Most deferred rows are blocked on **endpoints**, not on
design. So the split must be explicit: this team owns the path's **definition, priority,
and acceptance criteria**; Engineering owns the build. A burn-down team that cannot
commission endpoints will report "blocked" for a year.

**Primary metric.** *Paths closed per month*, with a paired **honesty ratio**: deferred
paths that carry a named unblocker ÷ all deferred paths. Today that ratio is unusually
high — protecting it is the point.

**Premortem.** It burns down the 100 seating-density rows because they are enumerated and
feel tractable, ships more Reports surface nobody opens, and the paths that would have made
`/inventory` usable stay deferred for another year — while the ledger itself drifts out of
date, exactly as `:49` already has.

---

### 3.2 Design System & Motion Substrate

**Mandate.** Own the shared substrate every surface is built from: component primitives,
tokens, states, accessibility standards, and the motion language.

**Why distinct.** It is the only Design team whose customer is **other teams**. Its output
is reused, so its failure compounds silently across 51 routes and two apps, while 3.1's and
3.3's failures are visible on one screen. It also spans web *and* native, which no other
Design team does.

**Evidence — PARTIAL (real substrate, thin coverage):**
- `packages/ui/src/` — `components/`, `lib/`, `styles/`, `index.tsx` (shared workspace
  package). ⚠️ **Zero `.stories.tsx` files** — the *shared* package is the one with no
  documented surface.
- `apps/web/src/components/ui/` — the primitive set: **26 component files, 5 with stories**
  (`form`, `toast`, `empty-state`, `error-state`, `loading-skeleton`). 28 story files exist
  across all of `apps/web`, but they cluster in `src/stories/` (`Button`, `Card`, `Input`,
  `Badge`) rather than beside the primitives that ship.
- `apps/mobile/src/design/tokens.ts` — a second, separate token source, and
  **`apps/mobile` has zero stories**. **Two token sources and no shared documentation is
  the substrate problem stated in one line.**
- Visual language is written down: `.planning/sketches/MANIFEST.md` "Design Direction" —
  wine-burgundy `#CD2D5B`, Plus Jakarta Sans, glassmorphism, Stripe/Linear/Toast references.
  ⚠️ It still says *"WineOps AI"* — brand drift below the doc layer, same class as
  foundation README:42-43.
- Motion is specified in unusual depth: sketches **043–046** (`motion-signature-moments`,
  `wineops-signature-motions`, `ops-signature-motions`, `cellar-commit-motions`) each carry
  a full *trigger / motion / haptic / **anti-gimmick*** spec, and **042**
  (`mobile-stack-capabilities`) already picked a stack: *H — RN Skia + Reanimated*.
- Accessibility standard already enumerated: §X `NEW-667…NEW-676`
  ([UX_PATHS_CATALOG.md:1493-1506](../../07-reference/UX_PATHS_CATALOG.md)) — skip links, focus rings,
  Escape behaviour, SR announcements, reduced-motion, RTL, grid roles.

**Primary metric.** *% of newly-shipped surface composed from system primitives + tokens*
(vs bespoke). Secondary, and the one that actually predicts decay: **token-source count**
— currently **2**; the target is 1.

**Premortem.** The system documents what already exists rather than constraining what comes
next; §X accessibility stays a catalogue section instead of a lint rule, and every
burn-down sprint adds one more bespoke component nobody can find.

---

### 3.3 Exploration Studio

**Mandate.** Own **divergent** design: pose the design question, build throwaway options,
name a winner with reasoning, and hand a decided direction to 3.1.

**Why distinct.** Its success criterion is *a resolved question*, and most of its output is
correctly discarded. Measure it on shipped pixels and it stops exploring; measure 3.1 on
options generated and it stops shipping. The manifest already proves the workflow —
and already proves it decays without an owner.

**Evidence — EXISTS (large, structured, and visibly stalling):**
- **54 sketch directories, 51 HTML sketches, 97 files** in `.planning/sketches/`
  (counted this session), plus `themes/default.css`.
- `.planning/sketches/MANIFEST.md` is a genuine decision record: every row carries a
  **Design Question**, a **Winner**, and tags — e.g. 048 `profile-page` → *"C — Left rail
  (purity 9 × effectiveness 9 = 81)"*; 042 → mobile stack decision;
  033 `notification-preferences` → *"C × B synthesis"*.
- ⚠️ **The stall is measurable: 28 of 43 manifest rows carry `Winner: null`** — 006, 007,
  016, 020–026, 028–032, 034–041, 043–047 (counted this session). **Two-thirds of the
  exploration never converged.** That is the exact cost of having no owner.
- ⚠️ **And the index is incomplete: 10 sketch directories are not in the manifest at all** —
  005, 011, 012, 013, 014, 015, 017, 018, 019, 049 (43 manifest rows vs 54 directories,
  minus the duplicate-ID collision below). Work exists that the record does not know about.
- Two rows **did** converge all the way to code, which is the proof the pipeline works:
  038 `inventory-command` → *IMPLEMENTED — `apps/web/src/pages/inventory/command/`*
  (route `/inventory`; the legacy page was retired 2026-08-26); 052 `wineops-document` →
  *IMPLEMENTED (document) — `scripts/docgen/templates/wineops_document.html`*, role views
  not built.
- Duplicate ID `038` is used twice (`038-inventory-command`, `038-manager-shift-desk`) —
  small, but it is what an unowned index looks like.

**Primary metric.** *Resolved-question rate*: sketches with a named winner ÷ sketches
created. Today: **15 of 43 indexed** (and 43 of 54 are indexed at all).
Secondary: **winner → shipped-descendant conversion** — today **2 of 54**.

**Premortem.** It becomes a gallery. Sketch count climbs, `Winner: null` climbs with it,
and the burn-down team keeps designing in production because no decision ever arrived.

---

### 3.4 Activation & In-Product Guidance

**Mandate.** Own first-run: onboarding, the activation checklist, role-based defaults, and
in-product tours/tips — for **owner, manager, and staff separately**.

**Why distinct.** It is the only Design team with a **numeric business outcome** rather than
a quality judgement: a user is activated or is not. And it has a mandate the other three
explicitly do not — **cutting surface**. This is not invented: the agent-native UI review
rejected adaptive personalization and named the alternative in the same breath — the
surface is enormous and a new user drowns, *"but the fix is to **cut the surface** with
role-based defaults in a week, deterministically, with no telemetry"*
([AGENT_NATIVE_UI_DECISION.md §3](../../decisions/AGENT_NATIVE_UI_DECISION.md)). That sentence is a
team charter, and nobody owns it.

The same section also constrains the whole department: **high staff turnover** means you
onboard someone new every few months forever; training is oral and physical
(*"hit the blue button on the right"*); and muscle memory during service is a real
performance budget. Design in this product is bound by turnover, not by taste.

**Evidence — PARTIAL (surfaces live, coherence missing):**
- Routes: `/onboarding`, `/get-started`, `/invite/:code`, `/help`, `/register`
  ([PAGE_MAP.md](../PAGE_MAP.md)) — `/get-started` carries an in-degree of 2 (from
  `/onboarding` and `/help`, PAGE_MAP.md:68-70,145), putting activation among the twelve
  most-linked pages in the app. The surface exists; the coherence does not.
- Code: `apps/web/src/components/onboarding/`, `apps/web/src/contexts/OnboardingContext.tsx`,
  `apps/mobile/src/guidance/` (`GuidanceProvider.tsx`, `TipStrip.tsx`, `TourSheet.tsx`,
  `content.ts`, `analytics.ts`).
- Sketches: 001–004 (onboarding flow), 011 (activation checklist), 048
  (`interactive-guidance`), 049 (`mobile-guidance-web-shell`), 050 (`activation-flow` →
  winner *"C — Hybrid"*), 051 (`staff-firstrun-tutorial` → winner *"B — first-visit
  overrides session cap"*, i.e. the existing one-tour-per-session cap is a known defect).
- Paths: §S `NEW-589…NEW-608` ([UX_PATHS_CATALOG.md:1388](../../07-reference/UX_PATHS_CATALOG.md)).
- ⚠️ Role-based defaults — the thing §3 actually prescribed — do **not** exist. `/settings`
  role matrix is deferred (`NEW-513`, §O log at :63).

**Primary metric.** *Time-to-first-real-action*, split by role (owner / manager / staff) —
from account creation to the first non-onboarding mutation. Staff is the number that
matters: turnover makes it recur forever.

**Premortem.** Activation is designed for the owner demo, staff first-run stays a tour that
fires once per session and is skipped, and every new hire is trained orally by a manager who
resents the software — which is how a product stops spreading inside an account.

---

## 4. Partnerships & Integrations — 4 teams

Department strategy: **become the bridge, not another POS.**

**Founder's evidence, independently verified this session.** Square and Lightspeed are not
aspiration — they are in source, alongside Toast:

| Claim | Verified at |
|---|---|
| `developer.squareup.com` in source | `apps/api-gateway/src/pos-hub/pos-provider.registry.ts:75` |
| `developers.lightspeedhq.com` in source | `apps/api-gateway/src/pos-hub/pos-provider.registry.ts:109` |
| Square status is **`scaffolded`**, not planned — *"Orders API normalizer implemented; needs merchant OAuth token"* | `pos-provider.registry.ts:68-78` |
| Clover likewise `scaffolded` — *"Orders v3 normalizer implemented"* | `pos-provider.registry.ts:79-90` |
| Toast status `partial` | `pos-provider.registry.ts:54-66` |
| Onboarding already asks which POS: `'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'` | `apps/web/src/contexts/OnboardingContext.tsx:95` |
| Analytics substrate already multi-POS: `-- toast | square | lightspeed | clover | manual` | `supabase/migrations_archive/20260717120000_analytics_insight_infra.sql:65` |

**The registry is a 30-provider strategy document**, sequenced in its own header comment
(`pos-provider.registry.ts:3-16`): foundation → Square/Clover/SpotOn (~60% of detected SMB
restaurants) → Tier 1 → Tier 2 (partner agreements) → Türkiye (Simpra, ElektraWeb, Vectron,
Wolvox, SambaPOS). Two entries are **`available` today**: `generic_webhook` and `csv_import`
(:29-51) — *"any POS or middleware can push the canonical shape and the whole analytics
stack lights up."* Foundation README:38-41 is right that this has *"more groundwork than the
docs admit."*

---

### 4.1 POS Bridge

**Mandate.** Own the canonical check pipeline and the provider adapters: one
`CanonicalCheck` shape, N normalizers, and the mapping from a POS item to our catalogue.

**Why distinct.** It is the only team here whose deliverable is **code that runs in
production on someone else's data model**. Its constraint is a foreign API's semantics, not
a counterparty's willingness — which is precisely what separates it from 4.2.

**Evidence — EXISTS (substantial):**
- `apps/api-gateway/src/pos-hub/` — `pos-adapters.ts` (+ spec), `pos-hub.service.ts`
  (+ spec), `catalog-matcher.service.ts` (+ spec), `pos-types.ts`, `pos-provider.registry.ts`
  (30 providers), `registrySummary()` (:328).
- Capability model is already per-provider: `CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL`
  (:17-25) across `checks, items, tables, employees, webhooks`.
- 10 endpoints, **all 10 unguarded** — legitimately public webhook module, but
  ⚠️ *"must verify signatures instead"* ([ENDPOINTS.md:355](../ENDPOINTS.md)); combined with
  `TenantGuard` returning `true` for unauthenticated requests
  (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`) this is a live exposure,
  co-owned with Security (OD-19).
- Human gate already present: `/pos-hub/catalog-match/:restaurantId/proposals/:id/approve|reject`.
- Simulator to develop against: `apps/api-gateway/src/simpos/` (11 routes) + routes
  `/simpos/:restaurantId`, `/simpos/:restaurantId/orders`.
- ⚠️ **Reality check:** `pos_checks` = **0 real rows**
  ([AGENT_NATIVE_UI_DECISION.md §2](../../decisions/AGENT_NATIVE_UI_DECISION.md)); the 47 rows that
  exist are `source='generic_webhook'` simulator output from one 43-minute window
  (`20260819000000_guest_identity_minimal_slice.sql:11-14`).

**Primary metric.** *Providers at status `available` with a real merchant behind them.*
Today: **2 available, 0 with a merchant.** The second half of that sentence is the whole
metric — `scaffolded` count is vanity.

**Premortem.** It builds all 30 adapters against documentation, hits the same failure the
agent-native review named — *"combinatorially impressive systems built without a paying
customer pulling on them"* (§3) — and the one restaurant that signs runs a POS whose export
was a CSV all along.

---

### 4.2 Partner & Alliance Development

**Mandate.** Own the counterparties that engineering cannot unblock: POS partner
agreements, and the **Beli question**.

**Why distinct.** Nine providers in the registry carry `authModel: "partner_agreement"` —
**no amount of engineering makes them available.** They need a signature. That is a
different job, on a different clock, with a different skill, and it is the strongest
distinctness argument anywhere in this document.

**Evidence — EXISTS as a named, enumerable blocker list:**
- `authModel: "partner_agreement"` — **9 occurrences**, verified by grep, at
  `pos-provider.registry.ts:119` (TouchBistro), `:171` (NCR Voyix Aloha), `:192` (PAR Brink),
  `:222` (HungerRush), `:232` (Qu Beyond), `:242` (POSitouch), `:254` (Focus POS),
  `:264` (Givex/Vexilor), `:298` (Vectron Omni).
- The registry's own sequencing says it out loud: *"Tier 2+ — only when selling into chains
  (**partner agreements needed**)"* (`:10`).
- Türkiye market entries (`:268-322`) are a distinct BD motion, not a backlog: Protel/Simpra,
  ElektraWeb, Vectron, AKINSOFT Wolvox (*"start with file export → csv_import bridge"*),
  SambaPOS.
- ⬦ **Beli — OD-07, open:** *"build the guest consumer experience independently vs explore
  collaboration"*; *"Determines whether guest-app work is product or partnership groundwork"*;
  unblocked by *"Founder call after guest MVP scope exists (FUTURES.md §7.5)"*
  ([OD-07, OPEN-DECISIONS.md:28](../../decisions/OPEN-DECISIONS.md)).
  **This team owns the exploration; §2.3 owns the build. Both are gated on the same call.**

**Primary metric.** *Signed agreements that unblock a `partner_agreement` provider*, plus
**time-to-first-response** on outreach. Zero is an acceptable v0 result — pretending
outreach happened is not.

**Premortem.** OD-07 stays open by default rather than by decision; the guest app is built
independently *and* a Beli conversation is opened six months later from a weaker position,
having already sunk the build.

---

### 4.3 Supplier & Distributor Network

**Mandate.** Own the actual vendor and distributor **relationships**: who supplies our
restaurants, on what terms, and the vendor portal as the surface those relationships live on.

**Why distinct — and the boundary that matters.** §1.3 (Vendor Finder) ships *software that
finds vendors*. This team *signs and maintains the vendors*. The distinction is real:
Vendor Finder's metric is catalogue coverage; this team's is live, willing counterparties.
⚠️ **This is the most likely duplication in the division** — see §5.2.

**Evidence — PARTIAL (a real supply-side surface already exists):**
- `apps/api-gateway/src/vendor-portal/` — controller/service/module. **2 endpoints, both
  unguarded and still marked *"classify these"*** — i.e. not yet even confirmed as
  intentionally public ([ENDPOINTS.md:656-661](../ENDPOINTS.md)). Surfaced at route
  `/v/:slug` (`VendorPortal`), a cold-entry page by design
  ([PAGE_MAP.md:55,129](../PAGE_MAP.md)). Classifying these two is this team's first
  concrete assignment, jointly with §4.4 and Security (OD-19).
- `apps/api-gateway/src/providers/provider-intelligence.service.ts:135-222` — five distinct
  reads against `provider_promotions` (the table is **dormant**; the code is not).
- `apps/api-gateway/src/vendor-catalogue/`, `apps/api-gateway/src/distributor-discovery/`.
- Routes: `/providers` (linked), `/distributors` (cold-entry, PAGE_MAP.md:116),
  `/vendor-prices` (cold-entry, :130).
- Outbound relationship machinery already shipped: vendor-reply AI drafts with one-tap
  approve and **never auto-send**; `procurement_conversations` threading.
- ⚠️ **Reality check:** `procurement_orders` = **1**
  ([AGENT_NATIVE_UI_DECISION.md §2](../../decisions/AGENT_NATIVE_UI_DECISION.md)).

**Primary metric.** *Distributors with a live, refreshing price feed or an active portal
login* — not distributors in the database. The gap between those two numbers is this team's
entire job.

**Premortem.** The portal is built for distributors who never log in, because a distributor's
existing workflow is a PDF emailed to a rep, and nothing in the product was ever worth
changing that for.

---

### 4.4 Connector Platform & Trust

**Mandate.** Own the shared substrate every integration rides: the connector catalogue,
OAuth and credential lifecycle, **webhook signature verification**, connection status/health,
and deprecation.

**Why distinct.** Every other team here is per-counterparty; this one is
**per-integration-class**. If each adapter rolls its own credential path, we get 30
credential paths and 30 ways to leak one. It is also the department's concrete first
assignment — the same shape foundation §2.3 models for Security: evidence, `file:line`,
a classification step, and a recurrence guard.

**Evidence — PARTIAL (a real substrate with a real, sized gap):**
- `apps/api-gateway/src/integrations/` — `integrations-oauth.controller.ts`,
  `integrations-oauth.service.ts`, `integrations-oauth.constants.ts` (providers today:
  `google` at :39-41, `microsoft` at :70-72, with per-scope declarations).
- 5 endpoints, **all guarded** — the good pattern that should generalize:
  `POST /integrations/oauth/:integrationId/authorize`, `GET /:provider/callback`,
  `GET /catalog`, `GET /connections`, `DELETE /:integrationId`
  ([ENDPOINTS.md:226-234](../ENDPOINTS.md)).
- `apps/api-gateway/src/common/crypto/token-crypto.service.ts` — credential encryption exists.
- ⚠️ **The gap, re-counted this session:** **32 routes** are explicitly classified in
  [ENDPOINTS.md](../ENDPOINTS.md) as *"webhook module — expected public, must verify
  signatures instead"* — `simpos` 11 (:536), `toast` 10 (:603), `pos-hub` 10 (:355),
  `inbound-email` 1 (:120). Legitimately unauthenticated ≠ unverified: **0 of the 32 verify
  signatures today.**
- 📋 **Correction to the foundation scan, worth carrying back.** Foundation README:33-35
  states this class is *"≈51 routes"* across five modules including `vendor-portal`. The
  actual figure is **32** in the four modules labelled webhook-class, plus `vendor-portal`'s
  2 which ENDPOINTS.md marks *"classify these"*, not webhook — **34 across the five named
  modules, not ≈51**. The 137 total unguarded figure (README:31, ENDPOINTS.md:6) is correct;
  only the webhook-class subset is overstated. This narrows OD-19's scope by roughly a third
  and is exactly the kind of finding this team should generate on day one.
- ⚠️ Its own UI is orphaned: `/authorize/:integrationId` has **no inbound in-app link**
  (PAGE_MAP.md:110) **and** its route component could not be traced (PAGE_MAP.md:155).
- Wider surface it must inventory: **80 environment variables** and every third-party host
  ([EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md)) — including
  `abc123.ngrok.io` and placeholder domains in source paths (README:44-46).
- Co-owned with Security (OD-19) and bounded by Engineering: **this team owns the trust
  contract per connector — what data flows, under what auth, with what verification.
  Engineering owns the runtime code.** ⬦ FORK — that boundary is asserted here, not decided.

**Primary metric.** *% of public webhook routes with enforced signature verification.*
Today: **0 of 32**. Recurrence guard: a CI check, so the class of defect cannot come back —
the same recurrence-guard shape foundation §2.3 prescribes for the `JwtAuthGuard` gap.

**Premortem.** Verification is added per-provider as each integration ships instead of once
as a guard, `pos-hub`'s generic webhook stays open because it is the one every bridge
depends on, and a forged canonical check writes a restaurant's sales history.

---

## 5. Where fewer is correct — teams I am recommending against

Per the grounding rule *"prefer fewer well-justified teams; flag where fewer is correct."*
These were considered and rejected. Rejecting them is part of the proposal.

### 5.1 Four teams NOT proposed

| Considered | Why not |
|---|---|
| **Decision & Roadmap Ops** (Product & Vision) | The daily open-decision digest is assigned to Product & Vision (foundation README:277), but a team that runs it would duplicate the **Decision Office** advisory, which already owns *"the ADR log, the open-decision queue, and loop close-times"* ([ORG_STRUCTURE §3](../ORG_STRUCTURE.md)). Keep it as a **scheduled job**, not a team. |
| **Self-Learning UX Optimizer** (Design) | `apps/api-gateway/src/ux-optimizer/` exists, is dark by design (`UX_OPTIMIZER_ENABLED=false`), and has **0 rows in all four of its tables**. [AGENT_NATIVE_UI_DECISION.md §3](../../decisions/AGENT_NATIVE_UI_DECISION.md) reached a **"don't build"** verdict with a statistical argument. Staffing a team here would relitigate a decision by staffing rather than by superseding ADR. **Design owns keeping it dark**, not advancing it. |
| **Accessibility & i18n** (Design) | §X `NEW-667…676` is 10 well-specified paths. That is a **standard enforced by 3.2 and burned down by 3.1**, not a team. A separate a11y team at this scale becomes the department that is overruled by every deadline. |
| **Category Expansion** (beverages → bakery → kitchen) | FUTURES §2 sequencing is **locked** and the gating question is corpus depth, not product definition — which makes it **Data**'s blocker (foundation §1, L0 "the named blocker"), not a Product team. §1.1's module contracts absorb the product half. |

### 5.2 Three merge candidates — ⬦ FORK

| Merge | The case for merging | The case for keeping split |
|---|---|---|
| **§1.3 Supply Discovery + §4.3 Supplier Network** | Same domain, adjacent code (`distributor-discovery` is cited by both), and one person will hold both at v0. | Finding a vendor and signing one are different jobs with different metrics (coverage vs live feeds). **Highest duplication risk in this division — decide this one explicitly.** |
| **§4.2 Partner Development + §4.3 Supplier Network** | Both are relationship jobs; one BD function is simpler. | Different counterparties (POS vendors + Beli vs beverage distributors) and different deal shapes (technical partner agreement vs supply terms). Nothing transfers between them but the calendar. |
| **§2.4 Guest Value & Monetization → Commercial** | Advertising is a revenue model; Commercial owns Growth and Finance & Pricing. | The k-anonymity gate and the photo-consent contract are guest-data obligations, and Commercial has a structural incentive to lower them. Keeping it in Guest Experience puts the obligation next to the revenue. **⬦ This is a real division-boundary fork, not a detail.** |

### 5.3 The honest count

Seventeen teams is the **shape** of this division, not its v0 staffing. Two of them
(**§2.2 Taste Fingerprint**, **§2.3 Consumer App**) are hard-blocked today by decisions
already made — dish identity deferred (A15) and OD-07 open — and one (**§1.2 Floor
Checker**) has literally null input columns. Standing them up before those unblock produces
charters with nothing to charter.

**Recommended v0 activation order**, on the same *"lead priority + background parallelism"*
logic as foundation §8:

1. **§4.1 POS Bridge** and **§4.4 Connector Platform** — the bridge strategy has the most
   built groundwork *and* the most live exposure (0 of ~51 webhooks verified).
2. **§3.1 UX Path Burn-Down** and **§1.4 Surface Portfolio** — the two largest ownerless
   backlogs, both already enumerated, both cheap to start.
3. **§2.1 Guest Identity** — already shipped; needs an owner to *defend* it, not to extend it.
4. Everything else on its named unblocker.

---

## 6. Forks this document raises

To be added to [`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md).

> **Renumbered 2026-08-24.** These were first minted as `OD-20`…`OD-24`, colliding with
> the canonical register. The Decision Office reissued them in the `PROD-Fn` namespace —
> see [FORK-REGISTRY](../../02-advisory/decision-office/FORK-REGISTRY.md). Old → new: OD-20→PROD-F1 ·
> OD-21→PROD-F2 · OD-22→PROD-F3 · OD-23→PROD-F4 · OD-24→PROD-F5.

| ID | Fork |
|---|---|
| PROD-F1 | **Product division team layer** — 17 teams as proposed, or the reduced set in §5.3? |
| PROD-F2 | **Vendor Finder boundary** — does supply discovery sit in Product (§1.3) or merge into Partnerships (§4.3)? (§5.2) |
| PROD-F3 | **Guest monetization ownership** — advertising + photo-as-promotion in Guest Experience (§2.4) or in Commercial? (§5.2) |
| PROD-F4 | **Connector trust boundary** — does Partnerships own the per-connector trust contract while Engineering owns runtime, or is verification wholly Security's? (§4.4) |
| PROD-F5 | **Design's commissioning authority** — can §3.1 commission the endpoints its deferred paths are blocked on, or only report blocked? (§3.1) |

---

*Written 2026-08-24 against the working tree at `docs/foundation-memory-instructions-decisions`.
Every `path:line` was read or grepped in-session; every `NEW` was searched for and not found.*
