# ProfileNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. An account
page is a place people read and correct facts about themselves; it should feel
like a well-kept book, not a dashboard. Nothing here counts, shimmers, slides
or staggers.

**The seal is pressed four times now, and the ration was not loosened — the
gateway moved.** Until 2026-09-03 the hold appeared exactly once, over deleting
the account. The Stripe build (ADR 0110) added the second: confirming a
SetupIntent is the moment an instrument becomes chargeable. On 2026-09-04 the
founder extended challenge-and-redeem to payments, and *Charge this first* and
*Remove* became the third and fourth (ADR 0110's addendum): the gateway now
REDEEMS a one-time seal on `PATCH /payment-methods/:id/default` and
`DELETE /payment-methods/:id`, so a plain button there is not a lighter
ceremony — it is a control that receives a 403 every time.

That is the rule this file now states, and it is stricter than "ration the
die", because it is not a taste question: **the seal appears exactly where the
server redeems one, plus the one act that is irreversible here and has no
server to ask** (deleting the account). *Reconcile now* stays a plain button
because reconciling asks the provider what it holds and changes nothing we
chose. The add-a-card hold is the odd one and says so in its own words: it is
the ceremony without a redemption, because the write it precedes happens on
Stripe's origin and the two routes behind it take no seal (G-PAY-SETUP).

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount, opacity + 6px rise, via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel opening — “What you granted” / “What it would ask for” on the Workspace rail, “Scopes and dates” on a model-context server, “Show the working” on the session row. CSS `grid-template-rows: 0fr → 1fr` (the founder's named favourite, 053's row-expand) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover and focus on rows, buttons and membership entries — border colour and ground only; nothing translates, nothing scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account** (Register VII), under **Hold to put this card on file** (Register V, `StripeCardPanel`, since 2026-09-03) and, since 2026-09-04, under **Charge this first** and **Remove** on every instrument row (Register V, `SealedControl`) — all inside `HoldToApprove`. Deliberately linear: the operator is timing it against their own thumb. An early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when any of those holds completes — the only motion on the page allowed to overshoot. On the two payment-row acts it lands only after the gateway's one-time seal has been minted; a mint that fails resets the track and prints "The seal could not be issued — nothing sent", so the stamp is never drawn over an approval that did not happen |

## Deliberate non-motions

- **No stagger and no arrival.** The registers do not cascade in. A page about
  your own account is a reference, not an event.
- **No tally.** The plan became a figure on 2026-09-03 (the endpoint returns
  `subscription_tier` now), and it still does not animate: it is a label read
  once, not a total that moved. A `tally` here would imply the plan had counted
  up to something.
- **The forms that open do not slide.** “Add a server” and “Add a card” swap a
  button for a card with no transition. When the provider is unconfigured, the
  card panel arrives with its hold already disabled and the missing variable
  named — a panel that cannot store anything must not arrive with a flourish
  that would be the only part of it that worked.
- **Stripe's own fields are not animated, and cannot be.** They are iframes on
  `js.stripe.com`; the only thing this page gives them is a palette read off the
  live `.mudavym` root with `getComputedStyle`, so they carry paper/ink and the
  seal ring in both grounds without a second palette hard-coded here. Their
  focus and validation transitions are Stripe's, tuned to match `pf-ink` in
  duration and to use the same seal ring — matched, not driven.
- **Reconciling is not decorated.** “Reconcile now” makes a real round trip to
  the provider and gets a label change (`Reconcile now` → `Reconciling…`) and
  nothing else, for the same reason “Check the server” does: a spinner would
  make waiting look like progress, and the outcome — *n* kept, *n* dropped, or a
  sentence saying the provider was not reached — is words.
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
- **Checking a server is not decorated, and this is the one that was tempting.**
  “Check the server” makes a real network call that can take up to eight seconds,
  which is exactly the shape a spinner is usually spent on. It gets a label
  change (`Check the server` → `Checking…`) and nothing else. A pulsing indicator
  would make waiting look like progress, and the four outcomes it resolves into —
  answered, refused, unreachable, could-not-be-checked — are words, not a
  finished bar. The row's panel opens on the answer via the existing `pf-expand`;
  the result does not arrive with any flourish of its own, because a flourish
  over “unreachable” would be the page congratulating itself on a failure.
- **Reduced motion**: `animate()` collapses `pf-open` to its end state with
  zero duration; `PF_CSS` disables the `pf-expand` and `pf-ink` transitions
  under `@media (prefers-reduced-motion: reduce)`; `HoldToApprove` swaps its
  timed hold for the same two-step confirm the keyboard path uses.

## The collapse, 2026-09-04 — no new motion

Three registers left this page and one arrived (`ConsentRegister`). **No motion was
added**, and that is the decision, not an omission: `settle` on the header is the page's
one opening gesture, and animating the register that replaces three others would say the
replacement is an event. It is a smaller page, not a reveal.

The moved-registers line does not animate in either. A line explaining where something
went is read once and then ignored; drawing attention to it every visit would make the
page feel like it is apologising.
