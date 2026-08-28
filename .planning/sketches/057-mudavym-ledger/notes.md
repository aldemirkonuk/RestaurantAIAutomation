# 057 — Mudavym · The Ledger

One of five competing brand directions for the WineOps → Mudavym rebrand (OD-106,
document only, no build). Thesis: **the house's book of record**. The software
disappears into an object every restaurateur already trusts — the ledger the house
has kept for years. Trust is the product; honesty idioms ("—" never a pass, "no
comparable data" never 0%, every number shows its working) are the brand, not a
feature. Accountant-grade calm on top, hospitality warmth underneath — and the
warmth always arrives *quoted*, never self-declared.

## Research moves used (cited by name)

From `research-reference-aesthetics.md` (pick-list numbers):

- **#2 Warm-paper neutral system** (manus) — the entire surface model: warm
  off-whites (#FAF8F4 family), a 4-step ink ladder shared by text and icons, and
  surfaces built as 2–8.5% alpha tints of warm ink #37352F rather than painted
  grays. This *is* the paper of the ledger.
- **#3 Semantic color + matching tint pair** (manus) — ok/warn/alert each ship
  with an ~10–13% alpha twin; status chips in the orders strip use only the pairs,
  never raw hue on paper.
- **#1 Serif greeting over one input** (manus) — the dashboard opens with the
  product speaking in serif: "Good evening. The book is open on tonight — what
  needs attention before service?" Serif is rationed to moments the product speaks.
- **#7 Mono micro-kicker vs display** (motion.dev) — 11px UPPERCASE JetBrains Mono
  kickers (+0.14em) against 40px tight-tracked serif display; the contrast is the
  layout system of the board itself (§01–§07 kickers).
- **#11 Numbered-index sections** (motion.dev) — the board is written as numbered
  entries, the way a ledger is paginated.
- **#9 Fast-out settle easing** (motion.dev) — house curve cubic-bezier(.16,1,.3,1)
  at 160ms for micro-states; everything lands in the 140–420ms band; hovers move
  ≤4px.
- **#14 Hairline-rule structure** (bklit) — rules, not cards: sections, KPI grids
  and order rows are separated by 1px ink hairlines; the accountant's **double
  rule** (3px double border) closes totals, specimen lists, and the footer —
  bklit's discipline without its radius-0 severity (radii 6–14px, soft for touch).
- **#12 Grayscale data, chroma = anomaly** (bklit) — stated as the chart rule in
  the palette section: data draws in the ink ladder; color appears only where a
  decision lives.
- **#15 Small hero, dense catalog** (bklit + manus) — display caps at 40px;
  authority comes from the record, not point size.
- **#17 Balanced-antithesis tagline** (manus + motion.dev) — slogans 03 ("Less
  counting, more cooking") and 04 ("Mudavym. On the record.") follow the two
  reference grammars exactly.
- **#18 Deadpan brand, quoted warmth** (bklit) — codified as voice rule 7; Marta's
  "Same as last time, my friend." and "Confirmed for Thursday, before noon." are
  the only warm lines in both mocks, both in quoted serif italic with attribution.
- **#6 Accent-tinted deep-ink dark mode** (motion.dev) — dark mode ("after close")
  is warm near-black (#171310) biased toward the paper/seal hue, never neutral gray.

From `research-stars-motion.md`:

- **react-motion spring philosophy** — the founder starred interruptible spring
  physics over hard-coded easing; `settle` (stiffness 260, damping 34) and `stamp`
  (500/26) are named springs, mapped 1:1 to the `motion` React library in the
  token table, and defined as a portable token file (the RN-portability note:
  Motion `transition` props and Reanimated `withSpring` share this vocabulary).
- **Number tickers in tabular-nums mono** (§4 Command, motion.dev AnimateNumber
  pattern) — the `tally` token + live ticker demo; JetBrains Mono `tnum` so money
  columns never shiver.
- **Motion as feedback, not decoration** (aesthetic-inference section) — the only
  emphatic motion is `stamp`, reserved for approvals, because entering something
  into the book deserves a small ceremony. Everything else settles.
- **motion.dev Radix Switch / Sheet Modal / Reorder lineage** — the three live
  demos (toggle, row expand, ticker) are the three patterns the archetype mapping
  says the product will actually ship.

From the repo's own heritage:

- **sketch 052 "WineOps document"** (`.planning/sketches/052-wineops-document/`) —
  the verdict-first document sketch already used warm paper #FAF8F5/#F2EEE7, warm
  ink #1D1A18, burgundy #9E4249/#6E2A31, green #2F6B45, amber #9A6B18. The Ledger's
  palette is that sketch's palette, systematized: the light-mode semantics are
  lifted verbatim (#2F6B45, #9A6B18), the seal (#8A2E33) is 052's burgundy family
  deepened for AA contrast on paper.

## The decisions, and why

**Does burgundy earn its place? Yes — as a seal, not a theme.** The brief left it
open. The argument for: (a) 052 heritage — burgundy is already the house color of
the document sketches; (b) wine-cellar provenance is the one domain fact the brand
keeps from WineOps; (c) a ledger needs exactly one non-ink color, and wax-seal red
is the historically correct one. The discipline: the seal appears only on acts of
record — approvals, the AI's drafted letters, the wordmark's full stop, kicker
numerals. It never fills backgrounds, never colors data, never decorates. If a
screen shows burgundy twice, one of them is wrong.

**Serif anchor: Source Serif 4 + Source Sans 3 + JetBrains Mono.** Source Serif 4
is the research-cited accent voice (bklit loads it); pairing it with Source Sans 3
gives one foundry, one drawing logic — "one book, one hand" — instead of an
arbitrary serif/sans marriage. JetBrains Mono is the research's own tabular-nums
citation and carries figures, IDs, kickers, timestamps. Three voices with strict
jobs: **serif speaks, sans works, mono counts.** Serif is rationed (once per
screen) so it stays a voice, not a wallpaper.

**Logo: three closure marks.** All three concepts are ways a book closes an entry:
1. *The Double Rule* — wordmark over the accountant's double underline (a total
   that stands). Most austere; strongest stationery.
2. *The Seal* — burgundy wax impression with stitched inner ring; doubles as the
   in-product approval stamp, so brand mark and product interaction are the same
   object. Recommended.
3. *The Full Stop* — "Mudavym." with a burgundy period; the period recurs as the
   app-tile dot and the terminal mark of every verdict sentence. Smallest system.

**Motion personality: "the hand that writes settles."** Five named tokens — `ink`
(160ms micro), `settle` (spring 260/34, house default), `ledgerTurn` (420ms,
.32,.72,0,1 — manus's expressive entrance curve, used for drawers/expands),
`stamp` (spring 500/26, approvals only), `tally` (650ms per-digit ease-out).
No bounce anywhere except the stamp's slight overshoot. All demos are live inline
and each carries its `motion` (React) mapping; the token set is written to be the
cross-platform file the stars research prescribes for RN/Reanimated later.
`prefers-reduced-motion` collapses everything to ~1ms.

**Honesty idioms as UI grammar** (not copy garnish): the orders mock renders
PO-1038's quantity as "—" with the footnote "the dash is the truth; ask Bodega
Sur, or count it at the door"; the revenue KPI carries a "working ↗" affordance;
the row-expand demo is literally called "show the working" and totals its
arithmetic with a double rule. The dash gets its own token (--ink-4).

## Voice guide (full)

**Posture.** Mudavym is the müdavim at the back table with the books: present
every night, precise, unimpressed by drama, quietly fond of the house. It writes
like a good bookkeeper who is also a regular — never like software.

**The eight rules.**
1. **Say what's known; mark what isn't.** Unknowns are "—", never 0, never a
   filled bar, never an average passed off as a reading. An empty cell is
   information; faking it is the one unforgivable sin of this brand.
2. **Every figure can show its working.** A number the product asserts opens into
   its arithmetic (price × qty, source, timestamp). If it can't, it is labeled an
   estimate in so many words. Corollary: never round in headline, then contradict
   in detail.
3. **Verbs first, numbers second, adjectives never.** The brand does not praise
   itself ("smart", "seamless", "powerful" are banned). Confidence is shown by
   being exact.
4. **Serif is the product speaking — once per screen.** Greeting, verdict, or
   question. If two serif sentences compete, one becomes sans.
5. **Plain trade words, no software words.** "Bottles in", "close the night",
   "the purchase book", "on the record", "at the door". Banned: SKU, sync,
   workflow, leverage, dashboard (in copy), AI-powered.
6. **Ask before acting; record after acting.** The AI drafts; the human enters.
   Every consequential action produces a visible line: who, what, when. Nothing
   auto-sends (consistent with the autonomous-email-replies guardrails).
7. **Warmth arrives quoted.** Vendor replies, staff notes, the drafted letter's
   own courtesy — serif italic, attributed, on a quote rule. The frame around
   them stays deadpan. The brand is the room; the people are the warmth.
8. **Endings are spoken slowly and plainly.** Deletion/closure copy states
   exactly what is lost, in full sentences, no euphemism ("close the book"),
   no guilt-trip buttons, no tiny gray cancel. Respect at the exit is the last
   proof of honesty.

**Tone dials.** Certainty: high on records, explicitly hedged on forecasts
("likely", "based on 6 weeks"). Formality: mid — contractions yes, slang no.
Humor: none in the frame; allowed only inside quoted humans. Urgency: stated by
age and consequence ("oldest waiting 2 days", "2 critical by Friday"), never by
exclamation.

**Microcopy patterns.** Empty states name the missing record and the act that
creates it ("No checks in the book yet. Close one at the terminal and it will be
entered here."). Buttons pair the verb with the entry ("Approve & enter").
Confirmations echo the record line, not a cheer ("Entered · 22:41", never
"Success!"). Errors say what the book could not do and what stands unchanged.

**The five rewrites** (also on the board):
- "Draft, approve, and track purchase orders through delivery" → *"Orders, from
  draft to the door — every step on the record."*
- "Alerts that need a decision, oldest first" → *"Waiting on you. Oldest first."*
- "No checks yet — close an order from the terminal" → *"No checks in the book
  yet. Close one at the terminal and it will be entered here."*
- "No comparable data" → *"Not enough history to compare — shown as '—'. We'd
  rather give you a dash than a guess."*
- "Permanently delete your Mudavym account." → *"Close the book. This deletes
  your account and every record in it — orders, counts, letters, all of it. It
  cannot be undone, and we will not slow you down with tricks. Type your
  restaurant's name to confirm."*

## Risks / honest caveats

- The direction leans literary; if every team ships serif verdicts without the
  rationing rule, it collapses into a themed notebook app. The "once per screen"
  rule is load-bearing.
- Warm paper in light mode needs contrast vigilance: ink-3 (#7A7267) on paper-2
  is the floor for meta text; never use ink-4 for content, only for the dash and
  disabled states.
- Verification note (§0.5): the board's tag balance, JS syntax, and 46.6KB size
  were verified statically; the shared Browser pane refused file:// snapshots
  during this session (five direction agents contending), so pixel-level
  rendering was not screenshot-verified. The three demos and theme toggle are
  plain-DOM and were desk-checked, not clicked.

| 057 | mudavym-ledger | The house's book of record — can honesty idioms and warm-paper provenance carry the whole brand? | null | brand, mudavym, ledger, paper, serif, provenance, honesty, od-106 |
