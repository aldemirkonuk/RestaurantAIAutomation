---
type: handoff
title: Page retirement — register items for the OPEN-DECISIONS owner
branch: feat/retire-legacy-pages
updated: 2026-08-26
links: ["[[../06-pages/RETIRED|RETIRED]]", "[[../decisions/0019-p2-build-scope|ADR 0019]]"]
---

# HANDOFF — page retirement (ADR 0019 §B)

Written by the `feat/retire-legacy-pages` session. Three agents ran in parallel and
`OPEN-DECISIONS.md` / `CLAIMS.jsonl` were owned exclusively by another one, so
everything below that belongs in the register is recorded here instead of applied.
~~**Nothing in this file has been written to the register.**~~ **§1 was applied 2026-08-26 on `fix/od-80-dead-code`; §5.2 was already fixed on `main` by #98 — see the status lines under each.**

The retirement itself, its parity tables and the redirect decision are in
[`.planning/06-pages/RETIRED.md`](../06-pages/RETIRED.md). This file is only the
register delta.

---

## 1. OD-80 is unblocked — apply the cleanup **and** flip both claims together

> **APPLIED 2026-08-26** on `fix/od-80-dead-code`. Both halves plus both `CLAIMS.jsonl`
> flips landed in one commit; OD-80 moved to the Resolved table. Verified:
> `tsc --noEmit` 0 errors, `vitest run` 369/369 in 48 files, claims guard
> **94 checked, 94 holding**. The atomicity requirement was proven, not assumed —
> re-opening just the two claims on the fixed tree makes the guard exit 1 with
> *"STALE (2) — listed as open, but already true"*.

OD-80 says it is *"Blocked on branch, not on a decision… no part of this can land
`tsc`-green on any branch where `Calendar.tsx` still exists."* **That condition is
gone.** `Calendar.tsx` and `EntityAutocomplete.tsx` were deleted in `58113e26`, which
is on `main`. Both halves of OD-80 re-verified on `origin/main` @ `63c2bccd`,
2026-08-26.

**Why this branch did not do it.** The two OD-80 rows in `CLAIMS.jsonl` are
`status: "open"`. `scripts/check_decision_claims.sh` fails the build when an `open`
claim already verifies ("STALE — listed as open, but already true"). So the code
cleanup and the claim flip must land in the **same** commit, and `CLAIMS.jsonl` was
not this session's file to touch. Doing the code half alone would have broken CI.

### (a) `apps/web/src/types/companyClass.ts` — entirely dead, delete it

Re-verified: 743 lines, 25 exports, and a `grep -rnwE` for **all 25 names** across
`apps/web/src`, `apps/mobile/src`, `apps/mobile/app` and `packages` returns **nothing**
outside the file itself and the `types/index.ts` barrel. `tsc` stays green today only
because the barrel re-exports it.

```
delete  apps/web/src/types/companyClass.ts
sed -i '' '70,102d' apps/web/src/types/index.ts
```

Line 70 is the blank before the section; 71–72 the comments; 73–83 the `export type`
block; 84 blank; 85–102 the `export {` block. Taking `71,102` instead leaves a double
blank at the seam. Verified against the current file, not copied from the register.

### (b) `apps/web/src/data/customEventTypes.ts` — three exports lose their last caller

The module **survives**: `EventModal.tsx:22` imports `addCustomEventType`,
`getCustomEventTypes`, `isEventTypeNameAvailable` and `deleteCustomEventType`.

```
sed -i '' -e '88,105d' -e '65,80d' apps/web/src/data/customEventTypes.ts
```

Removes `isCustomEventType` (`:68`), `getCustomEventTypeByName` (`:76`, **no caller
anywhere in the repo, ever**) and `EVENT_TYPE_COLORS` (`:92`). Delete the high range
first or the line numbers shift.

⚠️ `pages/calendar/CalendarPage.tsx:43` declares its **own local** `EVENT_TYPE_COLORS`
— a different constant with a different shape (`Record<string,string>` vs an array of
`{name,value}`), not an import. It must survive; ~~six~~ **seven** call sites depend on
it (`:187, :216, :630, :667, :678, :688, :696` — the list was right, the count was not).

### Claim flips that must ride the same commit

Both currently `"status": "open"` (lines 23 and 24 of `CLAIMS.jsonl`). Flip to
`"resolved"` and set `"verified": "<date applied>"`. Their `verify` commands already
encode exactly the edits above and need no change.

Verify with `cd apps/web && npx tsc --noEmit && npx vitest run && bash scripts/check_decision_claims.sh`.

---

## 2. OD-83(b) — confirmed, and confirmed closed

The register already marks OD-83 ✅ Resolved (`OPEN-DECISIONS.md:103`). This session
re-derived it independently rather than trusting that, because it was handed to us as
an open "known loss":

- The claim was **true**. `/calendar-classic` had `useCalendarEventsSubscription`
  (`Calendar.tsx:34, :692`) and the modular page did not.
- It is **closed**. `CalendarPage.tsx:33, :164`, with a regression test at
  `CalendarPage.realtime.test.tsx`.

No register change needed. Recorded so the next handoff stops carrying it as open.

---

## 3. Refuted — "`/inventory-legacy` hosts a modal posting to a nonexistent endpoint"

Still circulating in handoffs; **false as stated**, and `v3.0-TECH-DEBT.md:96` already
says so.

- The nonexistent-endpoint modal is `InvoiceScannerModal`
  (`POST /invoices/:id/add-to-inventory`, no controller). It was deleted in `e5402d67`
  and was not reachable from `/inventory-legacy` when the claim was filed.
- `ManualOverrideModal` — the modal that actually was on that page — called
  `PATCH /inventory/:restaurantId/item/:itemId`, which **exists**
  (`inventory.controller.ts:288`) and whose DTO accepts `stockLive` and `shadowStock`
  (`inventory.dto.ts:133-143`). Its real defect was different: it dropped reason,
  category, notes and actor into local state. Not ported, deliberately —
  `reconcileItem` on `/inventory` records all four.

---

## 4. One real regression the retirement left, fixed on this branch

`/inventory-legacy` honoured the Settings measurement unit; `/inventory` did not.
Three hardcoded-`ml` sites, restored in `bc7ef90b`. Detail and citations in
[RETIRED.md](../06-pages/RETIRED.md). Flagged here because it is the kind of loss a
route-level parity check misses entirely: nothing was missing, a *setting* stopped
applying.

---

## 5. Two pre-existing test defects found while verifying (neither caused here)

Both baselined against `origin/main` @ `63c2bccd` in a clean worktree.

1. ~~**`OneTapActionCenter.test.tsx` is flaky.**~~ **Already fixed on `main` while this
   branch was in flight — `daa68396` (#100), filed as OD-96.** Recorded anyway because
   the two sessions found it independently within the hour and neither saw the other:
   *"puts the card back and reports the error when the server refuses"* failed once
   here and passed on rerun, while `origin/main` @ `63c2bccd` ran 369/369 green and the
   file passed 15/15 in isolation. The cause was a node captured across an `await`
   boundary that `AnimatePresence` then detached — not the missing node the failure
   message implied. **No action needed.**
2. ~~**`e2e/studio-flow.spec.ts:5` "login page renders correctly" fails on `main`.**~~ **Fixed on `main` by `73e43131` (#98) — and the diagnosis below is wrong; see the correction after this item.**
   `getByLabel('Password')` finds nothing. Reproduced on `origin/main` before this
   branch existed. Note `e2e/navigation.spec.ts:57` already works around the same
   thing on `/register` with `input[type="password"]`, commenting that the inputs
   "carry no ids or associated labels" — so the login page likely has the same
   unlabelled-input problem and the fix is probably an accessibility fix, not a test
   fix.

   **Correction, 2026-08-26.** The a11y hypothesis is false *for `/login`*. `Login.tsx`
   pairs `<label htmlFor="email">`/`id="email"` (`:176`, `:184`) and
   `<label htmlFor="password">`/`id="password"` (`:262`, `:270`) — the labels are
   properly associated and `getByLabel` resolves them. `getByLabel('Password')` found
   nothing because the field **is not rendered at step 1**: it sits behind
   `{showPassword && (…)}` (`Login.tsx:259`), which identity-first sign-in (ADR 0024)
   gates on `POST /auth/sign-in-methods`, and e2e runs with no gateway behind the vite
   proxy. #98 rewrote the test as *"login page renders step one: identify yourself"* and
   inverted the assertion to `toHaveCount(0)`, which now guards against a regression to
   the one-step form. **No further action on `/login`.**

   The unlabelled-input defect `navigation.spec.ts:58` describes is real, but it is on
   **`/register`**, a different page: `Register.tsx` uses bare `<label>` with no
   `htmlFor` and inputs with no `id` at every field (`:525`, `:540`, `:608`, `:624`,
   `:702`, `:717`, `:785`, `:801`, and ~14 more). That was a genuine WCAG 1.3.1 / 4.1.2
   failure — ~~not fixed~~ **fixed 2026-08-26 on `fix/register-label-associations`**:
   all 17 labels associated (16 `htmlFor`/`id` pairs, flow-prefixed so the create/join
   flows can never collide; 1 group label for the CuisinePicker composite via
   `role="group"`/`aria-labelledby`), the label-less invite-code input given
   `aria-label="Invite Code"`, and `CountryCombobox`/`PlacesAutocomplete` given an
   `id` pass-through so their labels land on the inner inputs. `navigation.spec.ts`
   now asserts through `getByLabel` — the workaround comment is gone and the test
   guards the association. The sweep behind it found the same class app-wide
   (318 unassociated labels, 48 files, no a11y lint anywhere): filed as **OD-105**,
   and resolved the same day — founder call: allowlist-ratchet guard, `jsx-a11y/label-has-associated-control` as `error` with the 47-file backlog allowlisted in `.eslintrc.cjs`.

---

## 6. A guard that fires on any new note in `06-pages`

`CLAIMS.jsonl:19` (ADR-0018, "every page note in 06-pages carries a Surface section")
runs `grep -L '## Surface' .planning/06-pages/*.md` and excludes exactly two
filenames: `PAGE-CONTRACT` and `PAGES-MAP`. **Any** new note in that folder therefore
fails the build unless it carries a `## Surface` heading, whether or not it is a page.
Adding `RETIRED.md` tripped it.

Resolved here by giving `RETIRED.md` a genuine Surface section — the retired routes
have real outbound edges and they belong in the graph — so no register file was
touched and the guard is green (`83 checked, 83 holding`). If the intent was to check
only `type: page` notes, adding `\\|RETIRED` to that exclusion, or filtering on the
frontmatter type, is the register owner's call.

---

## 7. Not in scope, noted

`apps/mobile/app/wine-agent.tsx` is a **mobile** Expo route and still exists. Its
button correctly deep-links to `/sommelier`, but its file docstring (`:12`) still says
*"Deep-links to web /wineagent when configured"*, which the code below it contradicts.
Cosmetic; ADR 0019 §B covered the web routes only.
