# 0396 — A person who wrote to the house can be answered, at the address that wrote

- **Status:** Proposed
- **Date:** 2026-11-20
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent. This one was made under the standing delegation (r104), and is Proposed until the founder locks it.
- **Keywords:** mail, reply, team, guest, recipient, vendor book, composer
- **Links:** supersedes in part the 2026-09-04 book-only recipient rule (`apps/web/src/pages/communications/next/Compose/RecipientField.tsx:2-17`; `house-letters.service.ts` refusal 1); [[0118-the-house-writes-its-own-mail]]; r104 mail-gap g1

## Context

Mail lists team and guest people (kind `team`, `guest`; `provider_id` NULL) and shows their letters, but `answerFor` returns null with no `providerId` (`mail-format.ts:1022-1031`), and the composer accepts only a vendor-book address, which the server refuses independently. A letter from a guest or a staff member can be read and never answered, though the goal of Mail is every conversation with people.

## Options considered

1. **Keep book-only.** Nothing changes; the portal stays one-way for people who are not vendors.
2. **Free-typed To for owners and managers.** Rejected: a free address is how a letter escapes the guardrails, the round count and the thread.
3. **Add every guest to the vendor book.** Rejected: a guest is not a vendor; the book keys prices, orders and agreements on a vendor record.
4. **Reply only to the exact address that wrote, on that thread.** Chosen.

## Decision

An address that has already written to the house can be answered, and only at that exact address (case aside), on the thread of the letter answered. The request names the letter (`answers`) and carries no `providerId`; the gateway reads that letter, requires its kind to be `team` or `guest`, and refuses any other `To`. The address must also be the stored sender of that thread's newest inbound letter a person wrote: automatic mail (auto-submitted, or from a mailer-daemon or postmaster, as Mail's list flags it) never counts, so a thread with only automatic mail has no one to answer and an older writer is refused once someone else wrote newest (r105 mail-3). It goes through the same guardrails, grant check, sender line, seal (the hold is over the answered letter), undo window and queue as a vendor letter. The sent copy is stored by the house under that person, so the thread shows it without reading Gmail's sent label. Only the house's owner or a manager may write it, the same people who may read these letters. A draft, request, order or inserted figure may not ride on it. The composer shows the fixed address and no book picker.

## Consequences

- A team or guest letter can be answered; a vendor still goes through the book.
- The vendor-book rule stands for every other letter.
- Revisit if staff are to answer their own team's letters (today: owner or manager only) or if a person is to be written to first (today: never; there is no thread to answer).

## Review trail

- r104 mail-gap g1: gateway `a-reply-to-a-team-or-guest-letter.spec.ts` (off-thread address refused; mutation: dropping the equality check fails two cases).
- r105 mail-3: the same spec file gains the automatic-only, older-writer and other-house cases; staff, other-house guest and typed-address refusals were already there. `house-letters.service.ts` `newestPersonWriter` enforces it (mutation: removing either check fails three cases). `claims.d/feat-r105-mail-3-g1-specs-adr-claims.jsonl` holds the checks.
