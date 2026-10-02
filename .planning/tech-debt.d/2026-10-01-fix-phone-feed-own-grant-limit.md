## A staff grantee's own grant limit was hidden on the phone feed — ~~OPEN~~ FIXED by `fix/phone-feed-own-grant-limit` — 2026-10-01

Filed by `fix/phone-feed-own-grant-limit`. That branch is stacked on `fix/phone-feed-no-money-for-staff` at ebd69b364 and must merge after it. It builds what that branch's entry left open:
- `tech-debt.d/2026-10-01-fix-phone-feed-no-money-for-staff.md:86-87` ("Fix round 2", item 1, "Not yet built");
- `:173` (open item 2, the grant-limit part).

The two rulings, verbatim:
- The founder, 2026-10-01: *"Show their own limit (Recommended)"*.
- Then, on how, by AskUserQuestion relayed by the coordinator: *"Record the grantee (Recommended)"*.
- Rejected: "Look it up each load" and "Leave it".

The build needed `authority-grants.service.ts`, a 16th file against the base branch's cap of 15. The coordinator chose a stacked branch over dropping a file from the base.

Line numbers are at this branch's head.

**What.** `tell()` sends `authority_grant_issued` and `authority_grant_reapproved` to every owner and to the grantee (`organizations/authority-grants.service.ts:566`). The sentence names the grant's money limit, such as "(up to 1234.5 USD, until revoked)". A reader of that row who does not see money is one of two people:
- the grantee, whose own limit the founder wants shown;
- an owner later demoted in the same house, for whom it is someone else's limit.

The row did not say whose grant it was. So the base branch kept both types off `MONEY_FREE_NOTIFICATION_TYPES`, and the grantee got the card's neutral line.

**Fix.**
- **Writer.** `tell()` records the grantee as `metadata.granteeUserId`, taken from `grant.grantee.userId` (`authority-grants.service.ts:579-589`). This is on every `authority_grant_*` notice it writes, so each owner's copy names the grantee too.
- **Feed.** `isOwnGrantNotice(type, meta, userId)` (`mobile/mobile.service.ts:142-158`) holds only when all of these are true:
  - the type is on `OWN_LIMIT_NOTIFICATION_TYPES` (`:137`), which is exactly the two grant types, neither of them on the money-free list;
  - the metadata is an object;
  - `granteeUserId` is a non-empty string;
  - it equals `userId`, which is `getFeed`'s first parameter. The controller fills it from the token's `user.userId`.
- **Where the gate applies.** `sayMessage` gains it as a third term (`:314-317`). So the grantee's card says the sentence, and every other reader who does not see money keeps the neutral line.
- **Meta.** The card's `meta` is still cut to `NON_MONEY_META_KEYS`. `granteeUserId` and `grantId` never reach such a caller, the grantee included.
- **Owners and managers.** Output is unchanged; the spec checks every grant row's message and the very metadata object.
- **Why the two extra checks.** The string and non-empty checks are not redundant. Take an old row (no grantee) read by a caller whose `userId` is undefined: `undefined === undefined` would say the sentence. The same holds for two empty strings. Specs cover both.
- **Controller.** The `getFeed` description (`mobile/mobile.controller.ts:41`) said the subtitle is the message "only for a type on the service's money-free list". This branch made that untrue, so it now names the grantee case. That is a seventh file the coordinator's list did not name; it changes nothing but the description.
- **Base claim.** The base claim (`claims.d/fix-phone-feed-no-money-for-staff.jsonl`) is amended, the sixth file. Its verify pins the exact `sayMessage` shape, and that shape now ends in the gate. Its prose stops saying the case is unbuilt.

**Older rows.** Rows written before this branch carry no `granteeUserId`, and they never show the limit on the phone. The ruling accepts this; it is what "Look it up each load" would have covered. Production was not queried for how many such rows exist.

**Tests** (in `/Users/aldemirkonuk/Projects/wt-own-grant-limit`, node_modules linked):

| Run | Result |
|---|---|
| `mobile/mobile-feed-money-for-staff.spec.ts` | 75/75, 23 new; it was 52 at ebd69b364 |
| `src/mobile src/organizations src/notifications src/team` | 50 suites, 999/999 |
| spec `tsc --noEmit` (scratch tsconfig over the spec) | clean |
| eslint on the 3 touched `.ts` files | 0 errors |
| eslint warnings in `authority-grants.service.ts` | 54, the same 54 as at ebd69b364; the file was never prettier-formatted |
| prettier on the 3 mobile files | clean |
| `bash scripts/check_decision_claims.sh` | 815/815 holding; 814 + this claim |

What the new spec cases check:
- The writer, `tell()` stubbed at its collaborators, for issued and re-approved. It checks the audience (both owners and the grantee) and the type, title, message and metadata against the spec's fixtures. The fixtures are therefore what the writer writes, not a guess.
- Owner and manager readers.
- Every non-money role:
  - their own grants say the sentence;
  - each of these keeps `""` with no figure on the wire: an old row, someone else's grant, a grantee given as a list, `metadata: null`, and a sales notice naming the reader;
  - a caller with no id, or an empty one, keeps `""`.

**Not run:**
- the whole gateway `tsc`. It stops at 2 errors in `passkeys/passkeys.service.ts`, because `@simplewebauthn/server` is not installed in the linked node_modules. That file is not touched here.
- the phone app on a device or simulator. The phone renders `subtitle` as before and no phone file changed.

**Spec mutations** (`cp -p` snapshot, restore, `cmp` byte-identical each time; never stash). 13 of 13 fail the spec:

| Mutation | Failed |
|---|---|
| writer drops `granteeUserId` | 2 |
| writer records the actor | 2 |
| gate term removed from `sayMessage` | 6 |
| gate returns true | 24 |
| gate ignores the type | 6 |
| empty grantee accepted | 6 |
| `typeof` check dropped | 6 |
| gate handed the house id | 6 |
| gate matches any non-empty grantee | 18 |
| `service_closed` made grantee-only | 7 |
| `authority_grant_issued` called money-free | 26 |
| re-approved dropped from the grantee-only set | 7 |
| both sources at ebd69b364 | 9 |

One mutation survives, as expected: dropping the gate's object check. The feed hands the gate `n.metadata ?? n.meta ?? {}`, and a property read on any non-null value is `undefined`, so in the feed that check changes nothing. The claim pins the line instead (below).

**Claims, mutation-tested on scratch trees** (the worktree is never written).

`ADR-0253-PHONE-FEED-OWN-GRANT-LIMIT` (new, `claims.d/fix-phone-feed-own-grant-limit.jsonl`) kills 23 of 23. They are:
- the writer:
  - drops the grantee;
  - records the actor;
  - records the grant id;
- a second notice writer in the register;
- the grantee no longer told;
- the grantee-only set:
  - widened;
  - narrowed;
- a grant type called money-free;
- the gate:
  - ignores the type;
  - returns true;
  - accepts an empty grantee;
  - drops `typeof`;
  - matches everyone but the grantee;
  - matches any grantee;
  - reads the grant id;
  - drops the object check;
- the gate in `sayMessage`:
  - dropped;
  - handed the house id;
  - called twice;
- `userId`:
  - reassigned;
  - shadowed;
  - destructured;
- the controller handing the house id.

`ADR-0253-PHONE-FEED-NO-MONEY-FOR-STAFF` (amended) kills 44 of 44. That is round 2's 41, re-anchored on the new `sayMessage`, plus three new ones: the gate dropped from the line, joined with `&&`, and handed the house id.

Both claims fail on whole trees at 4bd11a00e, 6a714f2a4, b02d931cd, ebd69b364 and `origin/main`.

**Limits (not changed here).**
- **The web Notifications screen** still shows every recipient the full sentence (base entry, open item 2's surface). A demoted owner still reads someone else's limit there.
- **`granteeUserId` is visible to recipients.** It is in the row's metadata for every recipient of the notice: the owners and the grantee. It is a user id they can already map to the name in the sentence.
- **The other grant notices** (`revoked`, `deleted`, `hidden`, `shown`) now carry `granteeUserId` too. They were already on the money-free list, so who reads their sentence does not change.
