# Producer Reputation — Design Plan

Status: **Stage 1 research is DONE (2026-08-17).** Prerequisites in §7 are done. Schema
work (the `producer_reputation_score` columns) is owned by the `BEVERAGE_CATALOGUE_PLAN`
session and was explicitly NOT built here — Stage 1 produced raw observations only, stored
in `datasets/planning-exports/stage1_producer_research_raw.json`, ready to load once that schema lands.
See §11 for what shipped and what it found.

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

## 11. Stage 1 results (2026-08-17)

**Scope:** all 101 top-value producers researched (99 distinct entities — 2 turned out to be
duplicate spellings of others already in the list, found and merged mid-research, see below).
**Method:** WebSearch, not the paid research-agent API — $0 marginal cost. **Output:**
303 raw observations across 99 producers, in `datasets/planning-exports/stage1_producer_research_raw.json`,
matching the Layer-1 (observations, not scores) design in §4. Nothing was written to the
database — no schema exists yet to hold it.

### Two more duplicate-producer identities found mid-research

Neither was catchable by the §7.1 typographic/legal-form rules — both require domain
knowledge, not string matching:

| Found | Merged to | Evidence |
|---|---|---|
| `Comte Vogüé` | `Domaine Comte Georges de Vogüé` | Both bottlings are Bonnes-Mares Grand Cru; de Vogüé is the confirmed dominant holder of that climat (7.2/10.8ha Musigny, 2.7ha Bonnes-Mares) |
| `Amoreau` | `Château Le Puy` | Amoreau is the family name behind Château Le Puy; confirmed by two identical cuvée names (`Duc des Nauves`, `Rose-Marie Rosé`) appearing under both producer strings, one at an identical $150 price |

Also fixed: `Hoffman-Jayer` → `Domaine Hoffmann-Jayer` (missing second *n*; official spelling
confirmed via hoffmann-jayer.com). All three logged to `wine_repair_log` with evidence, same
as §7.

**Running total across this whole engagement: 6 duplicate-producer identities found post-hoc**
(4 in §7.1's systematic pass, 2 more surfaced by doing real research). That ratio is the
strongest argument in this document for §10's still-open decision — a producers *entity*
would have caught the Vogüé and Le Puy cases automatically; string-matching, however careful,
keeps finding new ones by accident.

### Verification against the plan's own Stage-1 gate (§8)

| Check | Result |
|---|---|
| Coverage — producers with ≥2 axes of evidence | **93%** (92/99), above the 70% bar set in §8 |
| Below-gate producers | 7, listed below — correctly left thin rather than padded |
| Source tiering | Reused `SOURCE_TIER_DOMAINS`/`classify_source_tier` from `research_agent_helpers.py` verbatim, per §0's conformance rule — no parallel tiering scheme invented |
| Reproducibility | Every observation carries its `source_url`; spot-checked during recording (e.g. the Roumier/Vogüé and Amoreau/Le Puy merges were themselves *found* by re-reading citations, not assumed) |

**Honest finding on source tiering:** of 303 citations, only 14 landed tier A and 13 tier B —
275 are tier C. That is not a quality problem with the research; it is `SOURCE_TIER_DOMAINS`
showing its origin. That registry was built for wine *attribute* verification (appellation
authorities, grape databases) and lists ~10 major critics. Producer *history* — founding
year, family lineage, press characterization — legitimately lives on specialty wine
journalism (Wikipedia: 32 citations; Club Oenologique, Burgundy-Report, Wine-Searcher
producer profiles, The Wine Cellar Insider) that the registry was never asked to classify.
**Open question for whoever owns that registry: should it gain a tier for specialty wine
press**, distinct from both official bodies and the ~10-name critic list? Reusing the
existing registry as instructed was correct; extending it was out of scope for this pass.

**Price-correlation check, and why it isn't the validation §9 promised:** Spearman ρ between
*count* of prestige observations and average price was −0.036 (not significant). This is
expected, not a red flag — count is a proxy for "how much is written about this producer
online," not a calibrated prestige score. A producer written up twice because it's obscure
scores the same as one written up twice because everyone already knows the one fact that
matters (a First Growth classification, say). §9's real validation needs the weighted
0–200 axis scores from the derivation function in §4/§5, which is scoring-function work
this pass deliberately did not do — building it wasn't asked for, and building it here would
duplicate whatever the schema-owning session designs. The directional check that *is*
meaningful: producers meeting the evidence gate average $721/bottle vs. $534 for the 7 below
it — consistent with the gate finding real signal, though n=7 is too small to lean on.

### The 7 producers below the evidence gate — correctly left thin, not padded

| Producer | Evidence found | Why it stayed thin |
|---|---|---|
| `La Maison des Lions` | **none** | Two targeted searches found no independent record at all. Likely a small négociant bottling or restaurant-exclusive label under-indexed online. Flagged for direct menu-source follow-up rather than more web research. |
| `Domaine Matrot`, `Domaine de la Grange des Pères`, `Rare Champagne`, `Louis Remy`, `Domaine Sigalas`, `Château Musar` | 1 axis each | Real facts found (founding year etc.), but a second independent axis (critic coverage, production scale) didn't surface in the searches run. Not a claim that no such evidence exists — a claim that this pass didn't find it. |

None of these were forced into a tier. Per §6, they stay `unknown` until either more
research runs or someone with domain knowledge fills them in through the §8 correction
affordance once it's built.

---

## Appendix A — what was applied to the live table on 2026-08-17

All reversible; every row records its prior value in `wine_repair_log`.

| Change | Rows | Log tag |
|---|---|---|
| Producer canonicalization to full legal names (§7.1) | 168 | `producer-canonicalization` |
| `producer==name` repair + quarantine (§7.2) | 62 (32 + 30) | `producer-name-triage` |
| Country corrected from region (§7.3) | 464 | `country-region-consistency` |
| Duplicate identities found during Stage 1 research (§11) | 7 (2+1+4) | `producer-canonicalization-stage1` |
| **Total** | **701** | |

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

---

## 12. Stage 2 complete (2026-08-19) — **80.0% reached**

### Where it stands

| Metric | Value | Was (2026-08-18) |
|---|---|---|
| Coverage of `menu_corpus` list value | **80.0%** ($551,541 of $689,380) | 76.2% |
| Target | 80% | — |
| Producers with recorded observations | **614** | 509 |
| Raw observations | **1,682** | 1,317 |
| Passing the ≥2-axis evidence gate (§6) | 588 — **96%** | 485 — 95% |
| Source tiers (`classify_source_tier`) | A 254 · B 61 · C 1,358 · unsourced 9 | A 176 · B 49 · C 1,083 · 9 |

105 producers and 365 observations added this pass. Tier A rose from 13% to 21% *of new
citations* — not a methodology change, just a deliberate preference for the estate's own
site over a merchant page when both carried the same fact.

Store: `datasets/planning-exports/stage1_producer_research_raw.json`. Recorder: `/tmp/rec.py`.

**Denominator, stated explicitly** (it was implicit before and cost time to re-derive):
`source='menu_corpus' AND primary_type <> 'unknown'`, **deduplicated** on
`(name, producer, vintage, price_reference)` — 3,202 of 3,222 raw rows — then **less the
seven non-producer strings** below. Gross $693,740 − $4,360 = **$689,380**. Measuring on the
raw table instead gives $701,445 and understates coverage by ~0.7pt; the 2026-08-18 figures
were already on the deduplicated basis and were sound.

### Corpus defects found while refreshing the queue

None of these block the research, and none were repaired here — they are recorded for
whoever owns the corpus. The first two matter because they cap what coverage can ever reach.

| # | Defect | Scale | Disposition |
|---|---|---|---|
| 1 | `producer` holds a bare appellation, and `name` repeats it — the row carries no producer identity anywhere | 7 strings, **$4,360** — `Hermitage`, `Hermitage Blanc`, `Côte-Rôtie`, `Côte Brune`, `La Landonne`, `Cornas`, `Côtes du Rhône` | **Unresearchable.** Excluded from the denominator above |
| 2 | `producer` holds an appellation but `name` identifies the producer | 3 strings, **$1,150** — `Champagne`→Dom Pérignon, `Sauternes`→d'Yquem/Suduiraut/Ardyssiere, `Saint Emilion Grand Cru`→Croix Canon | **Repairable by data fix, not research** — worth ~0.17pt of coverage for free |
| 3 | **§7.3 recurrence:** `country` contradicts the country named in `region` | 71 rows, **~$15.1K**. Every case is `country='France'` — the signature of a default written when country was unknown. Includes `region='South Australia'` at $7,700 | Same class as the defect §7.3 records as fixed on 2026-08-17 |
| 4 | `wine_regions` is **empty (0 rows)** | — | Any validation that joins it passes vacuously. A region-membership check written against it here returned zero matches and looked like a clean result |
| 5 | Duplicate rows in the raw table — same `(name, producer, vintage, price)`, usually differing only in region granularity (`Rhône Valley` vs `Côte-Rôtie`) | 99 surplus rows, **$38,138** | Already neutralised by deduplicating the denominator; the rows themselves still exist |

**A caution on the obvious heuristic:** `producer = name` looks like it should detect defect 1,
but it flags 159 strings worth $37,295, and most are legitimate — `Harlan Estate`,
`Promontory`, `Mayacamas`, `Dominus Estate`, `Raveneau`, `Le Dôme`. Estates whose flagship
wine carries the estate name are common. Defect 1 was confirmed by reading the rows, not by
the rule; the rule alone would have discarded real producers.

### Technique that keeps paying: DB disambiguation before research

Querying the stored `name` column for an ambiguous producer string resolves identity
deterministically, with no similarity scoring — satisfying **A1**. It settled eight more
cases this pass, including three that a search alone would have gotten wrong:

| Menu string | Resolved by stored wine name | Identity |
|---|---|---|
| `Rotem & Mounir` | `Saouma` | Rotem & Mounir Saouma (the surname had landed in `name`) |
| `Juan Gil Bodega` / `Juan Gil Bodega Morca Touran` | `Morca Touran` / `Grenache` | One entity, Bodegas Morca (Gil Family), split across two strings |
| `Schumann` | `Sivi Pinot`, region `Podravje, Slovenia` | Šuman, Slovenia — *not* a German producer, despite the spelling |
| `Chateau Maltroye` | `Chassagne Montrachet 1er Cru Clos Du Maltroye` | Château de la Maltroye |
| `Dupueble` | `Beaujolais Nouveau` | Domaine du Dupeuble |
| `Huré Frère` | `Mémoire` | Huré Frères |
| `Mirror` | `Black Label`, Napa Valley | Mirror Napa Valley (Rick Mirer / Kirk Venge) |
| `Domaine Jean Francois` | `The Twelve Rows Sanford and Benedict` | Sanford × François Labet (Château de la Tour) joint venture |

Run this **before** searching any producer whose string is a bare surname or looks truncated.

### Open alias flags — human review, never auto-merged (A5)

Carried forward: `Ampeu` → Domaine Robert Ampeau · `Pierre Pillard` → Champagne Pierre
Paillard · `Zolt Suto of Strekov 1075` → Strekov 1075 · `Nobis` → Nimble Vineyards ·
`Feudi di Gregorio` → Feudi di San Gregorio · `Franchetti` → Vini Franchetti ·
`Eloi Dürrbach` → Domaine de Trévallon

Added this pass: `Rotem & Mounir` → Rotem & Mounir Saouma · `Juan Gil Bodega` **and**
`Juan Gil Bodega Morca Touran` → Bodegas Morca (**two strings, one entity**) ·
`Chateau Maltroye` → Château de la Maltroye · `Huré Frère` → Huré Frères ·
`Schumann` → Šuman · `Dupueble` → Domaine du Dupeuble · `Chandon de Brialle` → Chandon de
Briailles · `Ruinart Singuler` → Ruinart (cuvée appended to house) · `8 Years in the Desert`
→ Orin Swift Cellars (**cuvée recorded as producer**) · `Y. Clerget` → Domaine Yvon Clerget

**18 alias flags total, none auto-merged.** Two of the new ones are a different shape from
the rest — `8 Years in the Desert` and `Ruinart Singuler` are *cuvée names sitting in the
producer column*, which is defect class 1's cousin and may be worth its own detection rule.

### Explicit misses and known-thin records

- `Laurence` (Santenay Les Gravières 1er Cru, 1978/1990) and `Ledy` (Nuits-St-Georges 1er Cru
  Les Porrets-St-Georges) — **$1,085**. Resisted identification again, now with a working
  search engine. Treat as menu fragments; leave `unknown`.
- `Maison des Lions` (Chablis Les Clos Grand Cru, $245) — searched, only a single retailer
  listing exists. Recorded with axis `none` rather than left silent, so the attempt is on
  the record and is not retried blindly.
- Nine observations carry no `source_url` (all pre-existing, from the 2026-08-17 pass).

**Recorded source conflicts, not silently resolved:** 14 producers carry an explicit
`SOURCES CONFLICT` note in the observation `unit` field where merchants disagreed on
hectares — e.g. Domaine Burgaud (5 vs 9ha), Milan Nestarec (8 vs 50ha), Meinklang (70ha
farmed vs a ~2,500ha total-farm figure). The conflict is preserved rather than adjudicated,
per §4's raw-evidence rule.

### Provenance caveat

`/tmp/rec.py` hard-coded `retrieved_at: "2026-08-18"`. The session crossed midnight, so some
observations added on 2026-08-19 are stamped 2026-08-18. The recorder has been fixed to use
`datetime.date.today()`; existing stamps were **not** rewritten, since distinguishing them
after the fact would mean guessing. Affects the day field only — every `source_url` is exact.

### If coverage needs to go higher

The queue past 80% is a long flat tail: 1,307 uncovered strings averaging ~$105 each, so
roughly 10 producers per 0.15pt. Two cheaper moves first:

1. Repair defect class 2 (3 strings) — **+0.17pt with no research at all**.
2. Then resume the §11 grouped-value query, excluding store keys by normalised name.
   Batch 8–10 `WebSearch` calls, then one `rec()` call.

Working scripts for the queue and coverage refresh are in this session's scratchpad
(`queue2.py` recomputes the denominator, coverage and the ranked queue from the live DB).

---

## 13. Stage 3 (2026-08-19) — the four flagged items, and a push past 80%

Opened with a goal of 100% coverage plus the four items §12 left open. **All four are closed.**
Coverage work continues against a long tail; see "Where the tail stands" below.

### 13.1 `Laurence` and `Ledy` — both RESOLVED, and §12 was wrong to call them fragments

| Menu string | Identity | Evidence |
|---|---|---|
| `Laurence` | **Domaine Laurence**, Santenay (Dezize-lès-Maranges) | Bonhams auctioned its Santenay 1er Cru Gravières 1959 in magnum; iDealwine lists 1989 and 1990; Mon Millésime lists 1959 and 1973. Documented vintages run 1959–1990, matching the corpus rows (1978, 1990) |
| `Ledy` | **Domaine Vincent Ledy**, Nuits-Saint-Georges | Founded 2007, 3.5ha, organic, oldest vines ploughed by horse; established with help from his uncle Alain Michelot |

§12 recorded these as unidentifiable "menu fragments" after two sessions of trying. That was a
wrong call, not a limit of the sources: both are real estates with ordinary web presence. The
error was searching the *appellation and vintage* rather than the producer string as a proper
name. Worth **$1,085**.

### 13.2 `Maison des Lions` — search exhausted, and the absence is now the finding

Six distinct queries (EN and FR; producer, négociant and wine-searcher framings) and two direct
page fetches returned exactly one primary source: a sold-out retailer listing headed
"Exclusive". No estate site, no négociant registration, no importer, no press, no auction
record. Recorded with axis `none` and observation `search_exhausted`, carrying that reasoning.
Assessment: **a retailer-exclusive private label, not a discoverable producer** — an identity
that *cannot* be researched, which is a different thing from one not yet researched.

### 13.3 Source conflicts — 21, not 14, and 6 now settled against tier-A sources

§12 said 14. The actual count was **21**. Each resolution *adds* an observation citing the
estate's own site or the appellation authority; the conflicting observation is kept, per §4.

| Producer | Conflict | Resolution |
|---|---|---|
| Domaine Burgaud | 5 vs 9ha | **5ha** — the estate's own site, at ~8,000 vines/ha. The merchant figure was wrong |
| Fèlsina | 72–95ha | **90ha** of vines within a 500ha property, from the estate |
| Pieropan | 1880 vs 1860 | **1880** — the estate's own tagline, *Vignaioli dal 1880* |
| Clos du Mont-Olivet | 27 / 32 / 20.5ha | **20.5ha CdP + 11.5ha CdR**, published by the Châteauneuf-du-Pape appellation body. The larger figures conflate the two |
| Inama | 30 vs 60ha | **~80ha** today; founding corrected 1950 → **1948** |
| Château La Mission Haut-Brion | 1540 vs 1533 | **1540** — *and the cause found*: in 1540 Arnaud de Lestonnac married Jean de Pontac's sister; Pontac founded Château **Haut-Brion**, a different estate. 1533 is a conflation of the two |

Partially resolved (estate publishes parcel-level, not group, totals): Meinklang (10ha largest
contiguous vineyard; the ~2,500ha figure is *not* vineyard area), Elena Walch (Moncalisse is a
separate 12ha entity some sources fold in), Domaine des Perdrix, Milan Nestarec. Nine remain open.

### 13.4 `retrieved_at` — restamped exactly, not by guesswork

§12 said separating the misstamped observations "would mean guessing". It did not. Every batch
script in the session scratchpad carries an mtime of 2026-08-19, and the one inline batch ran
after `queue2.py` (00:01:26, 2026-08-19) — so **every** observation this session wrote belongs
to 08-19. Identity was recovered by re-parsing the batch scripts for the
`(producer, axis, observation, source_url)` tuples they wrote and matching them in the store,
with an abort if reconstruction was not exact.

Result: **365 observations restamped**, leaving 1,317 at 08-17/08-18 — matching the prior
session's recorded total exactly, which is the check that confirms the split was right.
`/tmp/rec.py` now uses `datetime.date.today()`.

### 13.5 Two more non-producer strings found

`Saint Joseph` and `Saint-Joseph` are both `producer == name == appellation` with no other
identifying column populated — defect class 1. Added to the exclusion set, which now holds
**9 strings / $4,760**. Denominator is now **$688,980**.

### Where the tail stands (updated 2026-08-22)

| Metric | Value |
|---|---|
| Coverage | **88.9%** ($612,701 of $688,980) |
| Producers | **961** |
| Evidence gate (§6) | **97%** (932/961) |
| Uncovered strings remaining | **951** (~$76,300) |

Started this stretch at 80.0% / 616 producers. **+345 producers, +8.9 points.**

### 13.6 Two alias sweeps — one worked, one failed

**Producer-string similarity (worked, with a caveat).** Shortlisting remaining strings whose
normalised form is a sub/superstring of a covered producer gave 43 candidates. **Only 27 were
real** — `Brokenwood`≠`Kenwood`, `Talbott`≠`Château Talbot`, `Faustino Rivero Ulecia`≠`Faustino`,
`Desvignes`≠`Clos des Vignes du Maynes`, `Enrico Serafino`≠`Domaine Serafin` and six others are
different producers entirely. Each of the 27 was confirmed individually and recorded under its
own menu string with an explicit ALIAS note; nothing was merged. This is the cheapest coverage
found all session (27 producers from one script) **and** a live demonstration of why §0's A1
forbids similarity-scored merges: the heuristic was wrong 26% of the time.

**Wine-name similarity (failed).** The same approach against the corpus `name` column produced
15 candidates and **zero usable results**. Matches were dominated by appellation names sitting
in `name` (`Margaux`, `Barolo`, `Sauternes`, `Rutherford`) and by the defect strings recorded
in §13.5, which act as attractors. Recorded here so it is not retried. One near-miss worth
keeping: `Ladoucette`'s **Comte Lafond** (Sancerre) vs **Comte Lafon** (Meursault) — one letter
apart, unrelated producers.

### 13.7 More corpus defects found while grinding

- `Costers del Segre` — bare DO in the producer column; the wine name (Purgatori) identifies it
  as **Familia Torres**, already covered as `Torres`. Same class as §13.5's repairables.
- `Domain Piccard` — recorded as if Jura; it is **Swiss** (Villette, Lavaux Grand Cru).
- `Domaine Ozil` — northern-Rhône-sounding but sited in **Lagorce, southern Ardèche**.
- `Château Laroque` — the corpus row reads Margaux; the producer is the **Saint-Émilion** Laroque.

### Resume

`rem.json` and an offline coverage calculator live in the session scratchpad; they recompute
coverage from the store without touching the database (the live DB query began timing out at
~900 producers). Recorder is `/tmp/rec.py`, now stamping `datetime.date.today()`.

---

## 14. Stage 4 (2026-08-22) — defects repaired in the database, and two of §13's findings corrected

Goal for this stretch: repair the logged corpus defects rather than research around them, and
give every producer a **four-rung search ladder** instead of a single query.

### 14.1 Defects are now fixed in the database, not just logged

**57 rows changed, each with a `wine_repair_log` entry carrying its evidence URL** — the same
pattern §7.3 used. Nothing was overwritten without a trace.

| Class | Rows | What changed |
|---|---|---|
| Appellation sitting in the producer column | 5 | `Champagne`→Dom Pérignon, `Sauternes`→Ch. d'Yquem and Ch. Suduiraut, `Saint Emilion Grand Cru`→Château Canon, `Costers del Segre`→Familia Torres |
| Wine name sitting in the producer column | 4 | `Salmos`→Familia Torres, `Bugey-Cerdon`→Domaine La Dentelle (×2), `Telegramme`→Domaine du Vieux Télégraphe |
| **Region column names a country** | 45 | country corrected on Austrian, Chilean, German, Greek, Italian, NZ, Portuguese, South African, Spanish and Swiss wines all mislabelled `France` |
| Long-form canonicalisation | 3 | `Torres`→`Familia Torres` |

**The 45-row class is the residual of §7.3 and was structurally unreachable by it.** §7.3 derived
country *from* region, so it could not repair a row whose region value **is** a country name
(`region='Italy'`, `country='France'`). Different signal, same defect.

**A second pass then found 71 more.** The first fix matched `region` exactly against a country
name; it missed the far commoner `"<place>, <Country>"` form — `Weinviertel, Austria`,
`Swartland, South Africa`, `Vayots Dzor, Armenia`. That class covers Croatia (18 rows), Slovenia
(14), Greece (10), Argentina (5), Austria (6), Georgia, Armenia, Israel, Hungary, Australia and
New Zealand. **129 country repairs in total; contradictions now 0.**

Two further defect classes surfaced with it:

- **Menu chrome in the producer column.** `Sonntag Geschlossen` is German for *closed Sundays* —
  a menu footer scraped into `producer`. Excluded, and worth watching for as a class.
- **The region column naming the producer.** `Prosecco` / "Rosé" carried `region='Canella - Veneto'`
  — Canella is the house, Veneto the region. Repaired to producer `Canella`, region `Veneto`.

Rows that could not be repaired: `Sauternes` / "Ch. Ardyssiere" — no source for that château under
any spelling. Non-producer strings now number **16**: the original appellation set plus `Cava`,
`Côtes du Rhône Blanc`, `Toscana`, `Prosecco` and `Sonntag Geschlossen`, each verified as
`producer == name == appellation` with `grape_variety = 'unknown'` and no identity in any column.

### 14.2 §13.7 was wrong about Château Laroque

§13.7 recorded `Château Laroque` as a defect, "the corpus row reads Margaux; the producer is the
Saint-Émilion Laroque." **Both estates exist.** The Margaux Château Laroque is the second wine of
**Château Le Coteau** at Arsac — Léglise family, six generations, Eric Léglise since 1993. The
corpus row was never defective.

Worse, the store's `Château Laroque` observations describe the *Saint-Émilion* estate while being
attached to a Margaux wine. Per A5 both are kept, with an explicit `homonym_disambiguation`
observation rather than a deletion. **This pair is now in the alias file's reject list** so no
future sweep merges them.

`Maison des Lions` went the other way: re-tested with rung 4 (its $1,000 Clos de la Roche Grand
Cru as the query term) and still nothing. §13.2's verdict survives a stronger test than it was
originally given.

### 14.3 The four-rung ladder

1. bare name as a proper noun → 2. name + winery/domaine/estate → 3. **name + region from the
corpus row** → 4. **name + the actual wine name from the corpus row**.

Rung 3 is what earns its keep. `Tarllc` looks like a corrupt string and returns nothing alone;
`Tarllc` + "Vayots Dzor, Armenia" resolves immediately to Aaron Rawlins' Armenian project on
150-year-old ungrafted vines. This is the same failure mode that cost §12 the Laurence/Ledy call.

The ladder also catches menu-string corruption that no similarity score should ever be trusted to
fix, because each was confirmed individually: `La Soula`→**Le Soula**, `Les Troix Croix`→**Les
Trois Croix**, `Roc l'Abbaye`→**Domaine du Roc de l'Abbaye**, `Tsibidis`→**Monemvasia Winery**,
`Monogram`→**Castel Faglia**, `J. Hoffstätter`→**Hofstätter**.

### 14.4 `producer_aliases.json` — the equivalence list is now a file, not prose

**118 entries**, versioned, with the A1 rule and the reject list stated in the file itself. Two
sources: ALIAS notes harvested from the store, and the 24 corpus pairs that `norm()` folds.

An audit of that folding found **24 producers ($3,214, 0.47%) counted as covered only because of
it** — `Cade`/`Cade Estate`/`Cade Winery`, `Cakebread`/`Cakebread Cellars`,
`Perrier & Jouet`/`Perrier-Jouët`. All 24 inspected, all legitimate. Note §13.6's 26% error rate
does **not** transfer: that heuristic matched arbitrary sub/superstrings, this one folds only
accents and a closed suffix list. Narrower operation, different risk.

### 14.5 Premortem: the parallel-agent fan-out failed, and why

Six agents were dispatched over 168 producers with the full ladder — roughly 670 searches fired
at once. **All six died on the shared session limit and wrote zero rows.** The budget is a shared,
rate-limited resource; parallelism spends it faster without increasing what it buys. Inline
batching — 3–4 searches, then one `rec()` call — is what carried 80% → 92% and is what should be
used. Recorded so the fan-out is not retried on this workload.

### Where the tail stands — CLOSED at 100% (2026-08-23)

| Metric | Value |
|---|---|
| Coverage | **100.0000%** ($688,343 of $688,343) |
| Producers researched | **1,891** |
| Evidence gate (§6) | **96%** (1,823) |
| Uncovered strings remaining | **0** |

Stage 4 closed at 97.60% / 1,561 producers / 337 strings. See §15.5 for the verification
and §15.6 for what 100% does and does not mean.

### 14.7 One repair applied and then reverted — the line between repair and assumption

`Camille Braun` was filed under region Loire. Domaine Camille Braun is at Orschwihr in Alsace, so
the region was repaired to Alsace. **That repair was then reverted**: the row's wine name reads
*Crémant de **Loire** Rosé*, and Camille Braun of Orschwihr makes Crémant d'**Alsace**. Producer
and wine name contradict each other, and changing region on the strength of the producer name
alone would have resolved the contradiction by assumption rather than by evidence.

Both the repair and the revert are in `wine_repair_log`, and the contradiction is recorded on the
producer. This is the same discipline as `Chardonnay, Chalk Hill` and the `Cherrier` cluster:
**a contradiction that cannot be settled is recorded, not resolved.** The 129 country repairs were
different in kind — region naming a country is unambiguous geography, with nothing to adjudicate.

**Long-form canonicalisations applied to the corpus** (each confirmed by a source showing both
forms, per the rule that the long name wins only when the search establishes the equivalence).
Every one collapsed a duplicate the corpus was carrying twice:

`Torres`→`Familia Torres` · `Lavantureaux`→`Domaine Roland Lavantureux` · `Meadow Ranch`→`Long
Meadow Ranch` · `Masseria Li Velli`→`Masseria Li Veli` · `Castello Banfi`→`Banfi` · `Stein
Palmberg`→`Ulli Stein` · `Alpha Estates`→`Alpha Estate` · `Caprera`→`Agricola Caprera` · `Vini
Rabasco`→`Rabasco` · `Remi and Laurence Dufaitre`→`Remi et Laurence Dufaitre` (and/et) ·
`Mondavi`→`Robert Mondavi`.

Note the direction is not always toward the longer string — it is toward **the form the producer
and trade actually use**, which is what the rule asks. `Vini Rabasco`→`Rabasco` and `Castello
Banfi`→`Banfi` both shorten.

**Two further defect classes found late in the pass**, both recorded rather than repaired on
inference: a *grape variety + AVA* occupying the producer column (`Chardonnay, Chalk Hill`, whose
wine name "Black" resolves to nothing), and the `region` column naming the producer (`Prosecco`
with `region='Canella - Veneto'`, repaired). A third repair corrected `Schlumberger` from Loire
Valley to Alsace — Grand Cru Spiegel is unmistakably Alsatian.

### 14.6 Menu-string corruption the ladder caught

Every one confirmed individually against a source showing both forms — never merged on resemblance.
This is the working evidence for why the equivalence list must stay closed and evidenced.

| Menu string | Actual estate | Corruption type |
|---|---|---|
| `La Soula` | Le Soula | article |
| `Les Troix Croix` | Les Trois Croix | transposition |
| `Vallanna` | Vallana | doubled consonant |
| `Sorelle Branca` | Sorelle Bronca | single vowel |
| `Lavantureaux` | Domaine Roland Lavantureux | vowel + dropped long form |
| `Meadow Ranch` | Long Meadow Ranch | dropped leading word |
| `Roc l'Abbaye` | Domaine du Roc de l'Abbaye | dropped particle |
| `J. Hoffstätter` | Hofstätter | doubled consonant |
| `Monogram` / `Lion Tamer` / `Pietramaggio` / `Alfredosa` / `Urlari PerVale` | Castel Faglia / Hess Persson / Fattoria di Grignano / Tenuta Alfredosa / Azienda Agricola Urlari | cuvée name used as producer |
| `La Vie` | Domaine du Castel | unrelated string; resolved only by rung 4 |

**Homonym clusters found — recorded unadjudicated rather than guessed:** `Château Laroque`
(Margaux vs Saint-Émilion), `Bachelier` (Francine vs Domaine, split by the cuvée "Hommage"),
`Cherrier Père et Fils` (three Cherrier estates at Verdigny; not resolved), `Pietramaggio` vs
Piemaggio, `Mondavi` (Robert Mondavi vs Charles Krug).

Per the decision recorded this session, an axis-`none` + `search_exhausted` record **counts
toward coverage** — it fails only the §6 evidence gate. 100% is therefore reachable; it means
every string attempted with its evidence on record, not every string identified.

## 15. Stage 5 (2026-08-23) — a third country pass, and the defect the first two structurally could not see

### 15.1 `country` was not repaired; it was repaired *twice* and still wrong 133 times

§7.3 derived country **from** region, so it could not touch a row whose region **is** a country.
§14.1's second pass caught the far commoner `"<place>, <Country>"` form. Both passes shared a
blind spot neither could see from inside: **a row whose `region` is an ordinary region name** —
`Lazio`, `Rías Baixas`, `Moravia`, `Santa Cruz Mountains` — with `country` carrying the corpus
default. Nine Lazio rows were filed under France. Eight Moravian ones. Five from South Australia.

The tell was in the country histogram, not in any contradiction check: `France` held 1,337 of
3,232 rows, and its region list contained `Sardegna`, `Bolgheri`, `Rioja`, `Madeira`, `Batroun`
and `Vayots Dzor`. **France is this corpus's null value.**

`repair5.py` fixes it with a closed, hand-checked region→country map — 133 rows, each logged to
`wine_repair_log` as `region-implies-country-repair`. It also normalised four `USA` rows to
`United States`, a label-variant defect that had been splitting the same country in two.

**One row was deliberately left wrong-looking.** `Styria`/`Slovenia` (Radovan Šuman) survived
because Styria/Štajerska straddles the Austria–Slovenia border: the map's first draft listed
Styria under Austria and **would have flipped a correct value to an incorrect one**. That draft
was caught by reading the ten affected rows before applying, not by any check in the script. Also
deliberately absent: `Austria/Hungary`, `South America`, `Macedonia`, `Central Valley` — genuinely
ambiguous, so out of the map entirely rather than resolved by majority vote.

Running country-repair total across all three passes: **262 rows**.

### 15.2 Two new corruption classes, both confirmed by search before recording

| Menu string | Actual estate | Corruption type |
|---|---|---|
| `Aransat` | Borgo Savaian di Bastiani Stefano | **wine name in the producer column** — "aransat" is Friulian for orange, the name of the skin-contact white |
| `La Antigua Clásico` | Alberto Orte | wine name in the producer column (resolves, so not a dead end) |
| `Elana Walch` | Elena Walch | single vowel |
| `La Ragose` | Le Ragose | article |
| `Odd Bird` | Oddbird | split compound |
| `Copertino` | Cantina Sociale Cooperativa di Copertino (trades as Cupertinum) | short form that is *also* the DOC name |
| `Selbach Oster` | Selbach-Oster | dropped hyphen |

`Copertino` is the interesting one for the naming rule. The string is simultaneously an
appellation, a town, and the trade short name of the cooperative — and the search returns the
cooperative for both the short and long forms. Under the rule the user set (*promote only when a
search confirms both forms name the same entity*) it **resolves**, where a bare appellation like
`Hermitage` does not. The test is not string shape; it is whether the search closes the loop.

### 15.3 The vintage-prefixed producer — a defect class hiding in the $0 rows

The last stretch of the tail was almost entirely **$0 by-the-glass rows**, and they had been
parsed by a different path from the priced list. It shows: nineteen of them carried a **four-digit
vintage year welded onto the front of the producer** — `2022 bodegas ponce`, `2023 cataldo
calabretta`, `2018 la louiserie`. A leading year is never part of a producer name, so `repair6.py`
strips it deterministically. **Two of the nineteen folded straight onto producers the corpus was
already carrying** — the corpus had been counting one estate twice because one row had a year on it.

Two related shapes in the same cohort:

- **Pipe-separated region welded on.** `antica | piedmont`.
- **One house under four strings.** `Antica Torino`, `antica`, `antica | piedmont` and
  `Torino Bianco` are all the same Piedmontese vermouth house — the last being the *product* name.
  Folded to one producer with the evidence recorded.

Not stripped: `2'2024 gioventu`, whose stray leading digit and apostrophe defeat the year regex.
It was resolved by hand instead, and the mangled prefix is recorded on the producer.

### 15.4 What the last hundred strings actually were

Past about 99.5% the remaining strings stopped being obscure producers and became **defect
shapes**. Worth naming, because the same shapes will recur on the next menu ingested:

| Shape | Example | What it is |
|---|---|---|
| Producer withheld at source | `Undisclosed Cellar BIN V3` | the menu deliberately anonymises a bin listing — **there is no producer to find** |
| Appellation + NV marker | `NV Valdobbiadene` | a place and a non-vintage flag, no house |
| Grape prefixed to producer | `Chardonnay, Cave de Lugny` | variety welded onto the name |
| Generic phrase | `bodegas y viñedos` | Spanish for "wineries and vineyards" — names nothing; resolved only by rung 4 off the cuvée `Pinuaga` |
| Cuvée as producer | `Ramitello`, `ATMA`, `Aransat`, `La Antigua Clásico` | the wine in the producer column |
| Word "Rosé" as producer | `Rosé` | resolved only by the cuvée `Whispering Angel` → Château d'Esclans |
| Brand owner, not grower | `Opici Wines`, `Terlato`, `Avissi`, `FRE` | importer or brand house, no vineyard behind the string |
| OCR letter confusion | `Cantina F.Ili Carafoli` | `F.lli` (fratelli) with lowercase L read as capital I |

**The importer/brand-owner class is worth flagging for downstream use.** Roughly a dozen strings
name a company that owns a label but farms nothing — Opici, Terlato, C. Mondavi & Family, Trinchero
(twice, as Avissi and FRE), M.S. Walker, PortoVino. A reputation model that reads these as estates
will attribute a négociant's scale to a wine that has none.

### 15.5 The 100% is verified independently, not asserted

`verify_final.py` recomputes the figure from the database without reusing the loop's own
calculator, and prints its working:

```
denominator  $688,343   (1,900 live strings; 16 excluded as non-producers, $5,397)
covered      $688,343 = 100.0000%
uncovered    0 strings, $0
```

Three things it checks that the loop's calculator does not:

1. **Every folded match is listed for inspection.** 28 strings (\$3,493, **0.51%** of the
   denominator) are covered only through `norm()` folding rather than an exact string match. All 28
   were read: they are accent restorations (`Château Lassegue`→`Lassègue`, `Resonance`→`Résonance`)
   and Estate/Vineyards/Winery/Cellars suffix variants (`Cade Estate`→`Cade`,
   `Grgich Hills`→`Grgich Hills Estate`). **No false merge among them.** This matters because
   §13.6's similarity heuristic was wrong 26% of the time — folding is not that heuristic, and the
   audit is what shows the difference rather than the claim.
2. **The evidence gate, recomputed.** 1,823 of 1,891 producers clear §6's two-distinct-axes bar —
   **96%**, down from a 98% peak, because the last stretch added evidenced misses, which by
   construction fail the gate. The gate falling is the correct behaviour, not a regression.
3. **26 axis-`none`-only entries are named individually**, so the difference between "covered" and
   "identified" is auditable rather than a rounding claim.

### 15.6 What 100% means — and what it does not

It means **every producer string in the deduplicated menu corpus has been attempted and its
evidence recorded**. That is the definition the user chose ("attempted-with-evidence counts"), and
it is the only definition reachable, because some strings *cannot* be identified from public
sources — not "have not been", but **cannot be**:

- `Undisclosed Cellar BIN V3` and `BIN N9` — the menu withholds the producer by design.
- `Maison des Lions`, `Piccolo Sogno`, `Francesca`, `Zanelli`, `Kotrosos` — searched to exhaustion
  across query framings; retailer listings only, no estate, importer or press anywhere.
- `NV Valdobbiadene` — an appellation, not a house.

**Twenty-six producers sit at axis `none`.** Each carries the reasoning for its own absence.
That is the honest floor of the corpus, and it is 1.4% of it.

Also unresolved on purpose, and recorded rather than guessed:

- **Contradictions that cannot be settled.** `Bisson` (Liguria producer filed under Veneto),
  `Montinore Estate` (Oregon estate with an Emilia-Romagna region *and* an unfindable cuvée),
  `Sandeman` (a Port and Sherry house with a Madeira row), `Les Allies` (Languedoc region, Côte
  d'Or bottling), `domaine de justices` (Bordeaux estate on a Loire row). In each the columns
  disagree with each other, and repairing one would resolve the row **by assumption** — the
  Camille Braun discipline from §14.7.
- **`terres blanches` / `terres bioiques`** — two rows, same wine name, same region, neither
  resolving to a Chinon producer. They look like two corruptions of one string. Not merged.
- **`la louiserie` / `la loupterie`** — both plausibly Domaine de la Louvetrie (Jo Landron), whose
  Muscadet Sèvre-et-Maine sur lie matches both rows. **Not merged**: the corpus wine name is the
  generic "Muscadet", so the link would rest on string resemblance alone — precisely the §13.6
  error. This is the clearest case in the whole run of the rule costing something real, and it is
  the right price.

`Cherrier Frères` **was** resolved — Domaine de la Rossignole at Verdigny, founded 1927 — which
partly adjudicates the Cherrier cluster left open in §14.6. `Cherrier Père et Fils` remains a
separate, still-unadjudicated name.

### 15.7 Repairs applied to the database this stage

Every one logged to `wine_repair_log` with its reasoning and source:

| Pass | Rows | `repaired_by` |
|---|---|---|
| Region implies country | 134 | `region-implies-country-repair` |
| Vintage-prefix strip | 19 | `vintage-prefix-strip` |
| Long-form canonicalisation | 8 | `producer-longform-canonicalisation` |

Running country-repair total across all stages: **263 rows** (129 in stage 4, 134 here). One log
entry was **corrected in place** rather than overwritten — a country repair whose first-written
justification cited the wrong wine. The value was right, the reasoning was not, and the entry now
carries both the correct reasoning and a note saying what it previously said.
