## Closing the Ask panel mid-answer dropped the answer, and asking again paid twice — ~~OPEN~~ CLOSED by `fix/ask-close-no-second-spend` — 2026-10-01

Filed by `fix/ask-close-no-second-spend` ([ADR 0145](../decisions/0145-mudavym-answers-out-of-a-reading.md), "Amendment, 2026-10-01"). Found by the audit of PR #575 on 2026-10-01, which rated it a note, not a block: it was pre-existing, and #575 only added a more visible trigger. Line numbers are at `origin/main` 5a330a88e.

**What.** `AskPanel` returns null when closed (`AskPanel.tsx:579`), so its body unmounts in both placements. The question in flight, its request id (`lastRequest`, `:237`) and the answers (`folios`, `:234`) lived in that body. Closing mid-answer dropped them. `askApi.submit` has no abort, so the gateway still answered and saved the folio, which was paid for. The panel reopened blank, and a new question minted a new request id (`:342`), so the house paid a second time.

**Fix.** The founder chose "Keep answering (Recommended)". `useAskSession` holds that state and `useAskPanel` owns it, so it outlives the body. Reopened mid-answer, the panel says it is still answering and stays busy. "Check again" re-sends the same id, which the gateway never charges twice (`bound-ask.service.ts`). Pinned in `AskPanel.test.tsx` ("closing keeps the question in flight"). [Corrected in round 1: this said six tests render the real owner, each mutation-tested. Five render the real owner and the sixth calls `useAskSession` through `renderHook`; and six guards (the verify's M1-M6) survived mutation. Round 1 pins five and removes the sixth (M2), which guarded only the closed body's own state; see the ADR's "Round 1" note.]

**Narrowed in round 1.** A close keeps the question in flight, its answer, a failure that offers "Check again" with its request, the proposer's refusal and the proposals still waiting. It drops a failure with nothing to retry, the proposer's transport error, and any proposal already applied, discarded, handled or failed, so none of them comes back on a reopen.

## The Ask session outlived a house switch, so "Check again" could pay in the wrong house — ~~OPEN~~ CLOSED by `fix/ask-close-no-second-spend` round 1 — 2026-10-01

Found by the Sonnet verify of this branch's first build (not on `main`: the session came with that build). Line numbers are at the branch's first head, 2958a4590.

**What.** `useAskSession()` and `useAskPanel()` took no person or house (`useAskSession.ts:55`, `useAskPanel.ts:24-27`). The shell is mounted once by the layout route (`App.tsx:355-358`) and a branch switch happens in place (`RestaurantBranchSwitcher.tsx:44-50`, `AuthContext.tsx:608-640`). So house A's answers, failure and kept request showed in house B. "Check again" re-sent house A's request id in house B, and the once-per-id key includes the house (`supabase/migrations/20260922220000_mudavym_bound_reading_folios.sql:26`), so that was a new paid call. A house-A answer in flight landed in house B's list.

**Fix.** `useAskPanel` keys the session by `<person>@<house>`, as `bindHouseSaid` does (`houseSaid.ts`), and a change starts it again. An epoch discards an answer, refusal, proposal or failure begun under the old key, and stops its end from releasing a newer request's gate. The open panel's body is keyed by the same scope, so it re-reads the new house's proposals and pickers. Pinned by the "one person in one house" tests in `AskPanel.test.tsx`; each guard turned a test red under mutation, and an epoch check on a folio re-read's answer, which no test could see (the reset empties the list it maps over), was removed (ADR 0145, "Round 1").

## The proposer has no request id, so a reload mid-draft can pay twice — OPEN — 2026-10-01

Filed by `fix/ask-close-no-second-spend` (ADR 0145, "Amendment, 2026-10-01").

**What.** `proposeAction` posts `{ utterance }` only (`services/api/askAi.ts:173-174`). There is no id the gateway could use to recognise a repeat. The fix above keeps this panel busy across a close, so a person cannot draft twice from it. A reload mid-draft, or a second tab, still sends a second paid call, and a second proposal row.

**Fix (deferred).** Give `POST /ask-ai/propose` a request id with the same once-per-id rule the bound ask has, and send it from the panel.
