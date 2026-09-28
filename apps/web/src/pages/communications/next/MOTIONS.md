# CommunicationsNext — motions, canonical

Four motions from `src/lib/mudavym/motion.ts`, three of them the page's own and
one inherited from the overlay primitive. The verdict's "too much text" critique
applies to movement too: a page about correspondence should read like a
well-kept book, not perform.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cm-row-settle` | `settle` | HOUSE · 320ms | a ledger row's expansion settling open (4px drop + fade); reduced-motion renders in place |
| `cm-ink` | `ink` | HOUSE · 160ms | row + rail-button hover/focus — one paper step, nothing translates |
| `cmp-pick` | `ink` | HOUSE · 160ms | a recipient, a template or an engine sentence taking hover/focus inside the composer — the same one paper step, so a picker in a sheet moves like a row on the page |
| `mdv-sheet-tuck` | `tuck` | spring · 300ms | the composer and the letter library arriving from the right; owned by `components/mudavym/Sheet.tsx` (ADR 0112), listed here because this page is where it fires |

Deliberate non-motions, and why each one stays still:

- **Glance figures do not tally.** They are today's counts of record, not a
  result being revealed.
- **The seal is not on this page's Send.** `HoldToApprove`'s `pour` → `stamp`
  ceremony fires only when the sender is the Mudavym subdomain (ADR 0118 D2),
  which is not provisioned, so nobody sees it today. The house's own mailbox
  gets a plain button; the house rations the seal on purpose.
- **The undo countdown ticks, it does not animate.** It is a number re-read from
  the server's own `dispatchAt` once a second. Giving a two-minute window a
  progress bar would make a letter's departure feel like a process being
  watched rather than a decision that can still be reversed.
- **A queued letter's chip does not pulse.** Same reasoning as the draft chip
  below, one step further: a letter that draws attention to itself while it is
  still recallable reads as one that is already going.
- **Draft chips never pulse** — a draft that draws attention to itself starts to
  look like activity, and prc-02 exists to prevent exactly that.
- **A refusal does not shake, flash or slide.** It appears in place, in words.
  A guardrail hit is a sentence to read, not an alarm.

`prefers-reduced-motion` is honoured everywhere: `.cmp-pick` drops its
transition, and the sheet renders at its end state with nothing scheduled at all
(`Sheet.tsx` skips `animate()` rather than collapsing it).
