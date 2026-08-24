---
type: charter
division: corporate
department: legal
status: new
metrics: [legal.instrument_chain_integrity, legal.request_to_executable_draft_days, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[legal-premortem]]", "[[legal-agenda-full]]", "[[legal-agenda-board]]", "[[legal-directive]]", "[[legal-loops]]", "[[legal-schedule]]", "[[instruments-equity-charter]]", "[[commercial-workforce-agreements-charter]]", "[[ORG_STRUCTURE]]", "[[corporate]]", "[[README|foundation-README]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[regulated-operations-charter]]", "[[roster-lifecycle-charter]]", "[[decision-office-charter]]"]
---

# Legal — Charter

Parent division: **Corporate** ([[ORG_STRUCTURE]] §2). Siblings in-division: Knowledge &
Documentation, Compliance & Privacy, People & Agent Ops, Strategy & Fundraising.

> **This document is not legal advice, and nothing in this department's vault is drafted
> legal text.** It is the charter for a *function* — one that commissions, prepares,
> tracks and retains paper that a qualified lawyer reviews before it binds anything. No
> artifact under `01-org/corporate/legal/` should ever be lifted into a contract. If a
> file in this tree starts to read like clause language, that is a defect, and
> [[legal-premortem]] M5 is the mechanism that produced it.

## Mandate

Legal is accountable for **the company's paper**: the executable instruments that bind
Mudavym to another party, and the record proving each one was properly authorised,
executed and retained. Its founding scope is the fifteen document types the founder named
— founder agreement · employment agreement · contractor agreement · NDA · MSA · statement
of work · professional services agreement · IP assignment · SAFE · board consent · stock
purchase agreement · advisor agreement · data processing agreement · business associate
agreement · letter of intent (`.planning/foundation/teams/corporate.md:54-57`). It
commissions and prepares those instruments; it does not decide their terms, does not own
the regulatory obligations *inside* them, and does not opine on the law.

## Boundaries

Owns outright:

- **The instrument register** — what paper exists, in what state (requested · drafted ·
  in counsel review · out for signature · executed · superseded), and where the executed
  original lives.
- **The executed-original chain** — signed instrument + the consent or authority that
  permitted it + the downstream record it must tie out to (cap table, roster, vendor file).
- **The clause library and the fallback ladder** — the reusable, reviewed text that makes
  a second MSA cheaper than the first, and the pre-decided negotiating positions behind it.
- **The counsel gate** — which instruments may never be executed without outside-counsel
  review, and the evidence that the review happened.
- **The request path** — how another unit asks for paper and what it gets back.
- **Retention and versioning** — which version of which instrument governs which
  counterparty, today.

Structured as **two teams split on reversibility, not counterparty**
(`corporate.md:59-63`):

| Team | What it owns | Failure mode it is optimised against |
|---|---|---|
| [[instruments-equity-charter]] | The six one-way doors: founder agreement, SAFE, board consent, stock purchase agreement, advisor agreement, IP assignment | **Permanence** — a term that cannot be renegotiated |
| [[commercial-workforce-agreements-charter]] | The nine repeatable instruments: NDA, MSA, SOW, professional services agreement, LOI, employment, contractor, DPA, BAA | **Slowness and drift** — a queue that blocks deals, a library that fragments |

The split exists so that high-volume paper does not set the tempo for the un-undoable
paper. One queue means the SAFE gets the turnaround norms of the tenth NDA — which is the
ordinary way a founder ends up with a term nobody modelled (`corporate.md:61-63`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Deciding the terms** of any instrument | The **founder** | No team decides its own terms (`corporate.md:505-506`). Legal prepares the choice; it does not make it |
| **Giving legal advice** | Outside counsel | This function commissions, prepares and tracks. It does not opine, and its output is not advice |
| **Regulatory posture** — GDPR/CCPA, obligation coverage, whether the code honours what a DPA promises | [[regulatory-posture-charter]], [[privacy-engineering-charter]] | Legal owns the **instrument**; Compliance owns the **obligations inside it** (`corporate.md:99-103`) |
| **Whether and when to raise** | [[positioning-fundraise-readiness-charter]] | Strategy sequences and requests; Legal drafts (`corporate.md:421-422`) |
| **The privacy notice** at `apps/web/src/pages/Privacy.tsx` | Compliance §3.2 | A notice is a public statement, not an agreement. It is also currently stale — it says "WineOps" (`apps/web/src/pages/Privacy.tsx:23`) |
| **Vendor commercial terms as parsed data** — currency, MOQ, `payment_terms: "Net 30"` | Engineering / procurement — `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` | Reading "Net 30" out of a supplier email is procurement. Making "Net 30" *contractual* is Legal. Today only the first exists |
| **Human performance management, payroll, reviews** | People & Agent Ops (Human Ops deferred; trigger: second human on payroll, `corporate.md:396-399`) | Legal owns the employment *agreement*; not the employment *relationship* |
| **Alcohol / excise licensing** | [[regulated-operations-charter]] ⏸ trigger-gated | Licensing is a permission to operate, not an instrument between two parties |

## Metrics it moves

| Metric | Owner | Baseline today |
|---|---|---|
| `legal.instrument_chain_integrity` — % of executed instruments holding a complete chain | [[instruments-equity-charter]] | **0 of 0.** Only 100% is a passing value |
| `legal.request_to_executable_draft_days` — median request → executable draft | [[commercial-workforce-agreements-charter]] | **Unmeasurable — no library, no requests** |
| `legal.clause_library_hit_rate` — % of a draft assembled from reviewed clauses | [[commercial-workforce-agreements-charter]] | **0% — the library does not exist** |
| `legal.counsel_gate_compliance` — % of one-way-door instruments reviewed by counsel *before* signature | Department | **0 of 0.** Target 100%, permanently |
| `legal.annex_satisfiability_signoff` — % of executed DPAs/BAAs carrying a Compliance signature that the code can satisfy the Annex | Department + [[regulatory-posture-charter]] | **0 of 0** — the two-signature rule (`corporate.md:99-103`) |

**Neural-footprint tie — and it is the sharpest one in the company.** If any agent ever
drafts an instrument, Legal is where `nf_a.doneability_verdict` must be strictest:
"the agent produced a document" and "the document is safe to sign" are different claims,
and here the gap between them is measured in equity and liability rather than in a retry.
Legal is therefore the natural first hard case for the doneability spine
[[performance-doneability-charter]] is building — a domain where *plausible output* is the
failure, not the success.

## Evidence today

**NEW — and this needs saying without cushioning: zero artifacts exist.**

`.planning/foundation/teams/corporate.md:29` grades Legal `EXISTS —`, `PARTIAL —`,
`NEW: all 15 document types`. That is the whole evidence base. Verified independently for
this charter:

- **No legal document of any kind is tracked in the repo.** A repo-wide filename sweep for
  `safe|nda|msa|contract|agreement|cap.table|board.consent|term.sheet|dpa|baa` returns
  only incidental matches — `.github/dependabot.yml`, and planning files whose names
  contain the substring "agenda". There is no contract, no template, no clause library
  (`corporate.md:104-106`), and no cap table, equity instrument or board record anywhere
  (`corporate.md:75-79`).
- **The only fixed legal fact on the record** is [ADR 0001](../../../decisions/0001-mudavym-single-entity.md):38
  — *"One brand, one legal surface, one doc graph."* That fixes that there is exactly one
  entity to issue against, and therefore exactly one cap table
  [[instruments-equity-charter]] owns.
- **The nearest counterparty-facing surface is not an agreement.**
  `apps/web/src/pages/Privacy.tsx` is a privacy *notice*, owned by Compliance §3.2, and it
  still names the retired brand at line 23.
- **The nearest commercial surface is parsed data, not paper.**
  `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` already extracts a
  supplier's currency, case/unit price, MOQ, discount tiers, `payment_terms` (line 33) and
  per-field provenance quotes (line 38) out of an email. The operating terms of supplier
  relationships are already machine-read; the agreement that would make any of them
  enforceable does not exist. That asymmetry is the clearest single argument for this
  department existing.
- **The one skill this department is supposed to own does not exist as a file.**
  [[README|foundation-README]] §3.2 names `legal-doc-draft` as a T2 department skill (line 145).
  `.claude/skills/` is not present in the repo at all. The skill is a name, not an asset.

### The trim flag, repeated rather than buried

`corporate.md:116-121` names Legal **the trim candidate**: the weakest evidence base of
the five Corporate departments, literally zero artifacts, and if the founder cuts one
split from that document this is the one to cut. This charter keeps the two-team split,
and the reason must be labelled honestly: **the argument is structural, not evidential.**
It is that a boundary drawn before the first instrument costs one extra charter, whereas
a boundary drawn after the first SAFE costs a renegotiation that cannot happen. There is
no evidence in this repo that the split is working, because there is nothing for it to
work on. [[legal-premortem]] M1 treats "the trim was right and we didn't notice" as the
department's most likely failure, and [[legal-loops]] L-LEG-5 gives it a named merge
trigger rather than leaving the reversal to a future argument.

### A third team was considered and rejected

**Workforce Paper** — employment, contractor, hire-attached NDA and IP assignment as its
own team — is a team invented for symmetry: two of fifteen documents, zero employees, zero
firing cadence. Folded into [[commercial-workforce-agreements-charter]].
**Split trigger: first W-2 hire, or first contractor in a second jurisdiction**
(`corporate.md:123-126`).

## Open forks touching this department

- **CORP-F2** — DPA/BAA ownership: Legal owns the instrument, Compliance owns the
  obligations (proposed `corporate.md:495`). Confirm the two-signature rule, or give one
  team both.
- **CORP-F1 / OD-17** — does a *team* get the full 7-artifact anatomy, or only a department?
  This vault answers "7" — 21 documents for a department with zero artifacts is exactly
  the cost that fork is about (`corporate.md:494`).
- **The trim itself** — one team or two (`corporate.md:116-121`). Not yet staged as an OD;
  [[legal-agenda-full]] asks it directly.
