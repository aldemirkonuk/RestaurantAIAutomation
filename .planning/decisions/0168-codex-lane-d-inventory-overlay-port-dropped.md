# 0168 — Drop Codex lane D's inventory-overlay port; do not adopt

- **Status:** Proposed (agent-executed under the founder's standing rule — see Decision;
  this is not a fresh open fork, but the founder can supersede)
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent.
  This record applies the founder's already-stated adoption rule to audit evidence; it
  does not itself ask the founder to weigh a new judgment call, except for the open
  founder-forks listed under Consequences.
- **Keywords:** codex, codex-lane-d, wt-fin-D, page-ports, inventory-overlays, adoption-audit,
  ADR-0112, ADR-0020, ADR-0117, ADR-0149
- **Links:** [[0112-one-modal-policy-three-shapes-one-primitive]] (Locked, violated),
  ADR 0020 absence-never-health (violated), ADR 0117 Q25/Q30 currency (violated),
  [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (the
  finish goal this lane was meant to serve), ADR 0142 security gate, PR #374 (overlay
  foundation, lane A — this lane's undelivered prerequisite)

## Context

Founder's rule for the Codex adoption audit (relayed for this task): *"adopt it only if
the quality baseline is great and align with our needs."* Lane D is one packet of that
audit — "Overlay packet 1 (inventory overlays)," Codex's port of Claude's `wt-port-ov1`
source, staged for evaluation at `/Users/aldemirkonuk/Projects/wt-fin-D` (47 files
staged, uncommitted, +9,129/-126 lines touching the inventory modals and the shared
`mudavym/` overlay primitives).

Two assessments exist, at different depths:

1. **Census** (`codex-lanes.md`, measured 2026-09-16 22:30–23:05, read-only) called lane D
   **ADOPT** — but its own Method section says why that call carries little weight:
   *"No test, typecheck, lint or guard was re-run by this census. Every pass count below
   is Codex's own claim unless marked 'measured'"* (`codex-lanes.md:65-66`). Its lane-D
   row credits only *"Hash-verified copy"* (`codex-lanes.md:76`) — i.e. the files match a
   manifest, not that the code is correct.
2. **Dedicated audit workflow** `wf_3cd8422b-f6b` (2026-09-17), run in three stages —
   an initial pass (`codex-audit/D-adopt.md`, 01:00), a judge review
   (`codex-audit/D-judge.md`, 08:26, journal.jsonl:126), and an independent adversarial
   confirmation (`codex-audit/D-confirm.md`, 08:39, journal.jsonl:140) — reversed the
   census's call: **REJECT**, quality_score **5**, 17 defects, 8 open founder forks.

This ADR records which of the two governs, and why.

## Options considered

1. **Adopt as-is** (the census's call). Fastest, but ships the defects below verbatim,
   including a reproduced production-data-corruption bug. Rejected outright once the
   deeper audit existed — the census explicitly disclaimed checking for this.
2. **Adopt after fixing every defect in place.** Keeps Codex's file structure and test
   scaffolding. Costed and rejected for now: 7 of the 17 defects are rated major, 8
   require a founder ruling before any fix would be durable (a fix written against an
   unanswered fork gets rewritten once the fork is answered), and the lane depends on
   lane A's `HoldToApprove` (async, server-challenged) which has not landed — fixing D
   before A lands means fixing it again after. This is the option the founder's bar
   exists to prevent: patching a lane that scores 5 to look green, rather than building
   to the bar directly.
3. **Drop; leave `wt-fin-D` untouched; record why.** Chosen. Nothing is lost: the
   requirements this lane surfaced (F13's consent control, the seal's server-challenge
   question, one-vs-two carry sheets, menu-scan stock writes, zone-truth source, receipt
   scope, voice locality) still need answers, and are listed under Consequences so the
   next attempt starts from them instead of rediscovering them.
4. *(Saying nothing.)* Costs the most: the census's stale ADOPT would stand as the only
   recorded verdict, and a later session merging on that recommendation alone would ship
   the money-corruption bug in decision 1.

## Decision

**Drop.** Do not merge, adopt, or fix-in-place any file in this lane. The worktree
(`wt-fin-D`) is left exactly as found — detached at `60ed83a7e`, the lane's 47 files
staged and uncommitted, nothing stashed, nothing merged forward onto `origin/main`
(`cb756083e`). The census's ADOPT verdict is superseded by the dedicated audit; per
`codex-lanes.md`'s own method section it was never a quality claim, only a file-integrity
one, and the founder's bar is a quality bar.

**Why the audit's REJECT governs, not the census's ADOPT:** the task instruction was to
read the *latest* audit verdict, and the two are not actually in tension once read
together — the census measured file integrity on 09-16 and said so; the judge and an
independently-run adversarial confirmer measured behavior on 09-17 and found it wanting.
Evidence, cross-checked by me directly against the code in `wt-fin-D` (not taken only on
the audit's word, per CLAUDE.md §5b):

- **Reproduced, not just claimed:** the confirm pass wrote 3 throwaway tests driven by
  real keystrokes and all 3 reproduced. I re-derived the mechanism independently by
  reading the code rather than trusting the claim: `AddWineToInventoryModal.tsx:479-483`
  binds the Carry sheet's cost input to `value={String(costPerBottle)}` /
  `onChange={... Number(e.target.value)}`. Because the field's source of truth is a JS
  `number`, not the raw string, every decimal point is silently dropped on the very next
  render (`Number("12.")` is `12`, and the redraw shows `"12"`) — so typing `12.50`
  keystroke-by-keystroke lands `1250` in state and in `costPerBottle`, corrupting average
  cost. The sibling `threshold` field 20 lines above uses `type="number"` and does not
  have this defect; the cost field does not, for `inputMode="decimal"` styling.
- **False completion copy, confirmed in code:** `RemoveFromInventoryModal.tsx:241-244`
  renders, whenever `phase === 'sealed'`, *"the rows below are gone from the book"* and
  *"Each removal is two ledger entries: the stock reconciled to zero ... then the row
  retired. Both are readable in the ledger"* — unconditionally, not gated on
  `bound.removed > 0`. The service call it describes performs a real ledger write for
  reconcile-to-zero but only an `is_active` update for retirement (`inventory.service.ts`
  per the audit; not independently re-checked by me at that file), so "two ledger
  entries" is false, and a 0-row write still shows "gone from the book."
- **Locked-ADR violation, confirmed in code:** `pages/inventory/command/bits.tsx:9`
  hard-codes `` `$${Math.round(n).toLocaleString()}` `` in `fmtMoney`, and
  `RemoveFromInventoryModal.tsx` uses exactly this `fmtMoney` for the write-off's sealed
  dollar figure. ADR 0117 Q25/Q30 already answered this (use
  `lib/mudavym/format.fmtMoney(value, houseCurrency)`); this lane doesn't call it.
- **Two more locked-ADR violations I did not re-derive myself but which the judge cites
  with file:line and the confirmer did not dispute:** ADR 0112 F12 (write-off needs a
  server-minted challenge + manager passcode; this lane ships a client-only
  `HoldToApprove` with no `onChallenge`, 0 hits in the diff) and ADR 0020 (absence
  reported as health: `PosMappingPanel.tsx` prints "Nothing is waiting" beside a *failed*
  unresolved-queue read, and zone delete is offered even when the mappings read failed).
- **Blocks the goal this lane was funded to serve:** ADR 0149 asks to finish every page
  and delete legacy once. `/inventory`'s Add path still runs through three legacy
  components (`AddWineSelectionModal`, `MenuScannerFlow`, `AddWineModal`), so legacy
  cannot be deleted after this lane merges — it would need a second pass regardless of
  code quality.
- **Depends on an unlanded prerequisite:** lane A's async, server-challenged
  `HoldToApprove` is not on `origin/main` (main's version is `onApprove => void`,
  stamps immediately) — this lane's seals are only honest once lane A lands underneath
  it, so it cannot be adopted alone even if every defect above were fixed.
- **Green gates are not evidence here:** web tsc, eslint (40 staged files),
  vitest (27 files / 436 passed), 24-25 Python guards, and `check_decision_claims.sh`
  (335/335) all pass on this lane. The audit's own point, matching this repo's ADR 0020
  ("absence reported as health"): the house tests mock the label/menu readers down to
  bare divs and fire whole-value `change` events, which structurally cannot exercise the
  keystroke-level cost-field bug, and the money-guard passes only because the offending
  `$` lives in a baselined file. 436 green tests is not a great baseline when the tests
  were built to not see the defect.
- **Provenance dropped:** Codex's packet replaces the original Claude source
  (`wt-port-ov1`)'s census/settings/wines-doc updates and its F13 filing with prose
  citing no measured numbers (e.g. `inventory.md` +33 lines; the ADR 0112 append's "2,704
  tests" vs. PR #374's own body claiming "2,840").

Quality score 5 and a REJECT verdict, on top of three confirmed locked-ADR violations, is
not "the quality baseline is great." Drop stands regardless of the "align with our needs"
half of the test.

## Consequences

- **Easier:** nothing from this lane reaches `origin/main`; no risk of shipping the
  cost-field corruption or the false "written to the ledger" copy to a production house.
- **Harder / given up:** the inventory-overlay UI (Carry sheet, write-off/remove modal,
  POS mapping panel, storage-location manager, receipt workspace, menu scanner, branch
  transfer, consent dialog) has to be built again from a clean Claude branch off current
  `origin/main` — not patched from this tree — per the census's own recommendation
  ("adopt by lane, never wholesale... one PR each, verify_index + pr-audit-gate",
  `codex-lanes.md:31-32`). Whoever does that work should start after lane A lands, not
  before, and should re-derive test coverage rather than reuse this lane's
  `*.house.test.tsx` files, which the audit's D16 finds "stop at the mocks."
- **Open founder forks this lane surfaced but did not settle** (unresolved by dropping
  the lane — they belong to the feature, not to Codex's attempt at it; not filed as new
  `OPEN-DECISIONS.md` rows here per this task's instruction to prefer none, given the
  citation-shift cost of a new OD row and the likelihood of concurrent lane audits filing
  their own rows this same session):
  1. F13 — the house `ConsentDialog` branch is unreachable (rebuilt `/settings` shows the
     four consents as records with no switch). Restore a real control, or delete the act?
  2. Write-off / spot-count seal: ship client-only for now, or wait for a server-minted
     challenge plus F12's per-role daily limit and manager passcode — or drop the word
     "seal" until then?
  3. One carry sheet or two? The census treats `/cellar`'s menu-scan as the same sheet as
     `/inventory`'s carry; this lane built two separate implementations.
  4. May a menu scan write stock quantities at all, and if so at what default (the lane
     assumed 6), and must it render as a proposal a person confirms rather than a write?
  5. Zone-occupancy source of truth: `wine_location_mappings` or lot locations? Should
     the server refuse to delete an occupied zone? Where do unassign / quantity-in-zone
     live on the house path?
  6. Write-off atomicity: should reconcile + retire + ledger reason be one server
     transaction instead of two client calls?
  7. Receipt scope at full-purpose-bar width: must bulk Fill, select-all, and per-row
     zone be rebuilt, or is a narrower receipt acceptable for now?
  8. Spot-count voice uses the browser Web Speech API (not guaranteed on-device). Does
     ADR 0143's "voice recognition must be local" rule (set for Arrival) extend to floor
     counts?
- **What would trigger revisiting this ADR:** a from-scratch inventory-overlay build
  (Claude branch, off current `main`, after lane A) that fixes all 17 defects, answers
  the 8 forks above (or gets founder rulings on them), and clears a fresh audit pass with
  reproducible probes — not merely green `tsc`/`eslint`/`vitest`/guards, which this
  lane already had.

## Evidence trail

- Audit workflow: `wf_3cd8422b-f6b`, journal
  `/Users/aldemirkonuk/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/effa5204-969b-42c5-a68e-f013d4f92d0d/subagents/workflows/wf_3cd8422b-f6b/journal.jsonl`
  — judge result at line 126 (`result.verdict = "REJECT"`, `result.quality_score = 5`,
  17 `defects`, 8 `founder_questions`), confirm result at line 140
  (`result.final_verdict = "REJECT"`).
- Full text: `codex-audit/D-judge.md`, `codex-audit/D-confirm.md`, probe logs under
  `codex-audit/D3-probes/` and `codex-audit/D4-confirm/`
  (under `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/effa5204-969b-42c5-a68e-f013d4f92d0d/scratchpad/`).
  Confirmed present on disk 2026-09-19.
- Census: `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/effa5204-969b-42c5-a68e-f013d4f92d0d/scratchpad/census/codex-lanes.md:65-66,76`.
- Code citations verified directly by me in `/Users/aldemirkonuk/Projects/wt-fin-D`
  (staged, uncommitted) on 2026-09-19: `apps/web/src/components/inventory/AddWineToInventoryModal.tsx:466-483`,
  `apps/web/src/components/inventory/RemoveFromInventoryModal.tsx:238-268`,
  `apps/web/src/pages/inventory/command/bits.tsx:8-9`.
- ADR-numbering guard run 2026-09-19: `python3 scripts/check_adr_numbers_unique.py` →
  *"No ADR numbers introduced by this ref... Next free number, swept across 902 refs:
  0168."* Number **0168 is provisional**: several other Codex-lane audits were expected
  to run concurrently this session, each independently sweeping the same guard, so
  whoever actually commits this file must re-run the guard first and renumber on
  collision (see `check_adr_numbers_unique.py`'s own docstring on why this is a race, not
  a one-time check).
- This file is **uncommitted** (per this task's hard rule: no commit/push/PR/merge from
  this lane). It exists only as a file in `wt-fin-D`'s working tree pending the
  founder's/orchestrator's consolidation pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Claude (Sonnet 5), Codex-lane-D adoption task | Created — drop, evidence above |
