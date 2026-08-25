# Dish identity — design, and why it is deliberately not built yet

**Register item:** A15
**Status:** **DEFERRED.** Dish identity stays a raw POS string.
**Decision date:** 2026-08-20
**Decided by:** product owner, explicitly — "this is a later on issue … for now
stick with defer, keep raw strings."
**Companion documents:** `BEVERAGE_CATALOGUE_ARCHITECTURE.md` §3 (deterministic
identity), §10.2 (the interaction side), §10.5 (what each ML target requires);
`BEVERAGE_CATALOGUE_PLAN.md` §8 register A11/A15.

This document exists so that deferring is a *decision with a design behind it*
rather than a gap someone rediscovers in a year. It records what is true today,
what would have to be built, and — most importantly — **what must not be built,
because the obvious approach is the one that is provably wrong.**

---

## 1. What is true today

`pos_checks.items` is a JSONB array, one row per closed check, populated
unconditionally at `pos-hub.service.ts:168/202`. Every line is captured — wine
and food alike. `table-analytics.service.ts:416` (`getBasketAffinity()`) already
runs lift-based market-basket pairing across those names with no `is_wine`
filter.

So pairing is not blocked by storage. It is blocked by identity: `"Ribeye 12oz"`
and `"Ribeye"` are different entities to any `GROUP BY`.

### 1.1 The measured baseline (2026-08-20)

| Measurement | Value |
| --- | --- |
| `pos_checks` rows | **47** |
| Distinct restaurants represented | **1** |
| Date span of all POS data | **2026-08-11 → 2026-08-11** (one day) |
| Checks carrying at least one line item | 46 |
| Total line items across all checks | **82** |
| Distinct item-name strings | **37** |
| Food/dish/recipe/ingredient tables in the schema | **none** (`cocktail_ingredients` is beverage-side) |
| `menu_items` scope | wine-only — no food menu exists |

Query used, for re-measurement later:

```sql
SELECT count(*) FROM pos_checks;
SELECT count(DISTINCT it->>'name')
  FROM pos_checks, jsonb_array_elements(coalesce(items,'[]'::jsonb)) it;
```

**Read that table before arguing for building this.** Thirty-seven distinct
strings, from one restaurant, on one day, is not a corpus. Any dish-identity
policy fitted to it would be fitted to noise, and — worse — would *look* like it
worked, because at n=37 a human can eyeball the output and confirm it. That is
the shape of every premature schema in this codebase's history.

---

## 2. Why the beverage playbook cannot simply be re-run

Beverage identity is trustworthy for one reason, and it is not the cleverness of
the key. It is that the key was **measured against 732,874 known-distinct pairs**
before it was adopted (arch §3). Those negative labels were free: two different
entries printed on one restaurant's wine list are, by construction, two different
products. That gave a falsifiable test, and it falsified the first three designs
— including a fuzzy-similarity threshold that looked excellent and produced 212
false merges.

**For dishes, that negative-label source does not exist.** There is no food menu
in the schema. Nothing enumerates "these N things were simultaneously offered by
this restaurant and are therefore pairwise distinct."

This is the single most important sentence in this document: *without a negative
set, any dish-matching policy is unfalsifiable, and an unfalsifiable merge policy
is exactly the failure mode arch §3.9 prices at roughly 100:1.*

### 2.1 The two candidate negative sources, and their costs

| Source | How it works | Why it is not ready |
| --- | --- | --- |
| **Food menu** (the direct analogue) | Two distinct dish names on one restaurant's current menu are different dishes | No food menu table exists. `menu_items` is wine-only. Building one is a product surface — menu ingestion, curation, ownership of staleness |
| **Same-check pairs** | Two distinct item names on one check are *probably* different dishes | Noisier: a check legitimately contains `"Ribeye"` and `"Ribeye, med rare"` — the same dish entered twice with different modifier text. That is precisely the pair we would *want* merged, so it poisons the negative set. Usable only with an `is_artifact()`-style filter, the way `build_merge_eval_set.py` already handles the producer-echo case for bottles |

Same-check pairs are the cheaper path and become viable on volume alone. At 46
checks they yield a negative set too small to distinguish policies.

---

## 3. The trap: the obvious normalization is a false-merge machine

Every instinct says: normalize the string, strip the size and preparation
qualifiers, group what remains. **Do not do this.** It is the same mistake §3.0
records for bottles, in a new costume.

```
"Ribeye 12oz"   vs  "Ribeye 16oz"     ← different dishes, different prices
"Pappy 12"      vs  "Pappy 15"        ← different bottles, $60 vs $80
```

Stripping `12oz`/`16oz` merges two menu items that a restaurant prices, stocks
and pairs differently. The measured beverage analogue is unambiguous: a fuzzy
policy at 0.85 produced **212 false merges**, and even at 0.98 produced one —
because the worst true match scored 0.919 while the worst *false* pair scored
0.979. The distributions overlap. **No threshold separates them.** There is no
reason to expect dish strings to be better behaved than bottle strings; they are
shorter, more abbreviated, and more modifier-laden, so expect worse.

The corollary that must survive into whatever gets built:

> A token you do not understand is a token you must not discard.
> Incompleteness has to fail safe — toward a false *split*, never a false merge.

---

## 4. The design, for when it is picked up

Staged, so each stage is independently abandonable and none of them requires the
next one to have been built.

### Stage 0 — Create the negative-label source *(prerequisite, not optional)*

Either ingest food menus (giving true same-menu negatives), or accumulate enough
POS volume that same-check pairs, filtered for modifier artifacts, yield a set
large enough to separate policies. Until one of these exists, stop here.

**Exit criterion:** a labelled set on the order of 10⁴–10⁵ known-distinct pairs,
built by a script that lives in the repo and is re-runnable — the direct analogue
of `scripts/build_merge_eval_set.py`.

### Stage 1 — Measure candidate policies before choosing one

Port `scripts/eval_merge_policies.py`. Same output shape, same CI gate, same
non-negotiable pass condition:

```
GATE: 0 false merges across the known-distinct set, or the policy is rejected.
```

False splits are reported and tolerated; false merges fail the build. Candidate
policies to score, at minimum: exact normalized string, residual-token key
(below), trigram similarity at several thresholds, embedding cosine at several
thresholds. Expect the fuzzy ones to lose — but *measure it*, because "the first
draft was falsified by measurement" is what happened last time and is the reason
the current key is trusted.

### Stage 2 — The `dish_key`

The residual-token construction, transposed from bottles to dishes:

- Normalize (lowercase, strip diacritics, collapse non-alphanumerics) using a
  function with **one home**, shared by SQL and any Python that touches it —
  `beverage_normalize_text()` is the existing precedent, and the reason it exists
  is that `wine_normalize_text()` expanded abbreviations and silently diverged
  from the validated Python on 67 of 4,822 entries.
- Identify base tokens (the dish noun) and retain the **complete multiset of all
  remaining tokens** — sizes, cuts, preparations, modifiers, everything.
- The key is base + residual multiset. Two strings collide only when nothing
  whatsoever distinguishes them.

`"ribeye 12oz"` and `"ribeye 16oz"` produce different keys. `"ribeye"` and
`"ribeye 12oz"` also produce different keys — a false split, which is the correct
direction to fail. It is surfaced for human review, not silently merged.

Implement as `GENERATED ALWAYS AS (...) STORED`, never as a trigger and never in
application code — see arch §4.1 and register A12 for why a direct write must
error at 42601 rather than be silently discarded.

### Stage 3 — Promotion to a `dishes` entity, if and only if it earns it

Only once dish-level pairing is in real use, and following arch §4's promotion
rule: promote the category that has earned query pressure, not all of them
preemptively. A `dishes` row would carry the canonical name, the restaurant
scope, and — the actual prize — ingredients, which is what makes
ingredient-level pairing reachable at all.

**Scope note.** Unlike bottles, a dish is *restaurant-scoped*. A bottle is the
same object in every restaurant that pours it, which is what justifies the global
`master_wine_library`. "Ribeye" at two restaurants is two different dishes with
different recipes. Do not reach for the global-identity pattern here; it does not
transfer.

---

## 5. What is safe to do today, at zero cost

- **Keep capturing.** Every closed check already persists every line item. The
  raw strings are the raw material for Stage 0 and cost nothing to accumulate.
  Nothing in this deferral should be read as a reason to stop or thin ingestion.
- **Keep `getBasketAffinity()` as it is.** Lift over raw names is honest at this
  volume: it reports co-occurrence of *strings*, and it does not claim to report
  co-occurrence of *dishes*.
- **Do not add a normalization step "just to tidy things up."** A normalization
  that merges is a merge policy, whether or not anyone calls it one, and it would
  be shipping unmeasured. This is the specific way this defect will try to enter
  the codebase.

---

## 6. Premortem — how this goes wrong later

**D1 — Someone ships normalization as a "cleanup."** A well-meaning change strips
sizes and pluralization inside a query or a service helper. No migration, no
review, no eval set. Pairing quality degrades invisibly, because merged dishes
produce *more* co-occurrence data and therefore look statistically stronger.
*Prevention:* this document, plus the Stage 1 gate — any grouping policy must be
scored against a negative set before it lands.

**D2 — Dish identity is built on the 37 strings.** The design is fitted, verified
by eyeball, and enshrined. Six months and 40 restaurants later it is wrong in
ways nobody can unpick because downstream aggregates already depend on it.
*Prevention:* the Stage 0 exit criterion is a volume threshold, not a date.

**D3 — Dishes get the global-identity treatment by pattern-matching.** Someone
sees `master_wine_library` and builds `master_dish_library`, creating a
cross-tenant path where one restaurant's recipe edits alter another's pairing
data. *Prevention:* §4 Stage 3's scope note, stated before anyone starts.

**D4 — The deferral is forgotten and re-derived.** Someone rediscovers "there's
no dish entity" and treats it as an oversight, redoing this analysis from
scratch. *Prevention:* register A15 links here; this file states the decision,
the date, and who made it.

---

## 7. When to revisit

Revisit when **any** of these becomes true:

1. A food menu exists in the schema (ingested or curated) — the negative-label
   source appears, and Stage 0 is satisfied for free.
2. `pos_checks` passes roughly 10⁴ rows across more than one restaurant and more
   than one month — same-check negatives become viable.
3. A restaurant asks for dish-level pairing as a product feature, at which point
   the volume question gets answered by whether that restaurant has the data.

Until then, `A15 = deferred` is the correct state, and re-measuring §1.1 is the
whole of the work.
