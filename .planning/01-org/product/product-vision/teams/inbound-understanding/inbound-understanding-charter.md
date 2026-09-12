---
type: charter
division: product
department: product-vision
team: inbound-understanding
status: partial
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count, nf_a.doneability_verdict, nf_a.outcome]
updated: 2026-08-24
links: ["[[inbound-understanding-premortem]]", "[[inbound-understanding-agenda-full]]", "[[inbound-understanding-agenda-board]]", "[[inbound-understanding-directive]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-schedule]]", "[[product-vision-charter]]", "[[ask-ai-charter]]", "[[supply-discovery-charter]]", "[[connector-platform-trust-charter]]", "[[supplier-distributor-network-charter]]", "[[ENDPOINTS]]", "[[FUTURES]]"]
---

# Inbound Understanding — Charter

Parent: [[product-vision-charter]] (Product division). Siblings:
[[service-floor-charter]], [[supply-discovery-charter]], [[surface-portfolio-charter]],
[[ask-ai-charter]].

## Mandate

Own the definition, boundary, and doneability criteria of the three modules that turn
something arriving from outside into a **structured, human-gated proposal**: **Email
Watcher**, **Order Watcher**, and **Invoice/Receipt Understanding**. The deliverable is not
three extractors — Engineering builds those. The deliverable is **one guardrail contract**:
what confidence means, what the gate looks like, what a human sees before they approve, and
how we find out afterwards that they approved something wrong.

## Boundaries

Owns outright:

- **The guardrail contract** — one confidence/gate standard, one approval primitive, one
  false-accept audit, shared by all three modules. Per-module thresholds are permitted only
  as *parameters* of this contract.
- **Module boundaries** — what counts as Email Watcher vs Order Watcher vs Invoice
  Understanding, and what each is done when it does.
- **The proposal shape** — every module's output is a proposal a human accepts, edits, or
  rejects. Never an execution.
- **The correction path** — how a wrongly-accepted proposal gets found and recorded.
  Without this, acceptance rate is a number that only goes up.

**Why these three are one team.** All three share one shape and therefore one failure mode:
input is adversarial and unstructured, extraction is probabilistic, and the output must
never execute itself. They fail identically — *a confident wrong extraction that a human
rubber-stamps* — so they need one confidence/gate standard, not three. Splitting them
per-module would produce three incompatible approval UXs, which is precisely the outcome
[[FUTURES]] §8.3 forbids for chatbots, reproduced one layer down
(`.planning/foundation/teams/product.md:74-79`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The extractors, parsers, and X12 code | [[engineering-charter]] | We own what "good enough to propose" means; they own the code that reaches it |
| Verifying the inbound webhook is genuine | [[connector-platform-trust-charter]] | We trust a payload **only** if signature verification happened upstream — today **0 of 32** webhook routes verify |
| Vendor relationships, terms, and the portal | [[supplier-distributor-network-charter]] | We understand what a vendor sent; they own the vendor |
| Outbound crawling for new vendors | [[supply-discovery-charter]] | We process what arrives; they go and get it |
| The action schema for *AI-initiated* actions | [[ask-ai-charter]] | Ours is human-initiated review of machine extraction; theirs is machine proposal of human intent. **Both must use the same confirm primitive** |
| Whether the extraction model is good | [[research-math-charter]] *(Intelligence)* / [[ai-orchestration-charter]] | We set the bar; they move the model to it |
| The screens | [[design-charter]] | One approval component is our constraint; its pixels are theirs |

## Metrics it moves

**Primary — `inbound.proposal_accept_without_edit_rate`**, per module, per document type.

**Paired hard gate — `inbound.false_accept_count`**: proposals accepted and later corrected.
The pairing is the whole design. Acceptance-without-edit rises when a human rubber-stamps,
so it is only meaningful next to the count of times rubber-stamping was wrong. A charter
that reports acceptance alone is reporting how tired the reviewer is.

Neural-footprint tie: each proposal is a complete NF-A event —
`stimulus` (the document that arrived) → `internal_state` (extraction confidence,
alternatives considered) → `choice` (accept / edit / reject) → `outcome` +
`doneability verdict` (foundation [[README]] §4.4). This team is the largest natural source
of NF-A rows in the product. L4 emits nothing today (foundation [[README]]:80), so these are
target shapes, not readings. *Corrected 2026-08-25: L4 emits since P1
(`model-client.service.ts:413`) — `inbound-responder` is one of the 7 wrapped
callsites. The `doneability verdict` half is still ungraded for this task type
([[0017-doneability-verdicts-are-sidecar-claims]]).*

## Evidence today

**PARTIAL — all three modules have running code; the shared contract does not exist.**

**Email Watcher**
- `apps/api-gateway/src/communications/gmail-watch.service.ts`
- `apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts` —
  `POST /webhooks/inbound-email`, a public webhook ([[ENDPOINTS]]:120-124)
- Phase 0 inbound-email intelligence shipped on
  `feat/inbound-email-intelligence-phase0`: triage signals, shadow classification, durable
  notifications, conservative reply gate

**Invoice / Receipt Understanding**
- `apps/api-gateway/src/procurement/documents/` — `document-extractor.service.ts`,
  `document-intake.service.ts`, `line-matcher.ts`, `credit-ledger.ts`, `document-types.ts`,
  `parsed-document.ts`, `credits.controller.ts`, `documents.controller.ts`, and `x12/`
- `apps/api-gateway/src/procurement/invoice-match.ts` with a backtest spec
  (`invoice-match.backtest.spec.ts`) — the only module in the department with a backtest

**Order Watcher**
- `apps/api-gateway/src/procurement/` + `recurring-orders.controller.ts`
- ⚠️ `recurring-orders` has **6 unguarded routes** that can place real orders against real
  vendors ([[ENDPOINTS]]:428) — co-owned with [[security-charter]] under OD-19

**The human-gate primitive already exists**
- `apps/api-gateway/src/one-tap-actions/` — controller, service, spec, module, dto
- The house style is already correct: vendor-reply AI drafts, one-tap approve,
  **never auto-send**

**What does not exist**
- No shared confidence/gate standard across the three. No correction path, therefore no
  `inbound.false_accept_count`. No per-module acceptance instrumentation.
- ⚠️ The upstream trust assumption is unmet: the inbound-email webhook is one of the **32**
  routes classified as *"webhook module — expected public, must verify signatures instead"*,
  and **0 of 32 verify signatures today** (`teams/product.md:779-783`). This team's entire
  input is currently unauthenticated.

## Entry condition

Active now. It is the second team to stand up ([[product-vision-agenda-full]]), and its
first artifact is the guardrail contract, not a module change.
