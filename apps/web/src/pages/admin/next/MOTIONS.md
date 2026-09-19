# AdminDesk — motions, canonical

Every duration and curve here is the `ink` token from `src/lib/mudavym/motion.ts`
(`cubic-bezier(0.16, 1, 0.3, 1)`, 160ms), inlined in `admin-desk.css` rather than
imported — the token has no CSS-consumable form, so peer pages (`team-next.css`,
`connections-next.css`) hand-copy the same curve and this page follows suit.

| id | token | curve · ms | fires |
|---|---|---|---|
| `ad-ink-btn` | `ink` | HOUSE · 160ms | restart/stop buttons, "Read again", the confirmation Sheet's confirm button — background and border-colour only on hover, nothing translates |
| `ad-ink-link` | `ink` | HOUSE · 160ms | the house-register links (Settings, Connections, Activity ledger) — colour only |
| `ad-ink-row` | `ink` | HOUSE · 160ms | an agent row's background on hover/focus, when it opens the per-agent drill-down |
| `mdv-sheet-tuck` | `tuck` | spring 380/32 · 300ms | the restart/stop confirmation `Sheet` and the per-agent drill-down `Sheet`. Inherited from the house primitive (`components/mudavym/MOTIONS.md`), not re-declared here |

## Deliberate non-motions

- **A reading never counts up or fades in.** Agent status, the database check
  and provider configuration are standing facts read once per poll; animating
  their arrival would imply they are being computed live, which they are not.
- **A stale reading does not flash.** When a re-read fails, the kept reading's
  row gets a text label ("as of …") in `--ink-3`, not a colour change or a
  transition — the house has no warning hue (ADR 0042), and a flashing row
  would draw attention away from the fact that matters, which is the age of
  the number on screen.
- **State (healthy / needs attention) is ink weight, not colour.** The house's
  one chromatic colour is the seal, reserved for "a thing you may do" (a link,
  a button, a focus ring) — never for a status word. So there is nothing here
  to animate a colour transition between; "needs attention" is heavier ink,
  set once, not eased into.

`prefers-reduced-motion` is honoured: `admin-desk.css`'s closing media query
sets `transition: none !important` on every control, link and row.
