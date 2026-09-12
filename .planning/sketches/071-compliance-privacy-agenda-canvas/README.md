# Sketch 071 · Compliance & Privacy — Agenda Canvas

**Design question:** A privacy control that has never run and a privacy control that works
look identical on paper — both are "committed, argued, CI-guarded." Can one page make the
difference visible, so the department's agenda reads as *what moves from asserted to
exercised, and by when*, rather than as a list of intentions?

**Context:** Wave 3 ([[0039-activation-plan-of-record]] Track B, `GENERATION_BRIEF.md` §8).
The picture of [`compliance-privacy-agenda-full.md`](../../01-org/corporate/compliance-privacy/compliance-privacy-agenda-full.md)
dated 2026-08-28 — 19 tasks across three teams, one of which is dormant behind its trigger.
Throwaway-grade thinking surface per the sketch conventions, not a product.

## Direction

| | |
|--|--|
| **Domain** | Consent gate · PII definition convergence · obligation register · crypto-shredding key design · erasure denominator |
| **Organising idea** | Three bands — **proven** (has run at least once), **asserted** (exists, never exercised), **absent** — and every task placed at the date it moves something between bands |
| **Color world** | Dark control-board; wine `#9E4249` reserved for *the one date another department depends on* and for findings, so it never becomes decoration |
| **Rejects** | A status dashboard (this department's numbers are mostly zero and a dashboard of zeros teaches nothing); a Gantt (dependencies here are cross-*department*, not cross-task); an org chart (three teams, one of them dormant — the chart is one line long) |

## What the page shows, in order

1. **Counters, re-measured against `HEAD` on 2026-08-28** — not transcribed from wave 2.
   Where a number moved, the wave-2 number is struck through rather than quietly replaced.
2. **The 19-task timeline**, lanes by team, columns by `close_time` (Sep 04 → Oct 30).
   Chip border style carries the grade: solid = committed, dashed = reach, dotted =
   aspiration. One chip glows — 09-11, the consent-gate SPEC, because that date is
   [[customer-relationship-research-charter]]'s dependency and not an internal estimate.
3. **The two-subject gate** — the finding that the department's "consent gate" is two
   gates, and the half that blocks Media & Brand (a **customer** approval register) is not
   the half the good 564-line guest schema solves.
4. **The derivation trap** — two key diagrams side by side. `guest_pepper()` derives a
   per-restaurant key by HMAC from one vault master secret; a derived key cannot be
   destroyed independently, so ADR 0037's crypto-shredding needs keys that are **stored,
   not derived** — structurally the opposite of the only precedent in this repo.
5. **The seams table** — what the department owes five other units, with the wave-2 state
   struck through beside the wave-3 date.
6. **Findings** — the fourth PII definition (Sentry, shipping today), the notice that
   omits a whole data flow, the citations that all drifted in four days — and the cheapest
   large win: the store-inventory publisher already runs in CI as a *security* guard.
7. **Locks**, stated out loud: NF-B HELD, pricing deferred, brand visuals held, no open
   fork resolved.

## Why these two diagrams and not others

Both are places where the *obvious* move is wrong, which is the only kind of thing a canvas
earns its space by showing:

- **The gate.** Everyone reading the charter assumes the excellent guest schema is the
  blocker being cleared. It is not — the blocking record is B2B and unbuilt, and that makes
  the dependency *smaller* than it looked, not larger.
- **The keys.** An implementer at NF-B activation will copy `guest_pepper()`, because it is
  the only key-management pattern in the tree and it is well argued. They would build a
  store that cannot shred and would find out at the first erasure request.

## Verification

Rendered at 1600×1100 and at 560×840 from a local static server; layout holds at both
(the timeline scrolls horizontally inside its own container rather than pushing the page).
Self-contained: no external stylesheets, fonts, scripts or images. Tag structure validated
(`html.parser`, zero unclosed tags, zero mismatches).

## MANIFEST row

Not added here — the manifest is edited by the orchestrating session
([`GENERATION_BRIEF.md`](../../foundation/GENERATION_BRIEF.md) §8.4). The row is:

```
| 071 | compliance-privacy-agenda-canvas | A privacy control that has never run and one that works look identical on paper — can one page show which is which, and by when each moves? | — | compliance, privacy, agenda, wave-3, consent-gate, crypto-shredding, pii-definition, obligation-register, erasure, subprocessor, notice-accuracy |
```
