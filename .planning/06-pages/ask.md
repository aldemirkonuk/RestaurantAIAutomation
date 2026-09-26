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
updated: 2026-09-25
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
  spent." The shelf and the book still read.
- **The layout's other three pieces** (ADR 0145, 2026-09-25 amendment): the Ask face in the
  shell's right-hand slot, the non-modal quick-ask popover (AskAiBar is still a modal), the
  requests list at `/admin`. The judge's fork 3 (push or overlay below ~1280 px) is open.
- **Shelf counts** per register (sketch 114 A): no shelf endpoint exists (ADR 0145 build
  item 5); the page shows no count rather than an invented one.
- **The pick before spend**: the pick runs inside the one `POST`; the page shows it after.
- **Feedback labels** (`POST /ask/folios/:id/feedback`) have no control on the page.
- **Not-built question classes** (forecast, landed cost, sales revenue, lot expiry) are not
  listed on the shelf; asking one returns its own "Not built yet" or refusal folio.
- Verified by vitest and jest only; no browser render against a live gateway (the launch
  gate is off everywhere).
