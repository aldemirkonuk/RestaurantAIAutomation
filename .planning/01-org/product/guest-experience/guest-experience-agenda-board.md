---
type: agenda-board
division: product
department: guest-experience
parent_department: product-vision
status: provisional
metrics: [nf_b.ops_conversion, nf_b.subject_coverage, nf_b.false_merge_count]
updated: 2026-08-24
links: ["[[guest-experience-charter]]", "[[guest-experience-agenda-full]]", "[[guest-experience-premortem]]", "[[guest-experience-loops]]", "[[guest-identity-consent-agenda-board]]", "[[taste-fingerprint-agenda-board]]", "[[consumer-app-points-economy-agenda-board]]", "[[guest-value-monetization-agenda-board]]"]
---

# Guest Experience — Board

> **PROVISIONAL — no work done yet.**

**`nf_b.ops_conversion` = 0.** First line, permanently, above every engagement
number — [[guest-experience-premortem]] M1.

## Every unit in this sub-layer

```dataview
TABLE status, type, updated
FROM "01-org/product/guest-experience"
WHERE type != "agenda-board"
SORT status ASC, updated DESC
```

## Anything stale — a unit whose agenda has not moved in 60 days is finished or fiction

```dataview
TABLE department, team, status, updated
FROM "01-org/product/guest-experience"
WHERE type = "agenda-full" AND updated <= date(today) - dur(60 days)
SORT updated ASC
```

## Sibling departments in this division

```dataview
TABLE status, updated
FROM "01-org/product"
WHERE type = "charter" AND department != this.department
SORT department ASC
```

## State

- [x] Charter written · **PARTIAL** — one of four teams has shipped code
- [ ] `nf_b.subject_coverage` — **structurally 0%**, no application code writes the identity tables
- [ ] `nf_b.false_merge_count` — 0 · hard gate, permanent · CI gate exists, **not wired**
- [ ] `nf_b.event_completeness` — undefined, no NF-B event emitted
- [ ] `nf_b.ops_conversion` — 0
- [ ] `nf_b.k_anonymity_pass_rate` — undefined, threshold not yet a code constant

## Teams

- [x] `guest-identity-consent` · **EXISTS** · activate now — defend and connect, do not extend
- [ ] `taste-fingerprint` · **PARTIAL** · wine-only entry · food blocked by A15
- [ ] `consumer-app-points-economy` · **NEW** · unstaffed · gated on **OD-07**
- [ ] `guest-value-monetization` · **NEW** · unstaffed · advertising has zero groundwork

## Blocked on a founder call

- [ ] **OD-07** Beli — build independently vs collaborate · this sub-layer takes no position
- [ ] **OD-11** NF column contract — ⚠️ must answer the `recommendation_actions` subject-type question *before* it closes
- [ ] **PROD-F3** Monetization here or in Commercial
- [ ] Advertising boundary vs `ServicesPermissions.tsx:41,249`
- [ ] Is `nf_b.ops_conversion` = 0 for two quarters a scope-review trigger

## Next three acts

- [ ] Wire `scripts/eval_guest_merge_policies.py` into CI while it still passes trivially
- [ ] Provision the `guest_identifier_pepper` vault secret, then build one write path
- [ ] Fix the k-threshold as a code constant with a CI guard; design the sub-k empty state
