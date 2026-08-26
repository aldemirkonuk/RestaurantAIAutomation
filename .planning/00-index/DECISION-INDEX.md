---
type: moc
title: Decision Index
updated: 2026-08-26
links: ["[[HOME]]", "[[AGENDA]]", "[[PLAN]]", "[[ORG-MAP]]", "[[GLOSSARY]]"]
---

# Decision Index

> The vault's navigational view of the decision layer. **Nothing here is canonical.**
> Each ADR file is canonical for its own decision; [`decisions/README.md`](../decisions/README.md)
> is the prose log; [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md) is the register of
> everything still undecided. This page exists so you can find them, not so you can read them here.

## 1. The ADR log

28 ADRs on file — **20 locked**, 8 proposed — spanning 2026-08-24 to 2026-08-26. Generated from the ADR headers, not hand-maintained: the 2026-08-24 version of this table listed eight and stayed at eight while the log tripled, which is the failure this whole layer exists to prevent.

| # | Subject | Status | Date |
|---|---|---|---|
| [0001](../decisions/0001-mudavym-single-entity.md) | Mudavym is one entity; modules are internal softwares | **Locked** | 2026-08-24 |
| [0002](../decisions/0002-documentation-first-operating-mode.md) | Documentation-first operating mode + ADR discipline | **Locked** | 2026-08-24 |
| [0003](../decisions/0003-session-output-discipline.md) | Low per-session output footprint; branch-per-operation | **Locked** | 2026-08-24 |
| [0004](../decisions/0004-obsidian-as-backlink-layer.md) | Obsidian adopted as the documentation backlink layer | **Locked** | 2026-08-24 |
| [0005](../decisions/0005-v3-to-v0-version-reset.md) | v3 internal build → deliberate v0 production reset | **Locked** | 2026-08-24 |
| [0006](../decisions/0006-neural-footprint-architecture.md) | Neural Footprint: split production and research stores | **Locked** | 2026-08-24 |
| [0007](../decisions/0007-org-structure.md) | Organization: divisions, departments, and an advisory layer | **Locked** | 2026-08-24 |
| [0008](../decisions/0008-nf-column-contract.md) | Neural Footprint column contract: full ADR 0006 shape now (Path C) | **Locked** | 2026-08-24 |
| [0009](../decisions/0009-loop-vocabulary-contract.md) | The loop vocabulary is read from §5.1 and enforced in CI | **Locked** | 2026-08-24 |
| [0010](../decisions/0010-gemini-model-retirement.md) | Replace retired Gemini models; correct the spend table that hid the cost | **Locked** | 2026-08-24 |
| [0011](../decisions/0011-pos-sale-volume-contract.md) | A POS sale removes a volume, not a unit: `sale_volume_ml` and fail-closed depletion | **Locked** | 2026-08-25 |
| [0012](../decisions/0012-reports-through-the-gateway.md) | The browser stops reading `generated_reports`; the gateway that owns it answers instead | Proposed | 2026-08-25 |
| [0013](../decisions/0013-one-commitment-guardrail.md) | The UCC commitment guardrail has one canon; every other copy is generated and CI-checked | Proposed | 2026-08-25 |
| [0015](../decisions/0015-pos-referential-integrity.md) | The remaining ten POS reference columns get foreign keys | **Locked** | 2026-08-25 |
| [0016](../decisions/0016-ledgers-must-express-unknown.md) | Ledgers express "unknown"; rates carry a dated source | **Locked** | 2026-08-25 |
| [0017](../decisions/0017-doneability-verdicts-are-sidecar-claims.md) | Doneability verdicts are sidecar claims, never edits to the event | **Locked** | 2026-08-25 |
| [0018](../decisions/0018-p2-plan-of-record.md) | P2 plan of record: spine reset, page graph, docs before features | **Locked** | 2026-08-25 |
| [0019](../decisions/0019-p2-build-scope.md) | P2 build scope (the founder-approval list) | **Locked** | 2026-08-25 |
| [0020](../decisions/0020-no-fabricated-answers.md) | A surface with no data says so; it never invents one | **Locked** | 2026-08-26 |
| [0021](../decisions/0021-studio-invites-are-self-service.md) | The invitee redeems the invite, and the invited address is what authorizes it | Proposed | 2026-08-26 |
| [0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md) | Scheduled jobs iterate opted-in tenants, and never borrow another tenant's recipients | Proposed | 2026-08-26 |
| [0023](../decisions/0023-email-verification-is-enforced.md) | Email verification is enforced, and enforced on the server | Proposed | 2026-08-26 |
| [0024](../decisions/0024-identity-first-signin.md) | Sign-in reveals the methods an identity actually has | **Locked** | 2026-08-26 |
| [0025](../decisions/0025-citations-must-disagree-loudly.md) | 0025-citations-must-disagree-loudly.md | **Locked** | 2026-08-26 (proposed and locked the same day) |
| [0026](../decisions/0026-schema-has-one-home.md) | Schema has one home, and CI compares it against the code | Proposed | 2026-08-26 |
| [0027](../decisions/0027-push-recipients-are-not-resolved-here.md) | Delete the resolver's push branch; push recipients are user ids, not devices | Proposed | 2026-08-26 |
| [0028](../decisions/0028-phantom-relations-repoint-or-delete.md) | A phantom relation is repointed or deleted, never created | Proposed | 2026-08-26 |
| [0029](../decisions/0029-p3-plan-of-record.md) | P3 plan of record: grade before you scale, and parallel only where nothing is assumed | **Locked** | 2026-08-26 |

> 🔴 **Three ADR files are missing from `main`, and two of their numbers were reused.**
> Found 2026-08-26 while regenerating this table. `0012-pos-mapping-inventory-integrity`,
> `0013-migration-ledger-reconciliation` and `0014-proposal-candidate-set-null` were all
> written and locked on 2026-08-25 (commits `32aa26c3`, `a874a68a`, `6780db35` — none of
> which is an ancestor of `main`). On `main` today, **0012** is *reports-through-the-gateway*
> and **0013** is *one-commitment-guardrail* — different decisions that took the same
> numbers — and **0014** is vacant.
>
> They are still cited: [0015](../decisions/0015-pos-referential-integrity.md) names ADR
> 0012 and ADR 0014 four times as the decisions it builds on, [0026](../decisions/0026-schema-has-one-home.md)
> carries a `[[0013-migration-ledger-reconciliation]]` link that resolves to nothing, and
> OD-71 cites ADR 0014's rule as its tie-break. **The decisions were implemented** — the
> migrations and guards they describe are live; only the records are gone.
>
> This is the ADR-number-collision class the register memory warns about, and here it did
> not merely confuse a citation: a squash-merge dropped three locked decision records.
> All three are recovered verbatim from the object store and held pending a founder call
> on renumbering (they cannot go back at 0012/0013 — those are occupied).

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
