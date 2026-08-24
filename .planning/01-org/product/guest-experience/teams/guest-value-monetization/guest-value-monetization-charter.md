---
type: charter
division: product
department: guest-experience
team: guest-value-monetization
status: new
metrics: [nf_b.ops_conversion, nf_b.k_anonymity_pass_rate, nf_b.photo_consent_rate, nf_b.segment_to_decision_latency]
updated: 2026-08-24
links: ["[[guest-value-monetization-premortem]]", "[[guest-value-monetization-agenda-full]]", "[[guest-value-monetization-agenda-board]]", "[[guest-value-monetization-directive]]", "[[guest-value-monetization-loops]]", "[[guest-value-monetization-schedule]]", "[[guest-experience-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[compliance-privacy-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[growth-charter]]", "[[finance-pricing-charter]]", "[[product-vision-charter]]", "[[FUTURES]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]", "[[product]]"]
---

# Guest Value & Monetization — Charter

> **Mixed evidence, and the monetization half is genuinely NEW.** Restaurant-side
> insight is specified in eleven UX paths; the enrichment pipeline photos would feed
> **exists**; the consent-to-reuse plumbing does **not**; and advertising has **zero
> groundwork of any kind** — grepped this session across all three apps and every
> migration.
>
> ⬦ **PROD-F3 is open** — does this team belong in Guest Experience or in Commercial?
> Reflected here as open, not pre-empted.
>
> **Pricing is founder-deferred. No pricing model is proposed anywhere in this
> charter, deliberately.**

## Mandate

Own everything the guest side gives *back*: **k-anonymized segment insight** to
restaurants, **guest photos as restaurant promotional assets**, and the
**advertising** revenue model that rides on guest activity and photo content.

And own the number that judges the entire sub-layer: **`nf_b.ops_conversion`** —
restaurant decisions traceable to a named NF-B segment. Zero means the guest side is
the standalone social network [[FUTURES]] §10 forbids (`FUTURES.md:281`).

## Why distinct — and why the distinction is uncomfortable on purpose

**This is the only Guest team whose customer is the restaurant, not the guest.** That
inverts every incentive in 2.1–2.3. The other three are structured to protect the
guest — refuse to merge, refuse to count, hold the credit. This team is structured to
extract value *from* guest data, and pretending otherwise would be the first failure.

The inversion is exactly why it needs a separate owner with a separate premortem
([[product]] §2.4). A team that both protects and monetizes resolves the conflict
inside one person's head, unobserved. Split out, the conflict is between two teams
with two charters and two metrics, where it is visible.

**And this team does not review itself.** [[ORG_STRUCTURE]] §3's rule —
*the department that benefits from a personalization feature cannot neutrally assess
it* — describes this team precisely. Every privacy gate it operates is reviewed by
[[compliance-privacy-charter]], never internally.

> Note: [[ORG_STRUCTURE]] §3 records **Ethics & Responsible AI as considered and not
> adopted**, with guest-data use falling to Compliance & Privacy in the line. So the
> reviewer named throughout this charter is [[compliance-privacy-charter]]. If that
> ever proves too thin for this team specifically, it is evidence for revisiting the
> advisory decision — and it is this team's obligation to say so.

## Boundaries

- **Restaurant-facing guest insight** — aggregated audience segments, top preferences,
  which menu items attract which segments, the weekly digest, exports.
- **The k-anonymity gate** on every restaurant-facing view. No exceptions, and
  explicitly **no "admin sees raw"**.
- **Photo-as-promotion**: the consent-to-reuse contract, its scope, its revocation
  path, and what a restaurant may do with a guest's image of their food.
- **Advertising** as a revenue model riding on guest activity and photo content — the
  product shape, the inventory model, the placement rules, and the boundary against
  what the product already promises.
- **`nf_b.ops_conversion`** and the traceability chain that makes it computable.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Pricing.** Rate cards, CPM, revenue share, floors — any of it | Commercial (Finance & Pricing) — and **founder-deferred** | This charter proposes no model. Naming it as a non-goal is the whole treatment. |
| Guest identity, merging, consent record shape | [[guest-identity-consent-charter]] | We render groups; they decide who is a subject. |
| Taste modelling, individual prediction | [[taste-fingerprint-charter]] | They model individuals; we aggregate. **The boundary is the k-threshold** — below it, an "aggregate" is an individual. |
| The consumer app, points, the guest's own view | [[consumer-app-points-economy-charter]] | Their customer is the guest; ours is the restaurant. |
| Segment analytics methodology | [[analytics-bi-charter]] | They own how a segment is computed and defended; we own that none renders below k. |
| Legal basis for photo reuse, licence text | [[legal-charter]] + [[compliance-privacy-charter]] | Reuse of a person's content for a third party's commercial promotion is a licence question. |
| Provider promotions (`provider_promotions`, `/promotions`) | Procurement / Providers | **Supply-side deals. Not guest-facing advertising.** The name is the whole trap — see §Evidence. |
| Reviewing our own privacy gates | [[compliance-privacy-charter]] | Structural, not courtesy. |

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `nf_b.ops_conversion` | Restaurant decisions — par change, promotion, menu experiment, 86 — **traceable to a named NF-B segment** | **0.** The number that judges the sub-layer |
| `nf_b.k_anonymity_pass_rate` | Restaurant-facing renders passing the k-threshold | undefined — **privacy gate**, must be 100%, no admin exception |
| `nf_b.sub_k_render_attempts` | Blocked renders below the threshold | undefined — the **early warning** for threshold pressure |
| `nf_b.photo_consent_rate` | Photos with an explicit, live, revocable reuse consent | undefined — consent plumbing does not exist |
| `nf_b.segment_to_decision_latency` | Time from a segment insight surfacing to a restaurant acting on it | undefined |

## Evidence today — **NEW overall**, mixed by component

### PARTIAL — restaurant-side insight, specified in eleven paths

`NEW-659` aggregated audience segments, privacy-safe · `NEW-660` top preferences,
k-anonymized · `NEW-661` which menu items attract which segments · `NEW-664` weekly
digest → menu experiment · `NEW-665` export anonymized segment report
(`UX_PATHS_CATALOG.md:1484-1490`). Plus `NEW-880`, `NEW-882`, `NEW-883` — advocacy
signal feeding par and promotion suggestions — and `NEW-885`, restaurant sees program
cost with **no platform liability** (§AB). None built.

### PARTIAL — photo-as-promotion, with the halves inverted

- `NEW-865`: *"Add a dish photo → bonus points; consent prompt for catalog reuse"*
  (`UX_PATHS_CATALOG.md:1781`), and [[FUTURES]] §7.2 — *"usable for catalog enrichment
  with consent"* (`FUTURES.md:169`).
- The **enrichment pipeline this would feed EXISTS** ([[FUTURES]] §4: photos
  first-class, the `master_wine_library` pattern).
- The **consent-to-reuse plumbing does not.** So the capability is real and the
  permission is not, which is the more dangerous way round: a working pipeline with a
  missing gate is one integration away from using a photo it has no right to.

### ⚠️ `provider_promotions` is not advertising — do not mistake one for the other

`/promotions` exists as a route (`PAGE_MAP.md:120`) and
`apps/api-gateway/src/providers/provider-intelligence.service.ts:135-222` reads
`provider_promotions` in five places. That table is **dormant** and holds *provider*
promotions — supply-side deals from distributors. It is not guest-facing advertising,
shares no data model with it, and the only thing they have in common is the word.
Reusing it would be the fastest way to build an ad system on a procurement schema.

### ⛔ Advertising — **NEW**, zero groundwork

Grepped `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src`, and
`supabase/migrations/` for `advertis|sponsored|ad_slot|ad_campaign`: **no ad
inventory, no sponsor model, no placement schema, nothing.** This is ambition with
zero groundwork and this charter says so plainly.

### ⚠️ A live contradiction, found this session and not in the team doc

The product already carries a **written promise about advertising**:
`apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any advertising
or cross-site tracking"* under **exclusions**, and `:249` states *"WineOps sets no
tracking or advertising cookies. Your session lives in local storage and clears when
you sign out."*

That copy binds the **operator** app, not a future guest app — the distinction is real
and this charter does not overstate it. But it is a written product promise about
advertising on one surface while another surface charters advertising as its revenue
model. **The boundary must be drawn deliberately, in writing, before any ad code
exists**, because it is cheap to answer now and expensive to answer once both strings
are quoted side by side. Escalated in [[guest-value-monetization-agenda-full]].

### ⚠️ And nothing to aggregate

`nf_b.subject_coverage` is structurally 0%
([[guest-identity-consent-charter]]) and no NF-B event has been emitted
([[taste-fingerprint-charter]]). There are currently **no segments**, which is exactly
the condition under which the k-threshold comes under pressure — and why the gate must
be built before the first segment exists, not when the first card is empty.

## PROD-F3 — reflected as open

*Does guest monetization sit in Guest Experience, or in Commercial?* ([[product]] §5.2)

- **For here:** the k-anonymity gate and the photo-consent contract are guest-data
  obligations, and keeping the obligation next to the revenue is the point. Commercial
  has a structural incentive to lower both.
- **For Commercial:** advertising is a revenue model, and Commercial owns revenue
  models ([[growth-charter]], [[finance-pricing-charter]]). A product sub-layer running
  an ad business is a scope stretch.

**This charter takes no position** and notes that it is not neutral: keeping the team
here maximises this sub-layer's scope. What it does assert is that whichever unit owns
it, the **k-threshold and the photo-consent contract must not move with it** — they
belong wherever [[compliance-privacy-charter]] can review them independently of the
revenue.

## Entry trigger

**`status: new`, unstaffed.** Three conditions, none satisfied:

1. `nf_b.subject_coverage` non-zero, and enough consented subjects that a segment can
   clear the k-threshold **without lowering it**. If the first segment cannot clear
   the founding threshold, the team is not ready — it is the pressure.
2. NF-B events being emitted with completeness above a floor
   ([[taste-fingerprint-charter]]).
3. **PROD-F3 resolved**, so the team knows which division it reports into before it
   builds an ad product.

**Two acts are available now and should not wait for the trigger**, because both are
counter-pressures that only work if they precede the thing they guard: fix the
k-threshold as a **code constant with a CI guard** and design the sub-k empty state;
and get the **advertising boundary statement** written against
`ServicesPermissions.tsx:41,249`.
