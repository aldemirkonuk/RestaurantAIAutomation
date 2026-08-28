# 056 — Mudavym · "The Pass"

One of five competing brand directions for the WineOps → Mudavym rebrand (OD-106,
document-only). Named for the kitchen pass — the rail where the expo calls the order
and the whole line answers. The bet: expo-line energy, run with expo-line discipline.
Mudavym is the calm loud voice that runs service.

## Rationale — research moves used, by name

All moves cite `research-reference-aesthetics.md` (transferable-moves pick-list) and
`research-stars-motion.md` (§2 aesthetic inference, §3–5 motion catalog/strategy).

- **Mono micro-kicker vs giant display** (move 7, motion.dev) — the direction's spine.
  128px/900 uppercase calls over 11px JetBrains Mono kickers at +.14em: a ~12:1 ratio on
  one screen. The research found this contrast "IS the layout" on motion.dev; here it is
  recast as the expo's dynamic range — shout the call, whisper the metadata.
- **One family, stretched** (move 8) — Archivo 500→900 does everything from 128px calls
  to 13px labels; contrast comes from weight and tracking (−.01em → −.04em as size grows),
  never from a third face. Mono is the only second voice.
- **Fast-out settle easing everywhere** (move 9) + the **react-motion spring signal**
  (stars research §2: the founder starred interruptible spring *physics*, not easing
  choreography). The Pass translates it into five named tokens — `call` 700/34, `slam`
  1000/42, `slide` 420/38 (critically damped), `roll` 120/26, and CSS `settle`
  cubic-bezier(.16,1,.3,1)/160ms. Everything lands inside 400ms; only revenue rolling in
  gets 600ms. Research §3's warning ("an ops tool that animates this much would exhaust
  staff mid-shift") is answered structurally: springs fire only on *state change*, one
  soft overshoot max, drawers critically damped, hover states stay CSS-only (research §5
  split-of-labor rule).
- **Accent-tinted deep-ink dark mode** (move 6) — service mode is `#15100A`, near-black
  biased toward Fire, never gray; the warm ink ladder (`#F6F0E6→#665E4F`) carries 95% of
  the surface. Prep mode (light) is **warm-paper neutrals** (move 2, manus): `#F7F4ED`
  ticket paper with a 4-step ink ladder.
- **Semantic color + matching tint pair** (move 3) — every status hue ships with its
  ~10–12% alpha twin. Statuses are renamed as kitchen calls: **Fire** (primary action),
  **Go** (success/"walking"), **Hold** (warning), **86** (danger/out-of-stock). The
  domain language does the brand work; the hex codes stay disciplined.
- **Grayscale data, chroma = anomaly** (move 12, bklit) — charts draw in the ink ladder;
  color appears only where a decision lives. One accent on screen at a time
  (cross-site synthesis rule).
- **Hairline-rule structure** (move 14, bklit) — 1px translucent rules structure the
  board and the tables, but the research's own warning is honored: radius 4px on data
  surfaces, 12px on touch targets, pill on chips. "Borrow the discipline, not the
  severity" — floor staff at 23:00 get big soft targets.
- **Kbd-hint mono chrome** (move 16) — PO codes, timestamps, ⌘K hints as permanent
  10px mono furniture.
- **Balanced-antithesis + "Name. Category claim." slogan structures** (move 17) —
  "Less chaos, more service." and "Mudavym. Your restaurant, expedited."
- **Deadpan brand, quoted warmth** (move 18, bklit) — the brand voice never praises
  itself; warmth enters through the vendor thread and the AI's staged drafts, quoted.
- **Hold-to-confirm** (stars research §4 Command archetype; kokonutui `hold-button`,
  motion.dev Interactions) — live on the dashboard's one-tap card: destructive-adjacent
  actions get a 600ms hold, not a dialog. "No dialogs on the line."
- **Number tickers** (stars research §4: AnimateNumber via `useSpring` + tabular-nums in
  JetBrains Mono) — the `roll` token, live on the KPI tile and the motion demo.
- **Numbered-index sections** (move 11) — the board itself is 01–07, the motif
  recommended for onboarding/reports/checklists.

Deliberately rejected: manus's serif greeting (move 1) — a book face is the wrong voice
for a direction whose premise is the expo's bark; the sibling directions cover that
register. Also rejected: motion.dev's per-domain accent rotation (move 5) — The Pass
runs ONE accent (Fire) everywhere to keep the call unambiguous; domain identity comes
from kickers and content, not hue. Rejected: bklit's radius-0 wholesale (see move 14
note above).

## Identity summary

- **Logo A — The Rail** (primary): MUDAVYM 900 under a heavy rule with two clipped-ticket
  nubs; the V set in Fire doubles as the approve tick. Every approval re-draws the logo.
- **Logo B — The Chit** (app icon): serrated order ticket clipped to the rail, M on the
  chit. Reads at 24px.
- **Logo C — The Stamp** (documents/vendor email signature): tilted expo "seen" stamp,
  lowercase wordmark, mono strapline "SEEN · CALLED · SENT".
- **Palette**: Fire `#FF5A26`/`#E03A0E`, Go, Hold, 86 + warm ink ladders; dark =
  fire-tinted ink, light = ticket paper. Full tokens in `index.html` §04.
- **Type**: Archivo (500–900) + JetBrains Mono (400–700, tabular always). Scale:
  128/88/64(mono)/56/32/18/15/13/11/10. Hero-to-kicker ≈ 12:1.
- **Motion**: `call` · `slam` · `slide` · `roll` · `settle` (specs in §06, mapped to the
  `motion` React library; portable to Reanimated `withSpring` via the shared
  stiffness/damping vocabulary — stars research §5 RN-portability note).

## Voice guide (full)

The expo doesn't narrate. The voice is loud once, then silent.

**R1 — Lead with the verb. Then stop.** "Approve." "Count." "Send." A period is a full
instruction. Buttons are one word wherever the object is already on screen. Never
"Click here to approve this order" — the order is right there.

**R2 — Numbers before nouns.** "7 low. 3 pending." The operator scans quantities first;
the noun confirms, it doesn't headline. All figures in mono, tabular, never spelled out.

**R3 — One line per call.** No subordinate clauses on action surfaces. If a sentence
needs a comma, it's two calls — split it. Long-form explanation lives in docs and
tooltips, never on the line.

**R4 — Say the next action, not the system state.** Empty states point at the door, not
the void. Never "No data available"; always what to do about it ("No checks yet. Close
one from the terminal.").

**R5 — Shout once per screen.** One imperative per card; everything else stands down.
Two shouts on one surface is chaos, and chaos is the enemy. Display-scale type appears
at most once per view.

**R6 — Confirm in the past tense.** "Approved." "Sent." "Counted." Every action echoes
its own verb, completed — the kitchen answering the call back. Toasts are the echo,
nothing more.

**R7 — Time is short and relative.** "2m ago." "Tonight." "By Fri." Full timestamps only
inside documents and audit trails.

**R8 — Destruction gets the full sentence.** The one place the voice slows down.
Irreversible actions are spelled out in complete, unhurried sentences with the
consequences named. No verb-slamming near the edge.

### Canonical rewrites

| Before | The Pass | Rules |
|---|---|---|
| Draft, approve, and track purchase orders through delivery | Draft it. Approve it. Track it to the door. | R1 R3 |
| Alerts that need a decision, oldest first | Needs a call. Oldest first. | R1 R2 |
| No checks yet — close an order from the terminal | No checks yet. Close one from the terminal. | R4 |
| No comparable data | Nothing to compare — yet. Two weeks of service fixes that. | R4 |
| Permanently delete your Mudavym account. | This deletes your Mudavym account and everything in it — orders, counts, vendor threads. There is no undo. | R8 |

### Vocabulary
- The AI is never "the AI" in-product; it is Mudavym, and it stages, drafts, and calls.
  It never auto-sends (locked guardrail) — so the voice never claims "sent" until the
  operator fired it.
- Kitchen calls are UI primitives: *fire* (execute), *hold* (pause/warn), *86*
  (out/danger), *walking* (done/in motion), *all day* (totals), *heard* (ack).
  Use them where floor staff read; keep plain English where owners' accountants read
  (documents, invoices, exports).

## Verification

Rendered and exercised live via localhost + browser pane (static-file preview blocks JS):
all three spring demos verified working (toggle re-targets, row critically damped, ticker
rolls and settles at exact targets), hold-to-approve completes at 600ms and echoes
"Approved.", dashboard KPI settles at $4,280, both sample screens render in their modes,
all six logo tiles render light and dark. File is 45KB, well under the 150KB budget.
Not verified: real mobile hardware (only 534px-wide pane render), reduced-motion branch
(code-gated, not visually exercised), Turkish diacritic rendering in Archivo.

| 056 | mudavym-pass | Expo-line energy — can display-scale type and imperative voice run daily ops without exhausting the operator? | null | brand, mudavym, pass, display-type, imperative, spring, od-106 |
