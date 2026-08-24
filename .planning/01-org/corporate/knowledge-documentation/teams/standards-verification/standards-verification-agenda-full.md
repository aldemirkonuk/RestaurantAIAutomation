---
type: agenda-full
division: corporate
department: knowledge-documentation
team: standards-verification
status: provisional
metrics: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.docs_past_60_day_rule, standards.stale_brand_doc_count]
updated: 2026-08-24
links: ["[[standards-verification-charter]]", "[[standards-verification-premortem]]", "[[standards-verification-agenda-board]]", "[[standards-verification-loops]]", "[[standards-verification-schedule]]", "[[knowledge-documentation-agenda-full]]", "[[decision-office-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[media-brand-charter]]"]
---

# Standards & Verification — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn [`CLAUDE.md`](../../../../../CLAUDE.md):147 — *"Claims about behavior need evidence…
'Should work' is not a report"* — from a rule into a mechanism.

| Metric | Today | Target |
|---|---|---|
| `standards.stale_claim_rate` | **unmeasured** | measured weekly, then falling |
| `standards.unpinned_claim_count` | **≥ 1 known**, badly | 0 for claims repeated in ≥ 2 spine docs |
| `standards.docs_past_60_day_rule` | 0 (fires **2026-10-23**) | reviewed within 7 days of firing |
| `standards.stale_brand_doc_count` | **216** `.planning/` · **75** `md/` | falling, scoped and reported with denominators |
| `standards.contract_self_compliance_pct` | **0 of 2** | 2 of 2 |

## How

**Mechanism before guidance. This is the whole method and it is the direct counter to
[[standards-verification-premortem]] M1.** The team is forbidden by
[[standards-verification-directive]] from publishing a standard it cannot check, which
means the first artifact is a script, not a page.

**The worked example is claim-pinning, and it should be done first because it is the
hardest case.** The insight-type contradiction looks like an editing error and is not:

- Three figures in the corpus — **375** (`LLM_INSTRUCTION_PROMPTS.md:19,51,56,166`),
  **573** (`YC_WEDGE_PLAN.md:280,324`; `AGENT_NATIVE_UI_DECISION.md:64,100,105`), and
  **348** (`LLM_INSTRUCTION_PROMPTS.md:167` — one line after the same file says 375).
- The source has no literal count. `INSIGHT_CANDIDATES` is built at import time by
  `buildCandidates()` (`insight-catalog.ts:547`) from `DIMENSIONS` × `MEASURES` ×
  `COMPARATORS`, pruned by two allow-maps.
- The only assertion is `toBeGreaterThanOrEqual(200)` (`insight-catalog.spec.ts:10`).
  **All three figures pass it.**

So the fix is a three-step pattern that generalises to every repeated number in the corpus:
**(1) make the source assertable** — an exact-count test that fails when the arrays change;
**(2) read the true number from it**; **(3) regenerate the documents that quote it.** The
team does **not** choose between 375 and 573 — see
[[standards-verification-premortem]] M2.

**Sampling needs an escalation clock or it is a ritual.** Findings land against units this
team does not control. [[knowledge-documentation-loops]] L-KD-4 escalates any
unacknowledged correction at 30 days regardless of severity, because
[[standards-verification-premortem]] M3's failure is silence, not disagreement.

**Scope every brand number.** 216 and 75 are tree-wide; the founding figure of 28 was
spine-scoped. All three are true. Reporting one without its scope is the defect this team
audits, so the board carries the scope inline.

## Why now

- **693 unit documents are being written this week**, each making claims. A verification
  mechanism that arrives after them starts with a 693-document backlog.
- **The 60-day clock has already started.** 2026-10-23 fires against 21 provisional
  agendas in this department alone.
- **573 is in the YC narrative.** `YC_WEDGE_PLAN.md:324` uses it inside the surface-area
  risk paragraph — an unpinned number doing load-bearing work in an external document.
- **The founding example is live.** [[ORG_STRUCTURE]] §5 mandates frontmatter; the file
  carries none. Every session that reads it learns the rule is optional.

## Next steps

| # | Step | Blocked on | Observable when done |
|---|---|---|---|
| 1 | **Pin the insight count** — exact-count assertion in `insight-catalog.spec.ts`; report the true number to the owning unit | Owning unit for the test; [[positioning-fundraise-readiness-charter]] for the external doc | A code change to the three arrays fails CI |
| 2 | `scripts/claim_sample.py` — sample N spine-doc claims, re-check against `path:line`, emit a rate | — | `standards.stale_claim_rate` has a first value |
| 3 | Unpinned-claim inventory — every number appearing in ≥ 2 spine docs, with its source's assertability | — | `standards.unpinned_claim_count` has a real value |
| 4 | 60-day sweep, org-wide, **no exclusions** | [[graph-retrieval-charter]] ships Dataview *or* the script fallback | List per unit; this department's own docs appear first |
| 5 | Companion-doc regenerate-and-compare in CI — `ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md` | — | A hand edit to any of the three fails |
| 6 | Brand-drift report, scoped: spine vs `.planning/` tree vs `md/` | — | Three numbers with denominators; handoff to [[media-brand-charter]] for surfaces |
| 7 | **OD-14** — retire or rewrite root `SKILLS.md` | Founder | File retired, or rewritten and re-branded |
| 8 | Report the OD-21 register contradiction to [[decision-office-charter]] | — | Entry raised; not resolved by us |
| 9 | Frontmatter on `ORG_STRUCTURE.md` and `OBSIDIAN_VAULT.md` — jointly with [[graph-retrieval-charter]] | — | `standards.contract_self_compliance_pct` 0/2 → 2/2 |
| 10 | OD-22 library freshness rule — `verified` date required; 180-day staleness | [[corpus-archive-charter]] places the library | Library entries appear in the staleness sweep |

Steps 2, 3, 5, 6, 8, 9 are unblocked today. Step 1 is the flagship and needs a partner unit.

## Questions for the founder

1. **OD-14 — retire or rewrite root `SKILLS.md`?** It is a prose reasoning protocol named
   like a registry, last touched 2026-02-15, still saying *"the WineOps AI project"*. The
   team recommends **retire**: [[README|foundation-README]] §3.1 already establishes that skills
   are `SKILL.md` files in a skills directory, so a root file with this name will keep being
   mistaken for the registry no matter how well it is rewritten.
2. **Who owns `insight-catalog.ts`'s count?** We can prove it is unpinned and propose the
   assertion. Someone else has to accept the test and state the number. Analytics & BI, or
   Engineering?
3. **Does correcting 573 in `YC_WEDGE_PLAN.md` go through Strategy?** We think yes — it is
   external-facing narrative, so the correction is theirs to make with our evidence.
4. **Is this team's exemption from the 60-day rule ever acceptable?** We propose: never
   without a written founder decision ([[standards-verification-premortem]] M4).
5. **OD-C6** — should this team sit under [[decision-office-charter]] as an advisory
   function instead of inside the department it audits? We cannot answer this about
   ourselves; both arguments are in [[knowledge-documentation-charter]].
