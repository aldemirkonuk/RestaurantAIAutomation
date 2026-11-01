# 0349 — The leaf turn gets its own house token

- **Status:** Locked
- **Date:** 2026-10-31
- **Decider:** Aldemir (founder). He picked "Add an 8th house curve (Recommended)" himself, in an AskUserQuestion in the Claude Code session that built this (2026-10-31), heard directly, not relayed.
- **Keywords:** motion, token, leaf, turn, endpaper, front matter, login, page turn, easing, stall
- **Links:**
  - [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (:38-40, the seven house motion tokens). This ADR amends that list.
  - [[0262-a-toast-is-for-your-own-act-newest-on-top-on-the-house-settle]] (:50, which rejected a non-token curve on 0131's ground)
  - sketch `118-login-flyleaf` (`front-matter.html:497-498`, `FLIP=760` on the `TURN` curve)
  - `apps/web/src/lib/mudavym/motion.ts`
  - `apps/web/src/components/brand/EndpaperShell.tsx`

## Context

The founder reported that the /login book turn "bugs for a second before changing".

The leaf ran on `{ turn.easing, 760ms }`, copied from sketch 118. `turn` is `cubic-bezier(0.32, 0.72, 0, 1)`, a front-loaded curve. On a 180° leaf it reaches the edge-on point at ~122ms and the cover-swap point (0.97) at ~431ms. Every hand-off in `EndpaperShell` is keyed to eased progress: the 0.47/0.53 cut, the back of the leaf fading at 0.8, and the cover swap at 0.97. So the last ~330ms played out over a still book. A headless frame recording of production showed two things (the recordings live in a session scratchpad, not in the repo):
- On open, the leaf sat flat while its back faded.
- On close, the inside cover visibly crossfaded into the endpaper about 300ms after the leaf landed.

Running `turn` at its own 420ms only shrinks that still tail to about 180ms; it does not remove it. Any fix that removes it needs a curve outside the seven tokens. ADR 0131 treats those seven as the whole vocabulary, and ADR 0262 rejected an outside curve on that ground.

## Options considered

1. **An eighth house token, `leaf`, set to `cubic-bezier(0.4, 0, 0.2, 1)` over 600ms.** The standard in-out curve. It lifts the leaf promptly and lands it at the end of the run: edge-on at ~211ms, cover swap at ~470ms, run ends at 600ms. A recording of a build showed continuous motion to 180° by ~580ms, a settle at ~610ms, and the close's swap hidden under the last 5° of the landing. *Chosen.*
2. **The house `pour` token (linear, 620ms).** It needs no new token and removes the stall. Rejected: the leaf would turn at a constant speed and stop dead, with no ease in or out.
3. **`turn` at its own 420ms.** It stays inside the seven. Rejected: the stall shrinks to about 180ms but is still there.

## Decision

- `lib/mudavym/motion.ts` exports `leaf: { easing: 'cubic-bezier(0.4, 0, 0.2, 1)', ms: 600 }`. It stays out of `motionTokens`, which lists the seven tokens by their sketch-083 names.
- The house vocabulary is now the seven tokens of ADR 0131 plus `leaf`.
- `leaf` is for a whole leaf turning over (180°). Screen changes keep `turn`.
- `EndpaperShell`'s six leaf runs and its settle timer read `leaf`. [2026-11-01: the book now settles when the runs report `finished`, not on a timer; see the amendment below.]
- ADR 0131's own text is left unedited; this ADR and its row in the decisions index (`README.md`, added in this PR) record the amendment.
- `EndpaperShell.test.tsx` asserts that the leaf runs carry `leaf.easing`. Setting the easing back to `turn.easing` fails that test; this was checked on 2026-10-31.

## Consequences

- `leaf` has one caller today, `EndpaperShell`. A later 180° leaf turn should take `leaf` rather than a new curve.
- The house-policy tests (`components/mudavym/housePolicy.test.ts(x)`) name the seven tokens and scan only the primitive family, which does not use `leaf`. A family file that adopts `leaf` must add it there.
- Sketch 118's `FLIP=760` on `TURN` no longer describes the build. The sketch stays as the record of what was picked; this ADR is what the build follows.
- Not covered: the phone-band poem drop and reduced motion never run the leaf. They keep `turn` and `linear` and are unchanged.

## Amendment 2026-11-01 — the book settles when the runs finish

Built on `fix/book-turn-settles-on-finish` (PR #717), the follow-up that #709's body listed as owed. The token, the curve, and the 600ms length are unchanged; only how `EndpaperShell` decides that the turn is over changes. The settle on `finished` is an implementation choice made by the session that built it. The backstop's length is the founder's ruling: asked on 2026-11-01, he chose 1.2s, twice the turn.

**What changed.** The front-matter turn used to settle on `setTimeout(LEAF_TURN.ms)`, started beside its six runs. In headless Chromium, on a local build of the branch over three opens and three closes, the runs reported `finished` 608–641ms after the click. So the timer could land the page before the last frame was painted. Now:
- The book settles on `Promise.allSettled` of the runs' `finished`.
- A cancelled run counts as settled, so a stray cancel lands the book rather than stalling it. A cancel that comes from the book landing or unmounting is already ignored by the effect's cleanup flag.
- A backstop, `SETTLE_BACKSTOP_MS = LEAF_TURN.ms * 2` (1.2s), lands the book if `finished` never settles. One case where it never settles is a page whose animations do not run, such as a hidden tab.
- A run without `finished` keeps the old `LEAF_TURN.ms` timer.
- Every run's `finished` is marked handled as soon as the runs start, so the fallback paths, which never await it, leave no unhandled rejection when landing cancels the runs.
- The runs fill `both` (`lib/mudavym/motion.ts` `animate()`), so the last frame holds until the settled page commits.

In the same headless runs, the book landed 2–6ms after the last run finished. These timings were measured once, at `aecaa3f`, with a Playwright script that was not kept. Re-measure them; do not copy them forward as established fact.

**The backstop at twice the run.** Options considered:
1. **2 × the run (1.2s).** A whole run's slack past its own end, so it never beats a run that is only a few frames late. It covers the sign-in form for at most 1.2s when `finished` never comes. *Chosen by the founder, 2026-11-01, over a 0.9s (1.5×) option and the one-frame option below.*
2. **The run plus about one frame (~620ms).** Rejected: the measured runs already ended up to 41ms late, so this backstop would race the very frame the change exists to wait for.
3. **No backstop.** Rejected: where `finished` never settles, the book would never land and the form underneath would stay covered.

**Tests.** `EndpaperShell.test.tsx` pins:
- the hand-offs: the 47–53% cut, the back at 80% and 20%, and the inside cover and the turn button at 97%;
- that the token's length alone no longer lands the page;
- that a cancelled run lands the book at once;
- that the backstop lands it at exactly 2× and not 1ms sooner.

The claim is `claims.d/fix-book-turn-settles-on-finish.jsonl:1`.

