# 0332 — A message from the team may reach you in quiet hours, and the logs show it

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** founder (2026-10-11 chat)
- **Keywords:** F-540, F-1340, F-528, F-539, quiet hours, push, team broadcast, member left, pushHolds, push_enabled, overtime, notification preferences, logs
- **Links:** `apps/api-gateway/src/notifications/push-hold.ts` ("the one rule for every push"); [ADR 0281](0281-a-pos-sale-is-dated-by-its-check-and-the-import-says-what-it-did.md) (a person's own push switch); [ADR 0121](0121-the-houses-text-sender.md); sim ledger S187 and S195

## Context

`pushHolds` (`apps/api-gateway/src/notifications/push-hold.ts`) holds a push for anyone whose Push switch is off or who is inside their quiet hours. Its header calls itself "the one rule for every push" and leaves open whether a critical push may pass quiet hours. That question is F-540.

Two team pushes never went through it (F-1340):

- The manager's broadcast (`team.controller.ts:661-668`) filters only by the Push switch.
- "X left the team" (`team.service.ts:1466`, `noticeToHouseLeads`) reads no preference at all.

Meanwhile Settings states a blanket quiet-hours rule (`apps/web/src/pages/settings/next/NotifySection.tsx:263-283`).

The founder, 2026-10-11, verbatim: *"What do you mean my weather team pushes respect quiet hours if it means that team doesn't care about the quiet hours and just do some stuff there, then it's allowed. We can do it um, because sometimes the work just gets overloaded and people cannot have the time to do it and they do it over time. If they do, we'll be able to see it through the logs though."*

## Options considered

1. **Quiet hours hold every push, team pushes included.** One rule. But a manager covering an overloaded night cannot reach anyone, and the founder rejected this.
2. **Team pushes ignore quiet hours silently (as built for these two pushes).** The work gets through. But nobody can later see who was messaged off-hours, and Settings says the opposite.
3. **Team pushes may pass quiet hours, every pass is logged, and Settings says so.** This is the shape Slack and Teams use for urgent messages from a person, which can break through Do Not Disturb. **Chosen.**

## Decision

**A push one person sends to the team (the manager's broadcast, and the "left the team" notice to leads) reaches people inside their quiet hours. Each push that does so is written to the house's logs, with who sent it, when, and who was inside quiet hours. Settings says this in its Quiet hours row.**

1. **The Push switch still holds.** Someone who turned Push off gets no team push. Quiet hours are a time window. The switch is the person's choice, and it is the OS-level opt-out anyway.
2. **Only team pushes from a person pass.** Pushes the system generates (low stock, orders, digests, reminders) still go through `pushHolds` and wait out quiet hours, as built.
3. **The log row** is a `system_audit_log` entry with the sender as actor and the house, and the recipients held by quiet hours listed by user id. It is shown on `/logs` in plain words, for example "Message sent during quiet hours to 3 people."
4. **Settings copy** (Quiet hours row): "Quiet hours hold app alerts. A message from your team can still reach you, and each one is kept in the logs."
5. `push-hold.ts`'s header is corrected to say team pushes are the stated exception. F-540 (whether a *critical system* push passes quiet hours) is answered "no": only a person's team message passes.

## Consequences

- An overloaded shift can be covered at night, and the owner can see afterwards who was messaged and by whom.
- A person who wants silence turns Push off, not just quiet hours. Settings has to say that plainly.
- Revisit if the logs show team pushes inside quiet hours becoming routine rather than overflow (the signal: most broadcasts in a month land inside someone's quiet hours).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created from the founder's chat ruling (sim S195) |
