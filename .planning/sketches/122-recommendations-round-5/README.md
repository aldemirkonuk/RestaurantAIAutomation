---
sketch: 122
name: recommendations-round-5
question: "Round 4 (108-A, the Morning Letter, bound into the built page) is still unjudged — winner: null. Before judging it, the founder's 2026-09-19 spoken feedback adds four hard requirements on top of it: the day rail AND the house's decided goals both 'on top', entries brief and punchy with how to act, a goals chart where Mudavym recommends setting a goal, and one-tap actions that approve automatically. Where do goals live relative to the day rail, and — since 'approve automatically' cannot mean an autonomous execution that does not exist (dossier §1a) — what, exactly, can honestly be one tap, and what still needs the die?"
winner: null
tags: [recommendations, goals, one-tap, seal, hold-to-approve, digest, mail, subject-account, day-strip, theme, paper-default, sketch-only, adr-0083, adr-0107, adr-0112, adr-0125, adr-0128, adr-0160]
---

# Sketch 122 · Goals On Top, Honestly — `/recommendations`, round 5

## Design question

Round 4 (sketch 120, `winner: null`) drew one direction — the built Wave Four page, unchanged in its
skeleton, with the Morning Letter's functionality bound in. It has not been judged. Before it could be,
the founder gave new, more specific spoken feedback (memory `founder-sketch-decisions-106-115.md`, batch 3,
2026-09-19 ~09:45Z), on top of round 4 rather than instead of it:

> "KEEP the days rail on top; SHOW THE HOUSE'S DECIDED GOALS ON TOP ('whatever the restaurant has decided …
> on top as the goal'); recommendations must be brief/punchy with how to act, plus a goals chart where we
> recommend setting a goal; apply ONE-TAP ACTIONS that approve automatically ('get back to work')."

He was explicit that only this much is a requirement; a newspaper-style digest he also mentioned is his
own brainstorm — parked below, not drawn. Purpose, in his words: *"where an owner/manager looks when stuck,
to see what they could have done, or to predict the future and prepare early."*

Two things had to be resolved to draw this honestly, not just prettily:

1. **Where do goals live relative to the day rail** — a second rail beside it, or folded into the letter's
   own masthead? This is the one structural fork the two directions below isolate.
2. **What does "approve automatically" mean when no autonomous execution exists anywhere in the gateway**
   (`06-pages/recommendations.md` §1a: *"'Let Mudavym do it' renders DISABLED on every entry… no autonomous
   execution path exists… with or without permission"*)? Read plainly, "one-tap, approves automatically"
   could be misbuilt as a fake "the AI did it" state. It isn't drawn that way here — see **How "one-tap"
   stays honest**, third section below.

## What this round changes, concretely, and why

- **Ground is paper by default**, not charcoal. The founder, same batch, same night: *"I realized all pages
  will be charcoal however I don't want it, I prefer the white look… people should have the option to
  choose."* That revises ADR 0149 row 6 pending an ADR another lane owns (0169); this sketch applies the
  spoken instruction rather than waiting on the paperwork, and both files carry a static Paper/Charcoal
  toggle in the header (Paper selected) so the choice itself is drawn, not just the default. **The exact
  token hex values here are provisional** — they're round 4's own charcoal values with light/dark swapped,
  not a new palette; reconcile against whatever ADR 0169 lands on.
- **Cards are cut hard.** Round 4's entries carried a full observation sentence and a full prescription
  sentence each. Here every entry is one bold imperative line (*what to do*) and one short clause (*why*) —
  the three-fact strip, file controls and day strip are otherwise round 4's, unchanged, because the founder
  praised Wave Four's bar and never asked for those to move.
- **A goals module, new.** Two active goals plus one Mudavym-suggested goal, positioned per direction (below).
  The suggestion is **scoped to what the goal engine can actually support**: `06-pages/recommendations.md`
  lines 457-469 name nine rules that map to one of six `SUPPORTED_METRICS`, and three that map to none
  (`stockout_imminent`, `vendor_concentration`, `revenue_concentration` — availability, an HHI and a Gini
  aren't supported figures). The suggestion drawn here (`sales_below_weekday_baseline → wine_revenue, at
  least`) is a real row in that table, attached to a metric the example house holds **no active goal on
  yet** — otherwise it would already be a "Goals slipping" entry, not a suggestion, and showing both about
  the same metric would contradict the very mechanic being demonstrated.
- **The suggestion's target is deliberately NOT one-tap.** See the dedicated section below — this is a
  finding, not a taste call, and it is the sharpest edit "approve automatically" needed.

## The two directions

- **`direction-a.html` — Goals Rail.** The goals module is a second rail directly under the day strip, in
  the day strip's own visual grammar (matched corner radius, padding, chip rhythm). Goals and days read as
  two coordinate things "on top" — closer to the founder's literal phrasing, both peers.
- **`direction-b.html` — Goals in the Masthead.** The same three goal cards move into a narrow column at the
  masthead's right, like a real letter's marginalia, under the kicker "The Morning Letter." The day strip
  spans below both columns. This keeps round 4's letter identity as ONE unit rather than a letter beside a
  dashboard widget, at the cost of a column that crowds past about three goals (a rail can wrap to a second
  row; a margin column cannot without redrawing the masthead).

Every other decision — the five entries, the one-tap/die split, the mail sheet, the subject-account sheet,
the inline-dismissal frame — is held identical between the two files on purpose, so the screenshots isolate
this one placement question rather than presenting two unrelated redraws.

## How "one-tap" stays honest

Two controls, drawn distinctly so they are never mistaken for each other (see the "One-tap, honestly" frame
in either file):

| Control | Looks like | Used for | Backing rule |
|---|---|---|---|
| **Tap** (solid pill) | a button that fills on press | dismiss, snooze, pin, mark-as-briefed; opening a page with the act already recorded | ADR 0112 F10 (founder answer): *"Dismiss an entry, archive a thread, remove a shift, a note: the act fires and Undo is offered for a few seconds."* No seal — reversible, client-visible, backed by a real write this page already makes (`POST …/action`) |
| **Die** (a ring, hold-to-approve) | the existing `HoldToApprove` shape | anything that books stock or money | ADR 0112 F10's other half, same line: *"Money, sends and ledger rows keep the seal before."* Mechanically the same mint → hold → redeem → write sequence ADR 0107's addendum already ships for a delivery confirmation, and ADR 0125 generalizes to `procurement_order` acts |

**Which of the five example entries records "acted" the moment you tap, and which don't, and why** — this
is a rule, stated once here rather than left for the reader to reverse-engineer from five inconsistent
buttons:

- **Self-contained acts** (mark as briefed) — the tap **is** the act. Recorded immediately.
- **A tap that hands off to a Mudavym page which itself completes the concrete step** (reprice → Vendor
  Prices; schedule → Calendar) — recorded as acted at the moment of navigating, with Undo, on the reasoning
  that the destination page holds the person accountable for finishing it, the same shape ADR 0083 accepts
  for a queued send (recorded as "queued," not "sent," until the real event happens).
- **A tap that hands off to something Mudavym cannot see at all** ("Call a vendor" → Providers, a real phone
  call) — **not** recorded as acted. The button stays a plain navigate with no receipt line, because nothing
  happened yet that this product can honestly claim.
- **"Order it"** is the flagship stock/money case and gets the die, not a tap — see next.

**"Order it," today vs. proposed.** Today the button only navigates to Orders; nothing is recorded until a
person drafts the PO there by hand — drawn as the honest baseline. This round *proposes* (not claims built)
drafting the PO from the rule's own already-known numbers (product, quantity, vendor) at fire time, so the
hold-to-approve die can seal that draft in place, one motion. That is a gateway change, not a copy change,
and it is asked as a question below rather than shipped silently.

**Setting a goal is a deliberate exception, and the dossier is why.** `06-pages/recommendations.md:453-455`:
*"the target is typed, because a rule states a gap, not a number a house should be held to… any figure
scraped back out of it would be invented."* So the suggested-goal tap opens the goal sheet with metric,
name and a suggested period pre-filled from the rule — genuinely derivable facts — and leaves the target
field **required and blank**, because a fabricated number there would be exactly what ADR 0020 (no
fabricated answers) and ADR 0083 (a control may not claim an effect it doesn't have) both rule out. This is
the one place "one tap, approves automatically" is deliberately NOT delivered in full, and it is called out
rather than quietly shipped short of the ask.

## Founder's picks on round 4, carried forward here

Read from batch-3 (memory file) against what sketch 120 actually drew:

- **1A over 1B** — the delta lives as a cutting above the docket, not a leaf of its own. Not redrawn here
  (this round doesn't touch the delta/"since yesterday's letter" cutting at all — out of scope for the goals
  question) but stated so nothing here contradicts it.
- **2B — wants to see how the mail looks.** Drawn in full in "Your copy," tightened to this round's brief
  entries, `recipient_email` gone per the batch-3-resolved digest choices (drops the field; per-person
  opt-in on Settings instead).
- **Subject-account sheet good "if it shows more than the table."** Drawn with a narrative line, a spark
  chart of six Tuesdays and a short list — not the docket's numbers re-typed into rows.
- **Inline dismissal with a real day — "maybe."** Drawn as its own small frame, labelled as a maybe, not
  folded into the main page as if decided.
- **The newspaper-style digest — brainstorm, not built.** One line in the footer of both directions, parked.

## Founder questions

**A count correction, stated plainly rather than quietly matched.** Sketch 120 named nine forks. Re-reading
all nine against batch-3: #1 (delta placement) is resolved (1A over 1B), and the digest builder's five
choices (a separate, also-owed item there) were answered and built elsewhere per the same memory file. That
leaves **seven**, not five, by this reading — questions 4 and 5 below (the account door's scope, and where
the post is edited) got a *lean* from batch-3 ("good if it shows more than the table," "liked, unsure") but
not a lock, so they're kept open rather than counted as decided; trimming them to force the count to five
would drop a real fork rather than resolve one (CLAUDE.md §0.4). If "the five" meant a narrower, specific
set that already covers 3 and 5, that is worth a direct correction rather than silently trusting either
count. All seven fold into this round because round 5 cannot be judged as a whole page without them. Two
more (1-2 below) are this round's own new forks, ahead of the seven carried from 120.

1. **Goals rail (A) or goals in the masthead (B)?**
   **Recommendation: A.** The founder described two things that both go "on top" — closer to two peers than
   one nested in the other. A also scales past three goals by wrapping a row; B's margin column starts
   crowding at exactly that count. B is the better pick only if he wants goals felt as *part of* the letter
   rather than beside it, and if 1-3 goals per house is genuinely the ceiling.
2. **The reorder die's backend upgrade** — build "draft the PO from the rule's own numbers so the hold
   seals it in place" this round, or ship the honest two-step (navigate, draft by hand) now and revisit?
   **Recommendation: ship the two-step now.** Zero gateway risk, still an honest improvement (nothing
   regresses), and it doesn't block picking a direction on a backend change.
3. **The C graft** (round 4's quiet tier) — fund a real per-rule `reading · threshold · state` field, or
   accept the `sourcesUnread` substitute already on the branch (no quiet tier)?
   **Recommendation: accept the substitute** for now; it's shipped, cheap, and nobody has asked for graded
   quietness by name — revisit only if the plain unread/read split proves too coarse in practice.
4. **The account door's scope** — a subject on every rule that could carry one, or keep it on just the two
   baseline rules the gateway can key today?
   **Recommendation: keep it on the two.** Building the richer sheet shape against a single real example
   (Tuesdays) is reasonable; generalizing it before a second example exists is guessing at a pattern.
5. **Where the house's post (digest cadence/hour) is edited** — (a) side sheet, drawn in both directions'
   "Your copy" frame and already built in round 4; (b) a second `Popover modal` component, which ADR 0112
   F2 names as the exact move that collapses the three-shape policy; (c) a read-only tile on `/settings`
   row 26 with a link here.
   **Recommendation: (a).** He said "liked, unsure" rather than objecting; (b) requires reopening a locked
   ADR, not working around it; (c) removes a surface this page currently has for a small navigation saving.
6. **The act-verb split** — "Mark as briefed" (records the act, no navigation) on floor entries vs. the
   built "Open Reports →" (navigates, records nothing) on weekday-pattern entries: keep the disagreement,
   or force one verb?
   **Recommendation: keep it.** It's principled, not accidental — briefing is something you do right now;
   "test a Tuesday offer" is something you go analyze first. Forcing one verb would make one of the two
   dishonest.
7. **The house-level send log** — even a bare count ("someone got today's post") shown to a member who
   isn't the recipient: is that more than they should see?
   **Recommendation: show the count, suppress who** by default, as round 4 drew it — a manager benefits
   from knowing the house was told even when they weren't the one told.
8. **Per-subscriber or per-house delta** — "since Monday's letter" (this reader's own last copy) or "since
   the last send to anyone in the house" (one shared clock)?
   **Recommendation: per-subscriber.** A shared clock would misdescribe what a newer subscriber has or
   hasn't already seen.
9. **Refusal copy** — keep it trimmed to the two genuinely refused entries (round 4's settled style), or
   restore a "not refused" explanation on every entry?
   **Recommendation: keep it trimmed.** Restoring it on every entry re-adds exactly the density this round
   was asked to cut.

*A lighter, non-blocking flag rather than a numbered question:* his "1A over 1B… not the fifth item… the
sixth is fine" is read here against sketch 120's own frame order (delta cutting · the post's two sheets ·
the rail alternative · subject's account · **the catalogue leaf** · **five states** · mobile) — "fifth" =
the catalogue leaf (dropped from this round, matches "browse every insight type" staying a separate page
per the dossier's own Surface table) and "sixth" = the states handling (folded into this round's one-tap
states frame). Both readings are converging inferences from two independent orderings in sketch 120, not a
re-read transcript — worth a one-line confirmation, not a blocking question.

## The example house, held identical across both files

Same clock, same rules as round 4's own worked example, so a side-by-side comparison isn't also comparing
different data: **Meyhouse Palo Alto**, Wed 16 Sep 2026, 06:58 PT read, 14 rules evaluated (12 + 2 goals),
5 stand, 1 withheld. The five entries (Order it/`stockout_imminent`, Price it/`plowhorse_repricing`, Call a
vendor/`vendor_concentration`, Brief the floor/`sales_below_weekday_baseline`, Schedule it/`weekday_gap`)
are round 4's own, rewritten brief. Two goals are new, invented for this round from real rows in the
rule→metric table (`06-pages/recommendations.md:457-469`): purchase spend ≤ $9,500 this month (from
`spend_acceleration`, on pace) and bottles sold ≥ 340 this month (from `puzzle_activation`/`dead_stock_capital`'s
metric, behind pace — this is also what feeds the one "Goals slipping" entry, so the two views agree with
each other rather than each inventing its own number).

## How to view

```
open .planning/sketches/122-recommendations-round-5/direction-a.html
open .planning/sketches/122-recommendations-round-5/direction-b.html
```

Each file, top to bottom: the full page at 1440 (header, masthead, day strip, goals, docket, footer with
the parked-idea note) — then four secondary frames, held identical between the two files: **One-tap,
honestly** (the tap/die states, and the Order-it today/proposed pair), **Setting a goal** (the sheet, target
blank), **Your copy** (the mail, 2B), **Tuesday's account** (the subject sheet), and **Inline dismissal**
(3B, marked "maybe"). No `<script>` anywhere — every state is a separate static frame, matching round 4's
own convention, not a live prototype.

## Screenshots

`shots/direction-a-1440.png` (1440×4714), `shots/direction-a-390.png` (390×6592), `shots/direction-b-1440.png`
(1440×4805), `shots/direction-b-390.png` (390×6533) — all four rendered with `p4-scratch/render-sketch.mjs`
(system Chrome via Playwright), all four reporting `errors: []` and `horizontalOverflow: false`. Additionally
spot-checked (not shipped as a file): both the main page and the goals module rendered with
`data-ground="charcoal"` at 1440, to confirm the new goal-chip, die and masthead-margin components — which
round 4 never had to draw in dark mode — hold contrast and legibility there too; they do.

One real bug was caught and fixed during this pass, not just a cosmetic one: an early draft hid the ENTIRE
main page frame at the 390 viewport (a stray `desk-only` class copied from round 4's CSS, whose matching
mobile markup this round doesn't build) — the first 390 renders showed only the secondary frames, nothing
of the actual page. Caught by rendering before finalizing, not assumed correct; removing the class restored
the page at 390 (scroll height went from ~3,600px, which was wrong, to the true ~6,500-6,600px), and both
files were re-rendered and re-checked after the fix.

## What I could not verify

- No dev server was run against a real gateway or Supabase project — everything here is example data, per
  the sketch-only convention and the house rule against pointing checks at production. Rule names, endpoint
  shapes and the goal-target-is-typed rule are read from `06-pages/recommendations.md` and round 4's own
  citations of `feat/finish-digest` (branch tip `13b30a59e` as of round 4's writing) — not re-verified live
  this session, and that branch may have moved since.
- The founder's exact original numbering behind "1A/1B, 2B, 3, 3B, the fifth, the sixth" is inferred from
  sketch 120's frame order and its own "Founder questions" list, not from a transcript — flagged above, not
  asserted as certain.
- ADR 0169 (the theme decision) does not exist yet; this sketch applies the founder's spoken words directly
  and states its own token values as provisional pending that ADR, per this lane's house rules (no other
  lane may create ADR 0169).
- The "draft the PO in place" proposal for Order it is a design proposal only — no gateway code was written
  or checked for feasibility beyond what ADR 0107/0125 already establish about the seal mechanism it would
  reuse.
- This is a static-HTML design sketch with no executable behavior, so there is no failing-before/passing-after
  test to show; verification here is the render pipeline's own pass/fail (`errors`, `horizontalOverflow`)
  plus the visual checks described above, which is the same evidence bar sketch 120 itself used.
