---
sketch: 118
name: login-flyleaf
question: "ADR 0143 row 35 (added 2026-09-17): '/login and /register take the flyleaf look of sketch 104 direction C — same fields and flow, nothing moves — sketch 118 first.' Two ways to carry that paper-book look onto the two forms the founder already knows: re-ink today's single centred card, or turn it into a two-page book with the house mark as its own endpaper?"
winner: B
tags: [login, register, auth, flyleaf, mudavym, directions, adr-0143, adr-0149, adr-0133, sketch-104, style-bar, sketch-only]
---

# Sketch 118 · Two directions for `/login` and `/register`

## Design question

ADR 0143 originally left `login` and `register` **open** because the founder rejected an
earlier redraw of them outright: *"It looks too modern... This just looks like an AI web
page"* (`0143:38-39`). Everything else in that record's scope got the colour-only "house
path" treatment (ADR 0133 §Decision 1, ADR 0143 §1) — same DOM, same classes, only the
palette swaps — and `login`/`register` already carry that switch today
(`usePublicDesign()`, gated by the `on` boolean threaded through both files). 2026-09-17,
in session, the founder chose a specific look instead of leaving it open: **row 35**,
*"Flyleaf look on login too — the paper-book look of sketch 104 direction C, same fields
and flow; sketch 118 first"* (`0149:117`), which the 0143 record itself notes
**reopens its own colour-only reading for exactly these two pages** (`0143:36`, the
2026-09-17 bracket). This file is that sketch — the one the ADR says goes to the founder
*before* anything is built.

Two things are therefore locked, not open, in every direction below:

1. **The look** — sketch 104 direction C's CSS, type and paper-book treatment,
   reused rather than reinvented: `Fraunces`/`DM Sans`/`JetBrains Mono`, the
   `--seal`/`--paper`/`--ink` token families on both grounds
   (`origin/feat/mudavym-new-pages:.planning/sketches/104-onboarding-directions/direction-c.html`).
   Direction C is the one the founder kept in the five-way review of that same sketch
   (*"the arrival, five ways"*, `verdicts/c`, 2026-09-12, verdict **keep**): *"/register
   is great flyleaf is cool, just make sure to keep it [s]imple... keep it readable not
   too much info looking at once, with not tiring the eyes... make sure to add our
   motions to the buttons."* A, B, D and E were reworked or merged away — C is the only
   one of the five never asked to change, and the founder's own words on it are the
   style bar in miniature, a session before ADR 0149 row 38 wrote the general version.
2. **The fields and the flow** — every field below is read off `Login.tsx` and
   `Register.tsx` on `wt-finish` as they stand today; nothing is renamed, reordered,
   added or dropped. See "What every screen reads" below for the field-by-field source.

What is genuinely open, and what these two directions answer differently, is **how much
of a book the page becomes** to carry that look — see "The fork between A and B."

**The wider style bar** (ADR 0149 row 38, added the same session): people-facing pages
follow *Wave Four*, *The Arrival, Five Ways* and *Documents and Reports Redesign* —
"simpler, easy to read, better UI"; technical pages may stay dense. Concretely, both
directions here drop sketch 104's own `.ln` three-column ledger row (label · value ·
provenance) for a plain vertical label-above-field form: a sign-in form is not an audit
register, and the provenance marks that make sense on `/get-started`'s book (pencil ·
posted · c/f) have no referent on a login screen. The paper, the ruled lines, the serif
headings and the seal survive; the ledger density does not. Rationale text that sketch
104 prints inside its `.note` boxes moves to the `.cite` caption *under* each frame here,
per the style bar's "no rationale prose printed as product copy."

## How to view

```
open .planning/sketches/118-login-flyleaf/direction-a.html
open .planning/sketches/118-login-flyleaf/direction-b.html
```

Self-contained, render from `file://`; the Paper/Charcoal toggle top right is live (same
script as sketch 104's). Ten numbered frames in each file, in this order: login (sign
in), register's door (create vs join), opening a house (create, step 1), the house
(create, step 2 — restaurant + **currency**), joining a house (invite code read-back +
join form), wrong password, locked out (429), loading, a Google-only account, and a 390
mobile rendering. Screenshots in `shots/` (`direction-{a,b}-{1440,390}.png`), rendered
with `p4-scratch/render-sketch.mjs`; both files render under Chrome's 16384px single-shot
limit (A 8525px, B 8307px at 1440 · A 8668px, B 10208px at 390), zero console errors, zero
horizontal overflow at either width — checked after two real fixes made during this pass
(see "Render check").

## Direction A — The single leaf (`direction-a.html`)

**Idea.** Today's centred `AuthCard` stays exactly where it is, exactly the width it
roughly is, doing exactly what it does — only its skin changes: the white rounded card
becomes one ruled paper leaf (the repeating-gradient rule lines from sketch 104's `.page`,
minus the book, minus the spine, minus the second page). No new layout primitive, no
second surface to keep in sync. The closest reading of "nothing moves" available, and the
smallest structural distance from what the founder already approved once (ADR 0133 §1).

Ten leaves, one screen each: `01` sign-in (step 2 of the identity-first flow — password +
Google, the amber "no sign-in method" state's sibling); `02` the register door (today's
two feature cards, quoted down to two quiet lines); `03`–`04` the create path's two real
steps (account, then restaurant + currency); `05` the join path (code, read-back, form,
all on one leaf, matching how sketch 104 itself drew its own join door); `06`–`09` the
four required states (wrong password, 429, loading, Google-only); `10` the same leaf at
390, losing only its border and shadow under 480px.

## Direction B — The endpaper (`direction-b.html`)

**Idea.** A hardback's first leaf is pasted to the cover and decorative — the
book's own pattern, never a page you read. This direction draws that leaf for real: a
permanent panel, left, tiling the house's own wax-seal glyph (the same path sketch 104
uses for its "hold to seal" control, `104:242`) as a printer's pattern, with the
wordmark and one still line of house voice — and the working page sits beside it, on the
recto, changing per screen. On the two-step create leaf and the join leaf, the endpaper's
line becomes the house's own name the moment the form has one ("Lokanta Meyhane" — the
one place across all twenty frames where the endpaper itself changes). More object than
A — closer kin to `/get-started`'s own flyleaf-as-book language (ADR 0143's bracket note
on row 35 keeps that name for `/get-started` specifically) — and a bigger structural
addition: a new two-column shell, not a re-skin of the existing one.

Same ten screens as A, each now a `.book` (340px endpaper + a 600–680px leaf) instead of
a single leaf. At 390 the two pages cannot sit side by side, so `10` stacks the endpaper
as a 150px band above the leaf rather than dropping it — the one place the two directions'
390 renderings differ in kind, not just in width.

## What every screen reads, and where it comes from

| Screen | Fields / controls | Source |
|---|---|---|
| Sign in, step 2 | resolved-email chip + Change, Password, Forgot password?, Sign In, Google | `Login.tsx:206-404`; methods drawn only from `identity.methods` (`identityProviders.ts`), never inferred from the domain |
| Sign in, step 1 (not drawn as its own frame — see `.cite` note on §01) | Email Address, Continue | `Login.tsx:206-229`; posts `POST /auth/sign-in-methods`, rate-limited 10/10 min (`auth.controller.ts:520`) |
| Register door | "I'm opening a new house" / "I have an invite code" | replaces `Register.tsx:253-330`'s two feature cards (icons, bullet lists, a "Most Popular" pill) — same fork, quieter |
| Opening a house, step 1 | Full name, Email, Password, Confirm password | `Register.tsx:791-903` |
| The house, step 2 | Restaurant name, Cuisine, Country, Address (Google Places), City, District, **Currency**, Phone | `Register.tsx:1150-1430` (`restaurantSection` 1–3, drawn here as one flowing leaf — see Shortcuts); currency statement verbatim from `CurrencyStep.tsx:44-50` |
| Joining a house | Invite code (8 chars), read-back, Full name, Email, Password, Confirm password | `Register.tsx:191-242` (code, 400ms debounce), join form fields `:608-720` |
| Wrong password | red note + disabled-looking field | server answers `401 Invalid credentials` for a wrong password **and** an unknown address alike (`auth.service.ts:206,268`) — an enumeration guard; the page never says which |
| Locked out / 429 | amber note, disabled Continue | real limit on `POST /auth/sign-in-methods`: 10 req / 10 min, per network, in-memory per gateway instance (`rate-limit.guard.ts:181-191`); **not** an account lock — see Shortcuts |
| Loading | spinner + "Signing in…" | `Login.tsx:346-350`; Register's own loading copy is "Creating your restaurant…" (`:1417-1422`) and "Joining…" (`:748-752`) |
| Google-only account | resolved-email chip, Google button only, no password field | `showPassword=false, showGoogle=true` when `methods=[google]` (`Login.tsx:166-168`) |
| Microsoft, honest edge | dashed "linked but no button here" row | `identity.unavailable`, off by default (`SHOW_DECLARED_PROVIDERS=false`, `Login.tsx:59`) — drawn once, in §09, as the rare case it is, not a standing dead row |
| Google button | real glyph, outline theme, "Sign in with Google", rectangular, 360px | `GoogleSignInButton.tsx:29-42` (glyph), `:119-125` (render config) |

## The fork between A and B

| | A · The single leaf | B · The endpaper |
|---|---|---|
| Distance from today's shell | smallest — same silhouette, new skin | larger — a new two-column shell |
| Reads as | today's card, re-inked | a book object, kin to `/get-started`'s |
| What changes per screen | the whole leaf | only the recto; the endpaper is static except when a house name exists |
| 390 behaviour | the same leaf, thinner chrome | the endpaper drops beside the leaf and stacks above it |
| New component surface | `AuthCard`/`AuthShell`'s existing paper variant, extended | a new `Endpaper` (or book shell) component |
| Brand presence | quiet | more — the mark and the wax pattern are always on screen |

## Recommendation

**[2026-09-19, the founder: "B, the endpaper", chosen over the recommendation below (ADR 0149 row 35).]**

**Ship Direction A.** Three reasons, in order of weight:

1. **It is the more literal reading of "nothing moves."** ADR 0143's colour-only rule was
   reopened for these two pages *specifically for the paper-book look* (`0143:36`) — not
   for a structural redraw. A stays inside that reopening: one component's skin changes,
   the page's shape does not. B adds a shape today's page has never had.
2. **The founder has twice now reacted to distance from what he knows** — once rejecting
   an earlier login/register redraw as "too modern," once ruling C (the quietest, most
   continuous direction) the keeper of five onboarding directions and reworking or merging
   away the other four. A is the C of this two-way fork.
3. **B's real payoff — the house mark always on screen — is a duplicate of what
   `/get-started`'s own book will do**, once that flyleaf is built (ADR 0143's row 35
   bracket keeps that name for `/get-started`, unbuilt today: no file in `apps/web/src`
   matches "flyleaf"). Two different objects both claiming "the house's book" a few clicks
   apart is a cost B pays for a distinctiveness A does not need — a sign-in form's job is
   to be recognised instantly, not to be admired.

B is not wrong — if the founder wants login/register to read as unmistakably the same
object as `/get-started`, it is the fork that does that — but that is a step beyond what
row 35 asked for, and it is the more expensive one to build and maintain (a new shell
component, a second responsive behaviour, a house-name binding on the endpaper that has
no failure-state drawn here). Recommend building A first; hold B in reserve if the founder
sees these side by side and wants the bigger object.

## The founder's build directions, 2026-09-19

The verdict itself (B, the endpaper) is the bracket under Recommendation, recorded in
ADR 0149 row 35.

**Build directions.** At about 04:45Z he reviewed the first build (a render of the
in-progress lane) and said *"do all of your recommendations"*. The resulting rules, as built:

1. **No rule crosses a word.** Each line of the leaf's title and lede sits on its own
   rule, and every field is a rule. The page-wide ruled background is gone, because it
   cannot stay on the baseline once an invite card, the Google button or an address
   picker sits between the lines.
2. **The door is two plain acts**, as frame 02 draws it: *I'm opening a new house*,
   then *I have an invite code*. The four sales cards stay on today's page only.
3. **On a phone the endpaper is a stacked band**: the kicker, then the wordmark, then
   the house line. Nothing overlaps.
4. **Each thing is said once.** The folio is the only place a step is counted, and the
   leaf title is the only heading. The inner headings, step bars and join banner stay on
   today's page. The endpaper holds still, except for the house's name once the form knows
   it, and "*X* is expecting you, as a *Y*" when joining.
5. **A refusal speaks in the book's voice** (frames 06-07), as a note in the margin.
   The status hue marks only the note's rule and title. "Checked and good" is shown in the
   seal colour, not green. The book hangs from the top of the screen, so a message
   lengthens it downward and nothing moves.
6. **Ledger fields and square plates**: a mono label, an underline-only field whose rule
   turns seal and doubles in weight on focus, and square buttons. The invite code is
   written into eight ruled cells. All of this is in `endpaper.css`, scoped to the shell,
   so no caller's fields, names or order change.
7. **The endpaper is pressed with the real seal**: `Seal.tsx`'s die, the A+M interlock
   over the double rule. The pressing is heaviest toward the gutter and fades where the
   page is written on.
8. **The leaf turns** when the screen changes (`turn`, 420ms). The endpaper never moves.
9. **The logo's signature motion, "The mark draws"**, from his own curation of the motion
   canvas (sketch 087 `founder-curation.dc.html`, *Entrances & reveals*). The name is
   written left to right, the full stop is struck, and the double rule is drawn. It
   plays on first render, once per page load (`MarkDraws.tsx`). Reduced motion shows
   the finished mark.

**Google also sits on the first page**, under the address (his answer at about 05:00Z,
recorded with the verdict in ADR 0149 row 35 and ADR 0143's bracket). This deliberately
changes "same fields and flow". An unknown Google account is still refused by the gateway.

**Not built:**
- The front-matter Easter egg: clicking the endpaper turns back to a poem about the
  house, or closes the book onto its back cover. He asked for a sketch first; it is
  being drawn for his review and nothing of it is built.
- Four more signature moments from the motion canvas were offered: the seal on success,
  the invite code becoming a person, the wrong password wiped gently, and "the house
  knows you". His answer was *"not sure, if we don't need it then don't"*, so none is
  built, and none should be added without a new ask.

## Shortcuts taken, said plainly

- **Register's three-screen restaurant step is drawn as one flowing leaf.** The real page
  paginates name/cuisine/country, address/city/state/postal/neighbourhood and
  currency/phone across `restaurantSection` 1–3 (`Register.tsx:1150-1430`); every field
  survives here, none renamed, but the pagination itself is compressed for legibility. A
  faithful build keeps the three screens; this sketch does not commit to how their own
  leaf/book chrome would repeat three times.
  - the Google Places address field is drawn as a plain text input; the live autocomplete
    dropdown is not drawn in either direction.
- **The 429 is attached to `POST /auth/sign-in-methods` (step 1), not to `/auth/login`
  itself.** That route carries no dedicated rate limit beyond the global default
  (100 req/min, `rate-limit.guard.ts:28`); sign-in-methods' 10/10 min is the limit a real
  user is likeliest to hit through ordinary retries, so it is the honest choice for
  "locked out" — but there is no true account-lockout feature in this codebase, and
  neither direction invents one. The copy says "too many tries," never "account locked."
- **"6 minutes" in the 429 note is illustrative**, not read from a live
  `X-RateLimit-Reset`; a real build reads the header.
- **Charcoal ground is built and correct** (spot-checked, not screenshotted per-direction
  — see Render check) but only the Paper ground is captured in `shots/`, matching sketch
  104's own convention.
- Every name, email and invite code is invented (Defne / Hasan / Lokanta Meyhane); the
  routes, files, line numbers and rate limits cited are real, read on `wt-finish` on
  2026-09-17.
- Neither direction wires the Google Identity script for real — the button is a static
  rendering of its real `theme:outline, size:large, shape:rectangular, width:360` config
  (`GoogleSignInButton.tsx:119-125`), not a live GSI mount.
- **No motion is drawn.** The founder's own note on this direction asked for it
  ("make sure to add our motions to the buttons," `verdicts/c`) and sketch 104 answers
  with `settle`/`turn`/`stamp` from `lib/mudavym/motion.ts` elsewhere in the corpus; a
  real build of either direction owes hover/press states on every `.btn`/`.gbtn`/`.word`
  at minimum, which these static PNGs cannot show.

## Render check, 2026-09-17

`p4-scratch/render-sketch.mjs` at 1440×900 and 390×844, full page, both files. Two real
defects found by looking at the PNGs, not assumed away:

1. **Direction A, 390 width:** the example email `defne@lokantameyhane.com` clipped
   mid-word inside every `<input>` (not the chip-row spans, which wrap fine) — the field
   was correctly 100% of its container; the value was simply too long for it on a
   390px phone at 15px type. Fixed by shortening every example address to
   `@meyhane.com` throughout both files, not by widening the field past what a real phone
   offers.
2. **Direction B, 390 width:** `horizontalOverflow: true` — a classic CSS Grid blowout.
   `.book`'s children (`.endpaper`, `.leaf`) default to `minmax(auto, 1fr)`, and `auto`
   resolves to each child's min-content width; the invite-code row's eight fixed boxes
   pushed `.leaf`'s min-content past the viewport even inside a `1fr` track. Fixed with
   `min-width:0` on both grid children (the standard grid-blowout fix) and a tighter code-box
   size at the same breakpoint. Re-rendered clean: `horizontalOverflow: false`, both widths,
   both files.

Zero console errors in any render. Fonts load from Google (`fonts.googleapis.com`), same
as the product does today (`apps/web/index.html`) and same as sketch 104 and all three
style-bar reference artifacts.

## Related

- [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] — row 35, and the
  "too modern... AI web page" quote this sketch answers
- [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] — rows
  35–38, the founder's 2026-09-17 session (this sketch, the sixteen-page go-live in
  parallel, the public-doors switch, the style bar)
- [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] — the
  `usePublicDesign()` switch both `Login.tsx` and `Register.tsx` already carry
- Sketch 104, direction C — `origin/feat/mudavym-new-pages:.planning/sketches/104-onboarding-directions/direction-c.html` — the CSS and type this sketch reuses
- `origin/claude/artifact-pull:.planning/07-reference/artifacts/{mudavym-wave-four,the-arrival-five-ways,documents-and-reports-redesign}.md` — the style-bar references (ADR 0149 row 38); *The Arrival, Five Ways* also carries the founder's per-direction verdicts on sketch 104 (Direction C: **keep**)
