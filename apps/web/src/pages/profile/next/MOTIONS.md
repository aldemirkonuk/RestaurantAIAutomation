# ProfileNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. An account
page is a place people read and correct facts about themselves; it should feel
like a well-kept book, not a dashboard. Nothing here counts, shimmers, slides
or staggers.

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount, opacity + 6px rise, via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel opening — “What you granted” / “What it would ask for” on the Workspace rail, “Scopes and dates” on a model-context server, “Show the working” on the session row. CSS `grid-template-rows: 0fr → 1fr` (the founder's named favourite, 053's row-expand) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover and focus on rows, buttons and membership entries — border colour and ground only; nothing translates, nothing scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account**, inside `HoldToApprove`. Deliberately linear: the operator is timing it against their own thumb. An early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when that hold completes — the only motion on the page allowed to overshoot, and the only place on the page the seal is pressed at all |

## Deliberate non-motions

- **No stagger and no arrival.** The registers do not cascade in. A page about
  your own account is a reference, not an event.
- **No tally.** The plan became a figure on 2026-09-03 (the endpoint returns
  `subscription_tier` now), and it still does not animate: it is a label read
  once, not a total that moved. A `tally` here would imply the plan had counted
  up to something.
- **The forms that open do not slide.** “Add a server” and “Add a card” swap a
  button for a card with no transition. A payment form whose submit is disabled
  should not arrive with any flourish at all — the motion would be the only part
  of it that worked.
- **No skeleton sheen.** Loading is stated in words (“Reading your account
  record…”), so a moving bar would only make “in flight” and “failed” look
  alike again — the exact confusion the page exists to remove.
- **Chips do not transition.** A row's state chip changes when the truth
  changes; easing it would imply a journey between two facts.
- **The exit is not decorated.** “Leave restaurant” arms and disarms with a
  label change and no motion at all. Only the irreversible act gets the seal.
- **Revoking is not decorated either.** A revoked model-context server stays on
  the register with a changed chip. Animating its departure would be the visual
  form of the thing the soft revoke exists to prevent: a grant that once existed
  looking like one that never did.
- **Reduced motion**: `animate()` collapses `pf-open` to its end state with
  zero duration; `PF_CSS` disables the `pf-expand` and `pf-ink` transitions
  under `@media (prefers-reduced-motion: reduce)`; `HoldToApprove` swaps its
  timed hold for the same two-step confirm the keyboard path uses.
