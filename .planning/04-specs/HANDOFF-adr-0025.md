---
type: handoff
title: Citation pairing — three anchors this branch could not fix
branch: feat/adr-0025-locked
updated: 2026-08-26
links: ["[[../decisions/0025-citations-must-disagree-loudly|ADR 0025]]", "[[../06-pages/privacy|privacy]]", "[[../06-pages/settings|settings]]"]
---

# HANDOFF — ADR 0025 §6 (citation pairing)

ADR 0025 §6 is locked. `scripts/check_citation_pairing.py` enforces it and the
`decision-claims` CI job runs it. This branch repointed **74** broken citations.

**Three it did not touch**, because a concurrent branch owns the six page dossiers
(`communications.md`, `notifications.md`, `privacy.md`, `receipts.md`,
`recommendations-catalog.md`, `settings.md`) and two branches rewriting the same
lines produces a conflict, not a fix. They are on `PAIRING_DEBT` in the checker so
CI is green either way, and this file is the fix list.

Retire-to-write (`CLAUDE.md` §4): paid by the 469 archive files this branch
deleted under ADR 0025 §7.

---

## 1. The three citations, and what each should say

Line numbers are from the register as it stood at `origin/main` = `4c6eb6d2` on
2026-08-26. **Re-run the checker before applying** — it prints the correct line for
every id, and the register moves under almost a quarter of all commits.

| # | File | Cites | Anchored at register line | That line is | Correct line |
|---|---|---|---|---|---|
| 1 | `06-pages/privacy.md:59` | OD-27 | 123 | OD-28 | **125** |
| 2 | `06-pages/privacy.md:129` | OD-27 | 123 | OD-28 | **125** |
| 3 | `06-pages/settings.md:123` | OD-86 | 78 | OD-81 | **82** |

Rows 1 and 2 are **defect #3 in ADR 0025 §2** — the anchor pair that was never
correct, and the reason the ADR exists. Fixing them closes the example that
motivated the rule.

Write them in the canonical form, id first:

```
OD-27 (.planning/decisions/OPEN-DECISIONS.md:125)
OD-86 (OPEN-DECISIONS.md:82)
```

Any form works as long as the id sits within 120 characters of the locator on the
**same line** — `OD-27, OPEN-DECISIONS.md:125` inside an existing parenthesis reads
better than nesting a second one.

## 2. Then delete the debt entries

`PAIRING_DEBT` in `scripts/check_citation_pairing.py` has two keys:

```
.planning/06-pages/privacy.md::OD-27
.planning/06-pages/settings.md::OD-86
```

Once the citations are fixed, **delete both lines and the block comment above
them.** The checker will print a `PRUNE ME` notice until you do.

That notice does **not** fail the build, and that is deliberate: this list exists
so two PRs can land in either order without turning main red. It is the one place
this repo's guards are softer than `KNOWN_MISSING` in
`scripts/check_queried_tables_exist.py`, which fails on a stale entry. The softness
is a real cost and it is bounded by the list being emptied. **If these two lines
are still here in a week, the list has become the thing it was built to avoid.**

## 3. One thing found while fixing anchors that anchors cannot fix

`01-org/intelligence/security/security-charter.md:125-126` says the **94**-endpoint
figure is *"current, verified row-by-row against `ENDPOINTS.md` and now canonical
in"* OD-19. The anchor is now correct — it points at OD-19's row. **The sentence is
not.** OD-19 was re-measured on 2026-08-26 and now reads **40**, with the 94 struck
through in the register itself.

This is defect #2 from ADR 0025 §2, exactly as the ADR predicted: every locator in
the paragraph resolves and the prose still lies. No locator mechanism catches it.
It belongs to `CLAIMS.jsonl` or to nothing, and it is left here rather than fixed
silently because ADR 0025 §6.4 says so in as many words.

Not this branch's to fix — it is a Security-department number, and correcting it
means re-reading the census, not editing a citation.
