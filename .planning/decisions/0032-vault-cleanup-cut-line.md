# 0032 — Delete closed build artifacts; a tombstone index replaces the archive tree

- **Status:** Locked
- **Date:** 2026-08-27
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** vault, cleanup, archive, phases, quick, tombstone, OD-01, retire-to-write, corpus
- **Links:** [[0004-obsidian-as-backlink-layer]], [[0005-v3-to-v0-version-reset]], [[0018-p2-plan-of-record]], [[0025-citations-must-disagree-loudly]] (deleted the first 469 archive twins), [OPEN-DECISIONS](OPEN-DECISIONS.md) OD-01, `foundation/VAULT_CLEANUP_AUDIT.md` (retired into this ADR, per its own §Status)

## Context

OD-01 (filed 2026-08-24) held the `.planning/` restructure open: the vault carried
~2,078 files, of which ~1,090 were Apr–Jul v1.0/v2.0 build artifacts sitting beside
the 2026-08-24 restructure. The evidence pass already existed —
`foundation/VAULT_CLEANUP_AUDIT.md`, written after an earlier session deleted 996
files **without a founder call** and was reverted. That audit measured the decisive
fact: `archive/` was 94% byte-identical copies of `phases/` + `quick/`, created by
an archive step that copied instead of moving. ADR 0025's sweep later deleted 469
of those twins; this decision finishes the job. The founder picked the cut line on
2026-08-27, in-session, question by question.

The same copy-not-move pattern turned up twice more during execution: the four
data blobs (2.3 MB) were byte-identical to their canonical
`datasets/planning-exports/` copies, and the two top-level milestone audits were
byte-identical to their (since-deleted) `archive/` twins.

## Options considered

1. **A — junk only** (6 files). Leaves the duplication and the Apr–Jul weight in place.
2. **B — junk + archive de-dup** (~528 files). Zero counter-argument, but keeps 470
   closed build files polluting vault search and the unique-filename rule
   (46 `README.md`s and other collisions lived almost entirely in those trees).
3. **C — B plus `phases/` + `quick/`, blobs to `datasets/`.** Costs the in-graph
   prose of *why* each closed phase was planned as it was; everything durable is
   already carried by `REQUIREMENTS.md`, `v3.0-TECH-DEBT.md` and the two
   milestone audits, and ADR 0005 locks v1/v2/v3 as scaffolding that resets.
4. **D — C plus `sketches/` + `claude_full_architectural.md` + `STATE.md` rewrite.**
   Rejected: 20 live code comments cite sketches by number
   (`InventoryCommandPage.tsx:2`, `Providers.tsx:727` …), the founder explicitly
   keeps `claude_full_architectural.md`, and STATE.md was already rewritten under
   ADR 0018 — D's remaining content is either harmful or done.
5. **Mechanism fork — move to a versioned `.planning/archive/` instead of deleting.**
   Rejected: the existing `archive/` tree is the proof of where that road goes —
   copy-drift, twin trees, and a vault that only grows. Git history already keeps
   every byte; what the working tree needs is an *index*, not a second copy.

## Decision

**Cut line C-modified, mechanism delete-plus-tombstone** (founder, 2026-08-27):
delete the closed build trees and the duplicate blobs; keep `sketches/`,
`claude_full_architectural.md`, the `999.1` backlog stub, and the two pre-P2
snapshots ADR 0018/0025 reference; this ADR carries the index that makes every
deletion recoverable.

Two standing rules ride with it:

- **Archive means delete + tombstone.** Nothing is ever again copied or moved
  into an in-tree archive folder. A retirement lists the file in the retiring
  ADR with the recovery commit; `archive/` exists only for the two pre-P2
  snapshots that locked decisions cite by path.
- **Flag metric for future retirements.** A doc is scored on duplication
  (byte-identical elsewhere), staleness (pre-reset branding/facts), inbound
  references, and live consumers (code or skill citations). Only provable
  zero-loss cases (byte dupes, zero-byte junk) are `AUTO`; everything else is
  `REVIEW` and goes to the founder before anything moves.

## Tombstone index

Every deleted path is recoverable with
`git show <commit>^:<path>` (single file) or
`git checkout <commit>^ -- <path>` (tree). Commits are on `docs/vault-cleanup`.

| What | Files | Deleted at | Why |
|---|---:|---|---|
| `.planning/phases/` — 39 closed v1.0/v2.0 phase dirs (incl. 12.1, and 14/15/16 rescued from `archive/` in `9c2d3dcc` so they recover from the same path) | 445 | `a9e1e977` | Closed Apr–Jul build artifacts; durable content lives in `REQUIREMENTS.md`, `v3.0-TECH-DEBT.md`, `v1.0/v2.0-MILESTONE-AUDIT.md` |
| `.planning/quick/` — 10 closed one-off tasks | 25 | `a9e1e977` | Same class; all closed Apr–May 2026 |
| `.planning/archive/v1.0-quick/`, `v2.0-quick/`, `v2.0-phases/`, empty `v1.0-phases/` | ~50 | `a9e1e977` | The twins ADR 0025's sweep left behind |
| `.planning/.next-call-count` | 1 | `a9e1e977` | Zero bytes, stale since 2026-07-08 |
| 4 data blobs (`stage1_producer_research_raw.json` 1.9 MB, `analytics-feature-catalog.json`/`.csv`, `producer_aliases.json`) | 4 | `c3a5c6f3` | Byte-identical to `datasets/planning-exports/` — the path every referencing doc already cites |
| `foundation/VAULT_CLEANUP_AUDIT.md` | 1 | this ADR's commit | Retired into this ADR by its own contract ("this doc is retired into the resulting ADR") — retire-to-write satisfied |
| `LLM_INSTRUCTION_PROMPTS.md` (content; a tombstone stub keeps the name at `07-reference/`) | 1 | the survivor-mapping follow-up commit | Founder call 2026-08-27: WineOps-era prompt library retired outright — a successor will be written fresh, and the stub carries the summary + recovery pointer for its line-anchored citations (OD-33 evidence) |
| `md/` + `md_files/` doc corpus — the Apr-13 WineOps import: 48 build logs in `04-updates-builds/` (incl. `POS_INTEGRATION_COMPLETE.md`, formally superseded by `04-specs/POS-BRIDGE-AUDIT.md`), getting-started/setup guides, package READMEs, architecture/planning/feature essays, the 8 top-level overview docs, `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md` (both copies), and the `md_files/` duplicates | 108 | `docs/md-cleanup` deletion commit | Founder batch calls 2026-08-27: superseded by the `.planning` spine and git history; five later-touched keepers moved to `07-reference/` instead (`FEATURE_ROADMAP`, `MOBILE_APP_SETUP_AND_STATUS`, `GOOGLE_AND_API_CREDENTIALS_SETUP`, both Toast API reports) |
| The 5 schema-debt `.sql` files (`md/02-architecture/` ×4, `md_files/02-architecture/DATABASE_SCHEMA.sql`) — the last tracked content of both trees | 5 | `fix/md-sql-schema-debt` | Exited via the ADR 0026 shrink path (guard `--update`, inventory −5). Evidence, measured 2026-08-27: every table they define is also defined in `supabase/migrations/`; `pending_ai_approvals` and all three cron functions return **404 PGRST205/202-class to the service-role key** in production (never applied) and have **zero consumers** in code — the REGISTER-AUDIT:422 sole-DDL worry was moot. Nothing captured, per ADR 0028 ("repointed or deleted, never created") |

## Retire-to-write waiver — PR #353 (2026-09-12)

**Founder call 2026-09-12: retire-to-write is waived for PR #353's nine
additions** (six files under `.planning/brand/` — `BUILDPROMPT.md`, the four
`Mudavym *.dc.html` canvases, `PITCHING IDEAS.md` — plus three color-audit
docs under `.planning/06-pages/`: `COLOR-AUDIT-PLATFORM.md`,
`COLOR-AUDIT-WEB.md`, `COLOR-CONTRAST-REPORT.md`). None of the nine is a
duplicate, byte-identical elsewhere, or superseding an existing doc — they
are net-new founder-produced brand/design reference material with no natural
retirement candidate, so the trade this section otherwise requires does not
apply. Per the founder's own direction (session 2026-09-12): waive rather
than force a fabricated retirement to satisfy the form. Precedent: ADR
0052's "retire-to-write waived for this wave." This is a one-time waiver for
this PR's specific nine files, not a standing exemption from §4 — the next
new top-level-or-subdirectory doc still owes a real trade or its own waiver
row here.

## Retire-to-write waiver — PR #421, the go-live (2026-09-21)

**Founder call 2026-09-21: retire-to-write is waived for PR #421's two
additions** — `.planning/06-pages/LIVE-CHECKLIST.md` and
`.planning/06-pages/live-checklist-wave5-sweep.json`.

This is the waiver row the PR #353 section above says the next new
subdirectory doc owes. It is written here rather than narrated in the PR,
because that section's whole point is that an inline narration is a
chat-only exception.

Neither file is a duplicate, byte-identical elsewhere, or superseding an
existing doc. Both are **evidence of a single event** — the record of which
sixteen pages went live for every house under ADR 0149 row 36, and the
machine-readable sweep that backs it. `PAGES-MAP.md` carries the index entry
§4 requires. There is no natural retirement candidate: retiring a page
dossier to make room for the checklist of what shipped would destroy the
thing the checklist points at.

Same shape and same reasoning as PR #353's waiver, and on the same terms:
**a one-time waiver for these two specific files, not a standing exemption.**
The founder was offered a standing exemption for generated go-live and audit
evidence and did not take it, so the next new document under `.planning/`
still owes a real trade or its own row here.

Kept deliberately: `phases/999.1-consumer-food-profiles…/.gitkeep` (FUTURES §7
backlog marker, not history); `archive/{ROADMAP,STATE}-pre-P2-20260825.md` (the
only archive files anything references — STATE.md:5, ROADMAP.md:5, ADR 0018);
`sketches/` (96 files, 20 live code citations); `debug/` (1 note, folded later
if ever); `FIX_ERROR_LOG.md` — the audit and the founder's first instinct both
had it archivable, but `.cursor/skills/fix-error/` still exists and maintains
it: it is live.

Vault: 1,677 → 1,152 files. Top level: 35 → 30.

## Retire-to-write waiver — the 2026-09-21 research judges (2026-09-22)

**Founder call, 2026-09-21 (evening, local time; 2026-09-22 UTC), his pick
verbatim: "Judges only, into repo (Recommended)"**, to the question of whether
any of the night's research should enter the repo before a reboot clears the
scratch folder it lived in. The option he picked said a one-time retire-to-write
waiver would come with it, for the six files the question named: the fine-tuning
judge, the Jev experiment and its judge, areas, labor, and the price lock.

**Session effa5204 added five more in the same PR (#443), the same night:**
`ask-judge.md`, `ask-layout-judge.md`, `price-judge.md`, `qty-judge.md`,
`seal-judge.md`. These are the same kind of file — judged summaries from the
same evening's earlier rounds — and would have been lost the same way when the
scratch folder cleared, so the session judged them to fall under the same
reasoning as his pick. That was the session's inference, not his decision, when
it was made.

**Founder call, 2026-09-22, his pick verbatim: "Keep all eleven
(Recommended)"** (round 6x, session memory
`founder-answers-2026-09-21-round5.md:303`), answering that inference directly:
the five extra judges get the same one-time waiver as the six he named on
2026-09-21. All eleven now carry his word.

So eleven judged research summaries land under
`.planning/07-reference/research/2026-09-21/` with no retirement:

- `ft-judge.md`, `jev-exp.md`, `jev-judge.md` (ADR 0163) — his pick, 2026-09-21
- `areas-judge.md` (ADR 0218) — his pick, 2026-09-21
- `labor-judge.md` (ADR 0215) — his pick, 2026-09-21
- `lock-decision.md` (ADR 0193) — his pick, 2026-09-21
- `ask-judge.md`, `ask-layout-judge.md` (ADR 0145, ADR 0112) — added by the session; his pick "Keep all eleven (Recommended)", 2026-09-22
- `price-judge.md` (ADR 0193) — added by the session; his pick "Keep all eleven (Recommended)", 2026-09-22
- `qty-judge.md` (lane E) — added by the session; his pick "Keep all eleven (Recommended)", 2026-09-22
- `seal-judge.md` (ADR 0175) — added by the session; his pick "Keep all eleven (Recommended)", 2026-09-22

**Scope, stated rather than hidden:** six of the eleven are his 2026-09-21 pick;
the other five are the session's addition, covered by his own separate pick on
2026-09-22 (both verbatim quotes above). The raw experiment files (4.5 MB of
logs and menus) and the un-judged finder reports stay out and expire, as the
option said. That includes every input file the judges cite as "this folder".

Each copy was masked before it entered this public repo: local paths, one API
request id and scratch paths were rewritten. Every mask is listed in the PR body.
Public product names, public sources and the synthetic experiment menus' producer
names were kept on purpose.

None of the eleven duplicates or supersedes an existing doc, so there is nothing
honest to retire. This is a one-time waiver for these eleven files, not a
standing exemption. The next new doc still owes a real trade or its own row here.

## Consequences

- Vault search, the Obsidian graph, and the unique-filename rule now operate on
  the working corpus only; sessions stop paying the Apr–Jul navigation tax.
- The prose *why* of closed phases leaves the graph (ADR 0004's cost, accepted —
  git history keeps it, three commands away).
- The pre-P2 snapshots still contain dead internal pointers to
  `archive/v2.0-phases/`; they are verbatim historical records and stay unedited.
- **Survivor mapping (founder calls, 2026-08-27, same session):** spine stays
  top-level — `PROJECT`, `STATE`, `ROADMAP`, `FUTURES`, `YC_WEDGE_PLAN` (kept
  top-level by call: live strategy, 82 citations), `v3.0-TECH-DEBT`,
  `config.json`. Twenty docs moved to `07-reference/` (see its `INDEX.md`),
  including `REQUIREMENTS.md` — a historical ledger by its own ADR 0018 banner,
  so it leaves the spine. Special homes by call: `FIX_ERROR_LOG.md` → `debug/`
  (its `.cursor/skills/fix-error/` paths updated in the working checkout —
  `.cursor/` is untracked, so that edit rides no commit),
  `AGENT_NATIVE_UI_DECISION.md` → `decisions/` (pre-log row added). 67 files of
  path citations rewritten in the same branch; wikilinks unaffected.
- **Residue:** `md/` + `md_files/` were executed the same day on `docs/md-cleanup`
  (five keepers to `07-reference/`, 108 deletions; the deferred `.sql` files
  exited the same day on `fix/md-sql-schema-debt` with production evidence). A
  successor LLM-instruction-prompts doc is planned; until it exists `CLAUDE.md`
  is the only instruction source. Revisit this ADR if a deleted doc turns out
  to be load-bearing (signal: a session recovering one from history to answer a
  live question).

## Review trail

- 2026-08-24 — audit written (evidence pass, no deletions), after the reverted
  996-file incident.
- 2026-08-25 — ADR 0025 deletes 469 archive twins; STATE/ROADMAP rewritten under
  ADR 0018 (removing what was the audit's largest breakage cascade).
- 2026-08-27 — founder locks cut line C-modified + delete-tombstone in-session;
  executed same day on `docs/vault-cleanup`. OD-01 moves to Resolved.
- 2026-08-27 (same session) — `md/` + `md_files/` executed on `docs/md-cleanup`:
  108 deletions, five keepers into `07-reference/`, `.sql` files deferred to the
  ADR 0026 lane. Every fork above was a founder batch call.
- 2026-08-27 (same session) — the deferred `.sql` files removed on
  `fix/md-sql-schema-debt`: production probes showed none of their DDL was ever
  applied and nothing queries it; guard inventory shrank 5 lines; both trees
  are now empty and gone.
- 2026-09-21 — retire-to-write waived for six 2026-09-21 research judges, on the
  founder's pick "Judges only, into repo (Recommended)" (relayed by session
  effa5204). The same session added five more in the same PR (`ask-judge.md`,
  `ask-layout-judge.md`, `price-judge.md`, `qty-judge.md`, `seal-judge.md`)
  under the same reasoning; that was its inference, not yet his word.
- 2026-09-22 — founder's pick, round 6x, verbatim "Keep all eleven
  (Recommended)": the five get the same one-time waiver, and all eleven now
  carry his word. See "Retire-to-write waiver — the 2026-09-21 research
  judges".
