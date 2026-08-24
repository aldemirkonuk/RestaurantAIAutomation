---
type: charter
division: corporate
department: knowledge-documentation
team: standards-verification
status: partial
metrics: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.stale_brand_doc_count, standards.docs_past_60_day_rule, standards.contract_self_compliance_pct]
updated: 2026-08-24
links: ["[[standards-verification-premortem]]", "[[standards-verification-agenda-full]]", "[[standards-verification-agenda-board]]", "[[standards-verification-directive]]", "[[standards-verification-loops]]", "[[standards-verification-schedule]]", "[[knowledge-documentation-charter]]", "[[corpus-archive-charter]]", "[[graph-retrieval-charter]]", "[[decision-office-charter]]", "[[ORG_STRUCTURE]]"]
---

# Standards & Verification — Charter

Parent: [[knowledge-documentation-charter]] (Corporate). Siblings:
[[corpus-archive-charter]], [[graph-retrieval-charter]].

## Mandate

Standards & Verification is accountable for **whether a document is still true**. It owns
the documentation quality bar, the [[ORG_STRUCTURE]] §4 anti-sprawl rule (*"an agenda that
has not changed in 60 days is either finished or fiction"*), brand-drift detection, and the
regeneration discipline for the companion documents [[foundation-README]] declares
*"regenerated rather than hand-edited"* — `ENDPOINTS.md`, `PAGE_MAP.md`,
`EXTERNAL_CONNECTIONS.md`.

**This team is not a style guide.** The bar it enforces already exists as a rule and lacks
only a mechanism: [`CLAUDE.md`](../../../../../CLAUDE.md):147 — *"Claims about behavior need
evidence… 'Should work' is not a report."* That rule is written, agreed, and checked by
nothing. This team is that mechanism, and if it ships prose instead it has failed
([[standards-verification-premortem]] M1).

## Why distinct from its siblings

`md/DOCUMENTATION_INDEX.md` is **correctly placed** (top of the tree it indexes) and
**perfectly findable**. It is also 7 months old and wrong in every row — it claims
`04-updates-builds` holds 6 files; it holds **48**. Neither sibling's metric can see that.
Conversely, this team has no opinion about whether a document is duplicated or unlinked.

The three failures are orthogonal, and the corpus demonstrates all three simultaneously.

## Boundaries

Owns outright:

- **Claim verification** — sampling spine-document claims and re-checking them against
  source.
- **Claim pinning** — whether a repeated number has an assertable source. This is the
  team's most distinctive deliverable and it is explained below.
- **The 60-day rule** — measurement and enforcement, across every unit in the org.
- **Brand drift in documents** — "wineops" in prose.
- **Companion-doc regeneration** — the three generated documents, and the check that they
  were regenerated rather than edited.
- **OD-14** — root `SKILLS.md`: retire or rewrite.
- **Freshness of OD-22 library entries** — a resource index of dead links is worse than
  none, because it is trusted.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Deciding what the true value is | The owning department | We prove two documents disagree and that the source is unassertable. We do not decide the insight count — that would make us an authority on analytics |
| Fixing the code so a document becomes true | The owning department | We change the document, or raise the discrepancy. We never patch someone's source to match our prose |
| Whether a decision is open or closed | [[decision-office-charter]] | We report the [[OBSIDIAN_VAULT]] OD-21 contradiction; we do not resolve it |
| Brand in code and product surfaces (`wineops.ai` × 10 in source) | [[media-brand-charter]] *(Commercial)* | Documents are ours; surfaces are theirs |
| Prose style, tone, formatting | Nobody, deliberately | A style guide is the thing this team must not become |
| Correcting external-facing numbers unilaterally | [[positioning-fundraise-readiness-charter]] | 573 sits in the YC narrative; changing it is a Strategy decision with a documentation input |

## Metrics it moves

- **`standards.stale_claim_rate`** — % of sampled spine-doc claims failing re-verification
  against source. **Unmeasured.** Per `corporate.md:221-222`, *a rate that cannot be
  measured is the first deliverable, not an excuse.*
- **`standards.unpinned_claim_count`** — repeated numeric claims with no assertable source.
  **≥ 1 known**, and it is a bad one (below).
- **`standards.docs_past_60_day_rule`** — live documents past the [[ORG_STRUCTURE]] §4
  threshold. First fires **2026-10-23** against 21 provisional agendas in this department
  alone.
- **`standards.stale_brand_doc_count`** — **216** `.md` under `.planning/` and **75** under
  `md/` contain "wineops" (case-insensitive, tree-wide). The founding figure of 28 was
  **spine-scoped**; both numbers are reported with their scope attached, because reporting
  one without its denominator is precisely the defect this team exists to catch.
- **`standards.contract_self_compliance_pct`** — % of foundation documents satisfying the
  rules they impose. **0 of 2** measurable cases.

## Evidence today

**PARTIAL — the rules exist; no mechanism enforces any of them.**

### The founding example: the standard-setter violating its own standard

[[ORG_STRUCTURE]] §5 mandates that *"every unit doc carries `type`, `division`, and
`links`"*. `ORG_STRUCTURE.md` carries **no frontmatter at all**. `OBSIDIAN_VAULT.md`, which
*defines the frontmatter schema* at §3, carries none either. Two standard-setting documents,
zero compliance. It is this team's founding case because it shows the failure is not
laziness at the edges — it is that a rule with no mechanism is not a rule, even for its own
author.

### The corpus contradiction, and the reason it is not a typo

The corpus disagrees with itself about its own size. Not two ways — **three**:

| Figure | Where |
|---|---|
| **375** insight types | `LLM_INSTRUCTION_PROMPTS.md:19,51,56,166` |
| **573** insight types | `YC_WEDGE_PLAN.md:280,324`; `AGENT_NATIVE_UI_DECISION.md:64,100,105` |
| **348** ("never invent a 348th type") | `LLM_INSTRUCTION_PROMPTS.md:167` — *one line after* the same file says 375 |

**The mechanism matters more than the discrepancy.** `apps/api-gateway/src/analytics/insights/insight-catalog.ts`
contains **no literal count**. `INSIGHT_CANDIDATES` is built at import time by
`buildCandidates()` (line 547) as a cross-product of `DIMENSIONS` (:67) × `MEASURES` (:114)
× `COMPARATORS` (:242), pruned by `DIMENSION_MEASURES` (:279) and `DIMENSION_COMPARATORS`
(:388). The only assertion over it is:

```
expect(INSIGHT_CANDIDATES.length).toBeGreaterThanOrEqual(200);   // insight-catalog.spec.ts:10
```

**375, 573, and 348 all pass that test.** The number in every document is therefore
*unpinned by construction*: any edit to those three arrays silently changes it and no CI
job would notice. So the fix is not "pick 375 or 573" — it is **make the count assertable,
then regenerate the documents from it.** That distinction is this team's whole method, and
this is its worked example.

It also matters commercially: **573 sits in the YC narrative** (`YC_WEDGE_PLAN.md:324`,
inside the surface-area risk paragraph), so the correction routes through
[[positioning-fundraise-readiness-charter]].

### The stale index

`md/DOCUMENTATION_INDEX.md`, last modified **2026-01-29**, titled *"WineOps AI - Complete
Documentation Index"*. Its category counts are wrong in every row it lists —
`04-updates-builds` claims 6 against an actual **48** — and it omits three directories
entirely. Not misplaced, not unlinked. **Wrong.**

### The rule with no mechanism

[`CLAUDE.md`](../../../../../CLAUDE.md):147 — *"Claims about behavior need evidence… 'Should
work' is not a report."* Nothing checks it.

### Root `SKILLS.md` — OD-14

5,322 bytes, last modified **2026-02-15**, second line: *"Guidelines for AI assistants
working on the WineOps AI project."* A prose reasoning protocol named like a skill
registry. Agents and contributors will mistake it for one, which is the actual harm.

### The team's own conflict of interest, stated

This team audits documents produced by the department it belongs to, including its own
seven artifacts. `corporate.md:512-515` raises whether it should instead sit under
[[decision-office-charter]] as an advisory function — the same independence argument
[[ORG_STRUCTURE]] §3 makes for the advisory layer. That is staged as **OD-C6** in
[[knowledge-documentation-agenda-full]] and this charter does not pretend to settle it.
