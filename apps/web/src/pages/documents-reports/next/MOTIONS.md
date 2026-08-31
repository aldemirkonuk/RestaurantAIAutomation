# DocumentsReportsNext (the Sorting Office) — motions, canonical

Two motions from `src/lib/mudavym/motion.ts`. A sorting office is calm by
profession: paper moves, the room does not.

| id | token | curve · ms | fires |
|---|---|---|---|
| `so-settle` | `settle` | HOUSE · 320ms | the reading pane settling open when a report is chosen (keyed per report, so switching reports re-settles) |
| `so-ink` | `ink` | HOUSE · 160ms | drawer rows, register links, and the copy/retry controls on hover/focus — one paper step, background and border only, nothing translates |

Deliberate non-motions: **counts never tally up** — a register's number is a
fact read off a drawer front, and a rolling odometer would dramatize what is
merely true; the **noise roll never pulses or scrolls** — routine that filed
itself is the opposite of an alarm; the **waiting drawer opening when its
registers answer swaps content without an entrance** — the queue was always
there, the page just finished counting it; a filled window's `≥` appears as
text, never as a highlight.

Reduced motion: the page's style block kills both the settle keyframe and the
ink transitions under `prefers-reduced-motion: reduce` with `!important`.
