# SettingsNext — motions, canonical

Six motions, all from `src/lib/mudavym/motion.ts`. Unchanged by the fourth
pass: the three registers it added introduced no seventh. A settings page is a place to
read carefully and change something deliberately, so the budget is spent on two
things only: the reveal of a register, and the ceremony that grants autonomy.
Nothing on this page moves that is not in this table.

| id | token | curve · ms | fires |
|---|---|---|---|
| `st-register-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the open register's panel, once per register change — 5px rise + fade, the "show the working" page-turn. Driven by `animate()`, so reduced motion lands it instantly |
| `st-ink` | `ink` | HOUSE · 160ms | hover / focus / checked states on contents items, toggles, choice chips, buttons and selects — border, ground and text only, plus the toggle thumb's 18px travel. Nothing else translates |
| `st-disclosure-settle` | `settle` | HOUSE · 320ms | the two disclosures — "Labour & goals" in Team, "the steps, as far as they are known" in Calendar — as `grid-template-rows: 0fr → 1fr`, chevron on the same token |
| `st-hold-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to allow AI to send** while the thumb is down (inside `HoldToApprove`). Linear on purpose: the operator is timing it against their own thumb |
| `st-hold-tuck` | `tuck` | spring 380/32 · 300ms | an early release retreating home, with the honest line "Released at N% — nothing sent" |
| `st-seal-stamp` | `stamp` | spring 500/26, ~11% overshoot · 360ms | the seal landing when the hold completes and autonomous sending is granted — the only overshoot on the page, and the only wax |

## Deliberate non-motions

- **The seal is pressed once on this page.** Revoking autonomy, removing a
  member, revoking an invite, disconnecting an app and regenerating the iCal
  token are all two-click armed confirmations with no wax — the die pressed dry.
  Revoking must always be the cheap direction; a ceremony on the way out would
  make it expensive to undo a mistake.
- **Nothing animates on a successful save.** The switch settles on the server's
  answer and nothing celebrates: a motion fired on click would be a confirmation
  the server has not yet given, which is the same lie as a hopeful figure.
- **No tally.** There is one figure of record here (checks received) and it
  arrives once. A counter rolling up would imply a live feed that does not exist.
- **No stagger in the contents list.** A table of contents is a reference, not
  an arrival. The fourteen entries — including the three added on 2026-09-03,
  Vendor terms, Approval thresholds and What changed here — arrive together and
  none is introduced. The group headings do not animate either: a heading that
  appeared would suggest the grouping was computed for this visit.
- **Nothing marks a restored control.** Quiet hours came back on 2026-09-03 after
  a day rendered as a dead record. A flourish on it would be the page
  congratulating itself for a correction the reader never saw.
- **No scroll motion at all.** The legacy page scroll-spies between ten anchored
  sections; this one opens one register at a time, so there is nothing to chase.
- **Reduced motion**: `animate()` collapses the turn and the hold to their end
  states; the `@media (prefers-reduced-motion: reduce)` block in `SettingsNext`
  disables every CSS transition and the disclosure grid; and `HoldToApprove`
  swaps its timed hold for the same two-step confirm the keyboard path uses.

## Fourth pass, 2026-09-03 — what the three new registers deliberately do NOT move

- **No motion on a recorded term.** Writing down a vendor's cutoff replaces the
  cell and its provenance line with the server's answer, and nothing marks it.
  The whole claim of the register is that a stated term and an inferred one are
  different KINDS of thing, not that one of them just arrived.
- **No motion on the threshold banner.** "Nothing stops an order yet" is a
  standing fact about the system, not an alert that fires. Animating it would
  make a permanent condition read as an event and, worse, make it easy to
  dismiss.
- **The settings record does not stream.** Rows arrive in one read and sit
  still. A ledger whose entries slid in would imply a live feed; the read is a
  snapshot, and the register says how far back it reaches instead.
- **The vendor table does not animate its rows on sort.** Vendors are ordered by
  how much the house actually buys from them, computed on the server, and the
  order does not change while you look at it.
- The sticky contents column has no transition of its own — `position: sticky`
  is layout, not motion, and it is disabled below 900px where a rail would eat
  the page.
