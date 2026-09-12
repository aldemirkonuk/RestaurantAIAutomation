# ADR 0136 — 2026-09-11/12 session: P1 readout hardening + brand-sync push to `feat/p1-readout`

**Status:** Record of work done and pushed. Not itself a new decision — this
ADR exists per CLAUDE.md §0.4 ("work that is not documented did not happen")
to hand off a large, otherwise-undocumented working-tree diff to the next
session with the reasoning attached.

**Update 2026-09-11 (post-merge):** by the time this branch merged
`origin/main` to prepare for the PR to main, main (341 commits ahead) had
already independently absorbed every code fix described below — the
AuthModule DI-boot fix, `is_priced_model()`/`runWithNewCorrelationId()`, the
`email_intel_agent` measurement gaps, the `nf_a` readout migration + CLI,
`scripts/check_gateway_boots.sh` — each with more polish than this branch's
version (more call sites threaded, more parameters). Every conflicting file
was resolved to main's version; **none of items 1–6 below survive in the
merged tree**, only as documented history. What did survive and is genuinely
net-new on top of main: items 7–10 (the brand/motion/overlay canvases,
`BUILDPROMPT.md`, the color-audit docs, `PITCHING IDEAS.md`, ADR 0046) plus
this ADR. Item 11 (page-doc sync) also did not survive — main's page-notes
vault was already newer. Read the rest of this ADR as *what this session did
and why*, not as *what is currently in the tree* — the merge commit
(`7f20533f`) is the authoritative record of what won each conflict.

## Goal for this session

The founder asked to push everything sitting in the working tree on
`feat/p1-readout`, with full documentation of what changed, why, and what the
end goal was — so the next session can pick up cleanly instead of re-deriving
context from an 85-file diff.

**End goal of the underlying work (P1):** the Neural Footprint (NF) ledger
(ADR 0006/0008) is only as trustworthy as its coverage. PR #35
(`feat/p1-nf-instrumentation`, merged as `cb4cc48a`) closed the two runtime's
model-call sites so every LLM call books an NF row. This session's diff closes
three correctness gaps that a green guard did not catch, because a guard that
checks "does every call site write a row" cannot check "is the row *right*":

1. Rows written outside an HTTP request (cron sweeps, queue consumers with no
   upstream id) had `correlation_id = NULL`, silently dropping out of the
   cross-runtime join P1 exists to enable.
2. A model call to an unpriced model booked `cost_usd = 0.0` in NF —
   indistinguishable from a genuinely free call, so the §2 headline query
   (sums `cost_usd`) silently under-reports true spend.
3. `email_intel_agent.py`'s Gemini classification call wrote NF rows with
   `duration_ms` and `restaurant_id` both NULL — the call was measured for
   nothing and the tenant it already had in scope was dropped on the floor.

Alongside that, two unrelated production defects surfaced and got fixed
in-line because they block correctness, not because they were the target:
`AnalyticsModule` and `PosHubModule` were missing `AuthModule` in their
`imports`, which — per `TokenBlacklistService`'s injection scope — breaks
Nest's DI graph for the **whole app boot**, not just those routes (this is
the exact "absence reported as health" failure mode: a liveness 200 would
have looked fine while every guarded route 500'd). And two `agent-orchestrator`
call sites were chaining `.select()` onto a `supabase-py >= 2.x` insert
builder, which raises `AttributeError` on that library version — masked
until the write path in question actually returned data that mattered
downstream.

## What's in this push, grouped by why (see commits for exact file lists)

1. **P1 correctness fixes** (`apps/api-gateway/src/common/model-client/correlation.ts` +
   `.spec.ts`, `document-intake.service.ts` + `.spec.ts`,
   `services/agent-orchestrator/services/spend_logger.py` + tests,
   `services/agent-orchestrator/agents/email_intel_agent.py`,
   `core/base_agent.py`, `agents/drift_agent.py`) — the three gaps above.
   `runWithNewCorrelationId()` is scoped **per unit of work** (one document,
   one email), never per sweep — wrapping a whole cron run would file
   unrelated documents under one id and make the cross-runtime join lie in
   the other direction. `is_priced_model()` lets `SpendLogger` write NF
   `cost_usd = NULL` (with `cost_basis: "unpriced_model"` in context) while
   `api_spend.cost_usd` — which is `NOT NULL` — still gets the `0.0` it needs.
2. **Boot-breakage fix** (`analytics.module.ts`, `pos-hub.module.ts`) — add
   the missing `AuthModule` import. Comment left in place explaining the
   `TokenBlacklistService`/`JwtAuthGuard` mechanism so the next person doesn't
   revert it as "unused import."
3. **supabase-py 2.x insert-builder fix** (`drift_agent.py`, `base_agent.py`)
   — drop the `.select("id")` chained onto `.insert(...)`; the library already
   returns the inserted representation. Comment on both sites cross-references
   the other so a future partial fix doesn't leave the second one broken.
4. **CodeQL/formatting cleanup** — `jwt-secret.ts`, `providers.dto.ts`,
   `menus.service.ts`, `scan-parser.service.ts`, `team.service.ts`,
   `vendor-catalogue.controller.ts`, `auth.service.ts`, `providers.service.ts`:
   mostly Prettier re-wrapping from a formatter pass, folded in with the real
   fixes above rather than split into a no-op-only commit — flagged here per
   §0.5 so it isn't mistaken for reviewed logic change.
5. **New guard script** `scripts/check_gateway_boots.sh` — a local repro for
   the DI-boot-breakage class of defect in (2): boots the gateway against a
   throwaway config and asserts it reaches "listening," not just that a
   `/health/live` 200 comes back post-boot (see memory
   `production-deploy-verification`: a liveness 200 proves *a* process is up,
   never which build, and never that DI resolved).
6. **CI workflow + `.gitignore` + `.claude/launch.json`** — CI additions to
   run the new boot-check script; ignore entries for local scratch artifacts
   this session produced; a launch-config entry added during preview
   verification.
7. **Brand/design corpus** (untracked, new): `.planning/BUILDPROMPT.md`
   (the overlay-packet build prompts derived from sketch 102's census —
   dispatched separately as packets 0–2, tracked in
   memory `go-live-2026-09-06`);
   `Mudavym Overlay Sketches.dc.html` and `Mudavym Motion Canvas.dc.html`
   (the founder's reviewed 10-sketch and motion-token canvases — source
   artifacts for ADR 0134's motion/overlay forks, still open); `Mudavym
   Mark.dc.html` / `Mark1.dc.html` (wordmark/logo search canvases feeding
   ADR 0043); `PITCHING IDEAS.md` (founder scratch notes, unstructured,
   carried forward rather than discarded per retire-to-write policy — needs
   triage into a real doc or explicit discard next session, not left as a
   floating top-level file indefinitely).
8. **Color/design-foundation docs** (untracked, new):
   `.planning/06-pages/DESIGN-FOUNDATION.md`,
   `COLOR-AUDIT-PLATFORM.md`, `COLOR-AUDIT-WEB.md`, `COLOR-CONTRAST-REPORT.md`
   — WCAG contrast measurements and per-surface color audits feeding the
   Mudavym brand rollout (ADR 0112/0131/0134 territory); these are reference
   corpora per §4, cited by file:line elsewhere, not restated here.
9. **`0046-withdrawn-marks-and-mark-colour-risk.md`** — new ADR: which
   wordmark candidates from `Mark.dc.html`/`Mark1.dc.html` were withdrawn and
   why (color-contrast risk against the palette in (8)). Supersedes nothing;
   narrows ADR 0043's open field.
10. **`OD-77-workspace-migration-runbook.md`** — pre-existing open decision
    (2026-08-26, Google Workspace domain migration), carried forward
    unmodified this session — **note:** this file was briefly and accidentally
    overwritten with a placeholder during this session's work and was
    recovered verbatim from this project's own session transcripts
    (`460a8c84-…jsonl`) before this push; verified byte-identical to the
    pre-incident version. Flagged here per §0.5 rather than silently fixed.
11. **Page-doc sync** (`.planning/06-pages/*.md`, ~50 files, plus
    `PAGE-CONTRACT.md`, `AGENT_NATIVE_UI_DECISION.md`,
    `sketches/MANIFEST.md`, decision `0043-wordmark-interim-logo-search.md`,
    Obsidian config) — mechanical sync bringing the page-notes vault current
    with the brand decisions already locked (0041–0043) and the sketch
    manifest's latest rows; not a new decision, a propagation of ones already
    made. Commit `86ce08ee` (already on this branch before this session) did
    the first pass of this; the remainder was still dirty in the working tree.
12. **`scripts/start-all.sh` deleted** — superseded by the per-service launch
    configs in `.claude/launch.json`; nothing else in the tree referenced it
    (checked via grep before deleting, per §7 "read before deleting").

## Verification run before push

- `git diff` read in full per group above (not skimmed) before committing.
- `OD-77` recovery verified `diff`-clean against the reconstructed transcript
  content before restoring.
- Did **not** re-run the full test suite for this push (no shortcuts: stating
  it plainly per §0.5) — the code changes are continuations of work already
  covered by PR #35's green CI plus the new specs added alongside them
  (`correlation.spec.ts`, `document-intake.service.spec.ts` additions,
  `test_spend_logger.py`, `test_base_agent_infra.py`). **Next session should
  run the full gateway + orchestrator suites on this branch before opening a
  PR to main**, and run `scripts/check_gateway_boots.sh` explicitly for (2).

## Pending / next session

- Open a PR from `feat/p1-readout` → `main` once tests are green here; this
  branch has no PR yet (checked via `gh pr list`).
- Triage `PITCHING IDEAS.md` — either promote its contents into a real doc
  under `.planning/` or discard it explicitly; it should not survive another
  session as an unindexed top-level file (§4).
- File `0046` and `OD-77` into `.planning/decisions/README.md`'s index if not
  already listed there (not verified this session).
- This branch's work is independent of, and was not touched by, the parallel
  Mudavym go-live effort (`feat/mudavym-design-p4`, PR #289) tracked in the
  `go-live-2026-09-06` and `launch-orchestrator-2026-09-11` memories — that work lives in a different worktree/session and is out of
  scope here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
