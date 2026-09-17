# 0133 — A public page has no house, so the public door has one switch

- **Status:** Locked 2026-09-06 — the founder's four answers in session (the public pages ship in place behind one deployment switch; the general assistant is a page plus the Ask AI panel, named **Mudavym**; `/no-access` is wired, not retired). The assistant's design is NOT decided here — it becomes its own record after the research fan-out (see §Consequences). **Amended 2026-09-11: the `/sommelier` HOLD clause is lifted — see Review trail.** Everything else in this record stands. **[AMENDED 2026-09-16 by [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]: the one public switch becomes permanent-on at cutover and its off branch is deleted; the founder also ratified the public doors' treatment, self-hosted fonts, a permanent redirect for the legacy hostname, and a search direction — see "Amendment 2026-09-16" below. Answered, not yet built.]**
- **Date:** 2026-09-06
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** public pages, login, register, feature flags, mudavym_design, VITE_MUDAVYM_PUBLIC, dark launch, no-access, wine-agent, Ask Mudavym, onboarding, sketch 104, ADR 0044, ADR 0131
- **Links:** [[0044-mudavym-implementation-kickoff]] (the per-house gate this record cannot use) · [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (Stream G — this wave) · [[0112-one-modal-policy-three-shapes-one-primitive]] · [[0113-the-assistant-proposes-the-seal-applies]] · [[0024-identity-first-sign-in]] · `.planning/06-pages/MAKEOVER-VERDICTS.md` (the founder's per-page verdicts of 2026-08-29) · `.planning/06-pages/PAGES-MAP.md`

## Context

ADR 0131 forked "the pages not yet rebuilt" to their own session (Stream G): `/login`,
`/register`, `/onboarding` and `/get-started`, the public focused pages (`/forgot-password`,
`/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`), `/promotions`,
`/vendor-prices`, `/recommendations/catalog`, `/logs`, `/help`, `/privacy`, `/admin`,
`/admin/health`, `/v/:slug`, `/authorize/:integrationId`, `/distributors`, and `/wine-agent`
as the general chatbot. `/sommelier` stays HOLD (**amended 2026-09-11 — see Review trail: the HOLD is lifted, `/sommelier` moves to the feat/mudavym-design-p4 session**).

Every page rebuilt so far turns on per house: `mudavym_design_<page>` is a boolean column on
the `restaurant_feature_flags` row, read through `useMudavymDesign(page)`
(`apps/web/src/lib/mudavym/useMudavymDesign.ts:118-153`), which needs an
`activeRestaurantId` — from `AuthContext` or from `localStorage` — before it will even ask
the gateway. **Nine of this wave's routes are public.** A visitor on `/login` has no house;
neither does a vendor's customer on `/v/:slug`, nor a person on `/invite/:code` who has not
yet made an account. For those routes the per-house flag is not "off" — it is structurally
unable to be on. Measured on this tree: `useMudavymDesign` returns `false` at
`:141-143` whenever no restaurant id can be found, before any request.

The founder's verdicts on the two pages that matter most in this set were explicit
(MAKEOVER-VERDICTS.md:234-242): the redesign of `/login` "looks like an AI web page";
"today's shipping login is better and should be the starting point, improved — not replaced
by the redesign"; `/register` is "the most important step". So there is no parallel `Next`
tree to gate here even if the gate could reach it: the work is an improvement of the page
that ships.

Three more things in this wave were open and could not be defaulted:

- `/wine-agent`'s surface and name — the founder had said "Mudavim agent or something like
  that" (MAKEOVER-VERDICTS.md:271) and left both open.
- `/no-access` — its own §13 says wire-or-retire is the founder's call; the page is
  unreachable because `AuthContext.tsx:347-355` fabricates a `'My Restaurant'` instead of
  routing a house-less person there.
- `/onboarding` — five sketches were asked for before any build; the parent session added
  what the arrival must ask (currency, cellar registers, vendor terms, notification producers,
  the configuration assistant).

## Options considered

### The public pages

- **A — In place, behind ONE deployment switch.** Improve today's pages (no parallel tree).
  Every public-page change sits behind a single build-time variable, `VITE_MUDAVYM_PUBLIC`,
  read in exactly one module; with it unset the pages are byte-identical to today. Dark on
  merge; the founder's keystroke on Vercel turns the public door on for everyone at once —
  the same shape as the four switches ADR 0131 already gives him.
- **B — In place, ungated.** Live for every visitor the moment the branch merges. Fastest,
  no keystroke; the only way back is a revert, and it would break the dark-launch promise of
  ADR 0131 on the one surface every stranger sees first.
- **C — Dev override only.** `localStorage["mudavym.design.public"]` and nothing else. Safe,
  and effectively unshipped on go-live day.

### The general assistant's surface

- **Page plus the Ask AI panel.** A full page at its own route for conversations with
  history and the seal on writes; the existing ⌘⇧K panel (`components/askai/AskAiBar.tsx`)
  becomes its quick door. One backend, one permission model.
- **Panel only.** Grow the panel; no page, no history.
- **Page only.** Build the page; retire the panel into it.

### The assistant's name

"Mudavym" (the house answers as itself; `/ask`) · "The Regular (Müdavim)" · "Mudavym Agent"
· "Ask the house".

### `/no-access`

Wire it (a house-less person lands there; the fabricated house goes) · retire it.

## Decision — the founder's four answers, 2026-09-06

1. **Public pages: A.** In place, one switch. The nine routes — `/login`, `/register`,
   `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`,
   `/privacy`, `/v/:slug` — improve the page that ships and read one module,
   `apps/web/src/lib/mudavym/publicDesign.ts`, whose precedence is the same as the per-house
   hook's: `localStorage["mudavym.design.public"]` (`1|true|on` / `0|false|off`) for a
   designer's browser, then `import.meta.env.VITE_MUDAVYM_PUBLIC` (`1|true|on`), then
   `false`. Absence is off, and off is byte-identical. [2026-09-16, ADR 0149: this holds only until the cutover merge, which makes the switch permanent-on and deletes the off branch — see "Amendment 2026-09-16" below.] [2026-09-17, ADR 0149 row 37: overtaken — the founder chose to turn the switch ON in code now, once the public doors pass their fixes, rather than waiting for the cutover; the off branch is still deleted only at cutover.]
2. **The assistant: a page plus the Ask AI panel.** The page's route is `/ask`; the panel
   stays where it is and opens the same backend. The page is a NEW route, so like
   `/connections` (ADR 0114) its flag, `mudavym_design_ask`, means "this surface exists
   here", and off is a redirect, not an old design.
3. **The name is "Mudavym."** The house answers as itself. Every sentence the assistant
   speaks, the nav entry and the page title say *Mudavym*, never "agent", "AI" or "bot".
   `/wine-agent` and `/wineagent` stay retired (ADR 0019 §B); nothing redirects to `/ask`
   from them.
4. **`/no-access` is wired.** `ProtectedRoute` gains a membership branch that sends a
   signed-in person with zero houses to `/no-access` once the branches fetch has *settled*
   (empty is not loading and not failed — the context must expose the three states), and
   `AuthContext.tsx:347-355` stops inventing `'My Restaurant'`.

### Mechanics for the rest of the wave

- The authenticated routes gate per house exactly as ADR 0044: `get_started`,
  `promotions`, `vendor_prices`, `recommendations_catalog`, `logs`, `help`, `admin`,
  `admin_health`, `authorize_integration`, `ask` join `MUDAVYM_PAGES`; their ten columns
  arrive in ONE new migration (`20260907010000_mudavym_design_flags_new_pages.sql` — a
  version past every migration on `main` and in every worktree, swept before naming); each
  has a registry entry with a real `readBy`; `scripts/check_flag_readby_anchors.py` is run
  after the edit because appending slugs moves the anchor line.
- `/onboarding` is not built until the founder picks from sketch 104's five directions;
  `/get-started` carries whatever he picks. `/distributors` stays a redirect and is not
  touched. `/sommelier` stayed HOLD until 2026-09-11, when the founder lifted it directly
  (amendment below) and assigned it to the feat/mudavym-design-p4 session — it was never
  in the new-pages fork's scope either before or after the amendment.
- Every overlay on the `Sheet` / `Panel` / `Popover` primitive; the close control is words;
  no emoji; one chromatic colour; absence is never health.

## Consequences

- One switch, one module, one grep. `VITE_MUDAVYM_PUBLIC` is read nowhere but
  `publicDesign.ts`; a page that reads the env directly is a review defect.
- The public door goes live for everyone at once. That is the honest shape: a stranger has
  no house to be enrolled in, so "one house at a time" cannot apply here, and pretending
  otherwise would have meant a gate that never opens.
- The assistant's design is **not** recorded here. Three finders and an adversarial pass
  run first (CLAUDE.md §3); the record that holds the outcome is the next free number when
  that pass is done, and this ADR's trail names it when it exists.
- `/no-access` becomes reachable, which makes the branches fetch's failure state visible
  for the first time: a failed fetch must read as a failure, never as "no houses".

## Rejected, and why

- **B (ungated)** — breaks ADR 0131's dark launch on the first surface every visitor sees.
- **C (dev-only)** — ships nothing; the founder asked for go-live today.
- **A second `Next` tree for `/login`/`/register`** — the founder rejected the redesign
  and asked for today's page improved; two trees would keep the rejected one alive.
- **Panel only / page only** — the panel has no history and no room for the seal's
  read-back; the page alone loses the one keyboard door operators already know.
- **Retiring `/no-access`** — the state it describes is real, and the fabricated house is a
  defect on its own (no-access.md §13.3).

## Amendment 2026-09-16 — the cutover, the doors, the fonts, the old hostname, and search

Carried from [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
(its founder-answers table, verbatim words in session) and from answers the founder gave
the same evening. Nothing above is rewritten; where a sentence above no longer holds after
cutover, it carries a bracket pointing here. **All of this is answered, none of it is built.**

1. **The switch becomes permanent-on at cutover** (0149 §Decision). `VITE_MUDAVYM_PUBLIC`
   stops being a choice: the cutover merge deletes "the public switch's off branch" with the
   rest of the gate machinery, once the founder approves that file group on the deletion
   manifest. Until that merge, decision 1 above holds exactly as written. [2026-09-17, ADR 0149 row 37: except that the switch is turned on in code before the cutover, as soon as the doors pass their fixes; the off branch stays until the cutover deletes it.] Every
   `mudavym_design_*` column that exists stays in the table, unread (0149: no table, column
   or row is deleted). The ten-column migration named under "Mechanics" above is not on
   `main` (`supabase/migrations/` at `60ed83a7` holds five `mudavym_design` files, none of
   them `20260907010000`).
2. **The public doors' treatment is ratified** (0149 row 7): a readable `/privacy`, the vendor
   board at `/v/:slug`, sign in before resending verification, today's invite preview
   fields, and publisher attribution with no Mudavym seal. This ratifies the *treatment*
   Codex drew; adopting its uncommitted *code* is still row 1's audit (adopted only if the
   quality baseline is great and it aligns with our needs).
3. **Every face is self-hosted** (0149 row 9): no public page makes a Google Fonts request.
4. **The legacy hostname redirects permanently.** `restaurant-ai-automation-web.vercel.app`
   answers with a permanent redirect to `https://mudavym.com` — **after** the OAuth redirect
   URIs registered with each provider have been checked, because a callback still
   registered on the old host would break sign-in the moment it redirects.
5. **Search and answer engines.** The founder: *"robots.txt must be unique, use already
   created teams to build upon geo, seo and the projectile it will go."* Recorded as
   given: `robots.txt` is Mudavym's own, and SEO and GEO build on the teams already
   created (`.planning/01-org/commercial/growth/teams/`) rather than a new structure. What
   "unique" requires and where the work goes is the separate spec being researched; this
   record decides nothing beyond his sentence.

## Review trail

| When | Who | What |
|---|---|---|
| 2026-09-06 | parent session (new-pages fork) | Measured the gate's dependence on a restaurant id (`useMudavymDesign.ts:141-143`); framed the four forks; asked. |
| 2026-09-06 | founder, in session | Four answers recorded above. |
| 2026-09-11 | founder, in the feat/mudavym-design-p4 session (relayed cross-session, then confirmed directly with the founder in the new-pages fork's own session before this row was written) | **AMENDMENT: `/sommelier` HOLD is lifted.** Founder's ruling on a same-night route-ownership collision between the two Mudavym-design sessions: the new-pages fork keeps only `/logs` (its one finished, wired page) going forward; the feat/mudavym-design-p4 session takes over every other route this ADR forked to the new-pages session (once that session's completed work is confirmed), *and* `/sommelier` — previously HOLD, not forked to either session — is released to feat/mudavym-design-p4 to build. Every design decision that session applies must come from a locked record; where one is missing, the founder is asked before a new one is added. This is the only clause 0133 had authority over; the ownership handoff itself is a working-allocation call, not a design decision, and is not recorded as an ADR. |
| 2026-09-16 | founder, in session (ADR 0149 and the same evening) | **AMENDMENT 2026-09-16** (section above): the switch permanent-on at cutover; the public doors' treatment ratified (0149 row 7); fonts self-hosted (row 9); the legacy Vercel hostname redirects permanently to mudavym.com after the OAuth redirect URIs are checked; robots.txt and SEO/GEO recorded as his sentence, spec researched separately. Answered, not built. |
