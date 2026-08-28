# 053 — Engineering agenda canvas

**Design question.** Engineering's charter forbids rolling its eight team metrics into
one number — a false merge and a stale bundle do not sum. So: *can a department whose
own rule bans a summary still be seen in one picture?* This canvas is the attempt. The
constraint drives the form: nothing here aggregates, and the one thing the eye is meant
to catch first is not progress but **absence** — seven of eight numbers reading
`unreadable`.

Companion to [`engineering-agenda-full.md`](../../01-org/platform/engineering/engineering-agenda-full.md)
(ADR 0039 Track B, dated 2026-08-28). Throwaway-grade thinking surface, not a product.

## What it shows

Three bands, top to bottom.

1. **The eight numbers.** One tile per primary metric, each carrying its reading or the
   literal word `unreadable`, plus the task id that would give it a producer. Two tiles
   are outlined rather than plain: `schema.days_since_hand_applied_ddl` (the only one
   readable today) and `platform.endpoints_protected_by_default_pct` (the only one
   measured *and* zero).
2. **The task field.** Nine lanes — the department plus its eight teams, each labelled
   with the kind of wrongness it owns — against a real date axis from 2026-08-28 to
   2026-10-30. Every chip sits at the date its task must have *moved* by, coloured by
   which of the three programs it belongs to. Dashed curves join the two live **seams**:
   one defect with two owning teams, which is the department's premortem M1 drawn rather
   than described.
3. **The argument, and the corrections.** Four short panels saying what the layout is
   claiming, then the four charter figures this canvas had to re-measure before it could
   be drawn.

## How to read it

- **Left-to-right is time; there is no priority axis.** A chip further right is later,
  not less important. PV-3 and CS-3 are at the far right because they are the two
  longest pieces of work, not the two least urgent.
- **Colour is the program, not the team.** Green = give a number a producer. Purple =
  the per-page audit. Amber = shrink-only debt. Red = a Track-A obligation from
  ADR 0039. Blue = a *proposal*, because a lock or an open OD sits behind it — SM-3
  (OD-110) and PA-3 (the protection-by-default mechanism) deliver a measurement and a
  case, never a resolution.
- **A dashed curve means the seam is unassigned.** Both are inputs to D-5, the weekly
  seam-arbitration close; when a seam gets a left-of-seam owner the curve should be
  redrawn as a single chip in that owner's lane.
- **Density in September is deliberate and is not a plan to ship features.** Everything
  before 2026-09-30 is measurement. The department's directive says a change to a metric
  never read is a guess, so the producers come first even though none of them is visible
  to a restaurant.
- **What is deliberately missing.** The seven findings in agenda §5 have no chip. A task
  no card and no loop can carry is a finding, and drawing it here would make it look
  scheduled. If you are looking for the ENDPOINTS atlas correction or the OD-19 hand-off
  to Security, that is why they are absent.

## Notes

- Self-contained: one HTML file, no external assets, no fonts, no scripts fetched.
  Layout is computed in-page so chips repack on resize instead of colliding.
- Light and dark are both driven by CSS variables under `prefers-color-scheme`; both
  were rendered and checked at 1360px.
- Chip positions are derived from the `close_time` column of the agenda's §3 tables. If
  a date moves there and not here, the canvas is the stale one — it is a picture of the
  agenda, never a second source of truth.
