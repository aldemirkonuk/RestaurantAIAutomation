# Producer Reputation — Design Plan

Status: **PLAN ONLY for the reputation model.** The two blocking data prerequisites in §7
are **DONE** (applied 2026-08-17, see §7). Schema work is owned by the
`BEVERAGE_CATALOGUE_PLAN` session; this document specifies what should be stored and why,
not how to migrate it.

**Companion documents.** `.planning/BEVERAGE_CATALOGUE_PLAN.md` and
`BEVERAGE_CATALOGUE_ARCHITECTURE.md` own identity, the catalogue split, and the merge
policy. This plan is downstream of them and conforms to their decisions — see §0.

Author context: written after repairing the menu-corpus enrichment, where `producer_tier`
was found to be 53% self-contradictory (premium wines labelled "emerging") and was reset to
`unknown` for 1,097 wines rather than guessed.

---

## 0. Conformance to BEVERAGE_CATALOGUE_PLAN

Read that plan first. Every point below is a constraint this one inherits, not a choice.

| Their rule | What it forces here |
|---|---|
| **A1** — identity by deterministic key + a *small, closed, versioned* equivalence list; never a similarity score | The producer alias list in §7.1 is explicit and versioned (`producer-canon-v1`). No fuzzy matching decides a merge. A gap costs a visible duplicate, never a silent merge. |
| **A3** — 357 rows with `normalized_producer = normalized_name` are quarantined, ineligible as merge or match targets | Those rows are **excluded from producer research entirely**. §7.2 adds 30 more explicit quarantines. |
| **A5** — merge must supersede + alias, never overwrite without trace | Every repair in §7 wrote a `wine_repair_log` row with the prior value. All 230 changes are reversible. |
| **§4** — researched facts recorded only from tier-A sources, with citation; *"No model guessing"* | Producer research **must reuse `SOURCE_TIER_DOMAINS` and the existing research-agent tiering**, not invent a parallel one. Reputation axes are new entries in the researched-field list, same as `grape_blend_pct`. |
| **C10 / N4** — a flattened ML export must never drop `field_confidences` / `knowledge` | This is exactly the §4 raw-vs-derived split. Provenance travels beside every axis. |
| **C11 / N3** — `observed_at` stamped at write; cannot be retrofitted | Every observation in §4 carries `retrieved_at`. Non-negotiable, and cheap only if done from the first write. |
| **C12** — `price_reference` is a *market hint*, never a restaurant's price | Constrains Axis 5 (§3.1) and the validation in §9: it may inform market position, and it must never be reported as what a restaurant paid or charges. |
| **§2.1** — `beverages` keeps `producer`/`brand` as plain string columns | **A producers entity does not exist in their design.** §7.1's proposal is therefore genuinely new, and must serve `master_wine_library` *and* `beverages`. See the open question in §10. |

**Their "rule underneath all of it"** — *a fact stored in two places, or a decision made by a
score where it should be made by a key* — is the review test for anything proposed here. A
producers table passes it only if the wine row holds a **reference**, not a second copy of
the name. The raw menu string is a different fact from canonical identity (as `display_name`
is from `name`), so keeping both is legitimate; keeping two *canonical* names is not.

**Cost benchmark inherited from their §4:** research runs at a **$0.04/record ceiling**.
At 1,960 canonical producers that puts full-depth coverage near **$78**, materially cheaper
than the staged plan in §8 assumed. Stage 3 may be affordable after all — see §8.

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

## 7. Hard prerequisites — **RESOLVED 2026-08-17**

Two data problems would have corrupted the research. Both are now fixed in the live table,
reversibly. **230 `wine_repair_log` entries** were written; every change records its prior
value and its evidence, so any repair can be traced and undone (A5).

### 7.1 Duplicate producer spellings — **FIXED**

`producer` is free text, so one producer could appear under several strings and be
researched twice with contradictory results.

**Measured:** 2,034 distinct producer strings; **93 duplicate-spelling groups** covering
**358 wines / $91,638**. (My first pass reported 68/$76,638 — that was the menu-corpus
subset; 93 is the whole library.)

**The near-miss worth recording.** My first normalizer stripped legal-form prefixes
(`Domaine`, `Château`) to group variants. That rule **merges different producers**:

| Would have merged | Reality |
|---|---|
| `Château Montrose` ($660, St-Estèphe 2nd Growth) + `Domaine Montrose` ($64, Languedoc) | **different producers, 10× price apart** |
| `Ch. Des Tours` (Vacqueyras) + `Domaine des Tours` (Vin de Pays de Vaucluse) | different estates |

The legal form is *discriminating*, not noise — which is A1's thesis restated. A second
heuristic ("canonical = the variant with most diacritics and greatest length") also produced
wrong names: `COS` → `Cos` (it is an acronym — **C**ilia, **O**cchipinti, **S**trano),
`Penner-Ash` → `Penner Ash`, `Laurent-Perrier` → `Laurent Perrier`.

**What shipped instead** — a closed, versioned equivalence list (`producer-canon-v1`), split
by what the difference actually *is*:

| Rule class | Basis | Groups |
|---|---|---|
| diacritic restoration | menus strip accents, never add them — safe and directional | 12 |
| case normalization | mixed-case wins, with brand exceptions (`COS`, `GlenDronach`, `EnRoute`) and Italian/French particles kept lowercase (`di`, `de`, `l'`) | 22 |
| punctuation / spacing | **not** auto-decidable; each verified individually | 22 |
| legal-form expansion to full estate name | verified per producer | 36 |

**Result: 168 rows repaired, 103 producer strings collapsed, 1 group left unmerged**
(`Eno Trio` / `Enó-Trio`, orthography unverified) plus the 2 blocked pairs above. Leaving
them costs a visible duplicate — the intended fail-safe direction.

Names were expanded to the **full, unabbreviated legal form**, per instruction. Two canonical
names turned out to be *neither* stored variant:

| Stored variants | Canonical | Source |
|---|---|---|
| `Roumier`, `Domaine Roumier` | **Domaine Georges Roumier** | web — and two other Roumier domaines exist in Chambolle, so the bare surname is genuinely ambiguous |
| `Grange des Pères`, `Domaine Grange des Pères` | **Domaine de la Grange des Pères** | web |
| `Frederic Magnien`, `Fredéric Magnien` | **Frédéric Magnien** | web — both stored spellings wrong |
| `Faiveley`, `Domaine Faiveley` | **Domaine Faiveley** | the bare rows are *Monopoles*, i.e. own-vineyard fruit, which is definitionally the Domaine label and not the négociant one |

### 7.2 `producer` auto-filled from `name` — **TRIAGED**

`load_enriched_wines.py:294` writes `producer = x.get("producer") or x.get("name")`, so when
a menu omits the producer the **wine name is copied into the producer column**. This is their
**A3** (357 rows library-wide; 220 in the menu-corpus wine subset — same defect, two scopes).

The string turns out to be three different kinds of thing, needing three treatments:

| Kind | Treatment | Rows |
|---|---|---|
| Real producer, abbreviated / misspelled / carrying classification junk | expand to full legal name | 32 |
| **Cuvée or second wine mistaken for a house** — `Cristal`, `Alter Ego de Palmer`, `Petit Figeac`, `172nd Edition Krug, Grande Cuvée`, `L'Oratoire des Papes` | set the *actual* producing house (Louis Roederer, Château Palmer, Château Figeac, Krug, Ogier) | included above |
| **Appellation or lieu-dit** — `Hermitage`, `Côte-Rôtie`, `Cornas`, `Côte Brune`, `La Landonne` | **quarantined, no producer invented** | 30 |
| Real producer already correctly named | untouched | 295 |

Detection for the appellation class used **evidence from our own corpus**, not a hand-written
list: a string is an appellation if ≥2 *other* producers use it as their region. That is a
key, not a score.

Highest-value repairs: `Ch. Pétrus` → **Château Pétrus** ($15,645, the single most valuable
producer string in the corpus) and `Chateau Lafite Rotschild` → **Château Lafite Rothschild**
(misspelled).

The 30 quarantined rows carry a `data_enrichment.producer_quarantine` note and
`review_status='needs_review'`. They are **ineligible for producer research** — researching
"Hermitage" as a producer would fabricate a reputation for a *place*. Their durable fix is
the other session's **0d** (stop extraction writing appellations into `producer`, ~$0.30
re-extract); this triage identifies exactly which rows that pass must correct.

### 7.3 New defect found and fixed: country contradicted region

Not in either plan's register. **464 rows stated a country that its own region disproves** —
186 Italian and 168 American wines were labelled `France`, plus Spanish, Austrian, German,
Greek, New Zealand, South African, Portuguese and Lebanese wines. Cause: a `France` default
applied where enrichment had no country.

Fixed by deriving country from region (unambiguous geography — Sicily is in Italy), each
logged to `wine_repair_log`. **This is why Axis 5 and the §9 validation are now trustworthy:
region and country were the two fields any geographic reputation signal keys on.**

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

**Staged plan — DECIDED: run Stage 1 first, verify it, then continue to full coverage.**

| Stage | Scope | Depth | Est. cost @ $0.04/rec | Value unlocked | Status |
|---|---|---|---|---|---|
| 0 | Prerequisites §7 + Axis 5 (price position) | no web research | $0 | pricing use cases | **§7 DONE**; Axis 5 ready to build |
| 1 | Top 101 producers | all 5 axes | ~$4 | **44% of list value** | next — **gated on verification below** |
| 2 | Next ~300 | all 5 axes | ~$12 | → ~62% | after Stage 1 verification passes |
| 3 | Remaining ~1,560 | all 5 axes | ~$62 | → 100% | proceed to completion |

The inherited $0.04/record ceiling changes the earlier recommendation: full coverage is
**~$78 total**, not the prohibitive figure the search-count estimate implied. Completing all
three stages is affordable. Staging is retained for a different reason — **Stage 1 is the
verification gate**, not a budget cut.

**Stage 1 verification (must pass before Stage 2 is funded).** Do not treat "the research
ran" as success:

1. **Manual audit of 20 of the 101** against their own producer sites — the axis values must
   match the cited source, not merely look plausible.
2. **Held-out price check** — Spearman ρ between PRESTIGE and within-region price percentile
   over the 101. A weak or negative ρ means the research is wrong, not that the metric is.
3. **Coverage report** — what fraction of the 101 yielded ≥2 axes with evidence. If it is
   below ~70%, the sourcing strategy needs changing before it is applied to 1,900 more.
4. **Reproducibility** — re-derive every tier label from stored observations with the pure
   function in §4. Any label that cannot be reproduced from its own evidence is a bug.

Report these four numbers before starting Stage 2.

**Stage 3 default: `unknown`, plus a correction affordance.** Where evidence is insufficient
the value stays `unknown` (§6). To stop that becoming a permanent dead end, the UI shows an
explicit **"Suggest a correction / report this"** action on any `unknown` reputation field,
open to users with the appropriate authority. Rationale: a visibly empty field with a way to
fill it recruits the people who actually know — sommeliers and buyers — whereas a
wrong-but-confident value is never questioned and never corrected. Suggestions enter the
review queue as *proposals with an author*, never as direct writes, and are subject to the
same evidence gate as researched values.

> Guard (their **C5**): a review queue that is never cleared turns "never auto-merge" into
> "never merge". Order the queue by value (restaurants × price impact), show the evidence
> inline, and track queue age as a health metric. If it proves unclearable, fix *generation* —
> never relax the decision rule.

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

## 10. Decisions — resolved and still open

**Resolved 2026-08-17:**

1. **Stage 1 scope** → top **101 producers** (44% of list value), **verified** against the
   four checks in §8, then continue to full coverage. Not a pilot to be abandoned; a gate.
2. **Stage 3 default** → **`unknown`**, plus an authority-gated *"suggest a correction"*
   affordance so empty fields recruit correction rather than rot. §8.
3. **§7.2 triage** → **done in this plan** (§7.2). It does not preempt the other session's
   **0d** re-extraction; it identifies precisely which rows that pass must fix.
4. **Does `BEVERAGE_CATALOGUE_PLAN` already own a producers table?** → **No.** Their §2.1
   `beverages` shape keeps `producer` and `brand` as plain string columns, exactly as
   `master_wine_library` does. There is no producer entity in their design.

**Open — and this is the one that needs an owner, not an answer from me:**

5. **Who owns the producers entity, and does it get built at all?**
   §7.1 is now fixed *as data* — 103 strings collapsed, reversibly — but the underlying
   design issue stands: producers are still free text, so the same drift will recur on the
   next menu load. A `producers` table would fix it structurally.

   It cannot be specified here alone, because it would have to serve **both**
   `master_wine_library` and their forthcoming `beverages` table, and their §2.1 shape does
   not have it. Three coherent options:

   | Option | Cost | Consequence |
   |---|---|---|
   | **a.** Producers entity shared by wines + beverages | schema work in *their* migration | Fixes drift structurally; research once per entity; reputation attaches to the entity where it belongs |
   | **b.** Keep strings; re-run the §7.1 equivalence list after each load as a maintenance job | near zero | Drift recurs every load and is caught after the fact, never prevented. Acceptable only while load frequency stays low |
   | **c.** Producer reputation keyed on the canonical *string* | low | Works today, but breaks the moment two producers legitimately share a name — the `Montrose` case, one table over |

   **Recommendation: (a)**, folded into their migration rather than added beside it — a
   second parallel structure is the "one fact, two places" failure their own register is
   organized around. **(b)** is a survivable interim; **(c)** should be rejected — §7.1
   proved same-name-different-producer is live in this data, not hypothetical.

6. **Should `producer_tier` be retired once the vector exists?** Keeping both a derived label
   and its source axes is defensible (the label is a projection, cheaply recomputed), but
   only if nothing ever *writes* the label independently. If it does, that is C2 in a new
   costume. Recommend: keep as read-only derived, enforced by a column comment and a check
   that it always equals the pure function of the axes.

---

## Appendix A — what was applied to the live table on 2026-08-17

All reversible; every row records its prior value in `wine_repair_log`.

| Change | Rows | Log tag |
|---|---|---|
| Producer canonicalization to full legal names (§7.1) | 168 | `producer-canonicalization` |
| `producer==name` repair + quarantine (§7.2) | 62 (32 + 30) | `producer-name-triage` |
| Country corrected from region (§7.3) | 464 | `country-region-consistency` |
| **Total** | **694** | |

Deliberately **not** changed, and why: `Château Montrose` / `Domaine Montrose`,
`Ch. Des Tours` / `Domaine des Tours` (different producers), `Eno Trio` / `Enó-Trio`
(orthography unverified), and the 295 `producer==name` rows whose producer is already
correct. In every case a visible duplicate was preferred to a silent merge.

To reverse any change:
```sql
SELECT wine_id, field_changes FROM wine_repair_log
WHERE repaired_by = '<tag>' ORDER BY repaired_at DESC;
```

## Appendix B — provenance of every number in this document

All figures were measured against the live `master_wine_library` on 2026-08-17, not
estimated. Scope is stated per figure, because the two plans use different ones and
conflating them is what made 220 and 357 look like disagreeing counts of the same defect:

- **whole library** (4,160 rows) — the 93 duplicate-spelling groups, the 357 `A3` rows,
  the 464 country corrections
- **menu-corpus wines** (`source='menu_corpus' AND primary_type != 'unknown'`, 3,222 rows) —
  the Pareto table, producer counts, the 220-row subset

The Pareto distribution, the split identities, and the loader-artifact triage are all
reproducible by re-running the queries in this session's history.
