# Producer Reputation — Design Plan

Status: **PLAN ONLY, NOT BUILT**. Schema work is owned by another session; this document
specifies what should be stored and why, not how to migrate it.

Author context: written after repairing the menu-corpus enrichment, where `producer_tier`
was found to be 53% self-contradictory (premium wines labelled "emerging") and was reset to
`unknown` for 1,097 wines rather than guessed.

---

## 1. The question this answers

"What does it mean for us to say a producer is *legendary*?" — i.e. what observable,
checkable quantity are we actually claiming?

The honest answer is that prestige is a **latent construct**: nobody can measure it directly.
What we can measure are its *indicators* — auction prices, critic scores, production volume,
years in business, distribution footprint. Any tier label is a lossy projection of those.

So the design principle is: **measure the indicators, store them raw, derive the label.**
Never store only the label — that throws away the evidence and makes the classification
unauditable and unusable as training data.

---

## 2. Why a single 0–1000 score is the wrong primitive

A scalar cannot separate cases the business must treat differently:

| Producer archetype | Prestige | Scarcity | Maturity | Reach | Collapses to |
|---|---|---|---|---|---|
| Domaine de la Romanée-Conti | very high | very high | very high | low | "legendary" |
| Screaming Eagle / cult Napa | high | extreme | **low** | low | "legendary"? |
| Yellow Tail / large commercial | low | none | medium | **extreme** | "established"? |
| New natural-wine darling | medium | high | **low** | low | "emerging"? |

Under a summed score, DRC and a 12-year-old cult Napa project land in the same bucket while
being *opposite* procurement problems (one is a stable blue chip, one is an allocation
scramble). And the commercial giant scores mid-range for reasons that have nothing to do
with quality.

This is also exactly why "cult" refused to fit the linear scale in the earlier proposal —
it is not a high point on the prestige axis, it is a high point on a **different axis**.

**Decision: model a vector, derive the label from regions in that space.**

---

## 3. Proposed value set

Five measured axes plus one meta-axis. Each is independently useful — meaning if we only
ever ship one, it still pays for itself.

### 3.1 The axes

| # | Axis | Latent question | Primary observable indicators | Business use |
|---|---|---|---|---|
| 1 | **PRESTIGE** | Do experts rate it highly? | critic scores (WS/Parker/Decanter/Suckling), competition medals, classification status | pricing, menu balance, talk track |
| 2 | **SCARCITY** | Can we actually get it? | annual case production, allocation/waitlist status, secondary-vs-release price ratio | **purchase urgency, allocation risk** |
| 3 | **MATURITY** | Is this an institution or a startup? | founding year, continuous production years, generational ownership | trust signal, staff narrative |
| 4 | **REACH** | How substitutable/sourceable is it? | markets/countries distributed, importer count, retail availability | **substitution, price benchmarking** |
| 5 | **PRICE POSITION** | Where does it sit in the market? | our own `price_reference` percentile within (region × varietal × type) | all pricing use cases |
| 6 | **CONFIDENCE** | How much do we trust 1–5? | evidence count, source quality, retrieval recency | gating — see §6 |

**Axis 5 is free.** We already hold list prices for 3,222 wines. It needs zero web research
and can ship immediately, independent of everything else. It is the single highest
value-per-effort item in this plan.

**Axis 2 (SCARCITY) is the most under-served by the current schema and arguably the most
operationally valuable** — it is the only axis that answers "buy it now or lose it," which
is a procurement decision this product exists to make. Prestige is table stakes; scarcity is
differentiated.

### 3.2 Why these five and not others

Rejected candidates and why:

- **Sustainability/organic certification** — real and checkable, but already partly captured
  in the existing `farming` field; belongs to the wine, not the producer's reputation.
- **Social/press buzz volume** — cheap to gather, but noise-dominated and reflects marketing
  spend more than quality. Correlates with REACH without adding signal.
- **Vineyard holdings / hectares** — checkable but only weakly predictive of anything we act on.
- **Composite "quality score"** — this is what we are trying to *avoid*; it is a derived
  value, not an observation.

---

## 4. Raw evidence vs. derived score — the core engineering rule

> Web research is expensive and slow. Normalization schemes are cheap and will change.
> **Never let a rubric change force us to re-research.**

Therefore two distinct layers, stored separately:

**Layer 1 — Observations (expensive, immutable, append-only)**
Record what was actually found, in its native units, with provenance:
```
{ "axis": "scarcity",
  "observation": "annual_production_cases",
  "value": 4200,
  "unit": "cases",
  "source_url": "https://…",
  "retrieved_at": "2026-08-17",
  "extraction_confidence": 0.9 }
```

**Layer 2 — Scores (cheap, derived, recomputable)**
Normalized 0–1000 per axis, plus the derived tier label. Fully reproducible from Layer 1 by
a pure function. If the rubric changes, re-run the function — do not re-run the research.

This is also what makes the dataset valuable as **ML training ground** (the stated goal):
a model trains far better on `production_cases=4200, founded=1998, WS=94` than on the string
`"cult"`. The label is the weakest column in the table; the observations are the asset.

**Corollary: NULL ≠ 0.** A producer with no findable critic score has NULL prestige evidence,
not a prestige score of zero. Sparse-by-design. Conflating these is the single most likely
way to poison downstream training.

---

## 5. Deriving the tier label

Tier stays in the schema for backward compatibility, but becomes an *output*, not an input.
Regions in the vector space rather than thresholds on a sum:

```
legendary   PRESTIGE ≥ 850  AND  MATURITY ≥ 700
cult        SCARCITY ≥ 850  AND  PRESTIGE ≥ 600   (maturity NOT required)
renowned    PRESTIGE ≥ 600
established MATURITY ≥ 400  OR   REACH ≥ 500
emerging    everything else with sufficient confidence
unknown     CONFIDENCE below gate  (see §6)
```

Ordering matters — evaluate top-down, first match wins. `cult` deliberately sits above
`renowned` and ignores maturity, which is the fix for the archetype collapse in §2.

---

## 6. Confidence gating and the missingness problem

"No evidence found" is ambiguous and must not be silently read as "low reputation":

| Situation | Correct outcome |
|---|---|
| Searched, found evidence of small local operation | `emerging`, confidence high |
| Searched, found nothing at all | `unknown`, confidence low — **not** `emerging` |
| Producer name is ambiguous / collides with other entities | `unknown`, flag for human review |
| Producer string is not actually a producer (see §7) | excluded from research entirely |

**Gate: do not assign any tier when fewer than 2 axes have evidence.** Leave `unknown`.
This is the same principle applied during the enrichment repair — an honest `unknown` beats
a confident fabrication, and it is recoverable later; a wrong label is not, because nothing
downstream marks it as suspect.

---

## 7. Hard prerequisites (blocking — must land before any research runs)

Analysis of the live table surfaced two data problems that would corrupt the research if
not fixed first.

### 7.1 Producers are not first-class entities

`producer` is a free-text string on each wine row. Consequences measured in the live data:

- **2,034 distinct producer strings** across 3,222 menu-corpus wines
- **68 of them are duplicate spellings** of a producer already present, covering
  **232 wines / $76,638 of list value (11% of total)**

Worst offenders — each of these would be researched twice and could receive *contradictory*
tiers:

| Split identity | Value at stake |
|---|---|
| `Armand Rousseau` / `Domaine Armand Rousseau` | $14,874 |
| `Dujac` / `Domaine Dujac` | $6,555 |
| `Ulysse Collin` / `Ulysse-Collin` | $5,320 |
| `Roumier` / `Domaine Roumier` | $3,775 |
| `Faiveley` / `Domaine Faiveley` | $2,599 |

**Required:** a `producers` table with canonical identity, and wines referencing it by FK.
Research once per entity, join to all their wines. This also cuts research cost and
guarantees consistency by construction rather than by discipline.

### 7.2 188 "producers" are loader artifacts, not producers

`load_enriched_wines.py:294` writes `producer = x.get("producer") or x.get("name")` — when a
menu omits the producer, the **wine name is copied into the producer column**. Result:
**220 wines / 188 distinct strings where `name == producer`**.

These split into two kinds needing different handling:

- **Real producers** that happen to be listed mononymously — `Ch. Pétrus` ($15,645),
  `Harlan Estate`, `Dominus Estate`, `Chateau Margaux`. Researchable as-is.
- **Appellations mistaken for producers** — `Hermitage` ($1,600), `Côte-Rôtie` ($1,800),
  `Côte Brune`, `Hermitage Blanc` ($2,400). **Not researchable as producers at all**;
  researching "Hermitage" as a producer returns appellation data and would fabricate a
  reputation for a place rather than a company.

**Required:** triage these 188 before research. Estimated ~1 hour of manual review, and it
protects the highest-value single row in the corpus ($15,645 Pétrus).

---

## 8. Research cost and staging

Full-depth research on all 1,966 canonical producers is not economically sensible. The value
distribution is steeply concentrated — measured from live data:

| Producer coverage | Share of list value | Share of wines |
|---|---|---|
| Top 5% (101 producers) | **44.0%** | 14.7% |
| Top 10% (203) | 55.5% | 24.0% |
| Top 20% (406) | 69.3% | 37.5% |
| Top 50% (1,017) | 88.4% | 66.6% |

Also: **71% of producers appear on exactly one wine.** The long tail is single-bottle, mostly
low-value, and mostly the hardest to research (small, obscure, little web presence) — the
worst possible effort-to-value ratio.

**Staged plan:**

| Stage | Scope | Depth | Est. searches | Value unlocked |
|---|---|---|---|---|
| 0 | Prerequisites §7 + Axis 5 (price position) | no web research | 0 | pricing use cases, immediately |
| 1 | Top 101 producers | all 5 axes | ~500 | 44% of list value |
| 2 | Next ~300 | 3 axes (prestige, maturity, reach) | ~600 | → ~62% |
| 3 | Remainder | 1 confirming search, or leave `unknown` | ~1,500 | → ~100%, low marginal value |

Recommend committing to **Stage 0 + 1**, then re-evaluating with measured hit-rate data
before funding Stage 2. Stage 3 likely never pays for itself and should default to honest
`unknown`.

---

## 9. Validation — we have a free held-out signal

`price_reference` exists on 3,222 wines and was **not** used to build axes 1–4. That makes it
a genuine held-out validation target:

- **Expected:** Spearman rank correlation between PRESTIGE and within-region price percentile
  should be strongly positive. If it is not, the research is wrong.
- **Expected:** SCARCITY should predict price *residual* — the part of price the region and
  varietal do not explain.
- **Seed/labelled set:** 445 wines the enrichment marked `knowledge="known"` already carry
  model-assigned tiers. Useful as a weak-label sanity check, **not** ground truth.

**Leakage warning:** Axis 5 (price position) is derived *from* price. It must be excluded
from any validation that uses price as the target, or the check is circular and meaningless.

---

## 10. Open decisions for you

1. **Scope of Stage 1** — 101 producers (44% of value) as proposed, or a different cut?
2. **Stage 3 default** — leave the ~1,500 long-tail producers as honest `unknown`
   indefinitely, or is a low-confidence heuristic guess preferable for UI completeness?
   (My recommendation: `unknown`. A visibly empty field prompts a human to fill it;
   a wrong-but-confident field never gets corrected.)
3. **§7.2 triage** — I can do the 188-string real-producer-vs-appellation split, or it can
   go to whoever owns the schema session, since it touches the same rows.
4. **Does the other session's schema work already cover the `producers` table in §7.1?**
   If so this plan should conform to theirs rather than propose a parallel structure.

---

## Appendix — provenance of every number in this document

All figures were measured against the live `master_wine_library`, scoped to
`source='menu_corpus' AND primary_type != 'unknown'` (3,222 wines), on 2026-08-17.
No figure here is estimated or assumed. The Pareto table, the 68 split identities, and the
220 loader-artifact rows are reproducible by re-running the queries in this session's history.
