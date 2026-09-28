# 0161 — A queue dispatcher whose queue cannot be read throws; it does not report a quiet minute

- **Status:** Proposed (agent, 2026-09-18 — implemented in this PR and in `feat/finish-relay`'s working tree; awaiting a founder lock)
- **Date:** 2026-09-18
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** dispatcher, cron, lastRun, house letters, relay, queue read, absence reported as health, zero-shape, considered 0, sender-identity, ADR 0161
- **Links:** [[0067-a-failed-read-is-never-an-empty-one]] (the rule this applies to a surface it did not reach), [[0118-the-house-writes-its-own-mail]] (D2's queuing answer built `dispatchQueued` as a copy of `dispatchDue`), PR #349 / memory `checks-cannot-see-their-own-removal` (a check proven against a no-op proves nothing; ADR 0135 is not on `main` yet, so it is cited by its PR), [[0051-rebuilt-pages-show-live-data-only]] (an unknown renders as unknown, never as 0), memory `absence-reported-as-health`

## Context

Two crons drain a queue table once a minute: `HouseLettersCron` → `HouseLettersService.dispatchDue` (`house-letters.service.ts`, `procurement_conversations`) and `RelayEmailCron` → `RelayEmailService.dispatchQueued` (`relay-email.service.ts`, `relay_email_queue`, added 2026-09-17 as a copy of the first). Both began:

```ts
const { data, error } = await this.db.client.from(<queue>).select(...)...;
if (error) {
  this.logger.error(`... could not read ...: ${error.message}`);
  return { considered: 0, sent: 0, failed: 0, skipped: 0 };
}
```

That return is byte for byte what the same function returns when nothing is due. The cron then wrote `this.last = { at, error: null, ...result }`. So a database outage on the queue read recorded `error: null`, all zeros — a quiet minute — for as long as the outage lasted. Confirmed by reading both dispatchers and both crons (2026-09-18), and by the new specs failing on the pre-fix source.

The one surface that reads it is `GET /communications/letters/sender` → `dispatcher: this.cron.lastRun()` (`house-letters.controller.ts:71`), whose stated job is to say whether letters can still leave. **No page reads that field**: `useComposeData.ts:42` types it and nothing renders it (`ComposeSheet.tsx` reads only `sender.sendable`), so the outage was visible only to a raw API caller. The failure was already logged; what it never did was reach the record. The relay cron's `lastRun()` has **no consumer** today, so its record was write-only — the same lie, one step less visible.

This is the standing fault (a system reporting on itself reports absence as health) one step past what `check_read_errors_not_swallowed.py` sees: that guard proves the error was **bound**; here it was bound, logged, and then turned into the empty answer.

## Options considered

1. **Throw from the dispatcher on a failed read (chosen).** The crons already `catch`, log, and record `{ zeros, error: <message> }`; the only change is that the read failure now reaches that catch. No return-shape change, no wire change, no edit to any spec that asserts the shape. It is also the house idiom: `HouseMailArchiveService.conversationsDue` throws `ServiceUnavailableException` on the same kind of read (`house-mail-archive.service.ts:1073`), and `HouseInboxCron` records its failed enumeration as `error`.
2. **Add an `outcome: "ran" | "read_failed"` field to the run record.** More explicit, but it needs a typed error shared by two files that live on different branches (the relay files are not on `main`), and `error !== null` already carries the distinction. Rejected as machinery over a state the record has.
3. **Return `considered: null` (unknown) instead of `0` on a failed read.** The most honest counts, but it changes a wire type the web declares as `number` (`useComposeData.ts:42`) and every spec that `toEqual`s the shape. The comment on `error` now says the counts are not a measurement when it is set. Left as a follow-up if a surface starts rendering the counts.
4. **Fix only the new dispatcher.** Leaves the pre-existing one still lying, on the surface that has a reader. Rejected.
5. **A source-regex guard alone, no behavioural spec.** A guard cannot run a cron; it would not notice a cron that stopped recording the thrown error. Both are shipped: guard for the shape, specs for the behaviour.

## Decision

A queue dispatcher whose queue **cannot be read** throws; it never returns the value it returns for an empty queue. `lastRun().error` is non-null for such a run, and `considered: 0` with `error: null` means a completed run that found nothing due. Applied to `dispatchDue` (this PR) and `dispatchQueued` (`feat/finish-relay`, uncommitted at the time of writing).

Enforced three ways, each mutation-tested (the guard's first draft was attacked adversarially and had eight escapes — a renamed error variable, a braceless `if`, an `else`, a `catch`, and three ways a `throw` can exist without leaving the method; each is now a self-test verdict, and six weakenings of the guard itself were each caught by the self-test):

- **Behaviour** — `house-letters.spec.ts` ("a queue that cannot be read is not a quiet minute") and `relay/relay-dispatch-read-failure.spec.ts` each run the same call twice, failing and empty: throws, and the cron's `lastRun().error` is non-null; empty queue → `error: null`. Reverting either fix turns two of the three red (measured for both).
- **Shape** — `scripts/check_dispatch_read_failure_is_not_quiet.py` (CI job `dispatch-read-failure`, in `CI Complete`'s `needs`): the registered dispatcher's first top-level `if (…error…)` must have a `throw` at its own top level (not nested in an inner `if`, callback or try) and no `return`; and, anywhere under `apps/api-gateway/src`, an `if (error)` block may not return an object with ≥2 run counters (`considered`, `sent`, `failed`, `skipped`, …) at a literal `0`. Exit 2 when it cannot check. `--self-test` runs 20 verdicts including the real `dispatchDue` with its fix reverted in memory; measured against `origin/main`'s pre-fix tree it fails on exactly the defect, and it auto-discovers an unregistered clone (the relay dispatcher, reverted in a copy).
- **Claims** — `ADR-0161-*` rows in `CLAIMS.jsonl`; one is a tripwire that fails the build when `relay-email.service.ts` lands on a tree whose guard registry does not yet name it.

## Consequences

- A queue outage is now **recorded truthfully** in `GET /communications/letters/sender`'s `dispatcher.error` (letters) and `RelayEmailCron.lastRun()` (relay, no reader). **No UI renders either yet** — this fixes the record, not the visibility. Surfacing it on a page is a separate build (Compose's sender card is the natural place).
- **Landing order.** The relay half lives only in the **uncommitted** working tree of another session (`/Users/aldemirkonuk/Projects/wt-fin-relay`, files still staged-not-committed); if that session is lost the relay half is lost with it and only the tripwire remains. When it merges with this, the guard finds `dispatchQueued` by rule 2 without registration, and the tripwire claim forces `EXPECTED` to name it.
- **Not fixed here, named so they are not rediscovered as new** (each changes a return shape or a different owner's surface):
  - `dispatchDue`/`dispatchQueued`: `claimError` is counted as `skipped`, which the cron logs as "claimed elsewhere". A database error on the claim is indistinguishable from a race lost. Open claim `ADR-0161-CLAIM-ERROR-COUNTED-AS-SKIPPED`.
  - Both dispatchers ignore the `.error` of the post-send `SENT` write and of the `FAILED` write. A send that succeeded but could not be recorded leaves the row `SENDING` forever (never re-picked, so no double send — but the page shows a letter perpetually leaving).
  - `dashboard.service.ts` answers a failed read with zero/empty tiles after a `logger.warn` in **at least five** places (measured by adversarial review, 2026-09-18: notifications `:186` `unreadCount: 0`, reports, calendar `:284`, procurement spend `:334` — a money figure — and the inventory breakdown `:924`, plus the `catch` copies). Same fault on a read path. Open claim `ADR-0161-DASHBOARD-READ-ERRORS-RETURN-ZEROS` tracks the calendar and procurement-spend sites. The guard's rule 2 does not see them (different counter names) and says so.
  - `house-letters.service.ts` `countOutboundOnOrder` returns `0` on a failed read (`if (error) return 0;`) — a single value, out of the guard's shape, same fault.
  - `wines.service.ts` cannot be parsed by the shared comment stripper (a regex literal containing `"`); it is on a shrink-only `UNPARSEABLE` list with a raw-text fallback.
- **Revisit** if a surface starts rendering the run counts (then option 3, unknown-not-zero), or if a third queue dispatcher appears (then promote the pattern to a base class rather than a third copy).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-18 | agent | Created; implemented; both dispatchers mutation-tested |
