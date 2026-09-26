# 0230 — Asking a vendor for a credit drafts the letter, and sends nothing

- **Status:** Locked 2026-09-25 (founder, round 5 — item 31)
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** credits, procurement_credits, requested, house letter, draft, HOUSE_DRAFT, communications, approval, never auto-send
- **Links:** [[0118-the-house-writes-its-own-mail]] (the letter path this rides), [[0083-a-page-may-not-claim-a-write-it-never-makes]] (drafted is not sent), ADR 0167 (credits are owner/manager only; its record is on PR #395), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 22 (the credits lane), PR #476

## Context

PR #476 built the credit ledger as a lane of `/receipts`. Moving a claim to
`requested` only stamped `requested_at` / `requested_by`
(`apps/api-gateway/src/procurement/documents/credits.controller.ts`, the
`requested` branch), and the lane said "Mudavym sends nothing to the vendor".
The receipts note (§13 item 1) listed "send the claim to the vendor" as the
highest-value missing piece, and #476's body left it as an open fork rather
than defaulting it.

The house already has one letter path: `POST /communications/letters`
(ADR 0118) queues a `procurement_conversations` row as `HOUSE_QUEUED` after
four refusals — recipient in the book, guardrails, a sending identity, the
house still using its grant — and a dispatcher sends it after an undo window.
It had no "drafted, nobody has decided" state.

## Options considered

The question's exact option text was not kept in the record; the founder's
answer is quoted as recorded in the session's founder-answers memory (item 31).
The options below are the forks the build faced.

1. **Keep `requested` a record only** (#476 as built) — the person asks the
   vendor themselves and records it. Honest, but the house writes the same
   claim letter by hand every time, and the claim's facts (amount, invoice,
   order, count) are retyped. Rejected by the founder's answer.
2. **Send the claim to the vendor on `requested`** — the move queues or sends a
   letter. Rejected: a letter to a vendor about money must never leave without
   a person's act (ADR 0118: "every step is a human's"; the AI reply path's
   never-auto-send rule), and the founder's answer says so in words.
3. **Draft the letter on `requested`; a person sends it from
   `/communications`** — chosen.

## Decision

**[founder, 2026-09-25, round 5]** "Credits #476: 'requested' creates a
DRAFTED letter to the vendor in /communications; nothing sends without
approval." Rejected: record-only `requested` (#476 as built); sending on the
move.

What was built, on `feat/receipts-credits-tab`:

- **A new letter state, `HOUSE_DRAFT`** (`LETTER_STATUS.DRAFT`,
  `house-letters.service.ts`). No cron selects it — the dispatcher reads
  `HOUSE_QUEUED` alone — so a draft cannot leave on its own. The row is a
  `HOUSE_LETTER` in `procurement_conversations`, `ai_generated: false`, with
  `email_headers.credit_id` naming its claim and `drafted_by` naming who asked.
  No migration: `status` has no CHECK, and the link lives in the row's own
  headers.
- **The letter carries the claim's facts and invents none**
  (`communications/letters/credit-letter.ts`): the amount in the claim's own
  currency, the reason in a vendor's words, the invoice and order numbers and
  bottle count when the claim has them, the matcher's summary. A fact the claim
  lacks is left out, never filled. A test pins that it trips none of
  `composerGuardrails` (no commitment language, no merge token).
- **`→ requested` drafts it** (`credits.controller.ts`). The move still
  succeeds when drafting fails; the response carries `letter: { state, id, to,
  says }` with one of five honest states — `drafted`, `drafted_no_address`
  (the vendor has no address in the book, or the book could not be read),
  `no_vendor` (the claim names none; no row is written), `existing` (asking
  twice returns the same unsent draft), `failed` (the sentence why).
  `POST /procurement/credits/:id/request-letter` drafts again for a claim
  already asked for.
- **The credit links to its draft.** `GET /procurement/credits` returns each
  claim's `letters` (newest first) or `null` + `lettersError` when they could
  not be read — unknown, never none. The lane's claim sheet shows the letter in
  the letter book's words and links `/communications?draft=<id>`.
- **Sending is the approval.** `/communications` lists "Drafted, not sent"
  (`GET /communications/letters/drafts`); opening one puts it in the composer.
  Send posts `POST /communications/letters` with `draftId`, and the draft row
  itself becomes the queued letter under every ADR 0118 refusal and the undo
  window — conditional on still being a draft, so one draft never leaves twice.
  `POST /communications/letters/:id/discard` keeps it as `HOUSE_CANCELLED`.
- The conversation book labels a `HOUSE_DRAFT` row "Drafted · not sent"
  (`cm-format.ts`), never sent and never "AI draft".

## Consequences

- A claim asked for is one tap from a written letter; nothing reaches a vendor
  without a person pressing Send in the composer.
- `requested` now means "asked for, letter drafted or sent" rather than "I
  asked by phone". A person who asked by phone discards the draft.
- `/receiving`'s `RcCreditDrafts.tsx` makes the same `open → requested` move and
  now also drafts a letter; its own copy ("it is with the vendor now") is the
  receiving lane's to correct.
- **Not done:** the `/communications` glance figure "drafts waiting" still counts
  only the AI approval queue (`/procurement/conversations/active`), not house
  drafts; the drafts list beside the composer is where they show.
- **Revisit** if a house wants credit letters grouped per vendor (one letter for
  several claims), or when a vendor channel other than email carries claims.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | founder (round 5, item 31) | Locked: draft on requested, never auto-send |
| 2026-09-25 | W3-credits-team lane | Built on PR #476 |
