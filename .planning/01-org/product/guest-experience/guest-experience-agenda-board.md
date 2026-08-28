---
type: agenda-board
division: product
department: guest-experience
parent_department: product-vision
status: active
metrics: [nf_b.ops_conversion, nf_b.subject_coverage, nf_b.false_merge_count, nf_b.k_anonymity_pass_rate]
updated: 2026-08-28
links: ["[[guest-experience-charter]]", "[[guest-experience-agenda-full]]", "[[guest-experience-premortem]]", "[[guest-experience-loops]]", "[[guest-experience-agent-stack]]", "[[guest-experience-questions]]", "[[guest-identity-consent-agenda-board]]", "[[taste-fingerprint-agenda-board]]", "[[consumer-app-points-economy-agenda-board]]", "[[guest-value-monetization-agenda-board]]", "[[0029-p3-plan-of-record]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0039-activation-plan-of-record]]"]
---

# Guest Experience — Board

**`nf_b.ops_conversion` = 0 (structurally — NF-B HELD, [[0029-p3-plan-of-record]] §3).**
First line, permanently, above every engagement number — [[guest-experience-premortem]] M1.
A bare `0` on this line is a failed run; the reason is part of the number.

> **ACTIVE — 2026-08-28.** 19 tasks in [[guest-experience-agenda-full]], all
> documentation. Nothing here writes a guest row or closes an open decision.

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

## Open questions across the sub-layer — the advisory delivery point

```dataview
TABLE open_questions, updated
FROM "01-org/product/guest-experience"
WHERE type = "questions"
SORT open_questions DESC
```

## Sibling departments in this division

```dataview
TABLE status, updated
FROM "01-org/product"
WHERE type = "charter" AND department != this.department
SORT department ASC
```

## Metrics — the set, never an average

- [ ] `nf_b.ops_conversion` — **0 (structurally — HELD)**
- [ ] `nf_b.subject_coverage` — **0 (structurally — no writer)**; app call sites re-verified **zero** 2026-08-28
- [ ] `nf_b.false_merge_count` — 0 · hard gate, permanent · **wired** (`.github/workflows/schema-parity.yml:185-212`)
- [ ] `nf_b.event_completeness` — undefined (no NF-B event has been emitted)
- [ ] `nf_b.k_anonymity_pass_rate` — undefined · threshold is not a code constant **and its founding value is unwritten** (GX-16)

## Teams

- [x] `guest-identity-consent` · **EXISTS** · active — defend and connect · GX-4 … GX-8
- [ ] `taste-fingerprint` · **PARTIAL** · wine-only; its stated entry trigger (OD-11) has fired, the hold is NF-B's · GX-9 … GX-12
- [ ] `consumer-app-points-economy` · **NEW** · unstaffed, gated on OD-05/OD-07 · GX-13 … GX-15
- [ ] `guest-value-monetization` · **NEW** · unstaffed; advertising verdict stands **BLOCKED** · GX-16 … GX-19

## Blocked on a founder call

- [ ] **OD-05 / OD-07** — now carrying a key-custody dimension added by [[0037-nfb-erasure-is-crypto-shredding]] (GX-13)
- [ ] Does the readiness dossier get its own `04-specs` file, with the retire-to-write pair named (GX-1)
- [ ] Does the `nf_b.ops_conversion` two-quarter stop-clock start at **activation** (GX-18)
- [ ] **PROD-F3** — monetization here or in Commercial
- [ ] The advertising boundary vs `ServicesPermissions.tsx:41,249` (GX-17a)

## Next three acts

- [ ] **GX-4** the key-custody question set → privacy-engineering · **2026-09-18**
- [ ] **GX-13** the OD-05/OD-07 branch brief, equal effort and no recommendation · **2026-09-25**
- [ ] **GX-7** the held-means-held guard, specified (build addressed to Engineering) · **2026-09-25**

## Standing verdicts

- Advertising design: **BLOCKED** until GX-17a exists (`cards.json` → `guest-value-gatekeeper`)
- Any NF-B caller: **refused** — the hold is a decision, not a backlog (ADR 0029 §3, §6.4)
