---
type: charter
division: commercial
department: sales
team: outbound-engine
status: new
metrics: [sales.qualified_conversation_rate, sales.sending_identity_isolated, sales.complaint_rate, sales.reply_rate, sales.claim_provenance_rate]
updated: 2026-08-24
links: ["[[outbound-engine-premortem]]", "[[outbound-engine-directive]]", "[[outbound-engine-loops]]", "[[outbound-engine-schedule]]", "[[outbound-engine-agenda-full]]", "[[outbound-engine-agenda-board]]", "[[sales-charter]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[media-brand-charter]]", "[[growth-charter]]", "[[conversion-funnel-charter]]", "[[inbound-understanding-charter]]", "[[reliability-sre-charter]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]"]
---

# Outbound Engine — Charter

> **`NEW`, and dormant by construction.** This team's own primary metric is undefined
> until the founder un-defers the target list ([[commercial]] §3). It exists to *design*
> a sending machine, not to run one. **Zero sends and zero spend are the correct output
> for this quarter**, and a version of this team that looks busy is a version that has
> failed. See §Entry trigger.

---

## ⚠️ The `prospects` module is not this team's pipeline

Before any evidence below is read: the repo's `prospects` module
(`apps/api-gateway/src/common/orchestrator/prospects.service.ts`) captures **vendors cold-
emailing a restaurant** — a wine rep sending an unknown-sender intro to a restaurant that
uses our product (`prospects.service.ts:36-42`). It is the **opposite direction** from
Mudavym selling to restaurants.

It is a valuable *shape* to copy: unknown-sender capture, domain dedupe, never auto-reply,
one-tap human promotion. It is **not** an existing sales pipeline, and citing it as one
would put this team's plans on a false premise. Stated here as well as in
[[sales-charter]] because this is the team most likely to be tempted.

---

## Mandate

Own **the mechanics of reaching restaurants that do not know us**: sequence
infrastructure, sending reputation and deliverability, reply routing, and the qualification
rubric.

**Explicitly not the target list.** That is founder-deferred and is not sketched here, not
in the agenda, and not in the schedule. Separating the machine from the list is the entire
reason this team can be designed at all while the list stays deferred — and it is the
discipline that must hold, because a team with a machine and no list will invent a list.

**Why distinct from [[design-partner-operations-charter]].** S1 is operational relationship
work with one named counterparty; its craft is presence. This is systems work at
population scale; its craft is deliverability, sequencing, and rubric design. The failure
modes are inverses: S1 fails by being too welcome, this team fails by being unwelcome at
scale. Beyond craft, the split isolates a risk **nothing else in the org owns** — see below.

## Boundaries

Owned outright:

- **Sending identity and reputation.** Which domain, which backend, which warmup, and the
  hard separation from the platform's transactional mail. This is the team's most
  important asset and its most fragile.
- **Sequence infrastructure** — steps, timing, stop conditions, suppression lists.
  Suppression is owned as seriously as sending; an org that cannot reliably stop emailing
  someone should not start.
- **Reply routing** — where a human reply lands, who answers, inside what window.
- **The qualification rubric** — what makes a restaurant worth a conversation, written
  down before there is anyone to qualify, so it is a standard rather than a rationalisation.
- **The claim allowlist** — the enumerated set of statements outbound copy may make, each
  traced to evidence. Copy is [[media-brand-charter]]'s craft; **what may be asserted** is
  this team's gate.
- **Complaint and bounce handling**, including the automatic volume cut.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **The target list / ICP** | **Founder-deferred. Unassigned.** | Not chartered, not sketched, not inferred. A machine is designed; a list is chosen. This team does the first only. |
| **The copy itself** | [[media-brand-charter]] → [[narrative-collateral-charter]] | They write the sentences. We own which claims are permitted and which identity sends them. |
| **Legal basis for cold contact** | Corporate → [[compliance-privacy-charter]] | CAN-SPAM / GDPR lawfulness is theirs to rule on. Mechanics and suppression are ours. |
| **The design partner** | [[design-partner-operations-charter]] | One counterparty, warm. If we are emailing someone who already knows us, we are in the wrong team. |
| **Inbound demand and the website funnel** | [[growth-charter]] → [[conversion-funnel-charter]] | They convert people who came to us. We interrupt people who did not. |
| **The `prospects` / inbound-email module** | [[product-vision-charter]] → [[inbound-understanding-charter]] | It is a product feature for our customers' vendor mail. See the warning above. |
| **The recovery number** | [[design-partner-operations-charter]] / [[analytics-bi-charter]] | We may only use a number someone else verified landed. |
| **Price** | [[finance-pricing-charter]] | Deferred, and never ours. |
| **Transactional email deliverability** | [[reliability-sre-charter]] / Engineering | We own **not damaging it**. That is a boundary, not a shared responsibility. |

## The one risk nothing else in the org owns

The platform's transactional mail runs through **a single Gmail identity**. The sender
resolves to a hardcoded fallback, `notifications@wineops.ai`
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`), and the inbound poller
filters against that same resolved address
(`apps/api-gateway/src/communications/communications.controller.ts:1028-1031`). That one
mailbox carries **vendor procurement mail** and **customer notifications**.

Cold outbound sent from it would couple sales deliverability to both. **One spam complaint,
three broken systems** — and the outage would present as a procurement bug, so the sales
experiment that caused it would be the last place anyone looked.

**The mechanism, not the intention.** The seam already exists and is unused:
`env.example:165` declares `EMAIL_BACKEND=gmail`, and a second backend key is already
reserved (`SENDGRID_API_KEY`, `env.example:167`, read at
`services/agent-orchestrator/config/settings.py:202`). So isolation is **configuration
plus a domain purchase**, not architecture. It is enforced by a CI guard in the shape of
the repo's existing `scripts/check_*.sh` family: **no module under an outbound path may
reach `GmailService`.** `sales.sending_identity_isolated` is a boolean, and it must be
`true` before send #1.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `sales.qualified_conversation_rate` | **Primary.** Qualified conversations per 100 first-touches | **dormant** — undefined until the list un-defers |
| `sales.sending_identity_isolated` | Boolean: cold outbound on a domain distinct from the transactional sender | **false** (`gmail.service.ts:76-78`) |
| `sales.complaint_rate` | Spam complaints per 1,000 sends — the **safety** metric, not a performance one | n/a, 0 sends |
| `sales.reply_rate` | Human replies per 100 first-touches | n/a |
| `sales.claim_provenance_rate` | Share of assertions in live copy traceable to verified evidence | n/a — and the allowlist is currently empty by design |
| `sales.suppression_integrity` | Share of stop requests honoured within 24h | n/a |

**Note on the primary metric.** Qualified conversation rate, not reply rate and not open
rate. Replies include *"take me off this list"*; opens are noise on a modern mail client.
Choosing the strictest of the three now, while the number is zero and nobody is attached to
it, is the only time this choice is free.

## Entry trigger

This team **does not staff, spend, purchase tooling, register a domain, or send anything**
until **both** hold:

1. `sales.verified_dollars_recovered > 0` — a credit that actually landed on a later
   invoice (`.planning/YC_WEDGE_PLAN.md:31-33`), produced by
   [[design-partner-operations-charter]]; **and**
2. the founder has **un-deferred the target list**.

Until then the only permitted output is **design**: the isolation decision, the
qualification rubric, the reply-routing shape, and the claim allowlist's structure. Written
as a trigger rather than a plan so the team cannot quietly begin — [[sales-premortem]] M5
is precisely the failure of a dormant team acquiring activity to justify itself.

## Evidence today

- **NEW — everything that is actually this team's mandate.** No sequencing tool, no sending
  domain, no warmup, no suppression list, no qualification rubric, no reply routing, no
  claim allowlist, no sends. Across 62 migrations there is **no lead, deal, opportunity, or
  sales-pipeline schema of any kind**.
- **PARTIAL — a reusable pattern, pointing the other way.** The unknown-sender capture
  shape is built, wired, and dormant: `prospects.service.ts:36-42` captures unknown-sender
  vendor email, dedupes by domain, **never auto-replies**, and offers one-tap promotion.
  `.planning/07-reference/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md:3-12` confirms both controllers are
  registered and the feature is gated on `INBOUND_EMAIL_DOMAIN` — *"Nothing is left to
  build… Activating it is an ops task, not a build task."* **Reusable shape. Not a
  pipeline.** See the warning at the top.
- **PARTIAL — the isolation seam exists, unused.** `env.example:165` `EMAIL_BACKEND=gmail`;
  `SENDGRID_API_KEY` at `env.example:167`, read at
  `services/agent-orchestrator/config/settings.py:202`. The cheapest available fix for the
  team's worst risk is already half-built.
- **EXISTS — the risk itself.** One transactional sending identity
  (`gmail.service.ts:76-78`; `communications.controller.ts:1028-1031`) carrying vendor and
  customer mail.
- **EXISTS — the guard pattern to copy.** The repo already runs grep-grade CI guards
  (`scripts/check_no_direct_stock_writes.sh` and siblings). The import ban is one more of
  the same, and is buildable today, before there is anything to send.
- **NEW — the thing that would make the machine matter.** No verified claim exists yet:
  `sales.verified_dollars_recovered == $0`.
