# 0213 — Get-started is account, then house, then the first proof

- **Status:** Locked
- **Date:** 2026-09-22
- **Decider:** Aldemir (founder) — "approve ALL Opus recs" / "all 17 opus rec's" and **BUILD** (2026-09-22, relayed through the parent agent)
- **Keywords:** get-started, arrival, register, first-proof, ink, pencil, skip, Places, Google sign-in, OD-134, OD-135, OD-136, OD-137, OD-138, OD-139, OD-141, sketch-123
- **Links:** [[0169-the-ground-is-white-by-default-and-each-person-chooses]], [[0186-a-menu-upload-classifies-every-drink-not-only-the-wine]], [[0047-am-interlock-supersedes-rivet-m]], [00-OPUS-VERDICT.md](../07-reference/deploy/research-122-squad/00-OPUS-VERDICT.md), [FORKS-FOR-FOUNDER.md](../07-reference/deploy/research-122-squad/FORKS-FOR-FOUNDER.md)

## Context

After sketches 121 and 122, the 122-squad verdict recommended a new get-started
order: account-only signup, house created on the restaurant screen, menu as an
inscription, then a typeset **first proof** instead of a modal or register
readout. The founder approved every Opus recommendation as **A / as written**
and asked for the build. Nothing here invents a product choice past that word.

`#414` (`feat/finish-arrival`) and `#454` stay unmerged. This record does **not**
flip `mudavym_design_arrival`. Gate-owned `#415` / `#430` / `#434` stay with
their owner.

OD-123 and OD-124 already mean other forks on `main` (Sheet scrim; privacy
legal facts). The squad's draft mapping of F1–F7 onto those ids is **wrong**
and is not used. F1–F6 are OD-134–OD-139; F7 is OD-141 (`#414` already drafted an unpublished OD-140).

## Options considered

1. **A — the verdict as written** (chosen). Account-only `/register`; house on
   screen 2; skip the menu only; Places + location bias; Google as sign-in;
   first proof; ink/pencil; one footer for `none`.
2. **B — keep `/register` creating the house** (F1-B). Cheaper. Asks twice.
   Rejected with F1=A.
3. **Doing nothing.** Leaves `/get-started` as the legacy wizard and `#414` as
   a conflicting flyleaf book that is not the approved order.

## Decision

Lock the seventeen Opus recommendations as **A / as written**. One ADR because
they were decided as one founder word, not seven separate calls.

| # | Rec | Lock |
|---|---|---|
| 1 | **F1** (OD-134) | Account-only `/register` (name, email, password or Google). House created on **Your restaurant**. |
| 2 | **F2** (OD-135) | *Skip for now* skips the **menu only**. Address stays required. |
| 3 | **F3** (OD-136) | "Location advice" = Places search + *Use my location* bias. |
| 4 | **F4** (OD-137) | *Continue with Google* on `/register` — auth, not inbox reading. |
| 5 | **F5** (OD-138) | Reveal is **the first proof** at `/house/menu` — typeset, categorized, no modal. |
| 6 | **F6** (OD-139) | Customer copy is **ink / pencil**. Internal enum unchanged. Banned: certain, likely, confidence, %, verified, approve all. |
| 7 | **F7** (OD-141) | `none` registers are one footer line. Supersedes PAGE-WAVE-BLOCKERS §5 Q2. |
| 8 | Must fields | Name, email, password\|Google; restaurant name; address + country. TZ and currency are derived, shown, never asked as blanks. |
| 9 | Optional fields | Owner mobile (alerts-only); role (one tap, none preselected); restaurant phone. |
| 10 | Later | Locations, Gmail inbox read, vendors/POS/team/calendar, last invoice. |
| 11 | Not asked | EIN / tax ID / bank / cuisine. |
| 12 | Sequence | After verify: **You → Your restaurant → Your menu → Reading**. Welcome is You's headline, not its own screen. |
| 13 | Threshold / OptionalTail | Leave onboarding. Become house-contents lines (exactly one ask). |
| 14 | Keep from 122 | White ground default; 56px bar; 24px A+M mark; reading settles once; three counts; no checkboxes; frame-04 rules moved inline; failed-read honesty. |
| 15 | Keep from 121 | Book typography / ruled lines; three ruled ways in; one ask on the house page; vendors skip-first; motion tokens `turn / settle / ink / tally`; phone fold. |
| 16 | Proof interaction | Inline expand next to the source crop; dashed guess never preselected; no modal / sheet. |
| 17 | Honesty residuals | Failed read is never an empty proof. Kitchen lines are counted, not silently dropped. |

R1–R6 in the verdict stay research, not product forks. The pencil rule ships
as the fallback the verdict named: unmatched / uncategorised / unknown → pencil.

## Consequences

- `POST /auth/register/account` and `POST /auth/register/house` split tenant
  creation. Legacy `POST /auth/register/restaurant` stays for invite / older
  clients; the web create path no longer calls it.
- `/get-started` is the four-screen flow; `/house/menu` is the first proof.
- `#414` is not the get-started plan of record. Do not merge it for this.
- `mudavym_design_arrival` is not flipped and is not added to `LIVE_PAGES`.
- Retire-to-write: this ADR supersedes
  `07-reference/deploy/GET-STARTED-REDESIGN-2026-09-22.md` and sketch 122's
  "Still open" as the get-started decision. Sketch 123 draws the lock; 121/122
  stay as research records.

**[ITEM 62, 2026-09-27 — row 8 ("TZ ... derived, shown, never asked as
blanks") tightened on both SIGN-UP routes. Founder verbatim, item 62:
*"Browser zone, else none (Recommended)"*; rejected "Save nothing" (would
discard a good browser answer) and "Keep New York default" (the fault ADR
0116 had already removed from `restaurants.timezone` itself — the column has
carried no default and stayed nullable since
`20260903170000_a_default_is_not_an_answer.sql`, so no migration was needed
here). Until this change, "derived" was true only in the sense that a value
always arrived — `AuthService.registerRestaurant` wrote `dto.timezone ||
"America/New_York"` for the legacy route this ADR's Consequences names, an
application-level re-invention of the exact fabricated-default fault the
column-level fix had removed one layer down. `createFirstHouse` (the route
this ADR actually put `/get-started` on) had no such fallback but also no
validation, so a malformed client-sent string would have been stored as a
house's clock, unread by `Intl` anywhere in the write path.**
**Both sign-up routes now call one function, `resolveSignUpTimezone`
(`apps/api-gateway/src/auth/sign-up-timezone.ts`): `Intl.DateTimeFormat`'s
own resolved name for the caller's zone when `Intl` accepts it and that name
is not a bare UTC offset, `null` otherwise — never a substituted default,
never the caller's raw spelling (`"america/new_york"` is stored as
`"America/New_York"`; `"+05:00"`, which Node 22.22.2's `Intl` accepts, is
stored as `null`; measured 2026-09-27, pinned in `register-timezone.spec.ts`).
A THIRD route also creates a house and is NOT covered here:
`OrganizationsService.createLocation` (`POST /organizations/locations`, used
by `AddLocationDialog.tsx` to add a location to an existing organisation)
writes `dto.timezone ?? null` with no `Intl` check, and the dialog calls the
bare `Intl` expression this bracket replaces below. It never writes New York,
so it is outside item 62's words, but it is the same class of gap — filed in
`v3.0-TECH-DEBT.md` (2026-09-27) with the open CLAIMS row
`TD-2026-09-27-CREATE-LOCATION-TIMEZONE-UNVALIDATED`.**
**What a `null` zone means downstream is not uniform yet, and this bracket
does not change it. At `origin/main` 29ba4e820 the low-stock digest runs
EVERY house on a hard-coded New York clock
(`notifications/low-stock-alerts.service.ts:146,172`) whatever
`restaurants.timezone` holds, so storing `null` instead of
`"America/New_York"` changes nothing about the digest while that stands. The
digest's move to the house's own zone with a UTC fallback is PR #488 (item
61, OPEN when this was written); the on-page "UTC — this house has no time
zone set yet" line is a further follow-up that #488's page note assigns to
#486's lane. So the honest UTC fallback for a sign-up with no zone depends on
#488 landing — this change does not supply it; merging this first changes
nothing in the digest, because the digest ignores the column until then.
Other readers already carry `null` themselves (`scheduled-tenants.service.ts`
`TIMEZONE_NOT_SET`; `calendar-reminders.service.ts` falls back to UTC and
logs it; `vendor-terms.service.ts:716-717` uses a display zone flagged
`isColumnDefault`).**
**The web side (`Register.tsx`, `GetStarted.tsx`, `AuthContext.tsx`)
computed the "derived" zone with a bare
`Intl.DateTimeFormat().resolvedOptions().timeZone` — including once at
`GetStarted.tsx`'s render, feeding the visible "Timezone · {timezone}" line
row 8 promises is "shown." A runtime whose `Intl` cannot resolve a zone would
have thrown there and taken the screen down before the person ever reached
"This is us," rather than proceeding with no zone recorded. All three call
sites now go through `lib/browserTimezone.ts`'s `getBrowserTimezone()`, which
wraps the same call in a `try`/`catch` and omits the field on failure.]**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-22 | Aldemir (founder) | All 17 Opus recs = A; build |
