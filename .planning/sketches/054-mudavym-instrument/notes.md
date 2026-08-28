# 054 — Mudavym: The Instrument

Brand direction 054 of 5. The back office as a precision instrument (bklit.com lineage).
Premise in one line: **the restaurant's numbers, taken seriously — chroma appears only when
something needs a decision.**

## Rationale — research moves used, by name

All moves cited from `research-reference-aesthetics.md` (transferable-moves pick-list) and
`research-stars-motion.md`.

- **Move 12 — "Grayscale data, chroma = anomaly"** (bklit) is the direction's spine, promoted
  from a chart rule to the *entire brand system*: surfaces, chips, KPIs, and the logo itself
  are grayscale; the single signal hue (decision amber `#FFB224` dark / `#8F5F00` light) marks
  only items awaiting a human decision. Trends and deltas stay in the gray ramp — up/down is
  weather, not anomaly. A screen with no pending decisions is fully monochrome; that state is
  the reward, and it is the answer to the sketch's question (calmer tool, louder decisions).
- **Move 14 — "Hairline-rule structure, radius near 0"** (bklit): 1px translucent rules replace
  cards and shadows everywhere; `--radius: 0` tokenized. The research warning ("do NOT copy
  radius-0 brutalism wholesale — floor staff on tablets at 11pm need bigger, softer, warmer
  touch targets") is answered with *size, not curvature*: radius stays 0, but touch controls
  keep ≥44px hit areas, contrast is high, and warmth enters through quoted humans (Move 18),
  never through geometry. This is the direction's honest tension, carried deliberately.
- **Move 13 — "Chart-token vocabulary"** (bklit): the palette ships chart atoms as first-class
  tokens (`--ramp-1..5`, `--crosshair`, `--gridline`) so every viz across 40+ pages is one
  instrument, matching bklit's ~40 named chart tokens.
- **Move 7 — "Mono micro-kicker vs giant display"** (motion.dev), inverted for an ops tool:
  the register contrast is kept (11px tracked mono caps vs tight-tracked headings) but display
  is capped at 32px per **Move 15 — "Small hero, dense catalog"** (bklit + manus). Authority
  via restraint; density worn proudly.
- **Move 9 — "Fast-out settle easing everywhere"** (motion.dev) + bklit's own motion profile
  ("0.15s fades… nothing springs; everything settles fast"): the motion system is three tokens
  (`flip` 120ms, `settle` 180ms, `reveal` 240ms) all in the `.16,1,.3,1` family, plus `count`
  500ms for tickers. Explicit anti-spring stance: *springs oscillate; instruments settle* —
  the one direction of the five that declines the react-motion spring philosophy at rest,
  while still shipping the tokens through the `motion` library per research §5 (the token
  file is the RN-portable unit).
- **Move 10 — "Clip-path reveals"** (motion.dev): row expands and drawers unmask
  (grid-rows/clip) rather than slide or fade — demonstrated live in the row-expand demo.
- **Move 16 — "Kbd-hint mono chrome"** (bklit): ⌘K and hold-to-approve hints are permanent
  10px mono furniture in both sample screens; the command palette is advertised, not hidden.
- **Move 18 — "Deadpan brand, quoted warmth"** (bklit): codified as voice rule R-08. The only
  warm sentence on the Orders mock is the quoted AI/vendor reply ("Confirmamos 24 botellas…");
  the chrome around it stays flat. Warmth is quoted, never authored.
- **Move 17 — "Balanced-antithesis tagline / Name. Category claim."** (manus + motion.dev):
  slogan S-03 ("Mudavym. The restaurant's instrument.") uses the structure directly; the rest
  obey the shared cross-site finding "quantified-confident, verb-first, allergic to adjectives".
- From `research-stars-motion.md` §4/§5: number tickers land on KPI cells (AnimateNumber
  Counter/Trend pattern, rebuilt free with rAF + tabular-nums), hold-to-confirm is referenced
  in the Orders footer ("HOLD ⏎ TO APPROVE"), and the motion tokens are authored as a
  `packages/ui/motion-tokens.ts` snippet consumable by `motion` now and Reanimated later.

Deliberately rejected for this direction: manus's serif greeting (Move 1 — this brand never
speaks in a book voice), per-domain accent theming (Move 5 — multiple accents would dilute
chroma-as-anomaly to chroma-as-wayfinding), and the incumbent burgundies (#9E4249/#CD2D5B —
a wine-colored brand would spend chroma on identity; this direction spends it only on
decisions).

## Identity

- **Name story used**: müdavim = the regular, the guest who returns and is counted on. The
  tally mark (Concept A) makes "counted on" literal — the oldest ledger mark there is.
- **Logo concepts**: A "The Tally" (four strokes + strike = five; primary), B "The Register"
  (calibration corners + solid center; favicon-strong), C "The Meter" (M as a five-bar level
  meter; the app-icon/animated variant whose single amber bar obeys the anomaly rule).
- **Wordmark registers**: Geist 600 −0.025em mixed case (product label) and Geist Mono 500
  +0.5em tracked caps (the stamp register — receipts, exports, printed POs).

## Palette (from scratch — no inherited burgundy)

Dark is home. Full token set in `index.html` §04; headline tokens:

| Token | Dark | Light |
|---|---|---|
| panel / surface / raised | #0A0B0D / #101114 / #16181C | #F5F5F4 / #FFFFFF / #FAFAF9 |
| rule / rule-strong | white 9% / 17% | ink 11% / 22% |
| ink ladder | #F4F5F6 · #B6BABF · #82878D · #55595F | #101113 · #44484D · #7A7F85 · #A8ACB1 |
| **signal (decision amber)** | **#FFB224** (+10% tint) | **#8F5F00** (+10% tint) |
| critical (irreversible money) | #F2555A | #CE2C31 |
| ok (transient only, never at rest) | #3DD68C | #1E7F4F |
| chart ramp (5) | #E8E9EA→#33373C | #26282B→#DDDEDF |

Anomaly-accent rationale: **amber is the caution lamp of every instrument panel** — visible
across a kitchen, unmistakable, and not an alarm. Red would cry wolf on routine approvals;
blue reads as "link/brand" and carries no urgency. Amber means exactly "a human decision is
waiting", red means exactly "money leaves irreversibly", green appears only as a confirmation
flash. Usage law: one lamp per screen region; amber leaves with the decision.

## Type

Geist + Geist Mono (both Google-hosted — bklit's exact pairing; nearest-equivalents note:
Inter / JetBrains Mono acceptable fallbacks). Scale (px): display 32/38 · h1 24/30 ·
h2 19/26 · h3 16/24 · body 14/22 · ui 13/18 · data-lg 26/30 mono · data 13/18 mono ·
kicker 11/14 mono caps +0.14em · micro 11/14 mono. Laws: every numeral is mono + tabular, no
exceptions, including inside prose; display never exceeds 32px; no serif in the system.

## Motion

`flip` 120ms cubic-bezier(.2,0,0,1) — binary state · `settle` 180ms (.16,1,.3,1) — the house
curve · `reveal` 240ms (.16,1,.3,1) — unmask expands/drawers · `count` 500ms — KPI odometer.
No spring type anywhere; reduced-motion collapses to instant state change. Shipped as
`packages/ui/motion-tokens.ts` for the `motion` React library; same numbers feed Reanimated
later (research-stars-motion §5: the token file is the portable unit). Three live demos in
the board: settings toggle (ink-filled ON state — chroma not spent on settings), row expand
(grid-rows unmask, + becomes −), number ticker (tabular figures, zero layout shift, lands on
the exact cent).

## Voice guide (full)

The product reports. It does not chat, apologize, or celebrate.

**R-01 Numbers, not adjectives.** "Fast" is banned; "1.8 s" is not. Any claim that matters
carries a figure. A sentence that needs an adjective needs a number instead.
**R-02 Every numeral is mono, tabular, typeset — never spelled out.** "7 items", not "seven
items". Figures align in columns even inside prose.
**R-03 State first, action second.** The readout precedes the button. Empty states, errors,
and prompts open with the current state as a measurement, then name the one action.
**R-04 Name the consequence, never ask for feelings.** "Deletes 3,412 orders. No recovery."
replaces "Are you sure?"
**R-05 No apologies, no cheers.** Never "Sorry, something went wrong!"; never "Success!".
Exclamation marks do not exist in this product.
**R-06 One sentence per message.** A second sentence is a second message. Fragments are legal:
"0 checks." is a complete report.
**R-07 Physical verbs only.** Draft, approve, close, count, receive, deliver. Never manage,
leverage, empower, streamline. If a hand can't do it, the verb is wrong.
**R-08 Warmth is quoted, not authored.** Vendor replies, staff notes, and the AI's drafts
render in full human register — quoted, attributed. The chrome stays deadpan. The contrast is
the brand.

Canonical rewrites:

| Before | After |
|---|---|
| Draft, approve, and track purchase orders through delivery | Draft. Approve. Track to the door. |
| Alerts that need a decision, oldest first | 4 need a decision. Oldest first. |
| No checks yet — close an order from the terminal | 0 checks. The count starts when an order closes at the terminal. |
| No comparable data | No baseline. Comparison starts at 14 days of data. |
| Permanently delete your Mudavym account. | Deletes this account and every record in it — 3,412 orders, 2 years of counts. No recovery. Type the restaurant's name to proceed. |

## Slogans (with rationale)

1. **Count on it.** — tally + trust; müdavim is counted on to return, the owner counts on the
   instrument. Both meanings literal.
2. **The house, measured.** — hospitality's own word for itself + the instrument's promise.
3. **Mudavym. The restaurant's instrument.** — Name. Category claim. (Move 17); footer line on
   every export.
4. **Every bottle. Every dollar. Every night.** — tally cadence, full scope, zero qualifiers.
5. **The back office, calibrated.** — names the enemy and the fix; procurement/receiving story.
6. **Trust the readout.** — the operator's actual relationship with the product; doubles as an
   internal design bar the readout must clear.

## Sample screens — what they prove

Dashboard: Revenue and Pending stay gray (weather); amber touches exactly the two tiles
awaiting a human (Low stock 7, Alerts 2) and the one decision card that resolves them. Orders:
one amber chip on the whole strip (AI draft ready); status chips are outline gray (states, not
decisions); the quoted vendor reply is the only warm sentence on screen (R-08); ⌘K and
hold-to-approve are permanent mono furniture (Move 16).

## Open questions for the founder

- Is decision-amber the right single hue, or should the lamp be tested against a signal
  blue/orange in situ? (The rule matters more than the hue; the hue is swappable.)
- Radius 0 on *touch* controls too (as boarded), or 2px concession on buttons/toggles for the
  11pm-tablet case? The board holds the hard line; the concession costs little.
- Does the no-serif stance hold once the sommelier/wine-heritage surfaces arrive, or does the
  cellar earn a quoted-serif exception under R-08?

| 054 | mudavym-instrument | Radius-0 monochrome precision — does chroma-as-anomaly make a daily ops tool calmer and decisions louder? | null | brand, mudavym, instrument, monochrome, tabular, anomaly-color, od-106 |
