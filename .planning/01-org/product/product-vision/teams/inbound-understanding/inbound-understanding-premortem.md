---
type: premortem
division: product
department: product-vision
team: inbound-understanding
status: provisional
metrics: [inbound.false_accept_count, inbound.proposal_accept_without_edit_rate]
updated: 2026-08-24
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-directive]]", "[[product-vision-premortem]]", "[[connector-platform-trust-charter]]", "[[security-charter]]", "[[red-team-charter]]"]
---

# Inbound Understanding — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — Accuracy was reported on the corpus it was tuned on

This is the team's named premortem (`teams/product.md:98-100`) and it deserves the first
slot. Extraction accuracy is measured against the invoice set the extractor was built
against — the one with predictable single-column PDFs from two vendors. The first real
vendor with a two-column layout and a credit memo halves it. Because **acceptance was the
only metric**, nobody notices: the reviewer accepts, the number stays high, and a
restaurant's cost basis is wrong for a quarter. `credit-ledger.ts` exists, which means the
credit case is *modelled* — it is the case where a wrong extraction is silently
compensating, so it is the last one anyone spots.

**Earliest observable signal.** Acceptance-without-edit rate **rising** while the number of
distinct vendors in the corpus also rises. That combination is nearly impossible if the
metric is honest — new vendor formats should depress acceptance before the model adapts. If
it does not, the reviewers are rubber-stamping.

**Counter-pressure.** `inbound.false_accept_count` ships **before** any accuracy claim, and
it requires a correction path: when a line item, price, or credit is later edited on the
downstream record, that edit is joined back to the proposal that created it. Report the two
numbers as a pair, always, on [[inbound-understanding-agenda-board]] — a rate with no
false-accept denominator is not published at all. Second: the backtest that already exists
for invoices (`invoice-match.backtest.spec.ts`) is extended with a **held-out vendor set**
that no threshold was tuned against.

---

### M2 — Three modules grew three thresholds and the grouping dissolved

The team's premise is that Email + Order + Invoice are one guardrail contract. The pressure
against it is constant and each instance is reasonable: invoices have an X12 path and
structured line items; email has a triage classifier and a conservative reply gate that
already shipped; recurring orders have their own schedule semantics. Each grows a local
confidence constant because each has a different corpus. Within a year there are three
approval UXs and three definitions of "confident" — the exact failure
[[FUTURES]] §8.3 names, one layer down.

**Earliest observable signal.** The **second** confidence-threshold constant appearing
anywhere under `apps/api-gateway/src/procurement/documents/` or
`apps/api-gateway/src/communications/` that is not read from the shared contract. Also: the
second approve/reject component that is not `apps/api-gateway/src/one-tap-actions/`.

**Counter-pressure.** The guardrail contract is **one versioned artifact with one owner**.
Per-module thresholds are permitted only as parameters of it, and a CI conformance check
(`inbound-gate-conformance`, [[inbound-understanding-schedule]]) fails a diff that
introduces a free-standing constant. A module that genuinely needs a *different shape* of
gate does not get a local exception — it triggers a team-split proposal to
`OPEN-DECISIONS.md`, because that would be evidence the shape-grouping was wrong, and that
is a decision, not a drift.

---

### M3 — The gate became a formality because the reviewer was the same person all day

The house pattern is correct: draft, one-tap approve, never auto-send. But a human gate is
only a gate while the human is discriminating. A manager reviewing forty near-identical
delivery confirmations develops a rhythm, and the rhythm is *approve*. The product then has
the *appearance* of human oversight — the audit trail is perfect, every row has an
approver — with none of the substance. This is worse than no gate, because everyone
downstream trusts it.

**Earliest observable signal.** Time-to-approve distribution collapsing: p50 approval
latency falling below the time it physically takes to read the proposal. Also: approval rate
approaching 100% for any single document type over a week.

**Counter-pressure.** Two mechanisms, both cheap. **(a)** The proposal surfaces *what it is
least sure about* — the gate shows the two or three fields with lowest confidence first,
not a tidy summary; a reviewer who sees only the summary cannot discriminate.
**(b)** Deliberate sampling: a small random share of high-confidence proposals is presented
for full review regardless, and disagreement on that sample is the honest read on
`inbound.false_accept_count` before the correction path is mature. If approval rate is 100%
on the sample too, that is a finding, not a pass.

---

### M4 — The input was never authenticated, and one forged document rewrote a cost basis

The team's entire input arrives through public webhooks.
`POST /webhooks/inbound-email` is one of **32** routes classified as *"webhook module —
expected public, must verify signatures instead"*, and **0 of 32 verify signatures today**
(`teams/product.md:779-783`). `TenantGuard` returns `true` for unauthenticated requests by
design (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`). Meanwhile
`recurring-orders` carries **6 unguarded routes that can place real orders**
([[ENDPOINTS]]:428). The failure is not that extraction is wrong — it is that the document
was never from the vendor at all, and every guardrail downstream was designed on the
assumption that it was.

**Earliest observable signal.** Any inbound document whose sender/tenant attribution cannot
be reconstructed from a verified signature — which today is *all of them*. Concretely: the
first time an investigation asks "which vendor sent this" and the answer comes from the
document's own contents.

**Counter-pressure.** This team does not own verification —
[[connector-platform-trust-charter]] does, co-owned with [[security-charter]] under OD-19 —
but it owns the **dependency being explicit**. The guardrail contract states that a proposal
derived from an unverified payload is marked as such in the UI and is **never eligible for
the high-confidence fast path**. That is enforceable by this team today and costs nothing to
state. Escalate the 0-of-32 figure at every close-time until it moves.

---

### M5 — The team optimized the pipeline it could measure instead of the workflow that hurt

Invoices are the tractable module: structured documents, a backtest already written, an X12
path, a credit ledger. Email is messy and Order Watcher is entangled with procurement
scheduling. So a year of work goes into invoice extraction quality, which is legible and
improvable — while the actual daily pain (a vendor emails a price change in prose, nobody
notices, the next PO is wrong) sits in the module with no backtest. The department's demand
reality makes this worse, not better: `procurement_orders` = 1
([[AGENT_NATIVE_UI_DECISION]] §2), so *no* module has real volume pulling on it, and the
tie-break defaults to whichever is nicest to work on.

**Earliest observable signal.** Three consecutive close-times where every closed item names
`procurement/documents/` and none names `communications/`.

**Counter-pressure.** The primary metric is defined **per module, per document type** on
purpose — one number cannot hide behind another. [[inbound-understanding-agenda-board]]
shows three rows, and a module with no reading is shown as *unmeasured*, never omitted. The
department's subject rule applies ([[product-vision-directive]]): a proposal must name the
restaurant it changes, and "the invoice pipeline is more improvable" is not a restaurant.

---

## Cross-cutting counter-pressure

- **Never report acceptance without false-accepts.** If the pair cannot be published, the
  number is not published. This single rule kills M1 and M3 together.
- **One contract, one approval primitive** — enforced in CI, not in review culture (M2).
- **The unverified-input dependency is stated in the contract**, so M4 is a known risk with
  an owner rather than an assumption nobody wrote down.
- **[[red-team-charter]] attacks the contract**, especially the sampling design in M3 —
  findings-only ([[ORG_STRUCTURE]] §3), landing in `questions.md`.
- **Anti-sprawl:** if this document has not been revisited in 60 days it is fiction
  (foundation §3.3).
