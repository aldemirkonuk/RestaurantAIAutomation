---
type: charter
division: commercial
department: growth
team: editorial-gate
status: new
metrics: [editorial.claims_traceable_pct, editorial.gate_bypass_count, editorial.rejection_rate, editorial.overstated_claim_catches]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[editorial-gate-premortem]]", "[[editorial-gate-agenda-full]]", "[[editorial-gate-agenda-board]]", "[[editorial-gate-directive]]", "[[editorial-gate-loops]]", "[[editorial-gate-schedule]]", "[[content-production-charter]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[conversion-funnel-charter]]", "[[YC_WEDGE_PLAN]]", "[[commercial]]", "[[ORG_STRUCTURE]]"]
---

# Editorial Gate — Charter

Team **G3** of [[growth-charter]]. Division: Commercial.

## Mandate

G3 is **the mandatory human pass. Nothing publishes without it, every time, with no
sampling, no expedited lane, and no exemption by content category.** The founder specified
it as mandatory and this charter treats that as a constraint rather than a default.

Three checks, in this order, because they fail differently:

1. **Fact-check against hallucination.** Every factual claim traced to a named source in a
   provenance record. A claim that cannot be traced does not get softened, it gets removed.
   **And separately: no claim may be stronger than its source supports** — this is the check
   that matters most here and it has a live, named instance below.
2. **Banned constructions.** No em dashes. No buzzwords, with "streamlined" named by the
   founder as the example of the class. It must not read as a press release.
3. **Brand voice**, conforming to the guide [[brand-identity-charter]] owns. G3 enforces
   that document; it does not author it. A gate enforcing its own taste is a reviewer.

**Scope note, stated once so it is never argued.** The banned-construction list governs
**published, outward-facing content**. It does not govern internal planning documents, this
vault, code comments, or commit messages — all of which use em dashes freely and should
continue to. Applying an editorial rule for strangers to a document written for ourselves is
a category error that will otherwise be attempted at some point.

## The claim this gate exists for

There is one specific falsehood the company is under continuous pressure to publish, and
naming it in the charter is the whole reason G3 is a team rather than a checklist item.

> **"Dollars recovered" currently means *we asked*, not *we received*.**
> [[YC_WEDGE_PLAN]]:31-33 states it directly: until an 812 credit memo lands on a later
> invoice, a recovery figure describes a request. Verified recovery requires watching the
> credit arrive, which requires modelling the document it arrives on.

That distinction is not marketing gloss. Publishing the stronger claim would be **false**,
in a number, on a public page, about money — the single most checkable class of statement a
company can make. It is also the claim every other unit wants: it is the metric on the YC
slide ([[YC_WEDGE_PLAN]]:315), the headline [[narrative-collateral-charter]] is built
around, and the social proof [[conversion-funnel-charter]] needs.

**G3's rule:** *dollars recovered* may be published only where an 812 credit memo has been
observed against a later invoice, sourced through [[design-partner-operations-charter]],
whose own primary metric is verified recovery for this reason. Everywhere else the honest
formulation is *dollars identified* or *credit requested*, and the honest formulation is
still a strong claim. **`editorial.overstated_claim_catches` counts every time this rule
fires**, because a gate that never catches this is not being tested.

## Boundaries

Owns outright:

- **The publish/return/reject verdict** on every unit, long-form and answer page alike.
- **The provenance record format** — what a source looks like, what counts as one, and
  where it lives relative to the draft.
- **The banned-construction list**, maintained as a document with reasons rather than a
  vibe. "Streamlined" is entry one.
- **The claim-strength rule** above, and its quarterly re-audit
  ([[editorial-gate-loops]] L-G3-3).
- **The bypass count.** `editorial.gate_bypass_count` is G3's number and it is reported to
  the department, not held inside the team.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Writing or rewriting | [[content-production-charter]] · G2 | **The gate returns, it does not rewrite.** A gate that rewrites has become a co-author and can no longer judge |
| The voice guide itself | [[brand-identity-charter]] · M1 | M1 defines; G3 enforces. This is what gives G3 something external to point at |
| Topic choice and the ten questions | [[search-demand-research-charter]] · G1 | G3 may reject a unit; it does not commission a replacement |
| Whether a page is indexed or reachable | [[technical-seo-ai-answer-surface-charter]] · G4 | Truth and reach are different gates and run in series |
| Producing the recovery number | [[design-partner-operations-charter]] · S1 | S1 produces the evidence; G3 refuses anything stronger than it |
| Throughput | [[content-production-charter]], [[growth-charter]] | **G3 has no throughput target by design.** A gate with a throughput target is a queue |

## Metrics it moves

**Primary — `editorial.claims_traceable_pct`. Target 100%.** Every published claim traceable
to a cited source. Not 99%: the one untraceable claim is always the interesting one.

**`editorial.rejection_rate` is a health signal, not a goal, and it is read in both
directions.** 0% for two consecutive close-times means the gate is not reading, not that the
drafts are clean. A rate climbing steeply means the brief or the voice guide is wrong, and
the fix is upstream in [[content-production-charter]] or [[brand-identity-charter]], not
harsher editing.

**`editorial.gate_bypass_count` = 0. Absolute.** One bypass invalidates the pipeline rather
than one article, because after the first exception the rule is a preference. It sits on the
department board ([[growth-agenda-board]]) so that suspending the gate is visible one level
above whoever suspended it.

**`editorial.overstated_claim_catches`** — the count of claims returned for being stronger
than their source. Read as evidence the gate is exercised. A quarter with zero catches and
non-zero publications means either the writers have internalised the rule or the gate stopped
looking, and those are distinguishable only by reading the verdicts.

## Evidence today

**NEW as a function**, with a genuine structural precedent that makes it native rather than
imported.

**What does not exist:**

- **The rules exist only as founder instruction.** There is no banned-construction document,
  no provenance format, and no recorded verdict anywhere in the repo.
- **The voice guide G3 is meant to enforce does not exist.**
  [[brand-identity-charter]] owns writing it. Until it does, check 3 is G3's opinion, and an
  opinion loses an argument with a deadline.
- **There is nothing to gate.** No draft, no article, no answer page, no publishing target.

**What exists, and it matters:**

- **Human approval before an outward-facing artifact leaves the building is the shipped
  default in this codebase, not an exception.** Vendor-reply drafts are staged and never
  auto-sent; recommendation actions are one-tap and require a person. The mandatory human
  pass is therefore consistent with how this system already behaves.
- **The repo already articulates the exact discipline G3 enforces**, in code:
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120` explains that a
  listing with no price emits no Offer, because *a zero-price Offer is a valid document and
  a false statement*. A structurally valid document that says something untrue is precisely
  what a well-formed, unsourced article is.
- **The claim-strength obligation is documented and dated**: [[YC_WEDGE_PLAN]]:31-33.
- **`apps/web/src/pages/Privacy.tsx:8-11`** is a working example of the standard G3 holds
  content to — a public page whose own header comment says it was written to match what the
  code actually does, and must change when the code does.

## Why this is a team, and the fork that disputes it

It is the only non-automatable stage in the pipeline and the only one with a veto. A gate
that reports to the team it gates is not a gate — the same argument [[ORG_STRUCTURE]] §3
makes for advisory independence, applied inside a department.

**Fork CM-F1 disputes exactly this**: one founder is currently both the writer and the
editor, so the separation is organizational fiction until there is a second person.
**Recorded, not resolved** ([[growth-charter]]). One observation offered without arguing the
fork: even with one person, the separation buys a **temporal** gap — draft on Monday, judge
on Wednesday, against a written list rather than from memory — and the artifact that
survives a merge is the verdict record, which is what makes a bypass visible in version
control either way.
