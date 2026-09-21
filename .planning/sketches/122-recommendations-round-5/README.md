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
the founder gave new, more specific spoken feedback. What follows is the memory file's own summary of that
feedback (memory `founder-sketch-decisions-106-115.md`, batch 3, 2026-09-19 ~09:45Z) — a condensed paraphrase
written down after the fact, not a verbatim transcript of his words — applying on top of round 4 rather than
instead of it:

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
| **Tap** (solid pill) | a button that fills on press | dismiss (F10, built) — plus snooze, pin and mark-as-briefed, this round's proposed amendment to F10's list, asked below | ADR 0112 F10 (founder answer, 0112:270-272): *"Dismiss an entry, archive a thread, remove a shift, a note: the act fires and Undo is offered for a few seconds… The list is closed; adding to it is an amendment here, not a builder's call."* Snooze, pin and mark-as-briefed are drawn the same way (one tap, Undo, no seal) but are **not yet** on that list — see the new founder question below |
| **Die** (a ring, hold-to-approve) | the existing `HoldToApprove` shape | anything that books stock or money | ADR 0112 F10's other half, same line: *"Money, sends and ledger rows keep the seal before."* Mechanically the same mint → hold → redeem → write sequence ADR 0107's addendum already ships for a delivery confirmation, and ADR 0125 generalizes to `procurement_order` acts |

**Which of the five example entries records "acted" the moment you tap, and which don't, and why** — this
is a rule, stated once here rather than left for the reader to reverse-engineer from five inconsistent
buttons:

- **Self-contained acts** (mark as briefed) — the tap **is** the act. Recorded immediately.
- **A tap that hands off to another page to complete the concrete step** (reprice → Vendor Prices; schedule
  → Calendar; call a vendor → Providers) — **never** recorded as "acted." Nothing has actually happened at
  the moment of the tap — that is equally true whether the destination is a Mudavym page or a real phone
  call, so it gets the same honest treatment: the button either records nothing (a plain navigate, as
  "Call a vendor" and "Schedule it" already draw it), or an honest "opened," never a claim that the step
  itself is done. ADR 0083's "queued, not sent" pattern does not apply here — a queued send is a real,
  written intermediate state; a tap that only navigates writes nothing at all, so there is nothing to call
  "acted" and nothing to Undo.
- **"Order it"** is the flagship stock/money case and gets the die, not a tap — see next.

**"Order it," today vs. proposed.** Today the button only navigates to Orders; nothing is recorded until a
person drafts the PO there by hand — drawn as the honest baseline. This round *proposes* (not claims built)
drafting the PO from the rule's own already-known numbers (product, quantity, vendor) at fire time, so the
hold-to-approve die can seal that draft in place, one motion. That is a gateway change, not a copy change,
and it is asked as a question below rather than shipped silently.

**The die's own label follows the house's order mode — it is not one fixed script.** The founder's own
answer (memory `founder-sketch-decisions-106-115.md`, "Answered 2026-09-18 evening"): for an order, "auto"
means the hold-to-approve die is still held every time — only the extra are-you-sure *after* the hold is
skipped; the default mode is hold, then that are-you-sure; only owners and managers may change which mode a
house is in. Nothing here lets a tap alone book an order in either mode — the hold is never optional. The
reorder die's label in both frames below says which mode this example house is in, rather than assuming one
silently.

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
leaves **seven**, not five, by this reading — questions 5 and 6 below (the account door's scope, and where
the post is edited) got a *lean* from batch-3 ("good if it shows more than the table," "liked, unsure") but
not a lock, so they're kept open rather than counted as decided; trimming them to force the count to five
would drop a real fork rather than resolve one (CLAUDE.md §0.4). If "the five" meant a narrower, specific
set that already covers 3 and 5, that is worth a direct correction rather than silently trusting either
count. All seven fold into this round because round 5 cannot be judged as a whole page without them. Three
more (1-3 below) are this round's own new forks, ahead of the seven carried from 120.

1. **Goals rail (A) or goals in the masthead (B)?**
   **Recommendation: A.** The founder described two things that both go "on top" — closer to two peers than
   one nested in the other. A also scales past three goals by wrapping a row; B's margin column starts
   crowding at exactly that count. At 390, B's `.mast-b` grid collapses to a single column before the day
   strip begins, and the goals column sits second in source order below the letter's own title — so on a
   phone B puts the goals ahead of the day strip, moving the rail he said to keep on top underneath them; A
   keeps the day strip first at every width, unchanged. B is the better pick only if he wants goals felt as
   *part of* the letter rather than beside it, and if 1-3 goals per house is genuinely the ceiling.
2. **Which one-tap acts join ADR 0112 F10's closed undo-after list?** F10's list, as answered, is exactly
   dismiss an entry, archive a thread, remove a shift, a note, and (added 2026-09-05, night) a door count
   within ten minutes (0112:270-272, 319-321) — *"the list is closed; adding to it is an amendment here, not
   a builder's call."* This sketch draws snooze, pin and mark-as-briefed the same way — one tap, Undo, no
   seal — which would be an amendment to that list, not something F10 already covers. A hand-off that only
   opens another page (reprice, schedule, call a vendor) records nothing at all, never "acted," since
   nothing has actually happened at the moment of the tap.
   **Recommendation: add snooze, pin and mark-as-briefed.** They only change a recommendation's own status —
   no money, no send, no ledger row — the same shape F10 already reasons from. A hand-off should record
   nothing, or an honest "opened," until the destination page completes the step.
3. **The reorder die's backend upgrade** — build "draft the PO from the rule's own numbers so the hold
   seals it in place" this round, or ship the honest two-step (navigate, draft by hand) now and revisit?
   **Recommendation: ship the two-step now.** Zero gateway risk, still an honest improvement (nothing
   regresses), and it doesn't block picking a direction on a backend change. Either way the hold stays, as
   he answered for cellar orders — the house's own order mode (Default or Auto) only decides whether an
   are-you-sure follows the hold, never whether the hold itself happens.
4. **The C graft's timing** (round 4's quiet tier) — he already picked "A with C's quiet tier" for 108
   (ADR 0160, 108 row; memory `founder-sketch-decisions-106-115.md` line 21: *"108 recommendations: A
   (Morning Letter) + C's quiet tier"*), so whether to build it isn't open — only the sequencing is: fund
   the real per-rule `reading · threshold · state` field this round, or ship the `sourcesUnread` substitute
   already on the branch now and build the field next?
   **Recommendation: ship the substitute now, build the field next.** It keeps his 108 pick without holding
   this round behind a change to every rule's condition; dropping the quiet tier instead would reverse his
   pick and needs ADR 0160's 108 row superseded, not assumed here.
5. **The account door's scope** — a subject on every rule that could carry one, or keep it on just the two
   baseline rules the gateway can key today?
   **Recommendation: keep it on the two.** Building the richer sheet shape against a single real example
   (Tuesdays) is reasonable; generalizing it before a second example exists is guessing at a pattern.
6. **Where the house's post (digest cadence/hour) is edited** — (a) side sheet, drawn in both directions'
   "Your copy" frame and already built in round 4; (b) a second `Popover modal` component, which ADR 0112
   F2 names as the exact move that collapses the three-shape policy; (c) a read-only tile on `/settings`
   row 26 with a link here.
   **Recommendation: (a).** He said "liked, unsure" rather than objecting; (b) requires reopening a locked
   ADR, not working around it; (c) removes a surface this page currently has for a small navigation saving.
7. **The act-verb split** — "Mark as briefed" (records the act, no navigation) on floor entries vs. the
   built "Open Reports →" (navigates, records nothing) on weekday-pattern entries: keep the disagreement,
   or force one verb?
   **Recommendation: keep it.** It's principled, not accidental — briefing is something you do right now;
   "test a Tuesday offer" is something you go analyze first. Forcing one verb would make one of the two
   dishonest.
8. **The house-level send log** — even a bare count ("someone got today's post") shown to a member who
   isn't the recipient: is that more than they should see?
   **Recommendation: show the count, suppress who** by default, as round 4 drew it — a manager benefits
   from knowing the house was told even when they weren't the one told.
9. **Per-subscriber or per-house delta** — "since Monday's letter" (this reader's own last copy) or "since
   the last send to anyone in the house" (one shared clock)?
   **Recommendation: per-subscriber.** A shared clock would misdescribe what a newer subscriber has or
   hasn't already seen.
10. **Refusal copy** — keep it trimmed to the two genuinely refused entries (round 4's settled style), or
    restore a "not refused" explanation on every entry?
    **Recommendation: keep it trimmed.** Restoring it on every entry re-adds exactly the density this round
    was asked to cut.

*A lighter, non-blocking flag rather than a numbered question:* his "1A over 1B… not the fifth item… the
sixth is fine" is read here against sketch 120's own frame order (delta cutting · the post's two sheets ·
the rail alternative · subject's account · **the catalogue leaf** · **five states** · mobile) — "fifth" =
the catalogue leaf (dropped from this round, matches "browse every insight type" staying a separate page
per the dossier's own Surface table) and "sixth" = the states handling — loading, empty, refused, partial.
122 draws none of those; that handling stays exactly as round 4 (sketch 120) left it, not folded into this
round's own tap/die states frame, which is a different thing (a control's interaction states, not the
page's data states). Both readings are converging inferences from two independent orderings in sketch 120,
not a re-read transcript — worth a one-line confirmation, not a blocking question.

## The example house, held identical across both files

Same clock, same rules as round 4's own worked example, so a side-by-side comparison isn't also comparing
different data: **Meyhouse Palo Alto**, Wed 16 Sep 2026, 06:58 PT read, 14 rules evaluated (12 + 2 goals),
6 stand, 1 withheld — five recommendation entries plus the one "Goals slipping" entry the behind-pace goal
also feeds. The five recommendation entries (Order it/`stockout_imminent`, Price it/`plowhorse_repricing`, Call a
vendor/`vendor_concentration`, Brief the floor/`sales_below_weekday_baseline`, Schedule it/`weekday_gap`)
are round 4's own, rewritten brief. Two goals are new, invented for this round from real rows in the
rule→metric table (`06-pages/recommendations.md:457-469`): purchase spend ≤ $9,500 this month (from
`spend_acceleration`) and bottles sold ≥ 340 this month (from `puzzle_activation`/`dead_stock_capital`'s
metric).

**The calendar, spelled out so the next reader checks it in one subtraction instead of re-deriving it:**
September has 30 days; the read date (Wed 16 Sep) is day 16, so this house is **16 days elapsed, 14
remaining** — not 9, which round 6 found had been propagated from the bottles chip onto the spend chip
without either being checked against the month itself (round 5 fixed the wrong "22 days left" to a still-wrong
"9 days left" in six sites, none of them the month's actual arithmetic). Both goal chips now read "14 days
left." At day 16/30, a straight line wants 340 × 16/30 ≈ 181 bottles and $9,500 × 16/30 ≈ $5,067 spent:

- **Bottles (210 of 340) is *ahead* of that line, not behind** — 210 > 181, and the daily rate needed to
  finish (130 remaining ÷ 14 days, rounded up so a floor goal is never quietly missed ≈ 10/day) is already
  below the stated current pace of 13/day (210 ÷ 16 elapsed). It now reads **On pace**.
- **Spend ($6,180 of $9,500) is *behind* that line** — $6,180 is 22% over the $5,067 straight-line allowance,
  and holding the cap needs the remaining budget spread thin (($9,500 − $6,180) ÷ 14 days, rounded down so a
  cap is never quietly busted ≈ $237/day) against a current pace of $386/day ($6,180 ÷ 16 elapsed). It now
  reads **Behind**, and is the goal that feeds the one "Goals slipping" entry and the mail's third line — the
  two views still agree with each other, only now against the goal the honest calendar actually puts behind.

Both totals (210 of 340, $6,180 of $9,500) are unchanged from round 4 — this fix moves no invented number,
only which chip is honestly the behind one once the calendar itself is honest.

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

`shots/direction-a-1440.png` (1440×4895), `shots/direction-a-390.png` (390×7052), `shots/direction-b-1440.png`
(1440×4937), `shots/direction-b-390.png` (390×6944) — re-rendered in round 6 after the calendar fix changed
the goal chips, the goals-slipping entry, the mail's third line and the chart's worst bar. `p4-scratch/
render-sketch.mjs` is still not present in this worktree, so round 6 used the same equivalent script round 5
did (system Chrome via Playwright, the same cached `chromium-1217` build), doing the same checks — `errors:
[]`, `horizontalOverflow: false`, `.entry` count 6, `.mentry` count 3 — on all four renders, plus a fifth,
geometric check this round added: `.spark .baseline` and `.spark i.worst`'s rendered position, confirming the
gap between them (see "Round 6" below). Only the two 390-width heights moved (7034→7052, 6926→6944, +18px
each) — the spend-goal sentence in "Goals slipping" ("needs to hold under $237 a day from here, not the
current $386") is a few characters longer than the bottles sentence it replaced, wrapping one extra line at
that width; the two 1440 heights are unchanged (4895, 4937) since nothing there re-wrapped. Round 5's other
findings (goals chart, die honesty badge, `data-ground="charcoal"` contrast) were not re-tested here — round
6 touched none of that markup or CSS, only the goal-chip/entry/mail text and one `style="height"` attribute.

One real bug was caught and fixed during this pass, not just a cosmetic one: an early draft hid the ENTIRE
main page frame at the 390 viewport (a stray `desk-only` class copied from round 4's CSS, whose matching
mobile markup this round doesn't build) — the first 390 renders showed only the secondary frames, nothing
of the actual page. Caught by rendering before finalizing, not assumed correct; removing the class restored
the page at 390 (scroll height went from ~3,600px, which was wrong, to the true ~6,500-6,600px), and both
files were re-rendered and re-checked after the fix.

**Round 6.** Round 5's own last call found its "9 days left" fix (replacing round 4's impossible "22 days
left") was itself still impossible — 16 elapsed + 9 remaining is 25 days, no month — and that everything built
on the wrong 9 needed re-deriving together, not swapped digit-by-digit. Fixed by recomputing from the read
date (Wed 16 Sep, day 16 of a 30-day September → 16 elapsed, 14 remaining; see "The example house" above for
the full derivation) rather than picking a new number: both goal chips now say "14 days left"; the honest
pace math puts **bottles** ahead of its straight line (210 vs. a 181-bottle linear target) and **spend**
behind its own (`$6,180` vs. a `$5,067` linear allowance, 22% over) — the reverse of what was drawn — so the
`behind`/`gpace behind` class and the "Goals slipping" entry moved from the bottles chip to the spend chip,
using the same 210/340 and `$6,180`/`$9,500` totals already in the file, not new ones. The chart's `−38%`
callout (correct, sourced from entry 04's own `$1,940` vs. `$3,120`) sat on a bar drawn 58% below its own
baseline, not 38% — `direction-a.html`'s `.goal-chip.suggest .spark i.worst` height moved from `22%` to `32%`
of its 46px-tall container (`bottom:52%` baseline unchanged), which is `(52−32)÷52 = 38.46%` below baseline,
confirmed both algebraically and by measuring the rendered bar's height in a live Chromium page (14.72px
measured against a computed 14.72px for `32% × 46px`). Every one of these six figures was re-derived from the
read date and the two goals' own totals with `python3`, not eyeballed; the six-line calculation and its output
are recorded in this lane's session but not shipped as a file here, since the numbers themselves are now in
the markup and in this section. A repo-wide sweep for the old "9 days"/"22 days" strings and for any remaining
"Bottles goal is behind" text returned zero hits in both HTML files after the fix.

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
