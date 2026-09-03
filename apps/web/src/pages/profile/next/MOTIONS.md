# ProfileNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. An account
page is a place people read and correct facts about themselves; it should feel
like a well-kept book, not a dashboard. Nothing here counts, shimmers, slides
or staggers.

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount, opacity + 6px rise, via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel opening: “What you granted” / “What it would ask for” / “Show the shape”. CSS `grid-template-rows: 0fr → 1fr` (the founder's named favourite, 053's row-expand) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover and focus on rows, buttons and membership entries — border colour and ground only; nothing translates, nothing scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account**, inside `HoldToApprove`. Deliberately linear: the operator is timing it against their own thumb. An early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when that hold completes — the only motion on the page allowed to overshoot, and the only place on the page the seal is pressed at all |

## Deliberate non-motions

- **No stagger and no arrival.** The registers do not cascade in. A page about
  your own account is a reference, not an event.
- **No tally.** There is no figure of record on this page that could count —
  the one number-shaped thing, the plan, is an em dash because no endpoint
  returns it, and an unknown never animates.
- **No skeleton sheen.** Loading is stated in words (“Reading your account
  record…”), so a moving bar would only make “in flight” and “failed” look
  alike again — the exact confusion the page exists to remove.
- **Chips do not transition.** A row's state chip changes when the truth
  changes; easing it would imply a journey between two facts.
- **The exit is not decorated.** “Leave restaurant” arms and disarms with a
  label change and no motion at all. Only the irreversible act gets the seal.
- **Reduced motion**: `animate()` collapses `pf-open` to its end state with
  zero duration; `PF_CSS` disables the `pf-expand` and `pf-ink` transitions
  under `@media (prefers-reduced-motion: reduce)`; `HoldToApprove` swaps its
  timed hold for the same two-step confirm the keyboard path uses.
