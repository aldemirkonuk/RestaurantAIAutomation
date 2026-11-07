# docs/menu-upload-rulings-2026-11-07: left over

## Cellar comments call the dead menu scanner "real" — OPEN — 2026-11-07

`apps/web/src/pages/cellar/next/WineRegister.tsx:44` and
`apps/web/src/pages/cellar/next/IsThisTheBottlePanel.tsx:5` say the scanner's detection half
is real (`scanMenuImage` → the orchestrator pipeline), and `PhotographLabel.tsx:12` leans on
the same pipeline. `scanMenuImage` posts to `/api/v1/scan/menu`
(`apps/web/src/services/wineDetection.ts:482`), a route on `scan_routes.router`
(`services/agent-orchestrator/api/scan_routes.py:81,411`) that `main.py` never mounts (it
mounts only `router_preview`, `:70,169`). The comments go with proposal step 1k, which
repoints the buttons under ADR 0358 F3. The claim row `ADR-0358-SCAN-A-MENU-REPOINTED`
(`claims.d/docs-menu-upload-rulings-2026-11-07.jsonl`) counts imports and calls only, so these
comments do not keep it open.

## D1–D9 wait on the founder's answers — RESOLVED 2026-11-07 — the founder's /goal ("Do not ask me any questions I approve you decide them all") delegated them; ADR 0358 locks D1–D9, claim `ADR-0358-DELEGATED-CALLS-LOCKED` replaces the Proposed row. ADR 0193 brackets land with steps 2b/3e.

ADR 0358's nine delegated calls (MU-1, 3, 4, 6, 7, 8, 9, 11, 12) are recorded as Proposed:
after the delegation, his latest instruction to the dispatch was *"ask questions again"*, and
this lane cannot ask. Each needs his answer through AskUserQuestion; the change that records
the answers flips `ADR-0358-DELEGATED-CALLS-PROPOSED` and, for a confirmed D5 or D7, adds the
ADR 0193 bracket (item 7; F5, round-2 Q4, L13, L15) on the line it amends. No OPEN-DECISIONS
rows were filed for them (the dispatch said not to; ADR 0358's Proposed section holds them).

## ADR 0358's records owed — OPEN — 2026-11-07

Still unwritten, each owed with the step that builds it: the background-read runner's
technical ADR (step 2c, F2) and the PDF rasteriser placement ADR (step 3c); and, only if D6
and D7 are confirmed, the Retire act's ADR (step 2d) and the new `price_flag` value with the
ADR 0193 wording for which blank-price lines count as unread (step 3e).

## The founder's 2026-11-07 words are quoted from a relay — OPEN — 2026-11-07

ADR 0358 quotes four AskUserQuestion picks, the delegation *"I trust you you decide them
all"* and the later *"ask questions again"* as relayed (the dispatching session's memory note
`sw-sota-menu-receipts-2026-11-06.md` and its dispatch text), and says so in its own body. The
AskUserQuestion transcript is not in the repo, and the docs lane did not see it. F-696's 2026-10-11 ask exists only as a session-memory
paraphrase; no verbatim source is in `.planning/`. If the transcript surfaces, compare the
quotes and bracket any difference in place.

## ADR 0358's index row ships on a separate branch — OPEN — 2026-11-07

As dispatched, ADR 0358's `decisions/README.md` row is on
`docs/menu-upload-rulings-readme-row`, not on this branch. The PR audit gate releases a pure
row append only when the same PR adds the ADR (`scripts/pr_audit_gate.py`
`_index_pure_append`); a row PR without the ADR file is gate-owned and needs the founder's
word. Merging the two branches as one PR avoids that.
