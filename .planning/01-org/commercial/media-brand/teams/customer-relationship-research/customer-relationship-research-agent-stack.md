---
type: agent-stack
division: commercial
department: media-brand
team: customer-relationship-research
status: designed
updated: 2026-08-27
metrics: [nf_b.choice, nf_b.context]
links: ["[[customer-relationship-research-charter]]", "[[customer-relationship-research-schedule]]", "[[customer-relationship-research-loops]]", "[[customer-relationship-research-directive]]", "[[0034-agent-stack-artifact]]", "[[media-brand-agent-stack]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[skills-charter]]"]
---

# Customer Relationship Research (M4) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only card in Commercial that could touch an identified individual, so it is written as a
> **gate before it is written as an agent**. The register that gate reads does not exist, so
> today the correct output of this unit for every research request is **no**
> ([[customer-relationship-research-charter]] §The consent gate).
>
> **The consent gate is consumed, never redefined here.** It is
> [[privacy-engineering-charter]]'s to build as a callable check with a real denial path
> (`privacy-engineering-charter.md:24-25,57`); its legal shape is
> [[compliance-privacy-charter]]'s. Any line below that reads as a second definition of consent
> is a defect in this document.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `crr-eligibility-gate` | Answer every research request with `eligible` / `not eligible` / `no register`, write the refusal down either way, and touch no subject until the gate it calls exists | NEW |

One row, and it is a refusal engine rather than a research engine — an agent that could
*perform* research before the gate exists is the artifact
[[customer-relationship-research-schedule]] §"Skills this team will not build" refuses to make.

## 2. Agent cards

```yaml
agent: crr-eligibility-gate
unit: customer-relationship-research
triggers:
  - topic: research.request_raised          # publisher: NONE (gap — requests arrive in conversation; nothing emits them)
  - schedule: "weekly — reconciliation: subjects touched vs approved, must be equal"   # mirrored in [[customer-relationship-research-schedule]]
  - schedule: "weekly — withdrawal sweep"
  - schedule: "monthly — purpose-drift audit; register-build status"
consumes:
  - "the consent gate owned by [[privacy-engineering-charter]] — called, never reimplemented; its denial counter is `privacy.consent_gate_denials`"
  - "the guest consent record: `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64` (`consent_purpose`, `consent_notice_version`, `consent_captured_via`, `consent_captured_at`, `consent_withdrawn_at`)"
  - the customer approval register        # publisher: NONE (gap — it does not exist; this is the whole finding)
emits:
  - "the refusal log → consumed by this unit's weekly reconciliation and by [[privacy-engineering-charter]]'s `privacy.consent_gate_denials` (a gate that never denies is not a gate)"
  - "`research-consent-reconciliation`, `research-withdrawal-propagation`, `research-purpose-drift`, `research-register-build` loop outputs ([[customer-relationship-research-loops]])"
  - retraction-queue entries when a `consent_withdrawn_at` appears
routing_class: mechanical    # a gate is a lookup on purpose; making it judgment is how a gate becomes something to argue with
quality_bar: "exactly one of `eligible` / `not eligible` / `no register`; `no register` is terminal — not a warning, not a soft pass, and never accompanied by a suggested alternative. The hard metric overrides everything: zero subjects touched off-register, zero records touched with `consent_withdrawn_at` set"
autonomy:
  read: autonomous           # scoped to the vault, the loops, and the register's existence check — subject records are NOT a read surface while there is no register
  propose: autonomous        # refusal logs and the register's operational shape; the legal shape is Compliance & Privacy's to decide, never proposed as settled here
  mutate_stock_money_outbound: confirm   # constant — and note it already covers the research act itself: fetching a customer's public page is outbound, it lands in their server logs (the lesson `vendor-page-extractor.service.ts:17` taught this company), so it is confirm-gated on top of the consent gate, not instead of it
memory: customer-relationship-research
escalates_to: "[[compliance-privacy-charter]]"
```

**The card's own hard rules.** Prospect research is refused outright and routed to
[[outbound-engine-charter|Sales S2]] under their rules, never by borrowing this gate. A reply, a
follow, or a mention is **not consent**. It checks `consent_purpose` / `approval_purpose`, not
mere presence — testing `consent_captured_at is not null` and stopping there is purpose drift
implemented as a skill ([[customer-relationship-research-schedule]]).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `consent-register-check` | T2 | Before any research touch, and as the weekly sweep | Returns exactly one of `eligible` / `not eligible` / `no register`; `no register` is terminal; the refusal is written to a log, because a gate whose refusals are invisible cannot be shown to have held | The 2026-08-24 charter session ran this gate by hand and recorded the result: no live customer, no external site, and no social presence was fetched or looked up, *because the gate does not exist* (`customer-relationship-research-charter.md:151-154`). A hand-run, not a tool run — which is the instance README §3.3 asks for and the reason this is the one skill worth building first | NEW |

`finding-format-lint` is **absent on purpose**: there are no findings, so a lint over a format
that does not exist yet would encode a guess ([[customer-relationship-research-schedule]]). The
ordering is the point — the gate first, the format second.

Consumed, owned elsewhere: the consent gate itself and the PII guards
([[privacy-engineering-charter]]) · lawful basis, DPAs, notice text
([[compliance-privacy-charter]]) · the envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate intact.
- **Episodic** — nf_a `task_type: research_eligibility_check`, one event per request, with
  `context.subject_class` (customer | guest) and `context.purpose` as jsonb keys so a
  purpose-drift query is a filter rather than a reconstruction. **Every refusal is an episodic
  row**; the row that would matter most is the first non-refusal, and it cannot exist yet.
  The unit's declared NF-B metrics (`nf_b.choice`, `nf_b.context`) **emit nothing today** — NF-B
  is a priority track and L4 is uninstrumented (charter §Metrics).
- **Semantic** — `memory/` beside this file, `customer-relationship-research-MEMORY.md` as
  index. Founding facts: the guest columns are a *different subject and a different purpose*
  from customer web-presence research, so reusing them is drift permanently recorded in
  migration history; the erasure tombstone semantics; and the unowned review of this unit's
  data use. Provenance frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §The consent gate. Subject data is not a
  working-set item at all; the migration file is a `path:line` retrieval target.

**Consolidation** — monthly, mirrored on the register-build status row in
[[customer-relationship-research-schedule]]: read the month's refusals; **failures first** —
any request that came close to being answered "yes" without a register becomes a fact naming
the pressure that produced it, because that pressure is the premortem's mechanism; expire facts
unverified for 90 days; propose skill candidates. One PR; "no delta" stated. **The anti-sprawl
rule is inverted for the register-build job**: three unchanged runs is an *escalation*, not a
downgrade — the thing not moving is the gate, and deleting the watch is how a blockage becomes
an exception.

## 5. Async contract

Cross-unit interaction: loops ([[customer-relationship-research-loops]]), NF-A events, vault
PRs, and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The approval register has no publisher because it does not exist | Named in the charter as the founding finding. Until [[privacy-engineering-charter]] ships the gate and Compliance reviews the register, every eligibility answer is `no register` |
| `research.request_raised` has no publisher | Requests arrive in conversation. The refusal log is therefore only as complete as the human who logs the ask — an honest weakness, not a solved problem |
| `privacy.consent_gate_denials` has no source | The metric exists on [[privacy-engineering-charter]]; the gate that would increment it does not (`privacy-engineering-charter.md:83`) |
| Review of this unit's data use is **unowned** | [[commercial]] §4 assigns it to Ethics & Responsible AI; ORG_STRUCTURE §3 records that function as considered and not adopted. Escalated to [[compliance-privacy-charter]], not quietly reassigned |

## 6. Evidence today

- **EXISTS — the guest consent substrate**, and it is unusually well built:
  `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64`, the design note at
  `:55-57`, the erasure tombstone at `:79-81` and `:112-117`. A pre-login `/privacy` route exists
  (`apps/web/src/App.tsx:158`).
- **PARTIAL, tending to zero in practice.** The schema has **0 call sites**
  (`privacy-engineering-charter.md:83`, `regulatory-posture-charter.md:163`): no consent has
  ever been captured and no erasure has ever been executed. A substrate nothing exercises is
  not a working gate.
- **NEW — the approval register, the research practice, the findings format, the retraction
  mechanism, the cohort definition, the agent, the skill, and all of §4.** Stated plainly
  because the honest grade for this unit's own work is NEW across the board.
