# 0169 — The ground is white by default, and each person chooses

- **Status:** Locked (default + choice) 2026-09-19 — the founder's words, below, decided the
  default and that a choice must exist. Two sub-questions are still open and are not decided
  by this record: whether the choice should be per-account instead of per-device, and whether
  a person who has never chosen should get their OS's preference instead of paper. See
  **Still open**.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** ground, paper, charcoal, theme, ThemeMenu, ThemeContext, data-ground,
  data-mudavym-ground, groundChoice, per-device, FOUC, flash, contrast, prefers-color-scheme
- **Links:** revises row 6 of [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]
  (`ADR 0149`) · narrows [[0138-the-mudavym-ground-is-not-a-theme-and-the-rollout-starts-at-one-house]]
  (`ADR 0138` D1 — the MECHANISM it built is unchanged, only which column is the default and who
  may move it) · restores reachability to (does not reopen) the palette in
  [[0042-iznik-seal-and-warm-charcoal]] · `CLAIMS.jsonl` id `ADR-0138` (corrected in place, not
  superseded by a new id) · `.planning/decisions/founder-sketch-decisions-106-115.md` (memory,
  read-only) row "THEME (cross-cutting)"

## Context

The founder, 2026-09-19, in his own words, folded into a lane-answers batch about
promotions and other unrelated forks:

> "I realized all pages will be charcoal however I don't want it, I prefer the white look to be
> honest. People should have the option to choose."

This is a direct reversal of a decision he made himself one week earlier. ADR 0149 row 6
(2026-09-16) retired the app's light/dark toggle in favour of "charcoal everywhere, declared
paper surfaces only," and ADR 0138 (2026-09-12) built the mechanism: inside `.mudavym`, the
bare selector carried the Warm Charcoal column at every value, and exactly one attribute —
`data-ground="paper"` — let one surface (the canonical document, ADR 0104 D9; the legacy vendor
panel in `TwinSheet`) opt out. Nothing else could. The header even already carries a labelled
"Theme" control (`components/layout/ThemeMenu.tsx`, mounted by every `HouseHeader` since the
shell was built for exactly this reason — `components/mudavym/PageGate.tsx`'s header comment
lists "no theme switch" among what a rebuilt page was missing before). **That control has done
nothing on a Mudavym page since 2026-09-12**: it drives `ThemeContext`'s light/dark/system state,
and `.mudavym` has ignored `ThemeContext` by design since ADR 0138 D1. Clicking Light, Dark or
System in that menu on any of the sixteen locked pages changes nothing on screen — which is
almost certainly what the founder was looking at when he said "I realized all pages will be
charcoal." The product had a labelled theme switch that silently did nothing, on every page.

Measured before this change (`origin/main`, `apps/web/src/lib/mudavym/useMudavymDesign.ts:32-58`):
twenty pages are enrolled as `MUDAVYM_PAGES` — `dashboard, orders, receiving, receiving_door,
providers, communications, team, inventory, receipts, documents_reports, reports, notifications,
recommendations, calendar, settings, profile, cellar, connections, document, logs`. Of those,
eleven pass a `ground?: 'charcoal'` prop that no route ever supplies (`App.tsx` passes it zero
times, per `lib/mudavym/shellGround.ts`'s own file header), six hardcode
`className="mudavym min-h-screen"` with no ground attribute at all, one (`document`, the
canonical document) hardcodes `data-ground="paper"` unconditionally by design, one
(`receiving_door`, `DoorNext`) hardcodes `data-ground="charcoal"` unconditionally by design, and
one (`inventory`) carries no `.mudavym` scope on its own body at all — the gate mounts only its
header. Eighteen of twenty were therefore rendering charcoal purely because that was the CSS
default with nothing declared; none of them had ever been asked to render paper before this ADR.

## Options considered

Three independent forks are bundled in the founder's one sentence. Each is treated on its own.

### Fork A — what is the default when nobody has chosen?

1. **Paper, unconditionally** (what the founder's words say: *"default ground = white/paper"*).
   Predictable, matches his stated preference, and is what every "declared paper" surface in this
   codebase already does (the canonical document, `TwinSheet`, the onboarding step) — paper is not
   a new invention here, it is ADR 0042's other column, already fully tokened and tested,
   currently unreachable outside three surfaces.
2. **Follow `prefers-color-scheme` when nobody has chosen, paper only as the fallback for a
   browser that reports neither.** Current published UX guidance leans this way — "start with the
   system preference... respecting the system setting should be your baseline" (Figmenta,
   *Dark Mode & Dynamic Theming: UX Comfort Strategy for 2026*; similar language in `tech-rz.com`'s
   2026 dark-mode guide) — and it means a person who has set their OS to dark never sees an
   unwanted paper flash on first visit. Cost: the founder's own OS/browser preference is not
   knowable from his sentence, so shipping this changes what "the default" means for every new
   signed-in person based on a signal he did not mention, and it re-opens exactly the ambiguity
   ADR 0138 called out in ThemeContext's OLD behaviour (a system-driven default is a second thing
   to reason about beyond the one preference he actually stated).
3. *(Keep charcoal as the default, offer paper as the choice)* — the literal opposite of his
   sentence. Rejected on his words alone.

**Chosen: Option 1.** His sentence names the default explicitly; a person who wants their OS's
mode is one click away in the header, same as always. **Fork A2 (system-preference-as-default)
is not decided here — see Still open.**

### Fork B — where does the choice live: this device, or the account?

1. **Per device (`localStorage`), no migration.** Free, ships today, and is the exact pattern
   `ThemeContext.tsx` already uses for the (unrelated) legacy light/dark/system preference, and
   the exact pattern the founder himself picked, asked directly, for a structurally similar
   choice five days earlier: ADR 0164 F1 (last house remembered) — **"Per device (Recommended)"**.
   Cost: a person who sets charcoal on their phone sees paper again on a shared desk terminal.
2. **Per account**, a `mudavym_ground` (or similar) column on the person's row, synced everywhere
   they sign in. Consistent across devices. Cost: a schema migration, a read on every
   authenticated page load (or a value threaded through the JWT/profile fetch that already
   happens), and a decision about what an ANONYMOUS/pre-auth visitor sees, which per-device
   storage does not have to answer. No such migration exists today, and the task that produced
   this record was explicit that adding one is not this session's call to make alone.
3. *(Both — device wins until the account states one, then the account wins)* — the eventual
   likely shape if Option 2 is ever built, and not worth designing today against a schema that
   does not exist.

**Chosen: Option 1, explicitly named as an interim, not a final architecture.** Building Option 2
means adding a migration and a table on a lane whose house rules say new tables and cross-cutting
schema decisions come back as a founder question rather than being added on inference — so it is
one, in **Still open**, not built.

### Fork C — how is a stored charcoal choice applied without a flash of paper first?

1. **A synchronous, dependency-free script, first in `<head>`, before any stylesheet, reading the
   same storage key and stamping an attribute on `<html>` before first paint.** This is the
   documented industry-standard shape for exactly this problem — "put a synchronous, blocking,
   dependency-free script as the first thing in head, before any CSS or stylesheet link... The
   script is small enough (under 200 bytes minified) that the blocking cost is negligible"
   (DEV Community, *How to Prevent the Flash of Wrong Theme...*, and the same recipe under
   `next-themes`/Tailwind's dark-mode guidance). It is also already the right shape for THIS
   specific codebase: the default itself needs no JavaScript at all (paper is the CSS default),
   so the only work the blocking script has to do is the CHARCOAL case, which keeps it tiny.
2. **A cookie instead of `localStorage`,** read on the server so the very first HTML byte already
   carries the right ground. Rejected for now — `apps/web` is a client-rendered Vite SPA, not a
   framework doing HTML on a server per request (CLAUDE.md's own orientation table: "Vite SPA +
   react-router-dom, **not** Next.js"), so there is no server render to hand a cookie to; the
   blocking script already runs before the SPA's own first paint, which is the render that
   matters here.
3. *(No blocking script — apply the choice from a React effect after mount)* — the naive
   approach, and the one every source on this problem names as the actual cause of the flash
   ("the page paints in default theme → JS runs → reads localStorage → applies dark class → page
   repaints in dark" — DEV Community, same source). Rejected: this is the exact defect Fork C
   exists to avoid.

**Chosen: Option 1.** Built as `apps/web/index.html`'s first script tag (right after the charset
meta) and its runtime twin, `lib/mudavym/groundChoice.ts`.

### Fork D — does paper hold up on contrast the way charcoal was proven to?

Not really a fork — a check. ADR 0138 proved (`mudavym-ground.test.ts`, then and now) that
`--ink-1` on `--paper-0` clears WCAG's 7:1 (AAA, normal text) threshold on the charcoal column
(15.11:1). The same test now asserts the paper column's own pair, `#211c16` on `#fffdf8`, which is
**16.63:1** (independently recomputed for this record, WCAG relative-luminance formula) — both
columns clear AAA with wide margin, because both are ADR 0042's original,
already-designed pair; ADR 0169 does not invent a palette, it restores one to the default
position it held before ADR 0138 took it away. OD-112 (ADR 0149 row 30, `--ink-3` on paper is
decorative-only, `--ink-4` for captions) is unaffected — it already governed the paper column when
paper was the escape, and governs it identically now that paper is the default.

## Decision

**The Mudavym ground defaults to paper. A person may choose charcoal for themselves; the choice
is remembered on this device, applies with no flash, and never overrides a surface that has
declared its own ground.** This revises ADR 0149 row 6 ("charcoal everywhere, declared paper
surfaces only") to its mirror image: paper everywhere, a person's own charcoal only where they
have said so, and a surface's own hardcoded ground — the canonical document's paper (D9), the
receiving door's charcoal (`DoorNext`) — still outranks both, unchanged, because it always did.

### Mechanism (built, not just decided)

- `apps/web/src/styles/mudavym.css` — the base `.mudavym` selector (and the redundant-but-explicit
  `.mudavym[data-ground="paper"]`) now carries the paper column; `.mudavym[data-ground="charcoal"]`
  carries the charcoal column, JOINED by a third selector,
  `html[data-mudavym-ground="charcoal"] .mudavym:not([data-ground])` — the person's choice,
  reaching any `.mudavym` element that has not itself declared a ground. The `:not([data-ground])`
  clause is the whole guarantee that a declared surface is never moved by a general preference.
- `apps/web/src/lib/mudavym/groundChoice.ts` (new) — `'paper' | 'charcoal'`, `localStorage` key
  `mudavym.ground`, a `useSyncExternalStore` hook for React, cross-tab sync via the `storage`
  event, and every `localStorage` call wrapped so a blocked store (private windows) degrades to
  the decided default rather than throwing.
- `apps/web/index.html` — the blocking script, first in `<head>`.
- `apps/web/src/lib/mudavym/shellGround.ts` — `readGroundFromDom`/`readShellGroundFromDom` (the
  two functions the header, sidebar and every overlay already used to answer "what ground is this
  page on") now fall back to the person's choice instead of a hardcoded `'paper'` literal when
  nothing is declared, so the answer these functions give matches what actually painted — a
  latent mismatch (harmless before this change, because nothing branched on the distinction) that
  is now load-bearing and is fixed rather than carried forward.
- `apps/web/src/components/layout/ThemeMenu.tsx` — on a Mudavym page (`shell.on`), the SAME
  control that used to drive the inert `ThemeContext` now drives the real choice: two options,
  Paper and Charcoal, persisted immediately. Off a Mudavym page it is byte-for-byte unchanged —
  still the legacy Light/Dark/System menu against `ThemeContext`, which this record does not
  touch. No new UI surface was added; the one that was already on every page's header, already
  labelled "Theme," was wired to something real instead of duplicated.
- `apps/web/src/pages/receiving/next/DoorNext.tsx` — comment corrected in place (its
  `data-ground="charcoal"` used to merely CONFIRM the default; it now FORCES it, unchanged in
  effect either way).
- **[2026-09-21, round 5 — the live switch.]** The round-4 last call reproduced a defect: after
  choosing charcoal, switching back to paper left the header, the sidebar hint, the Ground menu's
  own popover and every Sheet overlay charcoal until a full reload. Two bugs, both required to
  reproduce and both now fixed:
  - `apps/web/src/components/mudavym/PageGate.tsx` — the effect that measures the ground and feeds
    it to `HouseHeader` and `MudavymGroundContext` ran only on `[showNext, page]`; a change to the
    person's choice alone never re-ran it. It now also depends on `useGroundChoice()`.
  - `apps/web/src/lib/mudavym/shellGround.ts` — `readShellGroundFromDom` queried every
    `.mudavym[data-ground=…]` in the document, excluding only `.mdv-ovl` (an open overlay). But
    `HouseHeader` and the sidebar's `NavTooltip` are THEMSELVES `.mudavym` roots that only ever
    MIRROR whatever this function returned last time — never a genuine declaration. Once charcoal
    had been mirrored onto the header, a later call (even one the first fix now correctly
    triggers) found the header's own leftover mirror before it found what the page actually
    declared, and answered charcoal again — a self-reference the page-change case had too, which
    is why the round-4 reviewer's repro still failed after a rerender with a different `page`, not
    only after a bare choice change. The query now also excludes `.mdv-hdr` and `.mdv-hint`.
  - Regression coverage: `HouseHeader.test.tsx`'s "PageGate" suite, two new cases — a live switch
    with no page change, and the exact round-4 repro (switch, then rerender with a different
    `page`). Both fail on the pre-fix code (`Expected: null, Received: "charcoal"`) and pass after.
    Mutation-tested: reverting either fix alone (PageGate's dependency, or shellGround's exclusion)
    while keeping the other fails both new cases the same way — neither half is sufficient alone.

### Measured — does every Mudavym page render correctly on paper?

Full census against `MUDAVYM_PAGES` (`lib/mudavym/useMudavymDesign.ts:32-58`), twenty pages:

| Shape | Pages | Paper today? |
|---|---|---|
| No ground declared at all — `className="mudavym min-h-screen"` | orders, providers, communications, receipts, documents_reports, receiving | Yes — picks up the new default with zero code changes; never had a ground attribute to begin with. |
| `ground?: 'charcoal'` prop, never supplied by any route | dashboard, calendar, recommendations, connections, logs, profile, cellar, notifications, reports, settings, team (+ its `MyShiftsNext` child) | Yes — same reasoning; the prop has always resolved to `undefined` in production. |
| Explicit `data-ground="paper"` (ADR 0104 D9) | document | Unaffected — already paper, unconditionally, by its own declaration; ADR 0169 does not touch it. |
| Explicit `data-ground="charcoal"` | receiving_door | Unaffected — already charcoal, unconditionally, by its own declaration (a loading-dock kiosk, not a preference surface); ADR 0169 does not touch it. |
| No `.mudavym` scope on the page body at all | inventory | Body unaffected either way (not part of the ground system — `PageGate` mounts only its header, which follows the new default); consistent with its "not being redesigned" status (App.tsx comment at the route). |

**Static audit, all twenty pages' own `.css`/`.tsx` under `pages/*/next/`:** every colour
literal found is one of: a `var(--token, #fallback)` safety fallback (the codebase's own stated
convention — `rec-next.css:1-8`'s header names it explicitly), a colour named inside a code
comment, a colour inside a `.test.tsx` fixture, or a colour on the three surfaces above that are
explicitly, permanently one ground regardless of anyone's preference. **No hardcoded,
charcoal-only assumption was found on any of the twenty pages.** The pre-existing structural guard
(`mudavym-ground.test.ts`'s "every `.mudavym` scope root says what ground it is on," which scans
every real root in `apps/web/src`, not a synthetic mount) passes unchanged, meaning no root is
left painting nothing — the exact class of defect ADR 0138 found once
(`components/onboarding/CellarRegistersOnboarding`, now fixed with its own explicit
`data-ground="paper"`, unaffected by this record).

**What this does NOT prove:** a live, signed-in, pixel-by-pixel look at all twenty pages under
real data. That was not reachable from this lane — no sign-in credentials were available, and the
shared Browser pane had nine tabs open from other concurrent lanes that this session declined to
close or hijack. The full `apps/web` test suite (199 files, 2852 tests, 14 pre-existing skips —
199th file and 8 of the tests are this record's own new `groundChoiceNoFlash.test.ts`) passes
after every edit in this record, `tsc --noEmit` and `eslint` both report zero errors, and
the two suites that specifically byte-compare rendered output on both grounds
(`mudavym-ground.test.ts`, `authPages.publicDesign.test.tsx`) pass with new and existing
assertions together — which is strong, mechanical evidence, not a substitute for a founder or QA
pass looking at the real pages. **No page is listed as a broken-on-paper workstream item because
none was found broken** by either the static audit or the mechanical suite; a live visual pass is
recommended as a follow-up, not because a defect is suspected, but because this record cannot
honestly claim to have looked.

**[2026-09-21, round 5 — re-measured on the merged tree, per CLAUDE.md §5b.]** The 2852-test figure
above is what round 4 measured before the branch was brought current with `origin/main` (it had
fallen 8 commits behind, not the 2 the round-4 last call itself measured) and before the two-file
fix and its tests landed. On the merged tree, after the fix: `apps/web` runs **199 files, 2863
tests passed, 14 skipped (2877 total)** — the 199-file count is unchanged (round 5 added 2 cases to
the existing `HouseHeader.test.tsx`, not a new file; the origin/main merge added cases to existing
files too, not new ones). `tsc --noEmit` is still 0 errors. `eslint` (run via
`--resolve-plugins-relative-to` the scratch dir `worktree-node-modules-links.md` documents, since
this worktree's linked `node_modules` predates `eslint-plugin-jsx-a11y`) is still 0
errors/warnings on every file this record or round 5 touched. `check_decision_claims.sh` reads
**370 of 370 holding** (359 at round 4, +11 additive rows from the commits this branch had fallen
behind) — unchanged by the round-5 code fix itself, which the mechanism note above already covers.

## Consequences

- **Easier:** the header's "Theme" control does something real on every Mudavym page for the
  first time since ADR 0138 shipped; a person who prefers paper — which, per the founder, is most
  people including him — gets it without clicking anything; the mechanism cost no new UI surface
  and no page-by-page edits (eighteen of twenty pages needed zero code changes because they had
  never declared a ground in the first place).
- **Harder / given up:** the choice is per-device, not per-account (Fork B) — a real, stated limit,
  not a silent one; `readGroundFromDom`/`readShellGroundFromDom`'s fallback is now a live read of
  a mutable store rather than a constant, which is one more thing a future contributor must know
  is not a pure function of the DOM alone (documented in `shellGround.ts`'s own comments,
  precisely so it is not rediscovered the hard way).
- **What would trigger revisiting:** the founder asking for the choice to follow him across
  devices (→ build Fork B's Option 2, with its migration, as its own decision); a page shipped
  after this record that hardcodes a charcoal-only colour outside a token (→ the static guard in
  `mudavym-ground.test.ts` would need extending to catch it, the way OD-112's onboarding bug did);
  the founder saying the header control should also offer "System" as a persistent third option,
  not only as this record's undecided default-source question.
- **Guard.** `CLAIMS.jsonl` id `ADR-0138` is corrected in place (not superseded by a new id, since
  it is the same underlying CSS mechanism, revised) to assert the new shape mechanically: the bare
  `.mudavym` selector is paper, `.mudavym[data-ground="charcoal"]` is still charcoal, a rule
  shaped like `html[data-mudavym-ground="charcoal"] .mudavym:not([data-ground])` exists and
  declares charcoal, and none of the three routes sits under a `.dark`/`.light`/`[data-theme]`
  selector or inside a `prefers-color-scheme` block. Proven against the shipped tree and four
  mutations (the default's own value, dropping the explicit-charcoal route, dropping the
  choice route, reintroducing a theme-qualified rule) — each one fails the check, and the
  restored tree passes; the whole 359-row `CLAIMS.jsonl` register still holds end to end.

## Still open — not decided by this record

Two sub-questions surfaced while building this and are the founder's call, not this lane's:

1. **Should the default, for someone who has never chosen, follow their OS's `prefers-color-scheme`
   instead of always being paper?** Current published guidance leans toward starting from the
   system preference (cited above); the founder's own sentence names paper flatly, with no mention
   of the OS. **Recommendation: ship as built — paper, unconditionally — and revisit only if he
   asks**, because (a) his words are unambiguous and adding OS-detection now would be answering a
   question he did not ask, and (b) it is a small, additive, non-breaking change later (one
   `matchMedia` read inside the SAME blocking script) if he wants it, whereas guessing wrong now
   means a person's very first impression of the product is a ground nobody chose for them either
   way. A related, smaller question folds in here: should "System" also become a third, persistent
   option in the header menu (today it is Paper/Charcoal only) — the same recommendation applies.
2. **Should the choice eventually be per-account rather than per-device?** Built as per-device
   now, per this lane's instructions, with no migration added. **Recommendation: leave it
   per-device unless a person reports the "wrong ground on my other device" experience as a real
   annoyance** — building the account column, the read path, and the anonymous-visitor answer
   before anyone has hit that friction would be schema and surface area against a problem not yet
   observed, and ADR 0164 F1 shows the founder has independently chosen "per device" for a
   structurally similar fork five days before this one.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir (founder), in a lane-answers batch (memory: `founder-sketch-decisions-106-115.md`, "THEME (cross-cutting)") | Default reversed to paper; a per-person choice required; ADR assigned number 0169 |
| 2026-09-19 | — | Created; built on `feat/theme-white-default` (`wt-theme`); mechanism, tests and this record land together |
| 2026-09-19 | Opus, round-4 last call | Not ready — reproduced a live-switch defect (charcoal to paper left the header, sidebar hint and every overlay charcoal until reload); branch also 2 commits behind `origin/main`. Two must-fix items filed. |
| 2026-09-21 | — (round 5) | Both must-fix items closed: merged current `origin/main` (8 commits by then; one genuine conflict on ADR 0138's status line, resolved by keeping both dated brackets) and reran claims (370/370) and the full suite (green) on the merged tree; fixed `PageGate.tsx` and `shellGround.ts` per the Mechanism note above, with a new regression suite that fails pre-fix and passes post-fix, mutation-tested against each half of the fix independently |
