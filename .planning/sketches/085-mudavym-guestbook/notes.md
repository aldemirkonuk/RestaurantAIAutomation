# 085 — Mudavym · The Guest Book

**Thesis.** Recognition is the product. The great restaurant's superpower is that it remembers —
your table, your vintage, the vendor who shorts you every July, the server who covers every Friday.
Ops software is anonymous by construction: it leads with an ID because the database does, it greets
no one, and it forgets the moment a record closes. This direction makes *memory and arrival* the
identity. The hospitality is the greeting; the technical superiority is the **recall** — nothing
forgotten, every pattern noticed, history one gesture away.

The mandate ("hospitality and passion while technically superior") is usually solved by bolting a
warm colour onto a cold grid. Here the two halves are the same claim: *being known* is the hospitality,
and *total recall* is the engineering. A direction where the warmth and the rigour are the same
sentence is the only kind that survives contact with a real product.

---

## 1. Research moves adopted, by name

Moves cited from `research-reference-aesthetics.md` (pick-list) and `research-stars-motion.md`.

| Move | How 085 uses it | Where |
|---|---|---|
| **2. Warm-paper neutral system** | Kept, then bent: paper stays warm (`#FBF8F4`), but the four-step ink ladder is cast *violet* (`#1C181F → #918A98`) and surfaces are alpha tints of `#29222E`, never painted grey. Warm paper + cool ink is what a written page actually looks like. | §05 |
| **3. Semantic colour + matching tint pair** | Every status hue ships with its 10–13% tint twin (`--kept/--waiting/--owed` + `-tint`). State colour never sits raw on paper. | §05, chips |
| **6. Accent-tinted deep-ink dark mode** | The night book is `#141118` — near-black biased toward the signing violet, with borders and margin rules a step lighter in the same hue. Dark is lamplight, not grey. | §05 |
| **9. Fast-out settle easing everywhere** | The whole motion table sits in the 150–400ms band on fast-out/long-settle curves. Exactly one token overshoots (`markSet`), and only on the return-marks. | §07 |
| **14. Hairline-rule structure, radius near 0** | Borrowed as *ruled lines* rather than brutalism: hairline row rules, a `repeating-linear-gradient` ruled sheet at 34px, and a violet **vertical margin rule** that creates the date column. Radii stay 8–15px on touch controls; the founder's staff are on tablets at 23:00, not in a terminal. | §01, §08 |
| **15. Small hero, dense catalog** | There is **no hero type**. The greeting is 30px; the date rail is 11px. A book does not shout its own title at you on every page — authority comes from the completeness of the record. | §06 |
| **16. Kbd-hint mono chrome** | ⌘K stays permanent furniture in the mock's bar. | §08 |
| **17. Balanced-antithesis tagline** | Slogans 02, 03, 05 are name-period-claim / "Less X, more Y" / two-word verb-first. | §03 |
| **18. Deadpan brand, quoted warmth** | The load-bearing voice rule. Mudavym's own sentences stay plain and exact; warmth arrives **inside quotation marks** — Marta's reply, Deniz's note. This is what stops a memory-brand from becoming saccharine. | §04, §08 |
| **stars: interruptible spring physics** (chenglou/react-motion → Motion) | `leaf` and `markSet` are declared as real springs (stiffness/damping/mass), with CSS bezier approximations recorded honestly in `motion.json` rather than pretending CSS springs. | `motion.json` |
| **stars: the motion token file is the portable unit** | Every token is named, numeric, and framework-neutral, so Motion `transition` and Reanimated `withSpring` consume the same physics vocabulary. | `motion.json` |
| **stars: number tickers (AnimateNumber pattern)** | `reckon`, rebuilt on the free API: `useSpring` + `tabular-nums`. | §07 |
| **stars: path drawing (`pathLength`)** | Two uses only — the signature (`signStroke`) and the return-marks (`markSet`). Both are hand marks; nothing else in the product draws itself. | §07 |
| **stars: staggered list entrance, first paint only** | `arrive`, 45ms stagger, first paint only. A working list never animates again while someone is reading it. | §07, §08 |
| **stars: `useReducedMotion` gated from day one** | The reduced-motion block zeroes **transition-delay as well as duration** — otherwise the Recall's 300–840ms stagger plays out slowly and silently, which is worse than not playing. | §07 CSS |

### Moves deliberately declined

- **1. Serif greeting over one input** — adopted the *serif greeting*, declined the *one input*. Mudavym's
  product is the operation, not a prompt box; a prompt-first surface would misrepresent it (the research
  says this explicitly about manus).
- **5. One-accent-per-domain theming** — declined. This direction spends its single accent on
  *recognition*, and a per-domain hue rotation would make the violet mean "where you are" instead of
  "you are known". Cannot have both; chose the one the brand is about.
- **7. Mono micro-kicker vs giant display (10:1)** — kept the mono kicker, killed the giant display.
  See "small hero" above; the contrast here is ~3:1, not 10:1, and that restraint is the point.
- **12. Grayscale data, chroma = anomaly** — retained as a stated chart rule, but this direction's
  charts are not its argument, so it is one line in §05 rather than a section.
- **4. Thinking shimmer** and **10. Clip-path reveals** — both good, both belong to a different
  direction's personality. Ink is laid down; it does not shimmer or unmask.

---

## 2. Logo — why three, and which one

Three complete systems, each with an app tile and a wordmark lockup, each of which had to pass one
test: **does it do a job inside the product, or only on the door?**

1. **The Ruled Name.** The wordmark is *signed onto* the line, not set above it — the descender of the
   *y* crosses the rule and knocks a clean break in it (a paint-order knockout in the paper colour),
   exactly as a real signature crosses ruled paper. The line runs past the name on both sides and closes
   on a violet check made *across* it. That break cannot be faked by a logo that merely sits on a bar,
   and the rule is the same hairline that underlines every name in the app.
2. **The Return Marks.** Four strokes and the fifth across them — the oldest count in the world, and the
   only glyph that means *this has happened again*. The fifth stroke is gilt: the visit being recorded
   right now. It survives 16px, engraves on brass, and stencils on a crate. Decisively: **the identical
   glyph is the return-tally in every entry rail**, so the logo is literally a UI component.
3. **The Kept Page.** A ribbon marker running out past the bottom edge of a page, with a darker fold at
   the edge so it reads as material rather than a stripe. In product it is the regulars marker — it hangs
   on the vendor you always reorder from, the staff member who never misses, the table that is always theirs.

**Recommendation: Concept 2 as the mark, Concept 1 as the wordmark.** The tally is the only one of the
three that is simultaneously a logo and a working component — the strongest possible argument that
recognition is the product — and the ruled name is the only lockup with a detail a competitor cannot
copy without copying the idea.

---

## 3. Palette — why violet, and why gilt is not a colour

The founder asked for an accent outside typical startup palettes. **Signing violet `#5E2A63`** is not a
mood board choice: aniline violet was the standard ink of civil registers and hotel books for roughly a
century, which makes it the historically correct ink for a guest book *and* places it well outside the
blue-indigo-emerald band every SaaS competitor is standing in. It is also unmistakably distinct at a
glance from 081's burgundy seal, which matters when nine boards are compared side by side.

**Gilt (`#B8862B` / `#DDB264`) is declared a material, not a status.** It appears only on tally marks,
ribbons and page edges — never as a fill, never as text, never as a state. The moment gold means
"warning", the recognition system dies, because the reader can no longer tell "you are a regular" from
"something is wrong". This is the single rule most likely to be violated in implementation, so it is
written into §05 of the board itself, not just here.

**Contrast is measured, not eyeballed.** `--ink-3` was darkened to `#756E7D` (4.6:1 on paper) and
`--ink-4` to `#918A98` (3.2:1) because in this direction dates, ordinals and the honest `—` are
*content*, not chrome. Dark mode: 5.3:1 and 3.5:1 respectively. Accent on paper is 10.0:1; accent on
the night book is 8.2:1.

---

## 4. Type — the name-first hierarchy is the thesis

**Newsreader** (names and every moment the house speaks) · **Instrument Sans** (the work) ·
**DM Mono** (dates and figures, tabular by construction). All Google-hosted, all verified loaded.
The stack is deliberately *not* the Source Serif/Source Sans/JetBrains family used by the ledger
direction — a competing board that shares a type stack is not competing.

The inversion, stated plainly: **the largest word in any row is somebody's name.** The identifier is
demoted to a 12.5px mono caption underneath. §06 renders both versions of the same order row side by
side so the founder can see that it costs no density and no information — it only changes what the eye
lands on first, from a code to a relationship. Everything else in the system follows from it: the date
rail exists because the name took the headline slot; the marginal note exists because a name deserves
a note; the tally exists because a name accumulates.

Scale contrast is narrow on purpose — 30px greeting against an 11px date rail. There is no hero type
in this direction.

---

## 5. Motion — writing and turning, nothing else

Two physical models. **Writing**: strokes that draw along their own length, left to right, in the order
a hand would make them (`ruleDraw`, `markSet`, `signStroke`). **Turning**: surfaces that open on a long
settle (`turn`, `leaf`, `arrive`). Everything sits in 150–400ms except the two orchestrated moments.

**The Recall** (`recall`, ≈880ms) is the signature: a name is set, the house draws its line under it,
the returns stamp in one at a time at 60ms apart, and the note it kept about you surfaces last. It
fires once per familiar name per session and **never on a stranger** — a recognition animation that
plays for someone the book has never met is a lie, and it would be the fastest way to destroy the
brand's central claim.

Discipline: nothing moves more than 6px, nothing loops, and no working list animates after first paint.
The Recall is the only moment permitted to be a small ceremony — spend it once, on the thing the brand
is about.

`motion.json` carries all ten tokens with framework-neutral params; springs record both the canonical
stiffness/damping/mass *and* the CSS bezier approximation actually used in the board, because CSS has
no springs and pretending otherwise would corrupt a cross-direction showcase.

---

## 6. Voice guide (full)

### Posture
The house is addressing one person standing at the pass, at 23:00, who is tired. It knows them. It
greets them, then gets out of the way. It never shouts, never congratulates itself, never uses an
exclamation mark.

### The eight rules

1. **Name first, always.** People and places lead the sentence; numbers and IDs follow.
   *"Vinos del Norte shorted you once — July 2025."* not *"PO-1042 has a quantity discrepancy."*
2. **Recall carries its date.** Every claim of memory shows its evidence: "since March", "your fourth
   Thursday running", "last time, $76.20". Recall without a date is a boast.
3. **A dash where the memory is empty.** If the book has nothing, it says so — `—`, "we have not met
   them before". Never a zero, never an invented comparison, never a filled bar.
4. **Second person, present tense, no exclamation.**
5. **Serif once per screen — the moment of recognition.** The greeting or the verdict is Newsreader.
   Everything else works in sans and counts in mono.
6. **Warmth arrives quoted.** Vendor replies and staff notes appear in italics, attributed, in their own
   words. The brand around them stays deadpan.
7. **Plain trade words.** "Bottles in", "the door", "the book", "letters", "the night" — never SKU,
   sync, workflow, entity, resource, leverage.
8. **Endings are said in full.** Deletion and closure copy states exactly what will be forgotten, in
   whole sentences, with no euphemism and no dark pattern.

### Lexicon

| Say | Not |
|---|---|
| the book, the page, the entry | the record, the row, the item |
| letters | emails, messages, comms |
| bottles in / at the door | goods receipt, inbound units |
| we have not met them before | no historical data available |
| waiting on you | action required |
| the house | the system, the platform, Mudavym AI |
| she made it right | the discrepancy was resolved |
| forget | permanently delete (only in the destructive confirm, where "forget" is the honest verb) |

### Patterns

- **Greeting:** name, then the ordinal, then the practical line.
  *"Good evening, Aldemir." / "The book is open at Thursday, 28 August — your 412th service." /
  "last entry 22:38 · Deniz and Marta both signed in tonight"*
- **KPI:** figure, then the change, then **the memory**. A KPI without a remembered comparison is a
  number any competitor could also show.
  *"$4,280 · +6.2% vs last Thursday · your best Thursday since 14 March"*
- **AI draft:** what it noticed, then the ask, never a claim of intelligence.
  *"Same as every Monday for 14 weeks — send?"*
- **Empty state:** what is missing, why, and the one action that fixes it — in that order.
- **First-time entity:** name the absence of memory as a fact, not an apology.
  *"— We have not met them before. Nothing to compare this to yet."*
- **Error:** what happened, what it cost, what is still true.
- **Never:** "Smart", "AI-powered", "seamless", "effortless", "unlock", "supercharge", or any adjective
  applied to Mudavym by Mudavym.

### The five rewrites

| Before | Guest-book voice |
|---|---|
| Draft, approve, and track purchase orders through delivery | **From the letter you write to the crates at the door — and the book remembers every one.** |
| Alerts that need a decision, oldest first | **Waiting on you. Longest wait at the top.** |
| No checks yet — close an order from the terminal | **Nothing in the book yet tonight. Close a check at the terminal and it will be here.** |
| No comparable data | **We have not seen this before — there is nothing to compare it to yet. Ask again in a few Thursdays.** |
| Permanently delete your Mudavym account. | **Forget everything. This closes your account and erases the book — every order, every count, every letter, every name you taught us. Afterwards no one reads it back, not you and not us. Type your restaurant's name to confirm.** |

The deletion rewrite is the one to read twice. On a brand whose promise is memory, the destructive
action has exactly one honest verb — *forget* — and naming it that way is the strongest available proof
that the promise was real.

---

## 7. Adversarial pass — how this direction dies

Written before the board was, and answered in it.

- **"Recall is a feature, not an identity."** The strongest objection. Answer: the board never shows
  recall as a feature panel — it shows it as *hierarchy* (name first), *layout* (the date rail),
  *ornament* (the tally), *copy* (every KPI carries a memory), and *motion* (the Recall). If it were a
  feature it could be removed; here removing it removes the design.
- **"A memory brand is a liability on day one, when there is no memory."** Answered structurally: both
  §01 and §08 render an entry with *no* history beside one with deep history, and the copy says so in
  plain words. A direction built on recall that cannot be honest about an empty book is not credible;
  this is the credibility test and the board takes it deliberately.
- **"Guest book means nostalgia, and nostalgia means kitsch."** Refused explicitly on the board: no
  script fonts, no sepia, no torn paper, no quills, no vintage filter. Exactly three hand-quality marks
  exist — the signature stroke, the tally, the marginal note — all SVG paths, all held against precise
  modern type.
- **"Violet reads as a tech accent, not a hospitality one."** Mitigated by desaturation and depth
  (`#5E2A63`, L≈26) and by pairing it with gilt as a material. If it still reads cold in review, the
  fallback is not a different hue but a *lower* accent load: violet confined to the margin rule and the
  marks, with approvals moving to ink.
- **"Names are not always available."** True in receiving and inventory, where the subject is a case of
  wine. Answer already in the system: the name slot takes the most human-legible subject available —
  the wine, the storage location, the shift — and the identifier still demotes. It degrades to
  "subject-first", which is still the right hierarchy.

---

## 8. Verification — what was and was not confirmed

Served at `http://localhost:8642/085-mudavym-guestbook/index.html` and driven in the Browser pane.

**Confirmed visually (screenshots):** every section — masthead; §01 premise with the entry specimen in
both memory states; §02 all three logo concepts in light *and* dark cells at 1.55× and 2.4×; §03
slogans; §04 voice; §05 both palette columns with hexes and ratios; §06 the three faces and the full
px scale; §07 all four demos including the Recall in its landed state; §08 both mocks in light *and*
night book.

Four defects were found by looking and fixed:

1. **Logo concept 1** — the rule's end tick read as a stray mark at size; it became a violet check made
   *across* the line, which is both better composition and one of the three declared hand marks.
2. **Logo concept 3** — the page read as a chip; it gained a real page stack behind it, a taller leaf,
   a gutter rule and a longer ribbon overhang, so it reads as a book rather than a badge.
3. **JSX brace escapes leaking as literal text** in the Recall's code line (`{"{"}` rendered verbatim in
   plain HTML) — replaced with plain braces.
4. **The `arrive` entrance could swallow content.** The KPI tiles shipped with `opacity:0` in the markup
   and were revealed by an IntersectionObserver; if the observer never fired, the numbers stayed
   invisible forever. Now the tiles ship *visible*, JS opts them into the entrance only when it can
   guarantee the exit, and a 2s failsafe reveals them regardless. An animation must never be able to
   hide content.

**Confirmed programmatically (computed styles / DOM probes, no console errors at any point):**
all three Google families loaded (`document.fonts.check` true for Newsreader, Instrument Sans, DM Mono);
zero horizontally-overflowing elements at 1200px and at 665px; every one of the ten `demoSelector`
values in `motion.json` resolves in the DOM; every demo's *target* state reached correctly with
transitions suspended — toggle thumb `translateX(20)` and track `#5E2A63`, row-expand
`grid-template-rows` resolving to 364.7px with history opacity 1, rule `scaleX(1)`, all ten tally
strokes at `stroke-dashoffset: 0`, note and count at opacity 1, signature path at `stroke-dashoffset: 0`
with its caption revealed and the button turning `--kept`; static tally rails render complete
(`stroke-dashoffset: 0`) while only the Recall's marks start hidden; dark mode verified token-by-token
across body, mocks, KPI tiles, demo cards, rewrite cells and the one-tap footer.

**Not confirmed: the *timed* playback of the animations.** The Browser pane was intermittently hidden by
concurrent sessions, and while hidden the page does not composite frames — `requestAnimationFrame` and
CSS transitions freeze, so the ticker's count and the Recall's 880ms orchestration could never be
*watched* running; one capture caught a theme change frozen mid-transition, which is what that looks
like. Start states, end states, orchestration order and every delay value were verified statically
instead (transitions suspended, computed styles read), and the reduced-motion path was fixed as a
result of that inspection — delays are now zeroed alongside durations, which the first draft did not do.
Stated plainly per the no-shortcuts rule: **the motion is verified as correct, not as watched.** The
scroll-linked triggers (`IntersectionObserver` on the ticker, the Recall and the KPI row) were likewise
verified as wiring, not as timing — which is exactly why defect 4 above now has a failsafe.

**Layout was checked at 1200px and 665px only.** No overflow at either, and the 820px breakpoint
collapses every two-column grid, but a true 390px phone viewport could not be emulated while the pane
was hidden — the narrowest real measurement is 665px.

---

| 085 | mudavym-guestbook | Recognition as the product — can "the house remembers you" carry an ops tool's whole identity? | null | brand, mudavym, guestbook, memory, recognition, arrival, od-106 |
