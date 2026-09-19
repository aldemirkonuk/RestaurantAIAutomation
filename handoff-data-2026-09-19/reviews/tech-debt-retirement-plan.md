# Retirement plan — `.planning/v3.0-TECH-DEBT.md`

Target: `/Users/aldemirkonuk/Projects/wt-review/.planning/v3.0-TECH-DEBT.md` (4,765 lines).
Every count below is from a command run against that worktree on 2026-09-18/19; commands are given so they can be re-run.

## 1. Every place that depends on the file

### 1a. Literal filename `v3.0-TECH-DEBT.md`

```
grep -rl "v3\.0-TECH-DEBT\.md" . --exclude-dir=node_modules --exclude-dir=.git | wc -l
```
→ **161 files.** Breakdown by top-level area (`grep -rl ... | sed -E 's#/[^/]+$##' | cut -d/ -f1-2 | sort | uniq -c`):

| Area | Files | Nature of the reference |
|---|---:|---|
| `.planning/06-pages/` | 29 | Page dossiers cite specific line ranges (e.g. `wines.md:1200 → v3.0-TECH-DEBT.md:543-549`) as the source for an open finding. **Content-dependent** — deleting the file orphans a line-number citation, not just a filename. |
| `.planning/01-org/` | 29 | The 693-doc org-generation corpus (exempt from §4 retire-to-write per CLAUDE.md). Mostly boilerplate mentions of the tech-debt register as a concept, not line citations. **Low-value, generic.** |
| `apps/api-gateway/` | 28 | 18 are real source (`.ts`/`.spec.ts`) with inline comments citing the doc as *why* code behaves a certain way or as *where an open item is filed*; 10 are generated `coverage/` HTML reports (regenerated on every test run — not a real dependency). |
| `.planning/decisions/` | 24 | ADRs (0032, 0064, 0097, 0103, 0104, 0105, 0111, 0119, 0125, 0129, 0137, 0139, 0140, 0141, 0147, 0159, 0162, 0010, 0018, 0019, 0005), `README.md`, `OPEN-DECISIONS.md`, `CLAIMS.jsonl`. **Highest-stakes class** — see §1c/§1d. |
| `apps/web/` | 9 | Real source files, same pattern as api-gateway (inline comments). |
| `.planning/08-softwares/` | 7 | Software catalog notes citing specific line ranges (e.g. `inventory-command.md:155 → v3.0-TECH-DEBT.md:432-440`). |
| `.planning/04-specs/` | 5 | Spec/audit docs, prose mentions. |
| `.planning/sketches/` | 4 | Old sketch HTML, prose mentions (likely stale already). |
| `.planning/07-reference/` | 4 | `INDEX.md` names it as what `v2.0-MILESTONE-AUDIT.md` "feeds"; `UX_PATHS_CATALOG.md` cross-reference. |
| `supabase/migrations/` + `migrations_archive/` + `tests/` | 5 | SQL comment headers citing the doc for context on a fix. |
| `scripts/` | 3 | `check_web_reads_gateway_dto_keys.py`, `check_definer_functions_closed.py`, `check_new_tables_are_locked_down.py` — **docstring/comment only**, not parsed (see §1b). |
| `.planning/foundation/`, `.planning/03-scenarios/`, `.planning/testing/`, `.planning/archive/`, `datasets/library/`, `CLAUDE.md`, `.planning/00-index/` | 1 each | Single mentions. |

### 1b. Scripts: comment-only, never parsed

Checked all three scripts that name the file. None `open()`/`read()` it or check its existence — each is a **prose docstring** describing a known blind spot as "filed in `.planning/v3.0-TECH-DEBT.md`":

- `scripts/check_web_reads_gateway_dto_keys.py:62` — "it is recorded in `.planning/v3.0-TECH-DEBT.md` instead."
- `scripts/check_definer_functions_closed.py:153,157` — "Filed OPEN in v3.0-TECH-DEBT.md" (twice).
- `scripts/check_new_tables_are_locked_down.py:310` — "Filed OPEN in v3.0-TECH-DEBT.md."
- `scripts/check_citation_pairing.py` — **0 hits**, does not reference the file at all.

**Deleting the file breaks none of these scripts' execution or CI**, but leaves each docstring pointing at a deleted file — a promise ("this gap is tracked there") that becomes false. Each needs its one line repointed to wherever the corresponding open item lands (see §3).

### 1c. `CLAIMS.jsonl`: 11 rows cite it in prose, `verify` never reads it

`grep -n "TECH-DEBT" .planning/decisions/CLAIMS.jsonl` → 11 lines, all inside the human-readable `"claim"` field, never inside `"verify"` (every `verify` is a self-contained `grep`/`python3` command against source code). One row's **id itself encodes a register id**:

- **`DEBT-44.2d`** (`status: "open"`) — claim text says "see v3.0-TECH-DEBT.md 44.2d for the replay"; `verify` is `grep -qE 'is[-_]ancestor' scripts/check_deployed_sha.py scripts/resolve_watched_commit.py`. Re-run today: still fails (open), matching this task's register entry `44.2d`.
- 9 more rows (`ADR-0147-REGISTER-NAMES-NO-HOUSE`, `ADR-0147-INVITE-ROLE-CEILING`, `ADR-0162-OWNERS-REMOVE-OWNERS`, `ADR-0162-ROLE-CHANGE-THIS-HOUSE-ONLY`, `ADR-0162-USERS-ROW-FALLBACK-RETIRED`, `ADR-0162-ROLE-IN-TOKEN-HOUSE`, `ADR-0162-LEAVING-ENDS-MEMBERSHIP`, `ADR-0162-TEAM-REMOVE-OWNERS`) each cite `v3.0-TECH-DEBT 44.1g/44.1h/44.1i/44.1j/44.1n/44.1p/44.1q` inline in their claim prose as *"closed"* or *"still open"* — cross-checked against this task's register and every one **agrees** (44.1g/h/j/p/q closed; 44.1i/n partly open), which is independent confirmation the register's state calls are accurate.
- 2 older rows (`LENS-POS-2026-09-03`, `LENS-INTEL-2026-09-03`) cite "TECH-DEBT 2026-09-03 POS/intelligence lens" as the origin story for a resolved claim.

**None of these `verify` commands will break** when the file is deleted — they don't touch it. But every claim's prose becomes a dangling citation. This is a documentation-integrity issue, not a CI-blocking one; §3 gives the options.

### 1d. `OPEN-DECISIONS.md`: one direct content link

- **OD-60** (the `.gitignore` " 2" duplicate-file policy, matches register item `gitignore-duplicate-files`) ends with `Detail in [v3.0-TECH-DEBT.md](../v3.0-TECH-DEBT.md).` — a real markdown link that 404s the moment the file is deleted.
- **OD-01**'s closure text (resolved, historical) names `v3.0-TECH-DEBT` as one of the six files kept at the top level by the ADR 0032 survivor mapping — historical record, does not need editing (it is describing a past decision correctly; the file's later retirement is a *new* fact for a *new* entry, not a correction to OD-01).

### 1e. `CLAUDE.md` and `decisions/README.md`: the two that matter most

- **`CLAUDE.md:124,130`** (§1 Orientation table) — names `v3.0-TECH-DEBT.md` as one of the five spine-level top-level `.planning/` files, and states "is the live defect register. Check it before claiming something is broken or fixed." **Both lines must change** on retirement — otherwise every future session is told by its own rulebook to read a file that no longer exists.
- **`.planning/decisions/README.md`** — 3 ADR-summary rows (0064, 0139, 0141) mention the doc inside their historical rationale prose (describing what was filed there at the time). These are **historical ADR records** — CLAUDE.md §5b/§7 norms favor bracketed corrections in place over rewriting history, so the recommended treatment is a one-line bracketed note per ADR (`[the underlying v3.0-TECH-DEBT.md item was folded into the successor register/ADR on retirement, 2026-09-xx]`), not a rewrite.
- **`.planning/PROJECT.md:47`** — "Prior milestones... its unfinished work is the live defect register [v3.0-TECH-DEBT.md](v3.0-TECH-DEBT.md), which feeds P2.3's proposal..." — a live markdown link in the currently-read entry point doc; must be repointed or the sentence rewritten.
- **`.planning/07-reference/INDEX.md:22-23`** — describes `v2.0-MILESTONE-AUDIT.md` as feeding this file, and flags `UX_PATHS_CATALOG.md` as "partially STALE (see v3.0-TECH-DEBT 44.13)" — both need repointing.

### 1f. Real source-code comments: 27 files

`grep -rl "v3\.0-TECH-DEBT\.md" apps/api-gateway apps/web --exclude-dir=coverage` (excluding generated coverage reports and excluding nothing else) → **18 files in `apps/api-gateway/src`, 9 in `apps/web/src`** (see full list in §1a's table sources; e.g. `apps/api-gateway/src/auth/dev-bypass.util.ts:45`, `apps/api-gateway/src/procurement/quantity-received-unit.ts:67`, `apps/web/src/lib/doorOutbox.ts:71`). These are genuine code comments explaining *why* a piece of code is shaped the way it is, or flagging a known-open gap right next to the code it concerns. **These are the most durable class of citation** — they will outlive any planning-doc reorganization because they live with the code, and each one should be repointed to the item's new home (a CLAIMS row id, an OD number, or an ADR section) rather than left dangling.

### 1g. `.github/workflows/e2e-prod.yml`: 2 comments, not parsed

Lines 16 and 96 are `#`-comments explaining *why* a check exists ("indistinguishable from 'production is broken' — see .planning/v3.0-TECH-DEBT.md"). No YAML step reads the file. Safe to leave stale briefly, but should be repointed for the same reason as §1f.

### 1h. Gate-owned paths (ADR 0090) — where founder sign-off is mechanically forced

`scripts/pr_audit_gate.py:485-517` (`_GATE_OWNED_PATHS`) does **not** include `.planning/v3.0-TECH-DEBT.md` itself — deleting the file alone would not force-escalate a PR. But it **does** include:

- **`CLAUDE.md`** — and §1e above establishes CLAUDE.md *must* be edited (§1/§4 references) to retire this file cleanly.
- **`.planning/decisions/README.md`** — and §1e establishes this needs at least a bracketed note.

**Consequence: any PR that retires this file correctly (edits CLAUDE.md + README.md alongside the deletion) automatically touches `_GATE_OWNED_PATHS` and force-escalates to BLOCK under ADR 0090** — `touches_own_gate` fires regardless of what any reviewer concludes, same as ADR 0090's own self-referential PRs did (#261, #297, #299). **This needs the founder's direct authorization in chat**, not the autonomous pr-audit-gate skill path, exactly as ADR 0090 already requires for any CLAUDE.md-touching PR.

### 1i. Register-id citations (`44.x` style) outside the file itself

A literal-id grep (`44\.[0-9]+[a-z]?`) is too noisy on its own — it matches coverage percentages (`44.72%`), dataset file names, and unrelated version strings. Narrowing to citations that co-occur with "TECH-DEBT" or sit inside `.planning/decisions/` and `.planning/06-pages/`/`08-softwares/` content citations (already counted in §1a/§1c) is the reliable signal; **no additional register-id citations were found outside those two classes.**

## 2. Total dependency count

**161 files** cite the literal filename; of those, **27 are real source-code files** (comments), **~24 are ADR/decision-register files** (2 of them gate-owned), and the remainder (~110) are planning-corpus prose (page dossiers, software notes, org-generation boilerplate, sketches, spec docs) that cite it either as a line-range source or as a generic concept reference.

## 3. What must change, by class, and what needs the founder's word

| Class | Count | What changes on retirement | Gate-owned? |
|---|---:|---|:---:|
| `CLAUDE.md` §1/§4 | 1 file, 2 lines | Remove the two references naming it as a spine file / the live defect register | **Yes** — forces BLOCK under ADR 0090 |
| `.planning/decisions/README.md` | 3 ADR rows | Bracketed note only, per §1e — no rewrite of ADR history | **Yes** — forces BLOCK under ADR 0090 |
| `.planning/decisions/OPEN-DECISIONS.md` (OD-60) | 1 link | Repoint "Detail in [v3.0-TECH-DEBT.md]" to wherever OD-60's evidence now lives (its own OD prose already carries the substance; the link can simply be dropped) | No |
| `.planning/decisions/CLAIMS.jsonl` | 11 rows | No functional change required (verify commands are self-contained); optionally strip the dangling filename mention from each `claim` string on next touch of that row | No |
| `.planning/PROJECT.md` | 1 link | Repoint or rewrite the sentence naming it as the live defect register | No (not in `_GATE_OWNED_PATHS`) |
| `.planning/07-reference/INDEX.md` | 2 lines | Repoint both mentions | No |
| Real source comments (`apps/api-gateway`, `apps/web`) | 27 files | Repoint each comment to the item's new home (CLAIMS id / OD number / ADR) — mechanical, one line each, no behavior change | No |
| `.planning/06-pages/*`, `.planning/08-softwares/*` | 36 files | Repoint line-range citations, or accept they become historical-only (many already describe fixed/closed items) | No |
| `scripts/check_web_reads_gateway_dto_keys.py`, `check_definer_functions_closed.py`, `check_new_tables_are_locked_down.py` | 3 files | Repoint the one docstring line each | No |
| `.github/workflows/e2e-prod.yml` | 2 comments | Repoint or drop | No |
| `.planning/01-org/*`, sketches, archive, foundation, scenarios | ~40 files | Leave as historical corpus (org-generation exempt per §4; archive/sketches are already frozen) | No |

**Net: retiring the file cleanly requires exactly two gate-owned edits (`CLAUDE.md`, `decisions/README.md`), which means this PR cannot self-merge under ADR 0090 — it needs the founder's explicit go-ahead in chat before or at merge time, same as every prior CLAUDE.md-touching PR.**

## 4. Where the surviving WORK/DECIDE items should live afterwards — options (no recommendation forced; founder's call, flagged in `open_forks`)

The checklist's **43 Decide items + ~68 WORK items (security/money + broken-features + quality/tests)** need a home once the register that held them is gone. Four options, with real costs measured against this repo's own tooling:

1. **Per-item `CLAIMS.jsonl` rows**, `status: "open"`, one per surviving WORK item (the `DEBT-44.2d` pattern already exists for exactly this).
   - Cost: a `status: open` claim **fails CI the moment its `verify` command starts passing but nobody flips `status` to `resolved`** — i.e. it *guards itself* against the "fixed but unstruck" rot CLAUDE.md §5b was written to stop. This is the only option with a mechanical, CI-enforced staleness check.
   - Cost: writing a precise, checkable `verify` command for every item is real work — some items here (e.g. `44.1r`, `google-signin-open-question`) are product decisions or session-scoped facts a grep cannot check, so this only fits the sub-set of items that reduce to a code-shape question.

2. **`OPEN-DECISIONS.md` rows**, one per Decide item.
   - Cost: **CLAUDE.md's own "Register row shifts citations" memory says a new OD row shifts ~173 citations** — inserting 43 rows at once is a large, disruptive edit to a file every session reads, and the memory "Decision register rots" already documents this file's own rot problem (5 wrong entries acted on in one day, 2026-08-25).
   - Benefit: this is exactly the file's stated purpose (§5 of CLAUDE.md: "Open decisions live in OPEN-DECISIONS.md"), and every Decide item here is, definitionally, an open decision.

3. **GitHub issues**, one per item.
   - Cost: **no static check in this repo can read a GitHub issue** — `check_decision_claims.sh`, `check_citation_pairing.py` and every CI guard here works against files in the tree. An issue-tracked item is invisible to the "claims must be re-checkable" discipline (§5b) unless a human re-reads it.
   - Benefit: lowest friction to file, natural home for anything that isn't a code-verifiable claim (e.g. `44.1e-collision-meta`'s renumbering advice, or "founder call on rollout pace").

4. **The owning ADR's own "open items" section** (e.g. fold `44.1i`/`44.1n`'s residual openness into ADR 0162's own text, since CLAIMS rows `ADR-0162-USERS-ROW-FALLBACK-RETIRED` etc. already narrate exactly this).
   - Cost: scatters the backlog across dozens of ADR files instead of one register — the opposite of §4's "don't create new top-level docs, do fold into what exists" instinct, but only works cleanly for items that already have a clearly-owning ADR (most of the `44.1x` auth/membership family does; many of the atlas/modules/models findings do not).

**A workable split (stated as the shape, not a decision):** items that already reduce to a grep/python-checkable code claim (the bulk of `security_money`/`fix_broken`/`quality_tests`) → **CLAIMS.jsonl**, mirroring `DEBT-44.2d`; items that are genuinely open product/architecture forks with no single checkable answer (the 43 `Decide` items) → **OPEN-DECISIONS.md**, accepting the ~173-citation-shift cost once rather than paying it 43 times piecemeal; items that are pure paperwork/reference notes with no code shape (renumbering advice, methodology caveats) → fold into the nearest owning ADR or drop entirely. This is presented as a starting shape for the founder to accept, reject, or repartition — see `open_forks`.

## 5. Retirement sequencing (mechanical, once the founder has picked from §4)

1. Land the successor rows (CLAIMS/OD/ADR-section, per whatever §4 split is chosen) **first**, in their own commit(s).
2. Repoint the 27 source-code comments (§1f) and the 3 script docstrings (§1b) to the new homes — mechanical, one line each.
3. Edit `CLAUDE.md` §1/§4 and `.planning/decisions/README.md` (bracketed notes only) to drop the file — **this is the gate-owned commit; get the founder's explicit go-ahead before opening the PR**, per §1h.
4. Repoint `.planning/PROJECT.md`, `.planning/07-reference/INDEX.md`, `OPEN-DECISIONS.md` OD-60's link, and the `.github/workflows/e2e-prod.yml` comments.
5. Delete `.planning/v3.0-TECH-DEBT.md` and add its tombstone entry (per the existing "archive = delete + tombstone" convention from ADR 0032/OD-01), citing this retirement plan and the recovery commit.
6. Leave the ~110 planning-corpus prose citations (pages, software notes, org-generation, sketches, archive) as historical text — most already describe fixed/closed items and read fine in the past tense; only re-touch one if it is edited for an unrelated reason anyway (retire-to-write applies to *new* docs, not a mandate to rewrite the whole corpus in one PR).
