---
type: audit
title: Vault cleanup audit (OD-01 execution evidence)
status: proposal — awaiting founder call
updated: 2026-08-24
links: ["[[OBSIDIAN_VAULT]]", "[[0004-obsidian-as-backlink-layer]]", "[[0005-v3-to-v0-version-reset]]"]
---

# Vault cleanup audit — evidence for OD-01

- **Status:** Proposal. **No file has been deleted.** This document is the evidence
  pass; the founder picks the cut line, then a follow-up session executes and this
  doc is retired into the resulting ADR.
- **Scope:** `.planning/` — the Obsidian vault root ([OBSIDIAN_VAULT](OBSIDIAN_VAULT.md) §1).
- **Baseline:** **2,078 files, 38 MB**, all 2,106 git-tracked (nothing here is
  unrecoverable — every deletion stays in history).
- **Mandate this executes:** [OBSIDIAN_VAULT](OBSIDIAN_VAULT.md) §5 F2 — *"existing
  corpus left in place now; clean slate is the end goal — OD-01 carries it out as
  its own session."*

---

## 1. What the vault is made of

| Area | Files | Size | Age | Verdict |
|---|---:|---:|---|---|
| `01-org/` + `02-advisory/` | 801 | 6.5 M | 2026-08-24 | **Core.** The generated org corpus (99 units × 8 artifacts). Newest thing here. |
| `archive/` | 522 | 7.5 M | Apr–Jul | **Redundant** — see §2. |
| `phases/` | 445 | 6.7 M | Apr–Jul | Closed-milestone build artifacts — see §3. |
| `sketches/` | 97 | 2.2 M | Apr–Jul | Design provenance, cited by live code — see §4. |
| `06-pages/` | 52 | 236 K | 2026-08-24 | **Core.** Verified 1:1 against the 51 real routes in `apps/web/src`. |
| `05-library/` | 26 | 112 K | 2026-08-24 | **Core** (OD-22). 0 adopted / 23 candidate / 2 unverified. |
| `quick/` | 25 | 216 K | Apr–May | Closed one-off tasks — see §3. |
| `02-advisory/`… `03-scenarios/` | 20 | 200 K | 2026-08-24 | **Core.** 17 scenarios + tier map (OD-48). |
| `foundation/` | 13 | 320 K | 2026-08-24 | **Core.** |
| `decisions/` | 12 | 84 K | 2026-08-24 | **Core, never deleted** — `decisions/README.md`: *"Nothing here is ever silently deleted."* |
| `00-index/` | 10 | 592 K | 2026-08-24 | **Core.** MOCs + `UNIT-MANIFEST.json`. |
| `testing/` | 7 | 72 K | 2026-08-24 | **Core.** |
| `_templates/` | 7 | 28 K | 2026-08-24 | **Core.** Obsidian Templater set. |
| `04-specs/` | 4 | 60 K | 2026-08-24 | **Core.** P1 NF instrumentation — the branch in flight. |
| `debug/` | 1 | 4 K | May | One resolved defect note. |
| top-level files | 35 | 3.4 M | Apr–Aug | Mixed — see §5. |

The vault splits cleanly in two: **~1,000 files created on 2026-08-24** (the
restructure — org corpus, scenarios, pages, decisions, foundation) and
**~1,090 files from the Apr–Jul v1.0/v2.0 build line**.

---

## 2. `archive/` is 94% a byte-for-byte copy of `phases/` + `quick/`

The GSD archive step copied rather than moved, so both trees coexist. Measured:

- **24 of 35** phase directories in `phases/` are **byte-identical** to their
  `archive/` twin.
- **11** differ — and in every case the live `phases/` copy is the **superset**
  (extra files added after archiving). Only **3 files** differ in shared content,
  and the live copy is larger in all three (`25-VALIDATION.md` 4,129→4,687 B,
  `30-HUMAN-UAT.md` 1,663→2,789 B, `36-VALIDATION.md` 4,441→4,957 B).
- **4 of 10** `quick/` dirs are byte-identical to `archive/v2.0-quick/`; the other
  6 are supersets. `archive/v1.0-quick/` and `archive/v2.0-quick/` **overlap each
  other** on 6 of their dirs.
- Only **31 files** exist in `archive/` and nowhere else: v1.0 phases **14**
  (comprehensive-e2e-testing), **15** (wine-storage-locations-unification), and
  **16** (auto-locate-wines) — deleted from `phases/` at some point.

**Consequence:** `archive/` can be deleted with **zero information loss** provided
those 3 directories are first moved back into `phases/`. That alone reclaims
**7.5 MB / 522 files (25% of the vault)** and is the only tier with no argument
against it.

Also inside `archive/`: two zero-byte macOS duplicate-name artifacts,
`24-03-PLAN 2.md` and `24-03-SUMMARY 2.md`, which violate the vault's own unique-
filename rule ([OBSIDIAN_VAULT](OBSIDIAN_VAULT.md) §3).

---

## 3. `phases/` + `quick/` — closed-milestone build artifacts (470 files, 6.9 MB)

- **v1.0** — 17 phases, closed **2026-04-08**, 96% complete.
- **v2.0** — 18 phases, closed **2026-07-28** with `gaps_found`.
- **`quick/`** — 10 one-off tasks, all Apr–May 2026, all closed.
- **1 exception:** `phases/999.1-consumer-food-profiles…/` is an empty `.gitkeep`
  stub for a *future* backlog item (FUTURES.md §7), not history.

**The case for deleting:** [ADR 0005](../decisions/0005-v3-to-v0-version-reset.md)
locks v1/v2/v3 as "the internal scaffolding build" that resets to v0 at the
production line. Everything durable in these 470 files is already carried forward
elsewhere: what shipped → `REQUIREMENTS.md`; what's still broken →
`v3.0-TECH-DEBT.md` (the live defect register); what the milestones concluded →
`v1.0-MILESTONE-AUDIT.md` + `v2.0-MILESTONE-AUDIT.md`; and the full text stays in
git history regardless.

**The case against:** these are the only prose record of *why* each phase was
planned the way it was. Git history preserves them but takes them out of the
Obsidian graph, which is the whole point of [ADR 0004](../decisions/0004-obsidian-as-backlink-layer.md).

---

## 4. `sketches/` — 53 sketches, cited by production code

Throwaway HTML mockups by the `gsd-sketch` skill's own definition. But **20 live
code sites cite them by number**, e.g.:

- `apps/web/src/pages/inventory/command/InventoryCommandPage.tsx:2` — *"production port of sketch 038"*
- `apps/web/src/pages/team/command/ManagerShiftDesk.tsx:2` — *"production port of sketch 038"*
- `apps/web/src/pages/Providers.tsx:727,875,972` — sketch 008-A, 009-A
- `apps/web/src/pages/Providers.tsx:1242` — sketch 010-A
- `apps/web/src/components/orders/CommercialTermsPanel.tsx:4-6` — sketch 10a/b/c

Deleting `sketches/` turns every one of those comments into a dangling pointer.
Note also `038` is used **twice** (`038-inventory-command`, `038-manager-shift-desk`),
so the two code comments above are already ambiguous.

---

## 5. Top-level: 35 files, 3.4 MB

**Zero-argument junk (6 files):**

| File | Why |
|---|---|
| `Untitled.canvas` | 2 bytes, contents `{}`, **0 inbound references** |
| `.next-call-count` | 0 bytes, stale since 2026-07-08 |
| `sketches/.DS_Store` | macOS artifact |
| `archive/…/24-03-PLAN 2.md` | 0 bytes, duplicate-name artifact |
| `archive/…/24-03-SUMMARY 2.md` | 0 bytes, duplicate-name artifact |
| 3 × `.gitkeep` | in directories that now have content |

**Data blobs in a documentation vault (2.3 MB, no code consumer found):**

| File | Size | Grep for consumers |
|---|---:|---|
| `stage1_producer_research_raw.json` | 1.9 MB | none in `apps/`, `services/`, `scripts/` |
| `analytics-feature-catalog.json` | 174 KB | none |
| `analytics-feature-catalog.csv` | 68 KB | none |
| `producer_aliases.json` | 27 KB | none |

`CLAUDE.md` §1 names `datasets/` as the home for data corpora. These four are
**60% of the vault's non-`01-org` byte weight** and they are not notes — they
inflate the Obsidian graph without contributing a single link. **Move, don't
delete** is the obvious call here.

**Stale / superseded prose:**

| File | Size | Modified | Note |
|---|---:|---|---|
| `claude_full_architectural.md` | 185 KB | **2026-04-10** | Pre-Mudavym architecture essay. No frontmatter, **0 wikilinks**, whitespace-padded raw paste. Oldest file in the vault. |
| `STATE.md` | 60 KB | 2026-07-28 | Titled *"Project State: **WineOps** Backend Kitchen Architecture"*, `milestone: v3.0`. Contradicts the 2026-08-24 reset. Still named a live-spine doc by `CLAUDE.md` §4. Holds **39 of the ~45** references into `phases/`+`quick/`+`sketches/`. |
| `LLM_INSTRUCTION_PROMPTS.md` | 16 KB | 2026-07-20 | *"WineOps — LLM Instruction Prompts"*. Predates `CLAUDE.md`, overlaps it. |
| `FIX_ERROR_LOG.md` | 16 KB | 2026-07-27 | Maintained by `.cursor/skills/fix-error/` — **skill still exists**, so this is live, not stale. |
| `v1.0-MILESTONE-AUDIT.md` | 12 KB | 2026-04-05 | **Keep** — this is the durable summary that makes §3 deletable. |
| `v2.0-MILESTONE-AUDIT.md` | 20 KB | 2026-07-28 | **Keep** — same. |

**Shipped-plan docs (7 files, ~230 KB):** `CONVERSATION_THREADING_PLAN.md`,
`SYNTHETIC_DATA_AND_DOCS_PLAN.md`, `PROSPECTS_ATTRIBUTION_ARCHITECTURE.md`,
`INVENTORY_ADD_REMOVE_SCENARIOS.md`, `INVOICE_DOC_UX_RESEARCH.md`,
`UX_SELF_LEARNING_AGENT.md`, `ANALYTICS_FEATURE_CATALOG.md` — all headed
`shipped` / `BUILT AND WIRED` / `Foundation shipped`, all dense with live
`file:line` citations. Same class as §3 but individually load-bearing. Recommend
**keep**, or relocate under a subdirectory rather than delete.

---

## 6. The cascade — what breaks

Deleting `phases/` + `archive/` + `quick/` + `sketches/` breaks **~45 references**
in surviving files, and they are highly concentrated:

| Survivor | Broken refs | Fix |
|---|---:|---|
| `STATE.md` | 39 | Rewrite (it is stale anyway — see §5) |
| `ROADMAP.md` | 5 | Point at the milestone audits |
| `UX_PATHS_CATALOG.md` | 3 | 3 lines |
| `foundation/teams/product.md` | 5 | 5 lines |
| `01-org/…/exploration-studio-charter.md` | 3 | 3 lines |
| 5 further `01-org/` docs | 1 each | 5 lines |
| `v3.0-TECH-DEBT.md`, `06-pages/notifications.md`, `decisions/OPEN-DECISIONS.md`, `02-advisory/…/FORK-REGISTRY.md` | 1 each | 4 lines |

Plus **20 code comments** citing sketch numbers (§4) if `sketches/` goes.

This is a small, fully enumerable cascade — roughly one file to rewrite
(`STATE.md`) and ~25 single-line edits. Not a blocker for any option.

---

## 7. Pre-existing defects this audit surfaced (not caused by cleanup)

- **OD-32 is still open and worse than recorded.** The vault's "single most
  important convention" is unique filenames ([OBSIDIAN_VAULT](OBSIDIAN_VAULT.md) §3).
  There are **46 files named `README.md`**, plus 4× `02-02-PLAN.md`, 4× `01-RESEARCH.md`,
  3× `260406-329-SUMMARY.md`, and more. Deleting `phases/`+`archive/`+`quick/`
  would resolve most of these as a side effect.
- **Duplicate sketch number 038** used for two different sketches (§4).
- **`STATE.md` and `PROJECT.md` disagree** about the current milestone (v3.0
  "Carry-Forward" vs v2.0 "Backend Kitchen Architecture") and about the brand
  (WineOps vs Mudavym).

---

## 8. Options put to the founder

Nothing below is chosen. Per `CLAUDE.md` §0.1 this is the fork, not the answer.

| Option | Deletes | Vault after | Reversibility |
|---|---:|---:|---|
| **A — Junk only** | 6 files | 2,072 files / 38 MB | trivial |
| **B — Junk + `archive/` de-dup** | 528 files | 1,550 files / 30 MB | git history |
| **C — B + `phases/` + `quick/`, data blobs moved to `datasets/`** | 998 files, 2.3 MB moved | 1,080 files / 21 MB | git history |
| **D — C + `sketches/` + `claude_full_architectural.md` + `STATE.md` rewrite** | 1,096 files | 982 files / 18 MB | git history; 20 code comments dangle |

Option **B** is the only one with no counter-argument — it deletes nothing that
does not exist elsewhere in the vault.
