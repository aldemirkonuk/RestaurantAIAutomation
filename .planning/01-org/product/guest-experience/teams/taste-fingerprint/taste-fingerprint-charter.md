---
type: charter
division: product
department: guest-experience
team: taste-fingerprint
status: partial
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage, nf_b.exposure_prior_coverage]
updated: 2026-08-24
links: ["[[taste-fingerprint-premortem]]", "[[taste-fingerprint-agenda-full]]", "[[taste-fingerprint-agenda-board]]", "[[taste-fingerprint-directive]]", "[[taste-fingerprint-loops]]", "[[taste-fingerprint-schedule]]", "[[guest-experience-charter]]", "[[guest-identity-consent-charter]]", "[[consumer-app-points-economy-charter]]", "[[guest-value-monetization-charter]]", "[[0006-neural-footprint-architecture]]", "[[DISH_IDENTITY_DESIGN]]", "[[data-charter]]", "[[research-math-charter]]", "[[analytics-bi-charter]]", "[[OPEN-DECISIONS]]", "[[README]]", "[[product]]"]
---

# Taste Fingerprint (NF-B) — Charter

> **PARTIAL, and honestly blocked.** The food half of this team's mandate is
> unbuildable by explicit product-owner decision (A15) over a corpus of **37 distinct
> item strings**. The wine half is buildable today. This charter says so before it
> says anything else.

## Mandate

Own the guest **food-identity profile**: the durable trace of *exposure → choice →
repeat → rating*, in context — region, season, companions. This **is** NF-B
([[README]] §4.2).

And own it at **mechanism level**. The founder's instruction is explicit and it is
the hardest constraint in this charter: model flavour **like chemistry or immunology,
not like generic tagging**. "Likes spicy food" is a tag. A tag is a summary of the
past that cannot predict a new stimulus, cannot explain why two people with the same
tag diverge, and cannot be wrong in an interesting way. This team's output must be a
**mechanism** — something that says why a preference exists, what would change it,
and what it predicts about a dish nobody in the corpus has eaten.

## The mechanism model — what "not generic tagging" means concretely

[[0006-neural-footprint-architecture]] fixes the recorded shape:
**stimulus → internal state → choice → outcome**, identical to NF-A. Four mechanisms
fill it. Each is falsifiable, and each has a metric that catches it degrading back
into a tag.

### 1. Exposure is a dose–response curve, not an attribute

A tag says *likes chili*. The mechanism says: repeated exposure to a compound class
at frequency **f** over duration **d** shifts the **likability weight** for that
class, and the shift is **asymmetric** — acquired tolerance builds slowly and decays
slower still. This is the immunological analogy taken literally rather than
decoratively: prior exposure is *sensitization*, and what it produces is a **prior**,
not a verdict.

Two consequences that a tagging model cannot express: (a) exposure raises likability
**up to a satiation point, past which it inverts** — the guest who ordered the ribeye
eleven times is the guest most likely to order something else next; (b) a novel dish
is predictable from its **compound overlap** with the exposure history, so the model
can say something about a dish nobody in the corpus has eaten. A tag cannot.

### 2. Regional exposure is a likability weight, not a label

Region does not enter as a categorical feature — that is tagging with geography. It
enters as the **population baseline of prior exposure**: the set of flavour compounds
an individual from that region has been repeatedly exposed to, and therefore the
starting weights before any observation of *this* person. Region sets the prior.
It never sets the posterior. The moment a region determines an output, the model has
become a lookup table wearing a personalization label.

### 3. Tourist adaptation is a trajectory relative to a **local baseline**

The same choice carries different information depending on whose it is. A guest from
Istanbul ordering lahmacun in Istanbul is close to a **null observation** — it is
what the local baseline predicts. A guest from Oslo ordering it in Istanbul is
**high-information**: it is a measured departure from *their* baseline toward the
local one.

So the `context` field must carry the **home-region baseline**, not merely the
current region, and the modelled quantity is the **delta between the two** and how it
moves across a visit. Without the home baseline the observation is not weakly
informative — it is **uninterpretable**, and averaging uninterpretable observations
is exactly how a personalization system becomes a regional average.
Metric: `nf_b.tourist_delta_coverage`.

### 4. Individual divergence — the sibling constraint

Two people raised in the same house, with the same cuisine, the same table, the same
decade of exposure, **diverge**. Any model that cannot represent that is doing
regional averaging under another name. Structurally this means the model carries a
**per-person free parameter that exposure cannot explain** — the analogue of
individual receptor variation, unmeasurable for us and precisely why the parameter
must exist rather than be fitted away.

**The falsifiable statement this team is judged on:** *if two guests with identical
exposure histories receive identical recommendations, the model is not personalizing.*
Metric: `nf_b.divergence_within_cohort`. It is the one number that catches the
failure mode the founder named, and it is deliberately a metric that **rewards
disagreement between similar people** — the opposite of what an accuracy metric
rewards.

> **Personalization is per-person, not per-region-average.** Everything above exists
> to make that sentence enforceable rather than aspirational.

## Why distinct

**From [[guest-identity-consent-charter]]:** 2.1 answers *who*, this answers *what
they like* — and they have **opposite risk postures**. 2.1 is measured on refusing to
guess; this team is measured on modelling. One team holding both lets the model's
appetite for data set the identity team's merge threshold, which is the exact conflict
[[ORG_STRUCTURE]] §3 cites for keeping Red Team out of Security. This team is the
*source* of the pressure named in [[guest-identity-consent-premortem]] F1, and saying
so plainly in its own charter is part of the defence.

**From [[research-math-charter]]:** they own NF-A methodology and modelling technique
in general. This team owns the **guest** subject and the domain mechanism — what a
compound class is, what a satiation point means, what a home baseline is. Technique
is theirs; food is ours.

**From [[analytics-bi-charter]]:** they own the metrics narrative and how a segment is
defended. This team owns the individual, not the segment. The moment a person becomes
a segment, it is theirs.

## Boundaries

- The **NF-B event contract** — what fills `stimulus`, `internal_state`, `choice`,
  `outcome`, `context` for a guest, and what does **not** qualify as an event.
- The **completeness definition** and the right to refuse to count.
- The four mechanisms above, and the metrics that keep them from collapsing into tags.
- The **wine-only track**, where identity is deterministic today.
- The honest statement of what the corpus does and does not support — which is
  currently this team's largest deliverable.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Dish identity resolution** | [[data-charter]] — **deferred** by A15 ([[DISH_IDENTITY_DESIGN]]) | We are its loudest consumer and we do not relitigate a product-owner decision by building around it. Building a taste graph over raw strings *is* building around it. |
| Guest merging, identity keys, consent | [[guest-identity-consent-charter]] | Explicitly: this team never proposes a merge rule change, in any form, for any reason. |
| Rendering guest data to restaurants, k-anonymity | [[guest-value-monetization-charter]] | We model individuals; they render groups. |
| The app that produces the signal | [[consumer-app-points-economy-charter]] | We define what a usable event looks like; they build the surface that emits it. |
| NF production columns, indexes, retention | [[data-charter]] under **OD-11** | Open. We are blocked on it and do not pre-empt it. |
| Modelling technique, NF-A | [[research-math-charter]] | |

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `nf_b.event_completeness` | % of NF-B events carrying **all four** of `stimulus`, `choice`, `outcome`, `context` | undefined — no NF-B event has been emitted |
| `nf_b.divergence_within_cohort` | Spread of predicted preference among guests with **identical exposure history**. Collapse toward zero = regional averaging | undefined — **the sibling constraint, made measurable** |
| `nf_b.tourist_delta_coverage` | % of events whose `context` carries a **home-region baseline** | undefined — without it a visitor's choice is uninterpretable |
| `nf_b.exposure_prior_coverage` | % of subjects with enough exposure history for the prior to be non-degenerate | undefined |
| `nf_b.novel_stimulus_hit_rate` | Prediction accuracy on dishes the guest has **never** encountered | undefined — **the tag/mechanism discriminator**: a tag cannot score above chance here |

**A rating with no identified dish is not an NF-B event.** Counting it as one is how
this metric lies ([[product]] §2.2), and it is exactly what the current corpus would
force.

## Evidence today — **PARTIAL**

### Defined, not built

- Event shape defined ([[README]] §4.4) and NF-B named a **priority** track
  (`README.md:206`).
- Storage architecture **resolved** — OD-11a: narrow polymorphic production table
  (`subject_type` ∈ `agent | guest | bio`) + wide append-only research log
  ([[0006-neural-footprint-architecture]]). The research store is *deliberately wide
  and never migrated*, which is the property that makes mechanism-level modelling
  affordable: new mechanism fields are added, old rows keep their shape.
- **Column contract still open — OD-11.** No NF-B event can be written until it
  closes.

### ⛔ Blocked, by decisions already made

- **Dish identity is DEFERRED**, register A15, 2026-08-20, explicit product-owner
  call: *"this is a later on issue … for now stick with defer, keep raw strings"*
  ([[DISH_IDENTITY_DESIGN]]). Dishes remain raw POS strings, so `"Ribeye 12oz"` and
  `"Ribeye"` are different entities to any `GROUP BY` (§1). **A taste fingerprint over
  food cannot exist until this reverses.** Not "is harder" — cannot exist, because
  `stimulus` has no referent.
- **The corpus, measured** ([[DISH_IDENTITY_DESIGN]] §1.1, 2026-08-20): 47
  `pos_checks`, **1** restaurant, **one day** (2026-08-11 → 2026-08-11), 82 line
  items, **37 distinct item strings**, **no food/dish/recipe/ingredient table in the
  schema at all**, `menu_items` wine-only.
- **The subject side is empty too.** `nf_b.subject_coverage` is structurally 0% —
  no application code writes the identity tables ([[guest-identity-consent-charter]]).
  Even with dish identity resolved, there is currently **nobody to attribute a choice
  to**.

### EXISTS — the wine exception, and it is the whole opening

`master_wine_library` plus deterministic beverage identity is the strongest data
layer in the repo (`README.md:64`), and enrichment is in flight — commits `f7e0ea1`
(producer reputation at 100% menu-corpus coverage) and `ef19b81` (144/1,448 wines).
Wine is the one domain where `stimulus` has a **real, deterministic referent**: a
bottle is identified by producer + name + residual tokens, and that key was measured
at **0 false merges over 732,874 pairs**.

Wine is also unusually well-suited to the mechanism model rather than merely
available: grape, region, vintage, and producer style are **compositional** in the
way the dose–response mechanism needs. Compound overlap between two Barolos is a real
quantity, not a tag similarity. **This team enters wine-only, and that is a
strength, not a consolation.**

## Entry trigger

**Wine-only track: enters when OD-11's column contract closes.** Nothing else is
required — the identity layer is deterministic and the corpus exists.

**Food track: `status: new`, and its entry trigger is explicit —**
*A15 is reversed by the product owner **and** a dish-identity referent exists.*
Corpus depth alone does not open it; a million checks of raw strings is a million
uncountable events. Until then this team's food output is a single honest sentence
about what cannot be modelled, repeated as often as it is asked for.
