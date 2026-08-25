---
type: premortem
division: platform
department: data
team: annotation-ground-truth
status: provisional
metrics: [annotation.gold_set_freshness_days, annotation.gold_set_size, annotation.inter_annotator_agreement, annotation.correction_to_rule_conversion_rate]
updated: 2026-08-24
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-directive]]", "[[data-premortem]]", "[[corpora-enrichment-premortem]]", "[[synthetic-generation-simulation-charter]]", "[[substrate-quality-coverage-charter]]", "[[red-team-charter]]", "[[technology]]"]
---

# Annotation & Ground Truth — Premortem

> Written at founding, before success is assumed.

The team doc gives one line (`technology.md:621-624`): *Label Studio is stood up, one pilot
round is annotated, the founder's time gets pulled elsewhere, and every accuracy claim for
the next year rests on `pilot_test_v2.json` — a set that predates three model changes.*

That is M1, and it is already half-true: `pilot_test_v2.json` is the newest task file in
the repo today. Four more mechanisms follow.

---

## M1 — The pilot became the permanent gold set

Label Studio is stood up (`docker/label-studio/docker-compose.yml`), a pilot round is
annotated, it works. Then the founder's attention goes to enrichment — which is visibly
productive, ships numbers weekly, and does not require sitting and labelling documents by
hand. Annotation is the one task in this department that **no agent can do for you**, and
it is therefore the one that loses every prioritization contest.

Twelve months later the newest gold example is from month one. Three model changes, two
prompt rewrites and a scanner retrain have happened since. Every accuracy claim in the
company still resolves to `pilot_test_v2.json`. The claims are not *wrong* exactly — they
are measurements of a world that no longer exists.

**Earliest observable signal.** `annotation.gold_set_freshness_days` crossing **30** for
any task type. Not 90, not 180 — 30, because the decay is invisible and the recovery cost
grows superlinearly. Second signal, equally cheap: a model or prompt change shipping with no
corresponding new gold examples in the same close-time.

**Counter-pressure.** Freshness is the team's *primary* metric, not size
([[annotation-ground-truth-charter]]), which makes stalling visible immediately rather than
in retrospect. Structurally: **a small standing quota beats a heroic batch** — a fixed,
small number of documents per week that survives a busy week, rather than a quarterly
session that gets cancelled. And a hard gate: no model or prompt change is declared
successful against a gold set older than its own last change
([[annotation-ground-truth-directive]]).

---

## M2 — Pre-labels were never actually reviewed, and the oracle became a mirror

`datasets/scripts/auto_annotate_subfields.py` exists to save time, and it should. The
workflow is: machine pre-labels, human confirms. Under time pressure, "confirm" becomes
clicking through a queue where the pre-labels are right 90% of the time. Attention decays
exactly as you would expect. The 10% that are wrong are disproportionately the *interesting*
cases — the ones where the model is confidently wrong, which are precisely the cases the
gold set exists to capture.

The gold set now agrees with the model on everything the model finds hard. Measured
accuracy is excellent and the field failures continue.

**Earliest observable signal.** Human-override rate on pre-labels falling toward the model's
own error rate — or worse, below it. Also a timing tell: median seconds-per-document
dropping sharply with no tooling change.

**Counter-pressure.** A **blind subset**: a fixed fraction of documents are labelled with no
pre-label shown, and agreement between blind and pre-labelled labelling is measured. When
the two diverge, the pre-label workflow is producing confirmation rather than verification.
Cheap, and it is the only way to detect this from the inside. Per-document time is logged;
speed that arrives without a tooling change is investigated, not celebrated.

---

## M3 — One annotator means agreement was never measurable, and idiosyncrasy became truth

There is one annotator today. Inter-annotator agreement is therefore not "low", it is
**undefined**. Every ambiguous call — is a wine list header a line item, does a modifier
belong to the dish above or below, is a handwritten total a total — gets resolved
consistently by one person, and consistency is indistinguishable from correctness when
n=1.

The scanner learns that person's conventions perfectly. Then a second annotator arrives, or
a customer disputes an extraction, and it turns out a whole class of labels encodes a
judgement call nobody knew was a judgement call.

**Earliest observable signal.** The absence itself: `annotation.inter_annotator_agreement`
having no value at all after the first quarter. Also, concretely: a **labelling guideline
document that does not exist** — if the conventions were only ever in one head, they were
never conventions.

**Counter-pressure.** Write the guideline **before** scaling annotation, not after — the act
of writing surfaces the judgement calls. Then a **double-labelled sample**: even 5% of
documents labelled twice (by the same person weeks apart, if there is only one person)
produces a real intra-annotator agreement number, which catches drift and ambiguity almost
as well as the inter- version. Every disagreement resolved becomes a line in the guideline.

---

## M4 — The correction loop closed on itself

`active_learning_service.py:14-17` describes the loop: *correction → accuracy tracker → rule
learner proposes patterns → benchmark validates → if improvement, merged into parser*. It is
a good loop, and it has one dangerous property: **it validates against a benchmark**. If the
benchmark ever shares provenance with the corrections — if a correction stream and the 200
gold-standard documents are drawn from the same pool, or if a benchmark document is later
corrected and the correction feeds the learner — the loop starts confirming itself.

Rules get merged because they improve a benchmark that they were derived from. Parser
accuracy rises monotonically, forever, which is the tell nobody reads as a tell.

**Earliest observable signal.** Monotonic benchmark improvement across many merges with no
regression ever. Real learning regresses sometimes. Also: any document present in both the
correction stream and the benchmark set — a set-intersection check that costs nothing to run.

**Counter-pressure.** **Hard partition**: the 200-document benchmark is frozen, its members
are excluded from the correction stream by ID, and the intersection is asserted empty every
run — not reviewed, asserted. A held-out set that the rule learner never sees under any
circumstances. And `annotation.correction_to_rule_conversion_rate` is watched from both
ends: near-zero means the loop is a data-entry job, near-one means it is accepting rules it
should be rejecting.

---

## M5 — Synthetic labels were promoted to gold because they were free

[[synthetic-generation-simulation-charter]] produces documents that come **with their own
answer key** (`scripts/docgen/truth.py`). Those labels are perfect, unlimited and free. The
argument for using them as gold is genuinely seductive: they are not guesses, they are
*true by construction*.

They are also true about a document that a machine composed. When the gold set is 80%
synthetic, "accuracy" measures how well the scanner reads documents generated by
`scripts/docgen/compose.py` — and the real-world gap shows up as
[[synthetic-generation-simulation-premortem]] M1, at which point both teams' numbers look
fine and the product does not work.

**Earliest observable signal.** The synthetic share of any evaluation set rising above a
stated cap. The cap must exist as a number *before* the pressure arrives; without one, each
individual increase is defensible.

**Counter-pressure.** Synthetic and human-verified are **different `source_guarantee`
values and are never summed** ([[data-directive]]). Reported separately, always, with a
stated cap on synthetic share in any set used to claim real-world accuracy. Synthetic data
is for *volume* — coverage of rare cases, regression breadth. Human gold is for *calibration*.
The backtest loop ([[synthetic-generation-simulation-loops]]) exists precisely to measure the
gap between them, and it cannot run if they are pooled.

---

## Cross-cutting

- **This team is upstream of the department's ability to detect its own failures.**
  [[corpora-enrichment-loops]] loop 3 (canaries) and
  [[synthetic-generation-simulation-loops]] (backtest fidelity) both consume a live gold set.
  M1 does not just harm this team — it blinds two others.
- **M1 is a resource decision, not a discipline problem.** It will not be fixed by wanting
  it more. [[annotation-ground-truth-agenda-full]] asks the founder the only question that
  matters: how many hours per month are real.
- **[[red-team-charter]]** attacks the decision to run on one annotator (M3) and the
  benchmark-partition design (M4).
- **60-day rule** ([[README]] §3.3): un-revisited, this document is fiction.
