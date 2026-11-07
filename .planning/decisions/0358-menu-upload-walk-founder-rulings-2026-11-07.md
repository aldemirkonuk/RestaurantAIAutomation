# 0358 — Menu upload walk: founder rulings 2026-11-07

- **Status:** F1–F4 Locked 2026-11-07, the founder's own picks. D1–D9 are **Proposed**:
  each is the proposal's recommended option, drafted under his delegation of the same day,
  but his next instruction to this dispatch was *"ask questions again"*, so each goes back to
  him and binds nothing until he answers. No other ADR is amended by D1–D9.
- **Date:** 2026-11-07
- **Decider:** Aldemir (founder) for F1–F4. D1–D9 await his answer.
- **Keywords:** menu upload, Phase 1A, background read, Scan a menu, scanMenuImage,
  multi-file, re-upload, retire, held price, never counted, gold set, serving formats, F-696
- **Links:** [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]]
  (not amended: D5 would amend item 7, and D7 F5, round-2 Q4, L13 and L15, only once he
  confirms them);
  [[0314-the-add-wine-photo-path-invents-no-wine]] (its "real scanner" clauses superseded by F3);
  [[0179-unmounted-python-http-is-deleted-not-mounted]]; [[0020-no-fabricated-answers]];
  [[0213-get-started-is-account-then-house-then-first-proof]];
  [[0262-a-toast-is-for-your-own-act-newest-on-top-on-the-house-settle]];
  [[0186-a-menu-upload-classifies-every-drink-not-only-the-wine]]; OD-161.
  Source plan: `p4-scratch/sw-menu-receipts/proposal-menu.md` (revision 2, outside the
  repo; the forks below restate what this record needs).

## Context

A read-only audit of menu upload on `origin/main` at `e26a5152d` found the back half (draft
versions, fingerprinted plan, price locks) sound and the front half below the bar. The
proposal split the work into Phase 1A (defects and rules already Locked, no option chosen),
Phase 1B (small steps each waiting on one answer) and Phases 2–4, and listed twelve forks,
MU-1 to MU-12. Two facts behind the forks were re-measured for this record:

- **"Scan a menu" posts to a route nobody serves.** `scanMenuImage`
  (`apps/web/src/services/wineDetection.ts:473`) posts to `/api/v1/scan/menu` (`:482`). The
  handler (`services/agent-orchestrator/api/scan_routes.py:411`) sits on `router` (`:81`);
  `main.py` imports only `router_preview` (`:70`) and mounts it (`:169`). ADR 0314 kept this
  scanner as "the real scanner" without checking that premise.
- **Menu import, line discard and the kept source have no role check.**
  `apps/api-gateway/src/menus/menus.controller.ts:55,132,197` carry no owner/manager check,
  unlike make-current (`:222`). `/menus/import` matches no path rule in
  `common/rate-limit/rate-limit.guard.ts:225-238`, so it takes the default bucket (`:28`,
  `:240`).

The founder answered four questions on 2026-11-07 through AskUserQuestion and delegated the
rest the same day. **Every quote of his below is as relayed, unverified against the
transcript:** the source is the dispatching session's memory note
(`sw-sota-menu-receipts-2026-11-06.md`, outside the repo) and its dispatch text; the
AskUserQuestion transcript itself is not in the repo, and this record's author did not see it.

## Options considered

Listed per fork under **Decision**: the chosen option, then the rejected ones and their cost.

## Decision

### Founder's picks

**F1. Phase 1A is approved as a whole.** His pick: *"Approve all 8 (Recommended)"*. The
eight rows: 1a (a dropped photo reads and its kept source is the real file), 1b (a
Turkish/EU spreadsheet reads; an ambiguous price is flagged, never guessed), 1c (a partial
read says so; an empty read is kept and says it read nothing), 1d (a failed read leaves no
orphan version), 1f (a dessert wine stays a drink), 1g (the onboarding self-heal reads its own
error), 1i (the orphan `POST /arrival/menu-evidence` is removed), 1l (OD-161's rule: a wine
never counted is unknown, not zero, on every low-stock reader). Rejected: approving row by
row, which would have held defects behind questions that choose nothing.

**F2 (MU-5). Reading runs as a background job.** His pick: *"Background job
(Recommended)"*. A read returns at once as a *Reading* version on `/menu`, survives leaving
the screen, and tells its owner when done (ADR 0262: own acts only); sending still needs a
connection. Consequences: proposal step 2c is built (a technical ADR for the runner is owed
with it); step 1d-ii (a client timeout sized to the host ceiling) is not needed. Rejected:
(a) synchronous with a page cap, which refuses long PDFs and keeps the screen waiting;
(c) background plus offline queueing of photos, which the door-paper precedent chose not to
build.

**F3 (MU-2). "Scan a menu" on `/inventory` and `/cellar` is repointed to the menu reader.**
His pick: *"Repoint to menu reader (Recommended)"*. The buttons send to the three-way
uploader's `POST /menus/import` (ADR 0179); the read lands as a draft version on `/menu`; the
direct add-to-inventory path (`menuScannerPersistence → bulkCreateInventoryItems`) goes.
**This supersedes ADR 0314's "A photo goes to the real scanner" and "The Photo tab keeps the
real scanner" (`0314:56,69`): a photo goes to the menu reader.** 0314's other decisions (no
wine built from a photo, the add sheet adds only a library wine by its real id) stand.
Until step 2a ships the uploader, step 1h is the interim: `scanMenuImage` says the scanner is
not available instead of "No wines detected" (ADR 0020). Rejected: (b) removing the buttons,
fewer doors but owners look for menu scanning where they handle bottles; (c) keeping 0314
with a permanent "not available", the visible dead control 0314 itself rejected as its
option 3. Mounting the old Python route is excluded by ADR 0179.

**F4 (MU-10). One upload of N files is one version.** His pick: *"One upload = one version
(Recommended)"*. Four photos of one menu sent together are one read, so one
`restaurant_menus` row; ADR 0193 item 7 ("every read is a NEW row") is unchanged by this,
because one import is one read. Built in step 2b. Rejected: (b) one file per version plus a
"combine drafts" act, which adds steps to the common case.

**F-696 is answered in part here.** On 2026-10-11 the founder asked for one plan covering every
house's menu needs, whole-menu upload that updates items versus per-menu replace, with speed
and smoothness as first-class criteria (recorded in session memory as F-696; no verbatim
source exists in `.planning/`). F4 answers the multi-file half: a whole upload is one
version, and making it current goes through the existing plan, which lists what changes and
what is not on the new file (L12, display). The re-upload half (a resend reopening the
version, a per-wine Retire) rests on D5 and D6 and stays open until he answers them.

### Proposed calls — put back to the founder

His delegation, 2026-11-07, as relayed: *"I trust you you decide them all"*. His next
instruction to this dispatch, as relayed: *"ask questions again"*. Each call below is the
proposal's recommended option, drafted under the delegation and **Proposed** until he
answers it; none binds a lane, and none amends another ADR.

**D1 (MU-1). A wine nobody has counted reads "Not counted yet" in words on the dashboard,
with a nudge to count.** Proposed, not decided. ADR 0020: a surface with no
data says so. Builds on F1's 1l (the rule). Rejected: (b) simply absent from alerts, which
costs nothing but loses the "count these" nudge.

**D2 (MU-3). Any member of a house may import a menu; discarding a line and opening the kept
source file are owner/manager only.** Proposed, not decided. A draft touches
no price (ADR 0193 item 7), so capture stays open where it is harmless; discard and source
close the two exposures the audit's M10 verdict names. Built in step 1j, with staff not
shown `rawText` in the import reply. Rejected: (a) owner/manager for all three, which stops
staff photographing a menu; (c) as today, any member can mint a link to a costed spreadsheet
and discard current-menu lines.

**D3 (MU-4). Menu import gets no dedicated rate rule; the default bucket stays.** Proposed, not decided. His words in ADR 0193 round 3, *"so never refuse a menu read"*,
are broad and no abuse is measured. Rejected: (b) a per-user rule with a worded 429 and
(c) a per-house daily ceiling, both of which answer some reads with a refusal.

**D4 (MU-9). An ambiguous price (`1.250`, `1,250`) is never resolved from the house's
currency; a person picks.** Proposed, not decided. ADR 0020 forbids invented
numbers; 1b already gives such a string no amount. Revisit when the gold set (D8) measures
how often it bites. Consequence: step 1m is not built. Rejected: (b) resolve by house
currency with a pencil reason, and (c) the same plus a magnitude check; both are guesses.

**D5 (MU-11). Re-sending identical bytes reopens the existing version, with a "read again"
act that does make a new row.** Proposed, not decided. **If confirmed, it
would amend ADR 0193 item 7**: a resend of identical bytes would not be a new read; "read
again" would be. Built in step 2b
(per-file sha256). Rejected: (b) every send a new billed read and row, with the UI naming the
earlier send.

**D6 (MU-12). The re-upload plan offers a per-wine *Retire* act for wines not on the new
file.** Proposed, not decided. Explicit, never preselected; it removes the
wine from the current menu's carried set and leaves locks and inventory alone, so L12
("Silence changes nothing") and L16 ("Only a person ends a lock") hold. The act's own ADR is
owed with step 2d. Rejected: (b) display only, at no cost, which lists departed wines but offers
no act on them.

**D7 (MU-6). A line with an unread or two-way price (or no source box) is held: not carried
until a person decides it, and there is no "approve all".** Proposed, not decided. **If confirmed, it would amend ADR 0193 F5, round-2 Q4, L13 and L15**, which stand as
written until then: it needs a new `price_flag`
value, an L15 sentence naming held lines, and the make-current fingerprint covering them.
Built in step 3e, whose amendment states which blank-price lines count as unread (F5's blank
that keeps a known price, Q4's never-priced blank); this record does not decide that. Rejected: (a) as today (flagged with reasons and carried, the Keep switches
as the only brake); (c) every line confirmed, which is slow and invites rubber-stamping.

**D8 (MU-7). The accuracy gate starts on public menus.** Proposed, not decided. The source PDFs are restored to a stated place, labelled truth goes in
`datasets/menu_corpus/gold/`, and a nightly run spends on live model reads. The per-run cost
is not measured for the pinned model; step 3a states the measured cost before the workflow
is enabled. The proposal's preferred option, adding consented customer menus, needs consent
only the founder can obtain; it becomes the answer when he has it, with consent wording and a
stated retention. Rejected: (c) no gate, which leaves regressions for owners to find.

**D9 (MU-8). Serving formats are offers per line in a child table.** Proposed, not decided. Each offer carries label, volume, raw price, amount and currency; glass and
bottle carry into the house price as today; others are stored and shown; a different printed
currency is a pencil reason, never converted; a glass volume reaches `pour_size_ml` only on a
person's confirmation (ADR 0193 round-2 Q3). Covers beer, whiskey and carafes without
touching the locked price machinery. Phase 4. Rejected: (a) two price slots and one currency
per menu, which cannot express pints, 4 cl or carafes; (c) sellable item → variant →
effective-dated price, which reopens ADR 0193's price versions and locks.

## Consequences

- Phase 1A proceeds as eight lanes (F1). Of Phase 1B: 1d-ii is dropped (F2); 1h ships as the
  interim before 2a (F3); 1k follows F3 after 2a. Steps resting on a Proposed call wait for
  his answer: 1m (D4), 1j (D2, D3), 1e (1l, D1's look and the decision on PR #656), and the
  D5/D6/D7/D8/D9 parts of 2b, 2d, 3a, 3e and Phase 4.
- No OPEN-DECISIONS rows are filed for MU-1, 3, 4, 6, 7, 8, 9, 11, 12 or F-696's re-upload
  half: the Proposed section above is where they wait, and a register row shifts later line
  citations. MU-2, 5 and 10 are decided by F3, F2 and F4.
- ADR 0193 carries no bracket from this record. If he confirms D5 or D7, the bracket goes on
  the line it amends (item 7; F5, round-2 Q4, L13, L15) in the same change.
- Records still owed, each with the step that builds it: the background-read runner's
  technical ADR (2c); the PDF rasteriser placement ADR (3c); and, only if D6 and D7 are
  confirmed, the Retire act's ADR (2d) and the `price_flag` value with ADR 0193 wording (3e).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-07 | docs lane of the menu-upload Phase 1A dispatch | Created; ADR 0314 and ADR 0193 bracketed in place |
| 2026-11-07 | independent audit of the docs lane, then the docs lane | Audit: D1–D9 rested on a relayed delegation while his latest word was *"ask questions again"*. D1–D9 moved to Proposed; ADR 0193's brackets removed; quotes marked as relayed |
