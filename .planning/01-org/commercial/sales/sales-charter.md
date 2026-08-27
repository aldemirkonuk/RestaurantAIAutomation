---
type: charter
division: commercial
department: sales
status: new
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak, sales.qualified_conversation_rate, sales.sending_identity_isolated, nf_b.source_count]
updated: 2026-08-24
links: ["[[sales-premortem]]", "[[sales-directive]]", "[[sales-loops]]", "[[sales-schedule]]", "[[sales-agenda-full]]", "[[sales-agenda-board]]", "[[design-partner-operations-charter]]", "[[outbound-engine-charter]]", "[[growth-charter]]", "[[media-brand-charter]]", "[[finance-pricing-charter]]", "[[partnerships-integrations-charter]]", "[[supplier-distributor-network-charter]]", "[[pos-bridge-charter]]", "[[strategy-fundraising-charter]]", "[[commercial]]", "[[ORG_STRUCTURE]]", "[[YC_WEDGE_PLAN]]", "[[PROJECT]]"]
---

# Sales — Charter

> **Near-greenfield, and the grade is `new` on purpose.** There is no pipeline, no
> CRM, no target list, no price, and no revenue. There is one restaurant, one
> friendship, and a Toast connector whose credentials have never been entered.
> Read §Evidence today before reading anything else here as a going concern.

---

## ⚠️ Read this before citing any evidence — the `prospects` naming trap

The codebase contains a module called **`prospects`**
(`apps/api-gateway/src/common/orchestrator/prospects.service.ts`). It is **not
Mudavym's sales pipeline.** It is the reverse direction:

> **`prospects` = vendors cold-emailing a restaurant.** A wine rep sends an unknown-sender
> intro or catalogue to a restaurant using our product; the service captures it as a
> low-priority, digest-only Prospect, dedupes by domain, never auto-replies, and offers
> one-tap "Add as vendor"
> (`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`).

Nothing in that module knows Mudavym exists as a seller. **Anyone citing `prospects`,
`ProspectsController`, or the `prospects` table as evidence of a sales pipeline is
misreading the module**, and any plan built on that reading is built on a false premise.

It is genuinely useful to [[outbound-engine-charter]] — as a *reusable shape* for
unknown-sender capture, dedupe, and human-gated promotion. That is a pattern to copy,
not an asset to inherit. This paragraph exists so a future session does not have to
rediscover the distinction the hard way.

---

## Mandate

Sales is accountable for **turning the product into a paying, referenceable customer
relationship** — starting with the one restaurant that already exists and ending with a
repeatable way to reach restaurants that have never heard of us. Concretely it owns two
things and nothing else: the **design partner relationship** (get it connected, keep it
alive, extract the verified recovery number and the case study the rest of the division
depends on), and the **outbound machine** (sequences, sending reputation, reply routing,
qualification) — deliberately *without* the target list, which is founder-deferred.

The department exists by explicit founder decision. [OD-09](../../../decisions/OPEN-DECISIONS.md)
records that Claude recommended merging Sales into [[growth-charter]] at v0 and the
**founder overruled it**, choosing ambition over solo-founder capacity
(`OD-09, .planning/decisions/OPEN-DECISIONS.md:114`). That overrule is respected here. The
capacity question it raises is not buried — it is argued in [[sales-agenda-full]]
§Questions for the founder and priced in [[sales-premortem]] M5.

## Boundaries

Owned outright:

- **The design partner account, end to end.** The single Turkish restaurant in San
  Francisco on Toast with full API access (`.planning/PROJECT.md:127`). Getting it
  connected, keeping weekly contact, observing actual usage, and unblocking it.
- **Verified dollars recovered** as the department's headline number — *credits that
  landed*, not credits requested. The distinction is load-bearing and is the repo's own
  finding: until an X12 812 credit memo arrives on a later invoice, "dollars recovered"
  means *"we asked"* (`.planning/YC_WEDGE_PLAN.md:31-33`).
- **The evidence artifacts sales produces**: the recovery number, the case study inputs,
  the sixty-second demo script. Sales supplies the *facts*; [[media-brand-charter]]
  writes the prose.
- **Qualification.** What counts as a qualified restaurant, and the rubric that decides.
- **Sending reputation for cold outbound**, and the isolation of that reputation from the
  platform's transactional mail. See §The deliverability boundary below.
- **Reply routing** — what happens to a human reply, and who answers within what window.
- **The definition of a design partner** versus a customer versus a pilot, before the
  second one exists and the words start meaning three things.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Pricing, packaging, discounting** | [[finance-pricing-charter]] → [[unit-economics-pricing-charter]] | Founder-deferred *and* owned elsewhere. Sales may report what a prospect said about price; it may not set one. A sales team that sets price sets it to whatever closes. |
| **The first outbound target list / ICP research** | **Founder-deferred.** No owner assigned. | Explicitly not sketched here. [[outbound-engine-charter]] builds the machine; the list stays deferred by design, and separating them is what makes that possible. |
| **The Toast connector code** | [[partnerships-integrations-charter]] → [[pos-bridge-charter]] | `apps/api-gateway/src/toast/` is 5 files and ~52KB of Engineering's code. Sales owns the *credential handshake with the restaurant owner*, not the adapter. |
| **Content, SEO, the answer surface, the funnel** | [[growth-charter]] | Growth attracts strangers at scale; Sales works named accounts one at a time. |
| **Brand voice, the case-study prose, the website copy** | [[media-brand-charter]] → [[narrative-collateral-charter]] | We hand over verified numbers and a real quote. They write it. A sales team that writes its own case study writes a better story than happened. |
| **The metrics narrative and the analytics that produce it** | Intelligence → [[analytics-bi-charter]] | We consume the number. We do not compute it, and we do not get to choose the definition that flatters us. |
| **Consent and legal basis for anything we collect from the design partner or its guests** | Corporate → [[compliance-privacy-charter]] | CAN-SPAM/GDPR posture on cold outbound is theirs to rule on; the sending mechanics are ours. |
| **The YC path, the SAFE, the board** | Corporate → [[strategy-fundraising-charter]] | We supply the traction slide's contents. We do not own the raise. |
| **Sales engineering as a distinct function** | Folded into [[design-partner-operations-charter]] | One customer, one POS. It un-folds when a second POS is live in a paying account — [[commercial]] §3.1. |
| **Inbound / SDR** | Nobody. No inbound exists. | And the `prospects` module is *not* this — see the trap warning above. |

### Distributor connectivity — proposed, not claimed (fork CM-F3)

`.planning/YC_WEDGE_PLAN.md:41` states plainly that getting X12 feed access from
distributors *"is a commercial problem, not a technical one."* That sentence is a
legitimate claim on Sales. But Product already owns a
[[partnerships-integrations-charter]] department containing a
[[supplier-distributor-network-charter]] team whose whole subject this is.

**This charter does not claim it.** The proposed line, offered for the Decision Office
to rule on rather than asserted:

> **Partnerships owns the distributor relationship, the feed agreement, and the
> onboarding of a distributor as a data source. Sales owns the moment a *restaurant we
> are selling to* must ask its own distributor for feed access on our behalf** — because
> that ask happens inside a sales conversation, is made by the customer rather than by
> us, and its failure is a deal risk rather than a partnership risk.

Stated differently: if the counterparty is the distributor, it is Partnerships. If the
counterparty is the restaurant and the distributor is a dependency of the sale, it is
Sales. The [[supplier-distributor-network-charter]] agent is writing the mirror side of
this line in the same generation round; the two texts should be diffed before either is
treated as settled.

> **Fork-ID correction.** The division brief handed to this session labelled this fork
> **CM-F6**. In [[commercial]] §6 (`.planning/foundation/teams/commercial.md:631`) it is
> **CM-F3**; **CM-F6** is the separate Social & Community dormancy fork
> (`.planning/foundation/teams/commercial.md:634`). This document uses **CM-F3**. Noted
> rather than silently reconciled, because a fork cited under two IDs gets resolved twice
> and closed once.

### The deliverability boundary

The platform's transactional mail flows through **one Gmail identity**. The sender falls
back to a hardcoded `notifications@wineops.ai`
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`), and the inbound poller
filters against that same resolved address
(`apps/api-gateway/src/communications/communications.controller.ts:1028-1031`). That one
mailbox carries vendor procurement mail and customer notifications.

**Cold outbound must never leave that identity.** One spam complaint on a sales sequence
would degrade the deliverability that purchase orders and low-stock alerts depend on —
one reputation, three broken systems. Sales owns this constraint as a hard boundary, not
a preference; the enforcement mechanism is in [[outbound-engine-charter]] and the gate is
in [[sales-directive]].

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `sales.verified_dollars_recovered` | Credits that **landed** on a later invoice, not credits requested (`.planning/YC_WEDGE_PLAN.md:31-33`) | **$0** — and the check that would generate the claim cannot fire; see Evidence |
| `sales.unprompted_sessions_7d` | Design-partner sessions in 7 days **not** preceded by a founder message | **unmeasurable** — no product analytics configured anywhere in `env.example` (187 lines) |
| `sales.design_partner_touch_streak` | Consecutive weeks with a real contact | 0 — no cadence exists |
| `sales.qualified_conversation_rate` | Qualified conversations per 100 first-touches | **dormant** — undefined until the list un-defers |
| `sales.sending_identity_isolated` | Boolean: is cold outbound on a domain distinct from the transactional sender? | **false** — one identity, `gmail.service.ts:76-78` |
| `sales.time_to_first_connection` | Days from today until DEP-06 is checked | running, uncapped |
| `nf_b.source_count` | Restaurants emitting real guest events | **0**, and see below |

**The NF-B dependency nobody else can discharge.** [[README]] §4.2 makes NF-B (guests) a
priority track. NF-B needs real guests making real choices in a real restaurant. There is
exactly one candidate restaurant in existence (`.planning/PROJECT.md:127`), and it is this
department's account. **Until `DEP-06` is checked, the guest track of the neural footprint
has no source at all.** That makes a Sales checkbox a blocking dependency for
[[guest-experience-charter]] and [[research-math-charter]] — surfaced here so it is
negotiated rather than discovered.

## Evidence today

Graded per [[commercial]] §0: **EXISTS** = running code or shipped schema · **PARTIAL** =
machinery exists but not for this purpose · **NEW** = nothing in the repo.

**Roll-up: `new`.** Not a single line of code in this repository is sales machinery. The
department's one genuine asset is a relationship, and a relationship is not an operation.

- **EXISTS (as a relationship, not as an operation) — the design partner.** *"First user:
  Friend's Turkish restaurant in SF using Toast POS. Full API access available."*
  (`.planning/PROJECT.md:127`). Real, named, willing, and with the rarest thing in
  restaurant software: API access already granted.
- **NEW — the connection.** `DEP-06: Toast API credentials configured for friend's
  restaurant` is **still unchecked** (`.planning/PROJECT.md:101`). This is the single
  most consequential unticked box in the department and possibly in the division.
- **EXISTS — the connector waiting for those credentials.** `apps/api-gateway/src/toast/`
  holds `toast.service.ts` (33KB, with `getSalesData`, `getMenus`, `processWebhook`,
  `createOrder`), `toast-auth.service.ts`, `toast.controller.ts`, DTOs, and a spec file.
  Config placeholders are already in `env.example:49-56`
  (`TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`,
  `TOAST_WEBHOOK_SECRET`, `TOAST_ENVIRONMENT=sandbox`). **This corrects the division
  document upward**: the blocker is not "build a Toast integration", it is "five
  environment variables and a conversation." That is a materially smaller and more urgent
  ask than [[commercial]] §3 implies.
- **EXISTS — the value to be demonstrated.**
  `apps/api-gateway/src/procurement/invoice-match.ts` — a real three-way match, pure and
  unit-tested (`.planning/YC_WEDGE_PLAN.md:129`). *(Stale-citation note: that document
  describes the file as 256 lines; it is now **406**. The finding holds, the number is
  old.)*
- **PARTIAL — and the headline check currently cannot fire.** The four-way match's
  strongest claim, `overbilled_vs_ship` (`.planning/YC_WEDGE_PLAN.md:342`), needs an
  invoice document. Today the invoice half is **typed by hand, per line item**, in the
  receiving UI: `aria-label="Quantity invoiced"` at
  `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400` and
  `aria-label="Invoice unit price"` at `:438`. *(The YC plan cites `:233,:265`; the file
  has changed and the live lines are `:400` and `:438`.)* **Sales' primary metric is
  gated on someone else's ingestion work** — a dependency this charter names rather than
  assumes away.
- **PARTIAL — reusable outbound machinery, pointing the wrong way.** The unknown-sender
  capture shape is built, wired, and dormant:
  `apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`;
  both controllers registered, feature gated on `INBOUND_EMAIL_DOMAIN`, *"Nothing is left
  to build… Activating it is an ops task, not a build task"*
  (`.planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md:3-12`). Reusable pattern. **Not a
  pipeline.** See the trap warning at the top.
- **PARTIAL — a sending-identity switch already exists.** `env.example:165` declares
  `EMAIL_BACKEND=gmail`, and a second backend key is already reserved
  (`SENDGRID_API_KEY`, `env.example:167`, read at
  `services/agent-orchestrator/config/settings.py:202`). The seam for isolating cold
  outbound onto a separate identity **exists and is unused**. That is the cheapest
  available fix for the department's worst technical risk.
- **NEW — everything else.** No CRM, no pipeline table, no lead/deal/opportunity schema
  across 62 migrations, no sequencing tool, no qualification rubric, no target list, no
  price, no invoice, no revenue, no case study, no demo script.

## Two teams, honestly

[[commercial]] §3 argues two teams is what one deferred list and one customer support, and
that proposing five would be inventing an org. That reasoning is sound and is not
re-litigated here. The narrower observation this charter adds:

**One of the two teams is dormant by construction.** [[outbound-engine-charter]]'s primary
metric is explicitly *"dormant until the list un-defers"* ([[commercial]] §3). So Sales is
operationally a **one-team department with a design document attached** — and that is the
correct shape, provided nobody staffs the dormant team or grades it green. The failure
mode is not the team count; it is a dormant team quietly acquiring activity to look busy.
That is [[sales-premortem]] M4, and the entry trigger that governs it is in
[[outbound-engine-charter]].
