# 0241 — An offline change belongs to its person and house, is never dropped for failing, and ends with its person's sign-out

- **Status:** Locked 2026-09-29 (founder ruling on OD-203). Built in two PRs: this one (the queue, the SyncManager, sign-out, the "not sent" strip) and a second one that brings `doorOutbox` and `spotCountOutbox` under the same retry rule (§The second OD-203 PR).
- **Date:** 2026-09-29
- **Decider:** Aldemir (founder). His ruling, verbatim, given in chat on 2026-09-29: *"make sure that offline changes still queue and always ends up uh, with our database. If the person signs out, however, the data is lose, lost, right? This is the best way since it's basically cache and you signed out basically. But if they do this action in, let's say, an app, I mean, like at a web app from Safari or somewhere else, and if we don't create our own app for this matter, then you're right, uh, do the standard industry application"*.
- **Keywords:** offline queue, pending mutations, sync manager, retry, backoff, park, not sent, sign-out, shared tablet, owner stamp, house binding, door outbox, spot count, navigator.locks
- **Links:** OD-203 (`OPEN-DECISIONS.md:98`); defect entry `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:1`; [[0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove]] (door outbox drops and pins, unchanged here [until §Amendment 2026-09-29, which parks a refused door receipt instead]); [[0164-sessions-follow-membership-and-several-houses-choose]] (the token names the session's house); [[0112-one-modal-policy-three-shapes-one-primitive]] (modal shape, see Consequences).

## Context

The web app keeps offline writes in one IndexedDB queue (`apps/web/src/lib/offline-storage.ts`, localStorage fallback). Three owners read it: the SyncManager (`calendar.*`, `provider.*`, `notification.*`), `doorOutbox` (`receiving.door`) and `spotCountOutbox` (`inventory.spotCount`). On `origin/main` 71ae5449b:

- `logout()` (`AuthContext.tsx:936-956`) never touched the queue, and no entry recorded who queued it, so `SyncManager.syncNow()` (`sync-manager.ts:239-258`) replayed a change queued by person A in house X under whoever was signed in at replay time — person B, or A in house Y.
- After `MAX_RETRIES = 3` the SyncManager deleted the change with a console line (`sync-manager.ts:251-275`); `spotCountOutbox` deleted after 8 attempts or on any 4xx with nothing at all (`spotCountOutbox.ts:103-115`).

## The ruling, read as three rules

- **(a) It always reaches the database.** No drop after a retry count. Retry with backoff for as long as it takes; a change the server refuses for good is kept and shown as "not sent", never deleted on its own.
- **(b) It is bound to the person and house that made it**, and never replays under a different login or house. (The founder's "always ends up with our database" for *their* change; replaying it as someone else is not that.)
- **(c) Sign-out ends it**, because it is a cache of the session — with the web-app industry standard of warning first: *"N changes have not been sent yet … Sign out anyway?"*

## Research (how others do it)

| Product | Retry | Permanent refusal | Bound to user | Sign-out |
|---|---|---|---|---|
| Replicache | forever, exponential backoff; a 401 calls `getAuth` and keeps the queue | server acks and skips; client rolls back on next pull | yes — one store per user name | not documented; per-user stores just sit |
| Linear (reverse-engineered) | resent from a `__transactions` table on reconnect | rollback locally | yes — one IndexedDB per user+workspace | unverified |
| Figma | kept up to 30 days (7 in Safari) | unverified | tied to the browser; switching accounts blocks | **warns** on logout with unsynced changes; review dialog |
| Firestore | forever | undone locally, error often only in console | **no** — one cache per app | `clearIndexedDbPersistence` drops pending writes, no warning |
| Workbox Background Sync | time-based, 7 days, then silent delete | a 4xx/5xx *response* counts as done | **no** — replays with whatever cookie exists | none |
| TanStack Query persist | paused mutations resumed; `maxAge` 24 h then silent discard | app's `onError` | no; `buster` on logout | left to the app |
| Gmail offline | — | — | one account per profile | a setting: keep or remove offline data |

Sources: developer.chrome.com/docs/workbox/modules/workbox-background-sync; doc.replicache.dev (server-push, how-it-works, ReplicacheOptions); github.com/wzhudev/reverse-linear-sync-engine; help.figma.com/hc/en-us/articles/360040328553; notion.com/releases/2025-08-19; firebase.google.com/docs/firestore/manage-data/enable-offline; tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient; support.google.com/mail/answer/1306849; webkit.org/blog/10218 (Safari deletes script-writable storage after 7 days without a visit). Google's own Docs offline help page was behind a bot check and was not read.

Where the products agree, that is the standard applied here: retry until acknowledged (Replicache, Firestore, Linear); bind the queue to the user (Replicache, Linear); a 401 pauses, never drops (Replicache); warn before a sign-out that would lose changes (Figma). Where they disagree — a permanent refusal is rolled back silently (Replicache, Linear, Firestore) or counted as done (Workbox) — the founder's "always ends up with our database" rules out both, so a refusal is **kept and shown**.

## Options considered

1. **Bind and park (OD-203 path a)** — stamp each entry, replay only under the same pair, park refused/exhausted entries in a "not sent" list. Keeps every change; needs a surface. **Taken for (a) and (b).**
2. **Warn and clear (path b)** — warn on sign-out and clear; on exhausted retries toast what was dropped. **Rejected for (a)**: it loses changes by design, against "always ends up with our database". **Taken for (c)**, which is exactly the founder's sign-out rule.
3. **One IndexedDB database per person (Replicache's shape).** Structurally impossible for one person's session to read another's queue, and sign-out drops the whole database. **Rejected for now**: it moves the store for three owners and their tests, and the house binding is needed on top of it anyway (one person, two houses). The filter at the one read point (`getPendingMutations`) gives the same guarantee to every reader, and the adversarial pass found no reader that bypasses it (`getAllPendingMutationsOnDevice` is used only by sign-out).
4. **Keep the cap, raise it (e.g. 20).** **Rejected**: any cap is a silent drop with a longer fuse.
5. **Time-based expiry (Workbox's 7 days).** **Rejected**: Workbox deletes expired entries without telling anyone; the one thing the ruling forbids.
6. **Do nothing.** The defect stands: a shared tablet at the pass sends one person's change into the next person's house, and changes vanish.

## Decision

**Every queued change carries the person and house of the session that made it, and only a session of that same person and house loads it.** Two exceptions hold until the second OD-203 PR: `doorOutbox` and `spotCountOutbox` read the session once per flush, so a house switch in the middle of a flush sends the rest of that flush under the new house; and a legacy spot count names no house, so `spotCountOutbox` sends it under whoever is signed in. A legacy entry that names no one is loaded by every session. The strip can discard it once the SyncManager has parked it, any sign-out removes it, and the SyncManager never sends it. **The SyncManager retries a change with backoff until the server takes it, and keeps one the server refuses for good, shown as "not sent".** The two outboxes keep their own caps until the second PR. [The second PR (#530) closed both exceptions and removed the outboxes' caps for transient failures; a permanent refusal of a door receipt still ends in ADR 0140's pinned drop record — §The second OD-203 PR.] [Superseded 2026-09-29: a door receipt refused for good is now parked as "Not sent" too — §Amendment 2026-09-29.] **Signing out warns with the count, then removes that person's changes in every house.**

What was built (`apps/web/src`):

- **Owner stamp and filter** — `lib/queue-owner.ts` reads the session (`sub` from the access token, house from `activeRestaurantId`, which the API client sends as `X-Restaurant-Id`). `offlineStorage.addPendingMutation` stamps `owner`; `getPendingMutations` returns only entries `isVisibleTo` the session. Every reader goes through it, so the rule covers the door and spot-count outboxes and the receiving rail at once.
- **Legacy entries** (queued before the stamp): a door receipt binds to the house its payload names (ADR 0140 already scoped their drop records by house, so a receipt waiting on a tablet when this ships is not lost). A spot count would bind the same way, but `SpotCountPanel` never set `restaurantId` on one, so every legacy spot count names no house. Any other legacy entry that names no one is visible to every session. The SyncManager parks its own such entries as `unowned`, and they show as "not sent" with Discard only; it never sends them. A legacy spot count is not parked by this PR; it counts as waiting. **Until the second OD-203 PR, `spotCountOutbox` still sends a legacy spot count under whoever is signed in, as it did before this PR.** That PR parks it instead. [Done in #530.]
- **Also stated, from the ADR 0090 review.**
  - The not-sent strip's Discard also uses `window.confirm`.
  - A strip holding only `unowned` changes still shows Try again, which does nothing for them.
  - With the shell design flag off (the QA override `mudavym.design.shell=0`), the legacy banner shows no "not sent" count.
  - `doorOutbox` and `spotCountOutbox` read the session once per flush, not per entry as the SyncManager does. A house switch in the middle of a flush can therefore send the rest of that flush under the new house's header. This behaviour predates this PR, which narrows what they load to the current person and house.
- **Retry** — `SyncManager` has no cap. Transient: no status, 5xx, 401 (the session ended — replayed after the same person signs back in), 408, 425, 429 → `retryCount + 1` and `nextAttemptAt` 30 s doubling to 15 min, ±20 % jitter. Permanent: any other 4xx → `parked: { reason: 'refused', status }`. The network coming back sends everything at once. After 5 failures a waiting change is counted "still trying".
- **Surface** — `AppOfflineBanner` (the shell's banner, live by default): **Not sent** · *N changes could not be saved and are kept on this device* · Try again · Discard (Discard confirms), and **Still trying** · Try now.
- **Sign-out** — `logout()` flushes the door and spot-count outboxes and the SyncManager once, counts what sign-out would remove, and asks `window.confirm("N changes have not been sent yet. They are kept only on this device, and signing out removes them. Sign out anyway?")`. Cancel returns `false` and changes nothing. Confirm signs out and removes that person's changes in every house, plus legacy entries naming no one; another person's changes and a legacy door receipt bound to its house stay. A refused refresh — the session ending without the person choosing — calls `endSession()`, which keeps the queue for the same person's next sign-in (Replicache's 401 rule; the founder's "if the person signs out" is a choice the person makes).

## Adversarial pass (a separate agent, told to kill it)

Verdict **SURVIVES, with fixes**. Taken:
- Sign-out deleted legacy door receipts of *other* houses (any entry without an owner) while counting none of them, so the warning could say nothing while deliveries went. **Fixed**: `endsWithSessionOf` removes only the person's own entries and legacy entries naming no one; the count uses the same predicate, so it never names fewer than are lost.
- The pass read the session once, but the API client stamps the house header at send time, so a house switch mid-pass (in this tab or another — `activeRestaurantId` is shared) sent the rest to the new house. **Fixed**: the session is re-read before every send; an entry no longer the session's waits.
- Two tabs flushed the same queue and, with no cap, could double a create whose first reply was lost. **Fixed**: one flush at a time across tabs (`navigator.locks`, `ifAvailable`); a tab that finds it held skips the pass.
- The pre-sign-out send skipped door receipts and spot counts. **Fixed**: `logout()` flushes both outboxes first.

Not taken, stated: `ChooseHouse.tsx:389` and `VerifyEmail.tsx:95` call `logout().then(navigate)` and ignore `false`, so Cancel there still goes to `/login` while signed in (those pages have no active house; `/login` redirects a signed-in person). Fixed in the second OD-203 PR, which had the file budget. `authStore.ts:190` has a second `logout` with no callers — left, named. A per-person database (option 3) — rejected above.

## Consequences

- **Easier.** The SyncManager can no longer send one person's change as another person, or into another house. No change the SyncManager queues disappears without the person seeing it. Until the second OD-203 PR, two exceptions remain, both stated above. The door and spot-count outboxes still drop changes after 8 attempts. They also still send a legacy spot count, or the rest of a flush interrupted by a house switch, under the current session. [Closed by #530, except that a door receipt the server refuses for good (any 4xx other than 401, 408, 425 or 429) is still dropped and pinned, not parked.] [That exception is closed too: §Amendment 2026-09-29 parks it.]
- **Harder or given up.** A permanently stuck change now costs one request per 15 minutes until someone acts on the strip. A change retried after days can overwrite a newer server value (last-write-wins; no base version is sent) — the same exposure as before, now without the cap that hid it.
- **Not solved.** Safari deletes script-writable storage after 7 days without a visit (webkit.org/blog/10218); a queue in a Safari tab left unopened for a week is lost with it. That is the platform, not this code; an installed home-screen app is exempt. `calendar.create` carries no idempotency key, so a create whose reply was lost can still be doubled by a retry (`provider.create` carries one).
- **`window.confirm`, not a house modal.** The standard browser prompt, used by every sign-out door at once; ADR 0112's modal shape would need a sign-out host component. Revisit if the founder wants the branded prompt.
- **Revisit when** a "not sent" entry is reported that the person could not explain (the classifier's 4xx rule is then wrong for that route), or the second PR's door/spot-count change lands.

## The second OD-203 PR (`fix/od-203-outboxes-never-drop`)

- `spotCountOutbox`: no attempt ceiling. A permanent refusal parks the count as "not sent", and the app-wide strip shows it. A transient failure is retried on the next flush. Before this, it deleted the count after 8 attempts or on any 4xx, and said nothing.
- `doorOutbox`: no attempt ceiling for transient failures. Before this, a receipt was dropped after 8 attempts. A 401 is now transient: the receipt is kept until the same person signs in again, which closes C4, where a 401 used to delete the receipt. A permanent refusal (any other 4xx) **keeps ADR 0140's pinned drop record**, which names the order on the receiving rail. [Superseded 2026-09-29 by §Amendment 2026-09-29: the founder chose to park it as "Not sent" instead; the rest of this bullet records the reasoning that ruling overturned.] This is the one place the rule "a refusal is parked, not deleted" is not applied. ADR 0140's rail is the surface porters already read. A door receipt the server refused as it stands (order closed, not found) cannot succeed by retrying. The pin keeps the order name and the reason, which is what the porter acts on. Revisit if a refused receipt is ever one the porter could have re-sent unchanged.
- Neither outbox backs off. Each flush is triggered by mount, `online`, `visibilitychange` or a sign-out (`logout()` flushes both first), never by a timer, so there is nothing to throttle, and a flush when the network returns should send at once.
- `ChooseHouse.tsx` and `VerifyEmail.tsx` honour `logout()` returning `false`.
- `doorOutbox` and `spotCountOutbox` re-read the session before every send, as the SyncManager does. A house switch in the middle of a flush now leaves the rest of that flush queued for its own house, instead of sending it under the new one.
- The receiving rail no longer shows an attempt count "of 8" or says "eight attempts failed". Its "no sync attempted — offline" inference counts only the receipts the flush can send, because parked entries, entries that are not this session's, and entries that name no one are skipped without being counted. A test covers this, and it fails when the old count is restored (measured).
- ~~**Open for the founder, not decided here:**~~ [Decided 2026-09-29 — the founder chose option 1, park it as "Not sent"; §Amendment 2026-09-29.] should a door receipt the server refuses for good be *parked*, like a spot count, instead of dropped with ADR 0140's pinned record? The pin names the order and the reason, but the receipt's counts are gone, and a proxy or captive-portal 4xx on dock wifi would drop it. The ADR 0090 adversarial review of #530 asked for this to go to the founder. It was not filed as an OPEN-DECISIONS row because a new row shifts register citations; it is raised in the session report instead.
- The tech-debt entry's heading is closed.

## Amendment 2026-09-29 — a refused door receipt is parked, not dropped

**The ruling (founder, chat, 2026-09-29, verbatim):** "option 1, not sent. but we have to find a way to optimizew storage using per device? what sindustry equilavent"

Option 1 was "Park it, show 'Not sent'". It closes the fork this ADR left open above (§The second OD-203 PR).

- **What changes.** A door receipt the server refuses for good (`isPermanentRefusal`: any 4xx other than 401, 408, 425 or 429) is **parked**, exactly as a spot count is: `updatePendingMutation(id, { lastError, parked: { reason: 'refused', status, at } })`. It is never deleted by the flush. `DoorFlushResult` counts it in `parked`, not `failed`, and loses `dropped` and `stranded`.
- **What this supersedes.** ADR 0140's drop-and-pin for permanent refusals: the flush no longer deletes a refused receipt and no longer writes a drop record (`recordDrop` and its strand marker are gone). The records already on devices are still read, shown, dismissed and adopted from the legacy keys, so a loss recorded before this is never hidden.
- **What still stands.** ADR 0140's principle — keep the receipt when storage fails, and claim nothing the storage cannot prove. Parking makes its "strand" case moot for new refusals: nothing is deleted, so no receipt can end up deleted but unrecorded. If the park write itself fails, the entry is left queued and unparked (counted `failed`), and the next flush meets it again.
- **The surfaces.** The receiving rail lists a parked receipt as "Not sent", with the refusal in plain words ("this account is not allowed to record deliveries" for a 403), **Send again** (refused only) and **Discard** (confirmed first: the count is not on the server). An `unowned` receipt can only be discarded — nobody to send it as — the same rule as `syncManager.retryNotSent`. The door screen says quietly that refused reports are kept on the phone as "Not sent". `pendingDoorCount` no longer counts parked receipts as waiting; `notSentDoorCount` counts them.
- **"Try again" on the app-wide strip.** `retryNotSent` un-parked door receipts and spot counts but then ran only `syncNow`, which skips both outboxes' types, so it did nothing for them. It now flushes both outboxes after un-parking.
- **The storage half** of the ruling ("optimize storage using per device", and the industry equivalent) is recorded separately in a following amendment.
- **Deferred** (filed in `tech-debt.d/2026-09-29-fix-door-refusal-parks-not-sent.md`): the online submit path still throws on a permanent 4xx instead of queueing and parking; a house switch during a 401 refresh can re-send under the new house and now parks the receipt under a wrong reason instead of dropping it; neither outbox backs off.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-29 | Founder | Ruled OD-203 (verbatim above). |
| 2026-09-29 | Research agent | Industry table above; Google Docs help page unreachable (bot check). |
| 2026-09-29 | Adversarial agent | SURVIVES with four fixes, all built; two items deferred to the second PR, named above. |
| 2026-09-29 | Build session | Tests fail on the old code: each production file reverted to `origin/main` fails the new tests. First measured as offline-storage 6, sync-manager 9, AuthContext 2 and AppOfflineBanner 2. The ADR 0090 correctness reviewer re-measured them after the adversarial fixes had added tests, and got **7, 11, 3 and 2**; those are the current figures. |
| 2026-09-29 | Build session (second PR) | `spotCountOutbox.test.ts` (9, all failing on `origin/main`'s outbox), `doorOutbox.test.ts` re-cut (5 failing on main's outbox), both re-measured by the ADR 0090 reviewer; `ChooseHouse.test.tsx` cancel case (fails on main's page). |
| 2026-09-29 | Build session (amendment PR) | Door refusal parks, not drops. New tests fail on `origin/main`'s copy of each changed source file: `doorOutbox.ts` 26, `DoorNext.tsx` 6, `useReceivingNextData.ts` 4, `RcOutboxRail.tsx` 3, `sync-manager.ts` 2 (of 110 in the five suites). |
