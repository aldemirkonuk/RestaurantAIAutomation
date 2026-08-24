---
type: moc
title: Decision Index
updated: 2026-08-24
links: ["[[HOME]]", "[[AGENDA]]", "[[PLAN]]", "[[ORG-MAP]]", "[[GLOSSARY]]"]
---

# Decision Index

> The vault's navigational view of the decision layer. **Nothing here is canonical.**
> Each ADR file is canonical for its own decision; [`decisions/README.md`](../decisions/README.md)
> is the prose log; [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md) is the register of
> everything still undecided. This page exists so you can find them, not so you can read them here.

## 1. Locked ADRs

Eight ADRs, all dated 2026-08-24 — the restructuring chapter produced the entire log in one day.

| # | Subject | Binds | Status |
|---|---|---|---|
| [0001](../decisions/0001-mudavym-single-entity.md) | Mudavym is **one entity**; modules are internal softwares, not sibling companies | Brand, org, legal shape | **Locked** |
| [0002](../decisions/0002-documentation-first-operating-mode.md) | **Documentation-first** operating mode + ADR discipline | `CLAUDE.md` §0, this whole layer | **Locked** |
| [0003](../decisions/0003-session-output-discipline.md) | **Low per-session output footprint**, branch-per-operation | How every session is run | **Locked** |
| [0004](../decisions/0004-obsidian-as-backlink-layer.md) | **Obsidian** adopted as the documentation backlink layer | The vault, Dataview, Graphify | **Locked** — header still reads *"mechanics open under OD-08"*; OD-08 was folded into OD-21 and resolved. ⚠️ stale |
| [0005](../decisions/0005-v3-to-v0-version-reset.md) | v3 internal build → deliberate **v0 production reset** | Versioning, milestones | **Locked** |
| [0006](../decisions/0006-neural-footprint-architecture.md) | **Neural Footprint architecture** — narrow production store + wide append-only research log; NF-C gated | L4, the metric spine | **Locked** — header still reads *"column-level schema open under OD-11"*; ADR 0008 closed it. ⚠️ stale |
| [0007](../decisions/0007-org-structure.md) | **Org** — 7 divisions, 19 departments, 2 sub-layers, 3 findings-only advisory functions, unit anatomy | Every unit in `01-org/` and `02-advisory/` | **Locked** |
| [0008](../decisions/0008-nf-column-contract.md) | **NF column contract** — full ADR 0006 shape now (Path C). Claude recommended A; the founder overruled | The P1 schema, `subject_type` | **Locked** — supersedes the open half of OD-11 |
| [0009](../decisions/0009-loop-vocabulary-contract.md) | **Loop vocabulary contract** — §5.1's table is the source of truth and a hard CI gate; `active`/`running` must cite evidence | All 482 loops, [[LOOP-MAP]], `ci.yml` | **Locked** — closes OD-47; live loops 6 → 5 |

**Two ADR headers are stale** (0004, 0006): both still advertise an open fork that has since
been resolved. A reader who trusts the header will believe a settled question is open. Fixing
this is a one-line edit per file, and it belongs to the Decision Office.

Decisions locked **before** this log existed live where they were written (brand, expansion
sequence, camera stack, `BaseAgent` extension). They are indexed — not copied — in
[`decisions/README.md` §"Locked — recorded elsewhere"](../decisions/README.md).

## 2. Live query — and why it is empty

```dataview
TABLE status, date, deciders
FROM "decisions"
WHERE type = "adr"
SORT file.name ASC
```

**This query returns zero rows today, and that is a defect, not a design.** No file in
`decisions/` carries YAML frontmatter — every ADR opens with an `# NNNN — Title` heading and a
bullet list (`- **Status:** Locked`). [`OBSIDIAN_VAULT.md` §3](../foundation/OBSIDIAN_VAULT.md)
declares `adr` as a valid `type:` value, but nothing instantiates it, so the decision layer sits
outside the Dataview graph while all 793 org documents sit inside it.

The query above is written against the *intended* shape so it starts working the moment
frontmatter is added. Until then the table in §1 is hand-maintained and will go stale — exactly
the failure Dataview was adopted to prevent. **This is a fork worth filing:** add
`type: adr / status / date / deciders / supersedes` frontmatter to the 8 ADRs (mechanical), or
accept a hand-maintained index and say so.

Loops and units, by contrast, *are* queryable:

```dataview
TABLE WITHOUT ID status AS "Unit status", length(rows) AS Units
FROM "01-org" OR "02-advisory"
WHERE type = "charter"
GROUP BY status
```

## 3. The open register

**[`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md) is canonical and this section does not
copy it.** Its rows carry the question, why it matters now, and what unblocks it — three things
that lose their meaning the moment they are summarised. Read it there.

What is worth knowing *about* the register rather than from it:

- It is a **queue with a fill-to-drain problem.** [[PLAN]] §0 records the ratio measured at 7:1.
- Several items were raised by review agents **against Claude's own work** (OD-28, OD-30,
  OD-32, OD-41). The register is the corpus's self-correction mechanism, not just a founder inbox.
- The 🔴 items are security or spend exposures, not planning questions. They do not wait on a
  restructure.
- [[AGENDA]] §"Waiting on the founder" is the *acted-on* subset — the items whose cost of waiting
  is being paid right now. The register is the full set.
- **The single highest-leverage entry is OD-11's downstream work, not OD-11 itself**: ADR 0008
  locked the column contract, so what remains is building P1. See [[PLAN]] §1.

## 4. How a decision moves

```
   ⬦ fork raised                 a session hits a genuinely open question
        │                        (CLAUDE.md §0.1 — if it is not written down, it is open)
        ▼
   OPEN-DECISIONS row            ID · question · why it matters now · what unblocks it
        │                        the session does every part that does not depend on it
        ▼
   founder call                  only a founder call moves an item out of the register
        │                        (advisory functions produce findings; they do not decide)
        ▼
   ADR NNNN-slug.md              context · options considered · decision · rationale ·
        │                        rejected alternatives · consequences
        ▼
   Resolved row                  the register keeps the item, links the ADR, records the date
                                 — nothing is ever silently deleted
```

Four rules that make the pipeline honest:

1. **A fork must be filed the moment it is found**, not batched to the end of a research pass
   (`CLAUDE.md` §3). Batching is how a fork becomes a silent default.
2. **A decision made in chat and not written down did not happen** (`CLAUDE.md` §0.2).
3. **Rejected alternatives are part of the record.** An ADR that lists only the winner cannot be
   revisited, only re-argued from scratch.
4. **Locked is binding, and disagreement is loud.** If a locked decision is wrong, propose
   superseding it in writing — do not quietly work around it (`CLAUDE.md` §5).

Not every resolved row becomes an ADR. Several — OD-12, OD-17, OD-47 — were recorded directly
into the contract document they govern (`ORG_STRUCTURE.md`, `OBSIDIAN_VAULT.md`) with a
Resolved row pointing there. That is deliberate: **one source of truth per decision**, and for a
convention the contract *is* the better home. An ADR is for a choice with rejected alternatives
worth preserving.

## 5. Vocabulary

`fork`, `decision`, and `ADR` are three different things and the corpus does mix them up. See
[[GLOSSARY]] for the distinction, and for `advisory (findings-only)` — the reason an advisory
function can raise a fork but never resolve one.
