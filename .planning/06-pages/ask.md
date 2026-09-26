---
type: page
route: /ask
slug: ask
softwares: [wine-library-sommelier]
component: apps/web/src/pages/ask/next/AskNext.tsx
audience: owner, manager, staff
tier: core
archetype: reading
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-26
supersedes: ["06-pages/sommelier.md"]
links: ["[[PAGE-CONTRACT]]", "[[RETIRED]]", "[[help]]", "[[privacy]]", "[[settings]]"]
---

# /ask — Ask the house

> **Part of** [[08-softwares/wine-library-sommelier|Wine Library & Sommelier]]. Decided by
> [ADR 0145](../decisions/0145-mudavym-answers-out-of-a-reading.md) (Locked 2026-09-12)
> and its 2026-09-25 amendment, which records the founder's 2026-09-21 `/ask` layout
> verbatim. Replaces `/sommelier` (retire-to-write: `sommelier.md` is deleted, tombstone
> in [[RETIRED]]).

## Surface — buttons → where they go

- **Ask** (the question box) → `POST /api/v1/ask/folios` `{requestId, utterance, origin: "page"}`
  → the saved folio opens at `/ask/f/:id`
- **A shelf card → Read it** → `POST /ask/folios` with `readingId`, `readingVersion`, and
  `args` (`subjectText` for an item/order reading; `from`/`to` for a period reading)
- **A clarify choice** → `POST /ask/folios` with `args.subjectId` and `previousFolioId`
- **Check again** (a pending folio) → `GET /ask/folios/:id`; (a request whose 60 s ran
  out, or that did not come back) → the SAME `POST` with the SAME `requestId` — the gateway
  returns the saved folio and never pays twice
- **A book entry** → `/ask/f/:id`
- **Back to the shelf** → `/ask`
- **Privacy** → [[privacy]] `/privacy`
- `/sommelier` → **redirects** here (`<Navigate replace>`), with a one-line note

## 1. Purpose

The page that answers a question about the house **out of a reading of its own books**
(ADR 0145): every figure is a cell of a Finding the query minted, with its provenance, and
opens to its rows; what Mudavym cannot read, it says in words. It never writes — anything
that would change the house goes through the seal elsewhere ("Never without the seal").

## 1a. Features

- The shelf: the house readings your role may be given, grouped Stock · Orders & receipts ·
  Sales, calendar, vendors, targets; pick one and read it (with an item or a period when it
  needs one)
- Ask in plain words; Mudavym picks the reading, or says no reading answers it
- General questions (pairing, service, the wine itself) answered from the model's own
  knowledge, marked "Not from the house's books", never carrying a figure
- The open folio: the question, which reading answered, the figures with their provenance
  ("assumed" for a default nobody set), the rows behind them, and what was read
- Your book: your asks in this house, newest first, by day; an old folio opens by address
- Staff see their own work only (stock, receiving, today's deliveries) and get the
  gateway's one-line reason for anything else
- Every failure said in words: not opened yet, too many questions, 60 s ran out, still
  answering, the shelf or the book could not be read

## 2. Entry

- `/sommelier` (redirect, `App.tsx`), the legacy sidebar's "Ask Mudavym" row
  (`Sidebar.tsx` `aiNavItems`), the command palette's "Ask Mudavym" (`commands.ts`
  `nav-ask`), /help's "Ways back in" card and its "Using the assistant" guide
- **Not yet:** the shell rail's "Ask Mudavym." row and ⌘⇧K still open the quick-ask panel
  (`AskAiSurface`), not this page — see §9

## 3. Files

- Route: `apps/web/src/App.tsx` — `/ask`, `/ask/f/:folioId` (`PageGate page="ask"`,
  `legacy={<SommelierAI />}` kept only for the ADR 0149 cutover), `/sommelier` redirect
- Page: `apps/web/src/pages/ask/next/AskNext.tsx`, pure half `ask-format.ts`, reads
  `useAskNextData.ts`
- Client: `apps/web/src/services/api/ask.ts`
- Gate: `ask` in `MUDAVYM_PAGES` and `LIVE_PAGES` (`lib/mudavym/useMudavymDesign.ts`) — live
  for every house in code, no flag column; header name `Ask` (`pageNames.ts`, `rooms.ts`)
- Tests: `AskNext.test.tsx` (owner, manager, staff; every failure state),
  `ask-format.test.ts`, `src/__tests__/ask-route.test.ts`

## 4. Endpoints

All in `apps/api-gateway/src/ask-ai/bound-ask.controller.ts`, guarded
`JwtAuthGuard, AuthedRateLimitGuard, RolesGuard`; house and role come from the token.

- `GET /ask/catalogue` — the readings, filtered to the caller's role
- `POST /ask/folios` — 10 a minute per person, 200 an hour per house; the folio is written
  before any paid call; refused with 503 "Ask has not launched yet." unless the gateway's
  `ASK_LAUNCHED` environment value reads `true`
- `GET /ask/folios` — the caller's newest 50 in this house (`reading-folio.store.ts`
  `list`, `.limit(50)`); the page prints the window as a floor at 50
- `GET /ask/folios/:id` — one of the caller's own folios

## 9. Gaps (named, not built)

- **`ASK_LAUNCHED` is not set** on the deployed gateway by this build. Until the founder
  sets it, every ask answers "Ask has not opened yet. Nothing was asked and nothing was
  spent." The shelf and the book still read. **[2026-09-25, founder, round 5: asked when it
  should turn on, he answered, verbatim, "aded to the railway" -- he has set it himself. Not
  verified by any lane: no read of the Railway environment was made, and a live ask spends.
  ADR 0145, "Amendment, 2026-09-25, round 5".]**
- **The layout's other three pieces** (ADR 0145, 2026-09-25 amendment): the Ask face in the
  shell's right-hand slot, the non-modal quick-ask popover (AskAiBar is still a modal), the
  requests list at `/admin`. The judge's fork 3 (push or overlay below ~1280 px) is open. **[ANSWERED 2026-09-25,
  founder, round 5, his pick verbatim: "Lie over it (Recommended)" -- the page keeps its
  width, and the panel is a sheet you close. Of the built surfaces only the ⌘⇧K panel
  exists, and it already lies over the page (now pinned by `AskAiBar.test.tsx`); the Ask
  face is still unbuilt and must follow this below ~1280 px. ADR 0145, same amendment.]**
  **[BUILT 2026-09-26, founder, round 6, his pick verbatim: "One panel, two modes
  (Recommended)" ("Two surfaces" rejected). ⌘⇧K, the header's Ask, the rail's first row,
  the phone's Ask door, the palette and "Keep asking" on an open folio all open ONE Ask
  panel (`components/askai/AskPanel.tsx`): docked in the counter's slot at ≥ ~1280 px
  beside a live page (the counter folds to its strip), lying over the page below. Its
  two modes are an explicit switch, "Ask the books" (`POST /ask/folios`, origin
  `panel`) and "Propose an action" (`POST /ask-ai/propose`, applied only through the
  sealed hold); the words only SUGGEST a mode, and after an ask the backend's own verdict
  (`no_reading_matched`, a declined proposal) is offered as the other mode, a click each.
  `AskAiBar` is deleted. Still not built: quick-ask context from an open act sheet, and
  the requests list at `/admin`. ADR 0145, "Amendment, 2026-09-26, round 6".]**
  **[BUILT 2026-09-26, founder, round 7, item 45, his words verbatim: "/ask panel opens
  in the person's LAST USED mode; first time = Ask the books." Kept as `askLastMode` in
  the account's existing `user_preferences` row (`useUserPreferences`), the same store
  `ground` already rides in -- not a device-only `localStorage` key, so it follows the
  person to another device. Written back only once the mode on screen differs from what
  the account already holds, so an all-Ask session spends no write. ADR 0145, "Amendment,
  2026-09-26, round 7".]**
- **Shelf counts** per register (sketch 114 A): no shelf endpoint exists (ADR 0145 build
  item 5); the page shows no count rather than an invented one.
- **The pick before spend**: the pick runs inside the one `POST`; the page shows it after.
- **Feedback labels** (`POST /ask/folios/:id/feedback`) have no control on the page.
- **Not-built question classes** (forecast, landed cost, sales revenue, lot expiry) are not
  listed on the shelf; asking one returns its own "Not built yet" or refusal folio.
- ADR 0145 R5 / build task 4 (two fixture tests per reading) was the nightly manifest's
  hold on `/ask`; it was not re-verified when the page enrolled (ADR 0145, 2026-09-25).
  **[AUDITED 2026-09-25, W3-ask lane: all sixteen readings have both tests, and every
  relation each one reads is now forced to fail too; `scripts/check_ask_readings_have_fixtures.py`
  fails CI when one is lost. The per-reading table is in ADR 0145, "Amendment, 2026-09-25,
  round 5".]**
- Verified by vitest and jest only; no browser render against a live gateway (the launch
  gate is off everywhere).
