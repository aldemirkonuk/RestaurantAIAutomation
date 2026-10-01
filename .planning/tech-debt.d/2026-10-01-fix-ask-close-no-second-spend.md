## Closing the Ask panel mid-answer dropped the answer, and asking again paid twice — ~~OPEN~~ CLOSED by `fix/ask-close-no-second-spend` — 2026-10-01

Filed by `fix/ask-close-no-second-spend` ([ADR 0145](../decisions/0145-mudavym-answers-out-of-a-reading.md), "Amendment, 2026-10-01"). Found by the audit of PR #575 on 2026-10-01, which rated it a note, not a block: it was pre-existing, and #575 only added a more visible trigger. Line numbers are at `origin/main` 5a330a88e.

**What.** `AskPanel` returns null when closed (`AskPanel.tsx:579`), so its body unmounts in both placements. The question in flight, its request id (`lastRequest`, `:237`) and the answers (`folios`, `:234`) lived in that body. Closing mid-answer dropped them. `askApi.submit` has no abort, so the gateway still answered and saved the folio, which was paid for. The panel reopened blank, and a new question minted a new request id (`:342`), so the house paid a second time.

**Fix.** The founder chose "Keep answering (Recommended)". `useAskSession` holds that state and `useAskPanel` owns it, so it outlives the body. Reopened mid-answer, the panel says it is still answering and stays busy. "Check again" re-sends the same id, which the gateway never charges twice (`bound-ask.service.ts`). Pinned by six tests in `AskPanel.test.tsx` ("closing keeps the question in flight") that render the real owner, each mutation-tested.

## The proposer has no request id, so a reload mid-draft can pay twice — OPEN — 2026-10-01

Filed by `fix/ask-close-no-second-spend` (ADR 0145, "Amendment, 2026-10-01").

**What.** `proposeAction` posts `{ utterance }` only (`services/api/askAi.ts:173-174`). There is no id the gateway could use to recognise a repeat. The fix above keeps this panel busy across a close, so a person cannot draft twice from it. A reload mid-draft, or a second tab, still sends a second paid call, and a second proposal row.

**Fix (deferred).** Give `POST /ask-ai/propose` a request id with the same once-per-id rule the bound ask has, and send it from the panel.
