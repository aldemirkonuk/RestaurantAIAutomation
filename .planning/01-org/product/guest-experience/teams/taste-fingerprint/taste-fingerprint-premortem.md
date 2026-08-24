---
type: premortem
division: product
department: guest-experience
team: taste-fingerprint
status: provisional
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage, nf_b.novel_stimulus_hit_rate]
updated: 2026-08-24
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-directive]]", "[[taste-fingerprint-loops]]", "[[guest-identity-consent-charter]]", "[[guest-identity-consent-premortem]]", "[[guest-experience-premortem]]", "[[DISH_IDENTITY_DESIGN]]", "[[research-math-charter]]", "[[data-charter]]"]
---

# Taste Fingerprint (NF-B) — Premortem

> Written at founding, before success is assumed.

The team-doc line this expands ([[product]] §2.2): *"It ships a 'taste graph' built on
37 raw POS strings and one day of simulator traffic, personalization recommends the
ribeye to everyone because the ribeye is most of the corpus, and the model's
confidence is mistaken for the data's."*

It is 2027-08-24. Five mechanisms, most likely first.

---

## T1 — The model became a tag with a confidence interval

**The failure the founder's instruction exists to prevent, and the one that arrives
by default.** Nobody decides to build a tagging system. It arrives because tagging is
what is *cheap*: `cuisine: turkish`, `spice_tolerance: high`, `prefers: red`. Each
tag is individually defensible, each demos well, each is what a product manager can
read. Twelve months on, the "fingerprint" is a feature vector of categorical labels
with probabilities attached, and it cannot answer the only question that matters —
*why does this person like this, and what would change it?* It cannot predict a dish
it has never seen, and it cannot explain why two siblings diverge, because a tag has
no mechanism inside it to diverge with.

**Earliest observable signal.** `nf_b.novel_stimulus_hit_rate` never gets
instrumented. That is the discriminator: a mechanism predicts a dish nobody in the
corpus has eaten via compound overlap, and a tag **cannot score above chance**. A
model that quietly declines to be measured on unseen stimuli has already told you
what it is. Second signal, in the vocabulary: the words *category*, *label*, and
*tag* appearing where *weight*, *exposure*, and *baseline* should be.

**What would have prevented it.** `nf_b.novel_stimulus_hit_rate` instrumented from
the **first** model, before accuracy on seen items is ever reported — the order
matters, because once a seen-item accuracy number exists it becomes the number.
Plus a directive rule with no exception: every predicted preference must be
**decomposable into its exposure prior, its regional weight, its baseline delta, and
its per-person residual** ([[taste-fingerprint-directive]]). A prediction that cannot
be decomposed into those four is a tag, whatever it is called.

---

## T2 — We modelled 37 strings and believed it

Personalization ships on the measured corpus: 47 checks, one restaurant, one day, 37
distinct item strings, all simulator-produced ([[DISH_IDENTITY_DESIGN]] §1.1). The
model recommends the ribeye to everyone because the ribeye is most of the corpus. A
restaurant changes a par level on it. The first externally visible output of NF-B is
a wrong operational decision with our name on it — and worse, a *confidently* wrong
one, because model confidence is computed from the model's own fit and reads to
everyone as confidence about the world.

**Earliest observable signal.** The first NF-B insight rendered **without its n**.
Sample size disappears from artifacts for good UI reasons every single time, and it
is the exact moment the model's confidence detaches from the data's. Second signal:
any recommendation whose top item is also the corpus's modal item — cheap to check
automatically and nearly diagnostic on a corpus this thin.

**What would have prevented it.** Three things. (1) **Wine-only entry**, where
identity is deterministic and the corpus is real, rather than food-and-wine at 37
strings. (2) A rendering rule with no exception: **every guest-derived claim prints
its n, or it does not render** — and the sub-k empty state is designed early so
"not enough data yet" is a normal shippable state rather than an embarrassment
somebody routes around. (3) `nf_b.event_completeness` defined so it cannot be gamed
by counting: a rating with no identified dish has no `stimulus` and is therefore not
an event.

---

## T3 — Coverage pressure was exported to the identity team

This team cannot model at 3% subject coverage, and the reasoning is impeccable at
every step: we need subjects; the identity team refuses everything without an exact
verified key; that refusal is a *policy choice*; policies can be revisited; here is a
proposal for high-confidence matching. Every sentence is true and the conclusion is a
disclosure. **This team is the origin of [[guest-identity-consent-premortem]] F1**,
and it will not feel like an attack from inside — it will feel like unblocking.

**Earliest observable signal.** Any artifact from **this team** — a doc, a ticket, a
review comment — that names the merge rule as a cause of low coverage. Naming it as a
*constraint* is fine and correct. Naming it as a *cause* has already framed it as the
variable.

**What would have prevented it.** A hard directive rule: **this team never proposes a
merge-rule change, in any form, for any reason**
([[taste-fingerprint-directive]]) — the escalation path for insufficient subjects is
*more capture channels*, never *looser matching*. And the two teams stay separate
([[ORG_STRUCTURE]] §3): the structural defence is that the team feeling the pressure
does not hold the rule.

---

## T4 — Region became the answer instead of the prior

The most technically seductive failure. Regional exposure genuinely explains a large
share of variance — it is a *good* feature, which is exactly the problem. Fit
improves when the model leans on it. Individual residuals are small and noisy, so
regularization shrinks them toward zero, and every step is defensible ML practice.
The result: a guest from Oslo and a guest from Bergen get different recommendations,
two guests from Oslo get the same one, and the system is a **lookup table on region
with a personalization label on the button.** The founder's sibling constraint is
violated by ordinary good practice, silently, in a hyperparameter.

**Earliest observable signal.** `nf_b.divergence_within_cohort` trending toward zero
while overall accuracy improves. That combination is the tell, and it looks like
success on every other metric — which is precisely why the metric must exist *before*
the first model, not after someone asks whether personalization is working.

**What would have prevented it.** `nf_b.divergence_within_cohort` as a **gate, not an
observation**: a model that reduces within-cohort divergence relative to its
predecessor does not ship, even if accuracy improves. A metric that rewards
disagreement between similar people is uncomfortable and it is the only structural
defence, because the per-person free parameter must be **protected from regularization
by design**, not preserved by intention.

---

## T5 — The team was staffed while blocked, and produced documents

Dish identity is deferred (A15) and the corpus is 37 strings, so the food mandate is
unbuildable — but the team exists, so it produces roadmaps, schema proposals, and
model designs for data that will not arrive this year. By month six the org reads
"Taste Fingerprint" as the team that writes about modelling. Then, when A15 reverses
and there is real work, the credibility to ask for resources is gone.

**Earliest observable signal.** Two consecutive monthly agenda syncs where §Next steps
is unchanged and `updated` moved anyway — visible in the Dataview stale query in
[[guest-experience-agenda-board]].

**What would have prevented it.** **Wine-only entry with a written trigger for the
food track** ([[taste-fingerprint-charter]] §Entry trigger), so the team has one real
domain and one honest deferral rather than a full mandate and no data. And the
anti-sprawl rule applied to units, not only to skills: an agenda that has not changed
in 60 days is either finished or fiction, and this team names which.

---

## The one that would end it

**T1 and T4 are the same failure at different depths**, and together they are the one
that matters — because they produce a *working system* that is not the thing that was
asked for. T2 embarrasses us once and is caught by printing n. T3 is dangerous but has
a structural defence in the org chart. T5 wastes a year.

T1/T4 quietly deliver a regional-average recommender that scores well, demos well,
and is exactly what the founder's instruction ruled out. The only defences that work
against a failure that improves every conventional metric are the two unconventional
ones: **`nf_b.novel_stimulus_hit_rate`** and **`nf_b.divergence_within_cohort`**, both
instrumented **before the first model**, both treated as gates rather than
observations.
