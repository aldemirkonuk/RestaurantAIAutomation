# 0160 — The founder's sketch review: what he valued, and what each page becomes

- **Status:** Locked 2026-09-17, corrected 2026-09-18 — the founder reviewed the sketch
  gallery page by page and dictated his reading of each. His words are quoted; the
  decisions below are his picks, and the build items are what those picks owe.
  **[corrected 2026-09-18, correction 20: not every decision below was his pick. A
  2026-09-18 re-read against the sketch files, plus his own answers to the forks it left
  ambiguous, found 21 corrections — two page-sections had recorded the sketch README's
  own recommendation as if it were his pick — and left several items genuinely open
  rather than decided. What follows separates his explicit picks and 2026-09-18 rulings
  from the builder's own syntheses, which are marked proposed. Quotes are his words
  verbatim, except that the fillers "uh" and "um" are dropped; a cut is marked "...";
  a typo keeps his raw word, with the reading in brackets after it.]**
- **Date:** 2026-09-17 (dictation); corrected 2026-09-18
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** sketch review, app shell, receiving, cellar, help, vendor prices, promotions, recommendations, picks, grafts, Stripe, Toast, quant, bundles, label reader, heat map
- **Links:** [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (rows 21, 23, 38 and the gallery this reviews) · [[0144-the-book-opens-on-evidence-and-three-pages-get-a-job]] · [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] · [[0112-one-modal-policy-three-shapes-one-primitive]] · sketches `.planning/sketches/106-app-shell`, `107-receiving-structure`, `108-recommendations-directions-3`, `109-settings-directions-2`, `110-cellar-directions-2`, `111-help-directions`, `112-vendor-prices-directions`, `113-promotions-directions`, `115-arrival-action-boxes` (retired 2026-09-22 — no A/B/C winner; sketch 121 is the direction, ADR 0144 addendum), `119-app-shell-sota`, `120-recommendations-round-4` · gallery artifact `4aFbY744aZv1GR2YmytzdQ` · corrections: 21, each bracketed inline below and numbered as in the Opus critic's list (`adr0160-corrections.json`, 2026-09-18 — a session scratch file, not committed; the brackets are the record)

## Context

Thirteen sketch sets went to the founder on 2026-09-17 as a published gallery. He
answered the first four in a question round (107, 108, 109 picked; 106 sent back for
better directions), then opened the rest in the browser and dictated a page-by-page
review. He closed it with: *"go by each of them. Go by my text. Extract what is valued.
... so find the matches find the why I did like them and then let's finish this finalize
it."* **[added 2026-09-18, corrections 15 and 20:** he also opened 115, which his
dictation never reaches (Open item 6). The dictation was first written to another
session, named *"Mudavim.com [Mudavym.com] full UI deployment,"* working the same
finalization, and was re-sent 2026-09-18; that session may build from the same words, and
its reading of them should match this record.]** **[verification 2026-09-18:
the closing quote above had been smoothed to "... find the matches, find the why I did
like them, and then let's finalize it"; it now reads as dictated.]**

This record is that extraction. Each section quotes him, says what he valued and why,
states the decision, and lists what the decision owes the build. Where he asked for a
note rather than work, it is marked NOTE ONLY.

**2026-09-18 correction pass.** An Opus critic re-read every sketch file cited below and
this ADR line by line and found 21 corrections (`adr0160-corrections.json`), the most
serious being that the cellar (110) and help (111) sections had recorded the sketch
README's own recommendation as his pick rather than what he actually said. The founder
then answered the forks the critic surfaced (`AskUserQuestion`, 2026-09-18); those
answers are folded into the sections below, dated and sourced, and are marked separately
from his 2026-09-17 dictation. Several items remain genuinely open and are listed in
Consequences rather than decided here, per CLAUDE.md §0.1. A verification pass the same
day re-measured every quote against the dictation word by word: where a quote had been
smoothed (a word dropped or changed without "...") or a typo fixed silently, the quote
now reads as dictated, with the typo readings bracketed (correction 21), and the
correction numbers in the brackets below follow the critic's list.

## The picks, page by page

### 106 — the app shell · direction A, in the Stripe and Toast idiom

> *"Do it as in how the Stripe and other startups do, like Toast, mimic that behavior."*
> Earlier the same day: *"I need the most sota with best user experience, (do not care
> baout [about] cheapest rebuild) I need full quality, use mudavym atlas to see the
> endpoints."*

**[verification 2026-09-18: the second quote above was deleted by the
correction pass although "What he valued" still points at it; restored, with its typo
bracketed. Its source is the 2026-09-17 question-round answer to this shell question
(transcript `86b45107:2247`), the same message the Owed and 108 quotes below come from.]**

**What he valued:** the rooms rail of direction A, held to how Stripe, Toast and other
startups do it — not to what is cheapest to rebuild (his earlier note, quoted above).
**[corrected 2026-09-18, correction 13: the original text here read "held to the
standard of the dashboards he uses — Stripe's and Toast's"; he never said he uses these
dashboards, only how they do it.]**

**Decision (his pick: direction A; the chrome spec below is the builder's synthesis,
proposed):** direction A is the shell. Its chrome follows the conventions those products
settled: a persistent, grouped left navigation with the house's identity and switcher at
the top, a thin top bar carrying search/command and the account, page headers that state
where you are and what you can do here, and one consistent place for state (empty,
loading, refused, offline). **[corrected 2026-09-18, correction 13: this chrome list is
the builder's reading of "mimic that behavior," not his dictation — 106 README describes
direction A only as "A quiet left rail of words, grouped by where the work happens in the
house" (README:216). Flagged as proposed, not as something he itemized.]** Sketch 119
draws two further directions at that bar; if one of them beats A on his review, it
supersedes this row and nothing else in this record moves. **[superseded 2026-09-21: his
pick is sketch 119 direction D, "the counter", with direction E's day line as a page
element on the dashboard and the receiving page, not chrome — see the review-trail row of
that date. The rooms rail survives inside D in 106 A's grammar.]**

**Owed:** the 404, the error screen, the loader, the offline banner and one toast system;
the floating assistant button removed; internal tools never listed for a house.
**[added 2026-09-18, correction 14:** a note on the price-actions/market-actions quant
work, and a placeholder endpoint. His words, from the 2026-09-17 question-round answer to
this shell question — the same message whose Wave Four sentence this ADR had previously
(and incorrectly) sourced to the 108 pick: *"we also were working on the price actions
market actions quant - give a note about that and create an endpoint(placeholder)."*
(2026-09-17 question round, re-verified against transcript `86b45107:2247` on
2026-09-18.) Already
drawn at sketch 119, README:303-304 and :361-384 — `GET /house/market-actions`, 501 until
the quant lands.]** **[amended 2026-09-21: his shell pick overrides the placeholder — the
Judge/market row appears ONLY once its register exists; no 501 placeholder row and no
placeholder route are built. The note on the quant stays at sketch 119 README:301-416.]**

### 107 — receiving · B+ (the composed grid), with A's vendor boxes and its bolder figures

> *"the first look, 1071 [107 · frame 1, direction A's Desktop 1440] desktop look doesn't
> look bad, especially those Southern Glazers wine warehouse [Southern Glazer's, Wine
> Warehouse — two vendor cards]. Those little boxes plus the more striking main values.
> ... you have to consider if there are too many operations for the record, what could
> happen."*
> *"For overlay part, looks good, especially it looks like it has been extracted from that
> area. ... it's concise and it gives you everything as well. Plus the hold to send money
> sender."* · *"For three, the states. Okay, that's approved. For mobile, that's also
> approved."*

**[corrected 2026-09-18, correction 12:** the two named vendors are Southern Glazer's
(`direction-a.html:432`) and Wine Warehouse (`:439`), two cards in A's own delivery strip;
his "1071" is frame 1 · Desktop 1440 (`direction-a.html:395`), so the original "[A's]"
reading is correct. The quote had replaced "1071" with "[A's]" and fused the two vendors
into one; it now keeps his raw words, with the readings bracketed (correction 21). B+
(the direction actually being built) lists vendors as **table rows**
(`direction-b-plus.html:615-617`), not boxes — the vendor-box object he liked is A's
alone, which is why it is a graft below rather than already present in B+.]**

**What he valued:** the vendor box as an object on the page, figures that carry weight,
an overlay that reads as lifted from the row it came from, the hold ceremony on a send
that costs money, and the state and mobile renderings as drawn.

**Decision (his pick: B+, in the question round; the A graft is the builder's synthesis
from his praise, proposed):** build B+, the composed grid picked in the question round,
and graft A's vendor boxes and its heavier treatment of the line's main figures. The
overlay, the states and the mobile rendering are approved as drawn. **[corrected
2026-09-18, correction 20: he praised A's boxes and figures ("doesn't look bad,
especially ..."); he did not say to graft them into B+. The graft is marked proposed.]**

**Owed:** the verdict history stays append-only (ADR 0149 row 23). **[corrected
2026-09-18, correction 11: the sentence that followed here — "the grid must page or
group rather than grow without end" — was written as settled build guidance, but he only
raised a risk and chose no fix: "you have to consider if there are too many operations
for the record, what could happen." No 107 direction commits to paging or grouping; the
README only states the cost. Moved to Open items below; do not build "page or group" as
decided.]** **Open (see Consequences, Open item 4):** what the desk does when one delivery carries far
more operations than the drawing shows (long line counts, repeated partial receipts, many
verdict records on one line) — paging or grouping is proposed, not decided.

### 108 — recommendations · A with C's quiet tier, and one more round

> Question round: *"A with C's quiet tier (Recommended)"*. From the same 2026-09-17
> question round, answering the 106 shell question (not something said after this pick —
> see correction below): *"Mudavym wave four artifact has the best reports,
> /recommendations rewrk [rework] needs one more time, (but still the mudavym wave fours
> [four] seems to be great compated [compared] to others find a way to improve
> functionality without disrupting UI expereince [experience] currently), bestt/calendar."*

**[corrected 2026-09-18, correction 14:** the "Wave Four" quote above is genuine but was
mis-sourced in the original ADR as following the 108 pick; it is part of his answer to
the 106 shell question (transcript `86b45107:2247`, re-verified 2026-09-18). Re-sourced;
its four typos, silently fixed in the original, are now bracketed (correction 21). In
the 2026-09-17 dictation pass this ADR otherwise draws on, he said nothing further about
108 — *"For sketch 108. Now I'll start from sketch 110"* — and
`108/direction-a.html` was opened in that pass but not reviewed.]**

**What he valued:** the Wave Four work — reports and calendar above all — as the visual
bar; the letter as the page's identity; the quiet tier as proof of what is withheld.

**Decision:** direction A with C's quiet tier, and a fourth round (sketch 120) that adds
function without disturbing the experience Wave Four already earns.

**[ADDED 2026-09-19, PR #391 audit M2 — his 2026-09-19 sketch-120 feedback (memory
`founder-sketch-decisions-106-115.md`, lane-answers batch 3, "RECOMMENDATIONS"), the
brief for the next round (sketch 122). He said only the first part below is a
requirement; the rest is brainstorming, not decided:**
**Requirement:** keep the days rail on top; show the house's decided goals on top
("whatever the restaurant has decided ... on top as the goal"); recommendations must
read brief and punchy, each with how to act; add a goals chart proposing where to set a
goal; apply one-tap actions that approve automatically ("get back to work"). Purpose,
his words: where an owner or manager looks when stuck, to see what they could have
done, or to predict the future and prepare early.
**Brainstorm, not decided:** 1A over 1B; the side sheet liked, unsure; 2B — he wants to
see how the mail looks; a newspaper-style digest, "maybe another software"; the
subject-account side sheet good if it shows more than the table; 3B's inline dismissal
with a real day and no overlay, "maybe"; "definitely not the fifth one"; "sixth one is
all right". Recommendations stays dark pending sketch 122, which folds in the 5
remaining recs-lane questions along with goals and one-tap actions.

### 109 — settings · A, the interview, with two grafts

Question round: *"A with two grafts (Recommended)"* — C's *read by* line under every
answer, and B's day sheet as the editor for opening hours.

### 110 — cellar · direction B, the gazetteer; C kept in mind, not built now

> *"Direction B. Okay, it looks really good. Especially the details part, the handling, I
> really like that the way we extract all the, all the menu like that, it looks really
> good. It looks clean. That's how I wanted it."* · *"I just want to see and trust you. I
> trust you on this. If the let's say the too many wise [wines], let's say 95 wines more
> wines in the index keeps it says keep scrolling okay if we can keep scrolling that will
> just work the fine work fine so the direction a looks great"* · *"the gazette
> [gazetteer] for 1b direction b is 1b seller [cellar] with nothing chosen okay Okay,
> looks looks good. I I'm able to see everything from there. Maybe we could add maybe one
> or two more let's say ana analytics but however it looks really clean. I like it."* ·
> *"these boxes, with the analytics should be able to be configured. Based on customer
> needs."* · *"adapting to the house is really good. I like it. The way it handled
> great."* · *"So now I'm at sketch 110, the wall. I think this is not it. Since I mean
> let's keep that in mind but I don't like this the first look nope ... sketch 110c is not
> good I don't like it the wall."*

**[verification 2026-09-18: the quotes above had been smoothed (a "that," "the fine," a
"maybe," a "let's say," "I like it" and a stutter dropped without "...", and "it says"
replaced by "[saying]"); they now read as dictated, with his "I trust you on this,"
which Owed #1 cites, restored to the quote.]**

**[corrected 2026-09-18, correction 1 — his "so the direction a looks great" line, above,
is not a walkthrough of direction A: everywhere else in this dictation he describes only
B's own frames, in order (`direction-b.html` §1 `:267`, §1b `:270`, §1c `:273`, §2
`:276`, §3 `:279`, §5 `:287`), and "95 wines more wines in the index" is B's own index
copy ("11 of 96 listed wines," `direction-b.html:374` — "index" appears 26 times in B,
22 of them outside CSS `z-index`, against 4 in A, all four inside `z-index`). He closed
on B with "The Gazette [gazetteer] looks good. I like it." Asked directly what the
"direction a looks great" line meant
(`AskUserQuestion`, 2026-09-18), he answered: *"B is great with that sidebar and how
simple it looks, and for I said great for was direction C paper trail graph"* [reading:
"and what I said 'great' for was 112's direction C paper-trail graph"] — the line was
about sketch 112's direction C, not 110's direction A at all. The original Decision below
— "the cellar is A's list with B's gazetteer detail" — was 110 README's own
recommendation (`README:295`, "A · The List ... with ... B's keyboard peek ... grafted
on"), not his words; he never separately walked A.]**

**[corrected 2026-09-18, correction 18 — "he rejected C, the wall, on sight" in the
original Decision overstates it: his words are "let's keep that in mind" alongside "I
don't like this the first look" — not built now, not discarded. Matches 110 README:315:
C is "the right page the day ADR 0115 lands ... until then it is a view, not the page."]**

**What he valued:** B's extraction of the menu and its detail handling; B's index
scrolling past 95+ titles; the empty gazetteer (B's `/cellar` with nothing chosen)
reading well; the register adapting to the house (B §2, §3). **[corrected 2026-09-18,
corrections 1, 10 and 18: the original read "A's plain list as long as it keeps
scrolling" and "He rejected C, the wall, on sight" — see the brackets above.]**

**Decision (his pick, confirmed 2026-09-18 — see corrections above):** the cellar is
**direction B** — one index of every title the house's books name on the left, one
bottle's whole record on the right; the record is the page, not a row that opens. C is
not the page for now — kept in mind, not built.

**Owed, from his words:**
1. B's index scrolls continuously past 95+ titles, virtualised as needed; the mechanism
   is delegated ("I trust you on this"). **[corrected 2026-09-18, correction 10: the
   original line here read "The index keeps scrolling at 95 bottles and beyond — paging
   or virtualised, never a wall that stops" — he asked for continuous scrolling
   and delegated the how; paging is not "keep scrolling." It is B's index
   (`direction-b.html:374`), not A's list.]**
2. One or two more measures on the gazetteer, and **the analytics boxes are configurable
   per house** ("based on customer needs").
3. The space-peek promotes to a fuller reading, and the peek itself carries **only** these
   values, as drawn in B §1c: `9 on hand · par 12 · $62 a bottle · $15 a glass`, a
   divider, then `38 sold · 9 d` [his words: *"If we can clean on this more ... Just keep
   it to super detailed, like super, simple details. Like nine hand. Part 12. Sixty-two
   bottles. Fifteen glass. And then a simple div ... divide divide of like that part with
   the thirty-eight sold, nine days with the sales."*]. **[corrected 2026-09-18,
   correction 4: the original line quoted his raw numbers as the values ("nine [on] hand.
   Part 12. Sixty-two bottles. Fifteen glass" ... "thirty-eight sold, nine days"). They
   are speech-to-text of the peek he was reading aloud, not a set he composed —
   "Sixty-two bottles" misreads a $62-a-bottle price as a bottle count. Read literally,
   his words ("clean on this more ... super, simple details") ask for a reduction, so
   "carries" becomes "carries only these" — the peek as drawn (`direction-b.html:274`,
   `#us-peek`) also shows "— at or under par" and "of till · paid $21.10," which his
   "clean on this more" strips.]**
4. **Where a wine's own detail lives** — *"it came from this area, this vintage, formats,
   the taste notes ... what we were working on and the machine learning side, the
   details, the features of those wines. How can we present them? And it's only going to
   be for wines for now."* This needs its own drawing before it is built; it is wines
   only.
5. All three overlays — Carry these bottles, the label reader ("Is this the bottle?")
   and Photograph the label — are approved as drawn (*"overlay is good, look good"*). He
   rated the label reader higher with a hedge (*"I think the label reader. Is a bit
   better. But I'm not sure. ... I can see many more things there. At the same time.
   It, it's just not that crowded as well."*) and Photograph the label *"great"*.
   **[corrected 2026-09-18, correction 8: the original line called the label reader "the
   preferred one" — B §5 draws three separate overlays (`direction-b.html:287-333`), not
   alternatives to choose between; he rated them, he did not pick one over the others,
   and "preferred" invites dropping the other two.]**
6. Hold-to-order is approved. His words name two modes for a house setting: *"either auto
   approve which will access the hold to order twelve straightly or Another are you sure
   you want to approve?"* — mode one, auto-approve, sends the hold of 12 straight
   through; mode two asks "are you sure you want to approve?" after the hold. **[corrected
   2026-09-18, correction 9: the original line gave three modes — "straight through on a
   hold, a confirm step ("are you sure"), or auto-approve" — his words give two.]**
   **Open (see Consequences, Open item 1):** what "auto-approve" means — a hold that still
   stops for one tap, or an order with no human hold at all, which would bypass ADR 0112's
   seal on a money act — and so whether the setting stays two modes; and who may switch a
   house into auto mode.
   **[answered 2026-09-18, founder via `AskUserQuestion`, both picks the offered
   recommendation: "Auto = hold, no confirm" — the hold stays the one deliberate act in
   both modes, and "auto" only skips the second "are you sure" (the default mode is hold
   then "are you sure"); and "Owners and managers" — only an owner or a manager of the
   house may change the mode; staff see it but cannot change it. Open item 1 is closed.]**
7. `/menu`: a person can add and discard items.
8. **[added 2026-09-18, correction 19:** the two adapting-to-the-house frames are
   approved as drawn and the build must carry them: the Turkish house (B §2 — TRY,
   tr-TR, a rakı chosen, `direction-b.html:276`) and the alcohol-free café / whisky bar
   (B §3, `direction-b.html:279`).]**
9. **NOTE ONLY, do not build now:** the fast-moving non-alcoholic lines (Turkish coffee,
   tea, American black coffee, water) need their own analytics — the present heat map is
   unreadable (*"the heat map looks blue as hell. It doesn't show anything. We can I
   cannot understand what this means."*). Record it and keep the pipeline able to feed
   it. **Open (see Consequences, Open item 7):** whether *"make sure the pipeline to go
   there is good"* means checking the sales pipeline for these lines now, or only keeping
   it unblocked for later.
10. **[added 2026-09-18, founder in chat after seeing the lane's build (the sketch-095
    book: register cards, a flat `/wines` table, a bottle leaf) beside B:** B stays the
    base — *"other than [that], ours look very much more beautiful"* — and three things
    from that build are carried into it: the one-place overview (*"how simple we can see
    everything in just one place, which is the registers, wines, beer, cocktails itself,
    in the building tonight"*); the bottle list, reached as a full page by a button
    (*"maybe we could integrate it into our current design, such as showing full page
    ... it buttons up like that, we just open up this page"*); and the bottle leaf's
    "What the library knows" and "The wine's own detail" (*"these are really, really
    important aspects"*). How they fit into B is being researched and drawn as sketch
    121 before the cellar is rebuilt.]**
11. **[added 2026-09-18, founder via `AskUserQuestion` on sketch 121 (session scratchpad
    `cellar-121/`; research `cellar-121/research-summary.md`, workflow wf_753c9988):**
    - *Buttons:* "Yes, as drawn" — each register the house carries is a button in the
      page head; pressing one opens that register's full-page list; a bottle chosen
      there opens beside the narrowed list, never over it (B's rule, the record is the
      page).
    - *Taste profile:* "Show, labelled honestly" — body, acidity, tannin, sweetness and
      aromas are shown with one line saying where they came from. Production, read-only
      2026-09-18: profiles on about 3,350 library wines; `data_enrichment->>'knowledge'`
      is inferred on 2,773 (a model's typical profile for the grape and region), known
      on 432 (a model's recollection, not checked), and review_status approved on 3.
    - *Machine-learning features:* his words — *"the master wine library data set has
      already a lot of value and features we could use ... taste notes, vintage,
      country, etc. And if the value is not shown there ... let's just say analytics
      coming soon ... or don't even include them. Create the right structure plan with
      foundations no details (further sessions will handle that). Do not embed the whole
      machine learning system ... However, create another document for this in order to
      build on this later with every endpoint thought ... on how to use that ML data ...
      the analytics part we have with ... 300 plus [insight types] ... must already be
      integrated with the ML data since most of it will come from there and also from
      ... other analytics like sales."* So: the cellar ships the fields the library holds,
      an ML section appears only when it has values (else a plain "coming" line or
      nothing), and a separate foundations document maps the library's features to
      every endpoint and to the insight types, for later sessions to build.
    - *The wine sentence:* *"either compose it from the profile or look at the master
      one library data set and extract the info from there. And if it's not there and
      we have that vine available, that means our pipeline is broken somewhere."* A
      pipeline check (source data set against production) is owed before the build.]**

### 111 — help · delegated to the builder, held to the industry's best; two must-haves

> *"just mimic how the big companies are doing. Such as Anthropic, and other financial
> fin fintech startup companies."* · *"We don't have to focus on this. But um, make sure
> that we are have a collection of great how to use the AI agent we have to be go between
> tasks, configure tasks, goals, and the general overview, read me type, type of thing,
> document."* · *"Always show how, who to email. ... Just emails, no Slack or anything for
> now."* · *"It's I think a good idea to alert the user so that in order to get the mails,
> this configuration needs to be done. ... but the access just revoked or anything else
> that we cannot access anymore, we're gonna pop up a notification for mobile. For web, I
> think it's it's a good idea to Maybe not, maybe not. Maybe not. I'm not sure."* ·
> *"What to do next is okay. I like it. Write to support model [modal] is good. I like
> it. Promote one tap acts. That's a big one."* · *"I'm right now at sketch 111 slash help
> direction c."* · *"I'll just leave the help slash help to you."*

**[verification 2026-09-18: the quotes above had been smoothed — "financial fin" and
"I think" dropped, "we are have" and "read me type, type of" tidied, "we have to be go
between" rewritten as "how to go between," and "but the access just revoked" changed to
"if the access"; they now read as dictated. The modal typo keeps his raw "model" with
the reading bracketed (correction 21).]**

**[corrected 2026-09-18, correction 2 — he was on **direction C** when he set the bar
above ("I'm right now at sketch 111 slash help direction c"); the two things he then
named exist **only in direction B**: the "What to do next" rail (`direction-b.html:782`;
zero hits in A or C) and the centred "Write to support with these readings?" panel
(frame 03, `direction-b.html:270`; zero hits in A or C, which carry only a plain "Write
to support" section, A:467, C:442). He closed with "I'll just leave the help slash help
to you," not a pick. "Direction A" in the original Decision below was 111 README's own
recommendation (`README:301`, "Build A as drawn in its section 07"), not his words. His
2026-09-18 answer (`AskUserQuestion`, "Delegated (Recommended)") resolves it: the direction is the builder's to pick under his bar, grafting B's two named
elements in regardless of the base chosen, with the guide collection and the one-tap acts
as must-haves, email only.]**

**What he valued:** a real help centre of the kind Anthropic and the fintech companies
publish (the bar he named while on C); guides for working with the assistant —
**must-have** ("make sure"); one email address in plain sight, no Slack; an alert when
mail access is missing; the next-act rail and the write-to-support panel (both B's);
promoting the one-tap acts — **must-have** ("that's a big one"). He named `/help` overall
low priority ("we don't have to focus on this"). **[corrected 2026-09-18, correction 16:
"we don't have to focus on this" and the two must-haves were absent from the original;
every Owed item read at the same weight.]**

**Decision (delegated to the builder, his 2026-09-18 ruling):** the base direction is the
builder's choice, held to his bar (mimic Anthropic's and the fintech companies' help
centres); **B's What-to-do-next rail and write-to-support modal are grafted in**
regardless of which base is picked; the guide collection and promoting the one-tap acts
are must-haves; email contact only, no Slack.

**Owed:** the guide collection — using the assistant, moving between tasks, configuring
tasks and goals, a general overview (must-have; no direction draws it yet — all three
carry only an "Open the app guide" link, A:517, B:516, C:492 — so it needs its own
drawing before or during the build); email contact only (`support@mudavym.com`), no Slack
(README fork 5, answered); a standing alert when the house's mail grant is absent or
revoked, pushed on mobile **and** shown as a persistent routine-tone banner on
`/connections` (Open item 5 — **answered 2026-09-22**, ADR 0149 row 53 / PR #413);
keep "what to do next" and the write-to-support panel (both B's); promote the one-tap
acts (must-have). **[verification 2026-09-18: the correction
pass had dropped the guide collection's
contents, "(using the assistant, moving between tasks, configuring tasks and goals, a
general overview)," and cited it to "README fork 3," which is the WIP-base fork
(`README:284-286`), not the guides; contents restored, citation replaced.]** **Open (see
Consequences):** whether `/help` is reachable signed out (README fork 7, `README:295-297`,
not embodied by any direction; listed with the unanswered README questions).

### 112 — vendor prices · A's ladder as the spine, C's chart and trail grafted; README's fork answers accepted, fork 6 moved to (a)

> *"this has to be the most technical area. So look for financial companies who have
> managed to do anything or like list all of those qualities. ... this is gonna be a
> quant type of thing. Even though we're not gonna show these of all of the features and
> the parameters we're using, we wanna make sure that everything is basically very well
> built. and very organized and tidy looking so that people can understand what they're
> looking at."*
> *"[B] the desk is not looking bad ... but it might be hard to find what you need, just
> for scrolling that would just take a lot of muscle power"*
> *"[C] I like the graph, graph is really good ... when pick the bottle ... keep this,
> this is great work."* · *"Whenever we choose a wine and look for the details, but if you
> click on it like a couple times or ... look at full chart, etc., then we open this up.
> So do not add this to the cache or whatever. But this is great work. I want to see this
> all the time."* · *"And all of the invoices we we receive, that's perfect as well. And
> also the where we got it from. Let's say if we find from WhatsApp or who did we Whoever
> did we communicate with, I want to see that in the report as well."* · *"for the vendor
> prices, I also like the leather [ladder] look since I can see everything. So compare,
> try to mix up, mix those things, make sure that it works. I also like the comparison
> between our house and the public pages and what they sell. It's also good comparison."*
> · *"Um, okay, I agree to the, I, I would be definitely agree, agreeing with you in the
> other things."*

**[verification 2026-09-18: the quotes above had been smoothed ("show these of all" →
"show all," "like a couple" → "a couple," "or whatever" and "we we" and "the where"
dropped, "who did we Whoever did we communicate with" rewritten as "whoever we
communicated with"), and the ladder sentence had been reordered so that "So compare, try
to mix up" followed the house-versus-public sentence; he said it straight after "I can
see everything," of the ladder. They now read as dictated, in his order, with "leather"
kept raw and the reading bracketed (correction 21).]**

**[corrected 2026-09-18, corrections 5-7 — three sentences the original ADR dropped are
restored above: "I want to see this all the time" (pulls against the "do not add this to
the cache" half, previously quoted alone); "So compare, try to mix up, mix those things,
make sure that it works" (his only sentence authorising the A+C graft — the Decision previously
rested on no quote for it); and his blanket "I agree ... in the other things," which the
original ADR never mentioned. That blanket line accepts 112 README's remaining
recommended fork answers (`README:354-383`). His 2026-09-18 answer ("Accept, full
provenance first (Recommended)") confirms this stands and additionally moves fork 6 to
(a) — see Decision.]**

**What he valued:** the ladder's completeness at a glance, C's chart, C's document trail,
the provenance of every price including the conversation it came from, and the house's
own prices set against the public register. He was cool on B for the hunting it costs. He
closed by accepting the README's remaining recommended answers wholesale.

**Decision:** direction A is the spine; C's chart and paper trail are grafted; the
house-versus-public comparison stays. His blanket agreement accepts 112 README's
remaining recommended fork answers (`README:354-383`): **1(a)** class badge per row ·
**2(c)** vendor's usual currency, required otherwise · **3(a)** wine library stated on
the page · **4(a)** staff read refused in one sentence · **5(a)** trend chips at product
consensus, **N = 5** · plus **B's landed/agreed badge grafted onto A's own-paper rungs**
(free — `own-paper-sighting.ts`'s built `receipt_verified` / `order_confirmed` refs).
**Fork 6 (which document links in) moves to (a) in the first build** — his 2026-09-18
ruling, overriding the README's cost-based sequencing (which recommended shipping (b)
first — "the order and its receipt row for own paper" — with (a) as a costed second
step, `README:410-416` and `:432-434`). **Open, not decided (see Consequences, Open item
2):** the paper trail's load behaviour — always available for every wine but loaded
lazily, or shown by default — since "I want to see this all the time" pulls against "do
not add this to the cache or whatever." **[corrected 2026-09-18, correction 6: the
original Decision settled this as "the detail opening on demand (opened after real
interest, not pre-fetched or cached ahead)," quoting only the "do not add this to the
cache" half.]** **[answered 2026-09-18, founder via `AskUserQuestion`, the offered
recommendation: "Always on the record, loaded fresh" — the paper trail is shown on every
price record without extra clicks, and read fresh each time the record opens, never
served from a cache. Open item 2 is closed.]** **Named tension:** 112 README's own recommendation sends C's chart to
`/notifications` instead (`MarketPricePanel`, `README:423-428`) because "the papers
matter more than the curve" on the register; his words ("I like the graph ... keep
this") keep the chart on the register, and the Decision follows his words, not the
README, on this point.

**Owed:** the price register drawn at the standard of a financial instrument — every
figure tidy, named and openable, with the machinery behind it unexposed; the ladder never
hides a rung the house has; a research pass surveying how financial products present
price registers, and writing down the qualities that survey finds, before the register is
drawn to that standard (his words: "look for financial companies who have managed to do
anything or like list all of those qualities"). **[added 2026-09-18, correction 7: this
research item was previously absent — the Decision rested on no quote for the A+C
mix.]** Each price carries its source document and, where it came from a conversation
(WhatsApp, mail), the message and the person — **built in the first pass, per fork 6(a)
above, not deferred**: this needs the two writer changes (receipt verification and order
confirmation, `own-paper-sighting.ts:350-404`, per 112 README:398-403) and the
attach-a-paper step in Record a price, all owed now rather than as a second step. **[corrected 2026-09-18, correction 5: the original
Owed line asserted this as settled; the README defers it to a costed second step, and it
is only decided for the first build by his 2026-09-18 ruling above.]**
**[sequenced 2026-09-25, founder via `AskUserQuestion`, web-rebuild round 5 item 30
(memory `founder-answers-2026-09-25-web-rebuild.md`): "provenance = follow-on lane that
must land before the flag goes live for any house". So the first build (PR #473,
`/vendor-prices` dark behind `mudavym_design_vendor_prices`) may merge without fork 6(a),
and `mudavym_design_vendor_prices` may not be turned on for any house until the
provenance lane has landed. This answers the sequencing question #473's page note asked;
it does not reopen "not deferred" — the provenance is still owed before any house sees
the page.]** **[built 2026-09-25, lane W3-provenance, branch
`feat/vendor-price-provenance` (stacked on #473): `vendor_price_observations` gains
`document_id`, `document_line_id`, `conversation_message_id` and `source_contact_id`
(`20260927130000_a_price_names_its_paper_and_its_messenger.sql` — composite keys with
`restaurant_id`, so the database refuses another house's paper or message, and a
public-register row can carry none **[corrected 2026-09-26, PR #482 audit at
cd2dc58f6: a line is house-checked by the database only when the row also names its
document (MATCH SIMPLE); a line named alone is refused by both writers and read
house-scoped, not refused by the database. "Can carry none" held for three of the four
ids until `vpo_document_line_needs_a_house` was added in the same migration.
`06-pages/vendor-prices.md` has the measurements.]**); the two writer changes (`procurement.service.ts`
`receiptPaperFor` names the one live invoice linked to a verified receipt's order and
the line paired with the order's line, `dealMessageFor` names the vendor reply a
confirmed deal was read from); the attach-a-paper upload in Record a price (the file
goes through `POST /procurement/documents` and the price is recorded with the returned
id); and the message and person a price came from, picked in the same form or read off
the message's own headers. All of it is shown on every record and read fresh on every
opening (`vendor-intel/price-provenance.ts`, fork 6's "Always on the record, loaded
fresh"). What it does not do is named in `.planning/06-pages/vendor-prices.md` §0.]**

### 113 — promotions · B, with C's density and bundles; A's 4c acts kept, their address open

**[CORRECTED 2026-09-19, PR #391 audit M2: "their address open" no longer describes the
current state — Open item 3, below, was answered 2026-09-18 (`AskUserQuestion`: the
sections move to `/communications`) and built 2026-09-19, uncommitted on other branches when written (see Open item 3). This heading is kept as
written for history; see the Decision paragraph, the Consequences bullets and Open
item 3 below for what changed and when.]**

> *"113B just looks like great promotions page. I would like to see that if I were the
> user and I like the, like as, as long as the bigger, bigger the sale, the bigger the box.
> I like this kind of approach and I would definitely pick this one. However, ... I'm only
> able to see three of them. If I can see, let's say, more than a couple, like more than
> 10, just like in the 113C, as in the one ... everything is just put down next to each
> other, I can, I'm able to see everything. And maybe I can just do bundles there."*
> *"I like the overlays of the 113C. And also the 113B, the overlays of it. ... that
> ordering is also good."* · *"For 113A, since this is going to be a live data, dynamic
> data, maybe we should do something else, but think about it."* · *"hold the truss [hold
> to trust] is great. 4C. Yep. And 4C in 113A is great. Okay, that's perfect."*

**[verification 2026-09-18: the quotes above had been smoothed (an "a" added, "the,
like as," "bigger," "let's say, more than a couple, like," "I can," "a live data" and a
"that" dropped without "..."); they now read as dictated, with "hold the truss" kept raw
and the reading bracketed (correction 21).]**

**[corrected 2026-09-18, correction 3 — read together, both sentences name **direction
A**: hold-to-trust and its "4c" section exist only there (`direction-a.html:667-680` —
zero hits in B and C, whose own §4c is the Export popover, `B:415` / `C:388`). "Hold-to-
trust stays" in the original Decision below is wrong — B has none of its own to keep; the
act is A's, along with the "Add as a vendor" ask beside it
(`direction-a.html:490-492`).]**

**What he valued:** worth expressed as size (see Consequences — the basis for this is not
decided), seeing ten or more offers at once, bundles as a first-class thing, both overlay
treatments, the ordering, and A's hold-to-trust plus add-vendor ceremony.

**Decision (his pick: direction B, with C's density and bundles in his words; the §4c
acts approved, their address open):** direction B, with C's density so more than ten offers read at once, and
bundles added as their own shape. **A's §4c acts — the hold to trust and the "Add as a
vendor" ask (`direction-a.html:667-680`, `:490-492`) — are approved and kept.** **Where
they live is open, his call (Open item 3):** in A they are the acts of its two secondary
sections, Trusted senders (`direction-a.html:475`) and Strangers (`:485`); B's own draw
moves senders and strangers to `/communications` (README fork 2, `:111`). Whether those
sections, with their acts, stay on `/promotions` under B, or the acts go with the
sections to `/communications`, is not decided here — his "4C in 113A is great" endorses
the acts, not the sections' address. **[verification 2026-09-18: the correction pass
wrote "is grafted into B," which presupposed the open answer (the acts can only sit in B
if the sections stay on `/promotions`).]**
**[ANSWERED 2026-09-19, PR #391 audit M2: this is no longer open. Open item 3 below
records his 2026-09-18 `AskUserQuestion` answer (move to `/communications`) and its
2026-09-19 build (`WhoIsWriting.tsx` + `SenderActs.tsx`, gated on
`mudavym_design_communications`).]**

**Owed:** decide and draw how a bundle is graded and shown (his open question, *"If
bundles, well, how would you react? How should we react? Maybe add another part for
it."*); reconsider **A's register itself** (direction A's page shape, "The Register") —
not the §4c acts he approved, which the live-data question does not touch — under live
data before any of it is reused. **[corrected 2026-09-18, correction 3: the original
"reconsider A's register" line was unscoped and would have also caught the §4c acts he
approved.]** **[added 2026-09-18, correction 17:]** Add "B's sized boxes at C's 10+
density" as a drawing still owed — no frame shows size-encoded boxes with ten or more
offers visible, and the two pull against each other. **Open, not decided (see
Consequences, Open item 8):** the projected-worth basis for box size — his 2026-09-18
words: *"are we sure baout [about] this approach? research [and] analyze [it] in
scalability and quality, but it s [it's] the best in terms UI looks(and possible that we
might get ads there in future)"* — **direction B stays the pick for looks** while a
research pass on the sizing mechanism's scalability and quality runs.
**[answered 2026-09-18, founder via `AskUserQuestion` after the research (session
scratchpad `113-box-sizing-research.md`): a bigger box means **money worth to this
house** — the discount times what the house actually buys, shown as an estimate, and
only when the house qualifies (the grader today never reads an offer's minimum quantity,
`offer-grade.ts`, and sizes by dollar worth while printing the percentage) — with his
condition *"structural system, priorities must come first"*: the ranking rules (the
offer qualifies, its worth is real, its comparison price is recent) are settled before
any box is sized. Sizes come in **tiers** — at most one hero, up to three larger cards,
then compact tiles so ten or more offers stay visible — not continuous scaling. Whether
box size and order may ever be sold as advertising is **left open until ads are
scoped** (his pick "Decide when ads come"; the research flags Turkey's Law 4250 and US
tied-house rules for a lawyer, from memory, moderate confidence). The estimate needs a
written rule under ADR 0020 before it ships. Open item 8 is closed; ads become open item
9.]**

## Consequences

- **Settled, his words or his 2026-09-18 answers:** 106 shell direction (A, pending 119's
  further directions); 107 direction (B+); 108 direction (A with C's quiet tier) plus a
  fourth round owed; 109 direction (A with two grafts); **110 cellar is direction B**;
  **111 help is delegated to the builder, with two must-haves**; **112 is A's spine plus
  C's chart/trail, README forks 1a·2c·3a·4a·5a (N = 5) accepted, fork 6 moved to (a) for
  the first build**; 113 direction (B with C's density and bundles; A's §4c acts kept,
  their address open **[corrected 2026-09-19, PR #391 audit M2: address decided
  2026-09-18, built 2026-09-19 but uncommitted on other branches when written — see Open item 3]**). **[corrected 2026-09-18, correction 20: the original line here
  read "Eight pages now have a locked direction, which unblocks their builds" — several
  of those "locked directions" were the sketch README's own recommendation or a builder
  synthesis, not his picks (see each section's correction above); replaced with what is
  actually settled, and below, what each page's README still asks that this review left
  unanswered.]**
- **Proposed, the builder's synthesis, pending his confirmation:** 106's chrome list;
  107's graft of A's vendor boxes and bolder figures into B+. **[verification
  2026-09-18: the correction pass had listed "107 grafts" and "A's §4c grafted in" as
  settled; correction 20 names both as syntheses, and the §4c address is Open item 3.]**
- **Unanswered sketch-README founder questions this review left open, page by page, his
  delegations excepted:** 110 — 8 of 10 (`README:257-292`; he answered only "what is the
  page for" and "is the record a row/page/sheet"); 111 — forks 1-4 and 6 are delegated to
  the builder (`README:275-297`, "I'll just leave the help slash help to you"), fork 5
  (Slack) is answered no, fork 7 (signed-out `/help`) is untouched; 112 — the fork table
  is accepted by his blanket "I agree ... in the other things" (`README:354-383`), but
  its three further,
  unlisted questions (whether the seal may mark "lowest before terms," the landed/agreed
  label under ADR 0054 Proposed, a price-movement colour pair) are not **[answered
  2026-09-25 for 112, founder via `AskUserQuestion`, web-rebuild round 5 item 30 (memory
  `founder-answers-2026-09-25-web-rebuild.md`): "no seal on 'Lowest admitted', rise/fall
  same ink — accepted" — the seal never marks the lowest admitted figure (matching his
  2026-09-19 lane answer "never seal now + follow-up lane for structured terms", memory
  `founder-sketch-decisions-106-115.md` "Lane answers batch 2"), and a rise and a fall are
  drawn in the same ink, the sign and the words carrying the direction, as PR #473 built
  them. The landed/agreed label was answered in the same 2026-09-19 batch — "badge words =
  keep landed/agreed" — and is written here from that memory record, not from item 30. All
  three of 112's further questions are therefore closed. Item 30 also set the sequencing:
  fork 6(a)'s full provenance MUST land before `mudavym_design_vendor_prices` is turned
  on for any house (`founder-answers-2026-09-25-web-rebuild.md:50`).]**; 113 — 6 of 7 open
  (`README:336-377`): only question 7, the coupling to 112's forks, is answered, through
  112's accepted forks 1(a) and 2(c) (`README:367-377`); open include question 2, the
  projected worth (Open item 8), and question 3, senders and strangers (Open item 3).
  **[CORRECTED 2026-09-19, PR #391 audit M2: "6 of 7 open" is stale — questions 2 and 3
  are both answered now (Open items 8 and 3 below, both closed 2026-09-18), so 113 is
  4 of 7 open: question 7 (answered, above), question 2/Open item 8 (answered) and
  question 3/Open item 3 (answered) are settled; the fork-6-coupling and the three
  drawing-owed items stay open.]**
- **Drawings owed before their builds can start:** the wine detail surface (110, Owed
  #4), the bundle shape (113), the guide collection for `/help` (111, must-have), B's
  sized boxes at C's 10+ density (113), and — if it wins — sketch 119's shell.
- **Two of his notes are deliberately not built now:** ~~the non-alcoholic heat map (110,
  Owed #9)~~ **[built 2026-09-22, Q9]** and A's register itself under live data (113).
- **Open items — the founder's call, not decided here (CLAUDE.md §0.1):**
  1. 110 — the two hold-to-order modes' exact meaning (does "auto-approve" still stop for
     one tap, or send with no human hold at all), and who may switch a house into auto.
     **[answered 2026-09-18: the hold stays in both modes, auto skips only the "are you
     sure"; owners and managers switch it. See 110 item 6.]**
  2. 112 — the paper trail's load behaviour: always available for every wine but loaded
     lazily, or shown by default? ("I want to see this all the time" against "do not add
     this to the cache or whatever.") **[answered 2026-09-18: shown on every record,
     loaded fresh, never cached. See 112 fork 6.]**
  3. 113 — whether A's Trusted senders / Strangers sections (with 4c's hold-to-trust and
     add-vendor ask) stay on `/promotions` under B, or move to `/communications` as B's
     own draw sends them. **[answered 2026-09-18, founder via `AskUserQuestion`, the
     offered recommendation: they move to `/communications`, and the hold-to-trust and
     add-vendor acts go with them; `/promotions` holds offers only.]**
     **[built 2026-09-19, uncommitted at the time of writing: the new home is
     `apps/web/src/pages/communications/next/WhoIsWriting.tsx` (+ `SenderActs.tsx`,
     `useSendersDeskData.ts`), a "Who is writing" section under the conversation book, with
     the two 4c acts as centred panels — trust takes the `HoldToApprove`, add-vendor is a
     plain create. The interim tabs are cut from `/promotions` (`PromotionsNext.tsx`) and
     `SendersProspectsPanel.tsx` is deleted (no other importer, grep 2026-09-19). No gateway
     route moves: `/senders/*` and `/prospects/*` live in `common/orchestrator/` and were
     never promotions-scoped. Build calls the founder did not make, open to his correction:
     the section's place and two-column shape; **"Strangers"** (sketch A's word) for what
     the interim called Prospects; untrust as a plain button (only raising trust takes the
     hold); a one-line "Open in Communications →" hand-off kept on `/promotions`
     (`direction-b.html:316`); the trust write is read back before it is called saved,
     because `sender-reputation.service.ts:56-83` ignores the upsert's error and answers
     200. Claims: `ADR-0160-SENDERS-HOME-COMMUNICATIONS`, `ADR-0160-PROMOTIONS-OFFERS-ONLY`
     (the second fails CI on any branch where the panels are cut before the home has
     landed — the merge-order guard). **Raised 2026-09-19, [answered 2026-09-19, founder via `AskUserQuestion`, the offered recommendation: flip the flag first — the `/promotions` cut does not merge until `mudavym_design_communications` is on for every house that has `/promotions`; the flip is his keystroke, not an agent's; the two alternatives declined were keeping the interim panels for flag-off houses and mounting the home on the legacy page, which ADR 0042 forbids]:** the home
     renders only where `mudavym_design_communications` is on (default false,
     `feature-flag-registry.ts:104`; the 2026-09-06 go-live flipped five houses, later flips not re-measured), while the rebuilt
     `/promotions` ships to every house with no flag — so a flag-off house would lose
     trust-a-sender and add-a-vendor the moment the cut merges (hence the answer above). Not filed in
     `OPEN-DECISIONS.md` because a new row shifts ~173 citations; filing it is the
     founder's or lane's call.]**
  4. 107 — "too many operations for the record, what could happen": his risk, not yet
     his fix; paging or grouping is proposed, not decided.
  5. 111 — the web half of the mail-access-revoked alert. **[answered 2026-09-22,
     founder via the PR #413 merge queue: persistent routine-tone banner on
     `/connections` in addition to the phone push. Recorded as ADR 0149 row 53.
     Rejected: phone-only / no web alert.]**
  6. **115 — arrival action boxes.** **Retired 2026-09-22** without an A/B/C
     winner; the founder picked sketch 121 as the arrival direction (ADR 0144
     addendum of the same day). The 2026-09-18 note that his spoken review
     never reached 115 still stands as history, not as an open item.
  7. 110 — the non-alcoholic heat map: does "make sure the pipeline to go there is good"
     mean checking the sales pipeline for instant-sale lines now, or only keeping it
     unblocked for later? **[answered 2026-09-22, founder Q9 via page-gap questions:
     wire live sales NOW, before #434 merges. Built on this PR: `readTillLines` mines
     `pos_checks.items` in addition to `pos_unresolved_lines`, because non-wine lines
     never enter the unresolved queue (`PosHubService.applyStockEffects` skips
     `!is_wine`). RowExpander's "When it sells" heat map already derives from those
     till lines via `rowSeries.whenItSells`.]**
  8. 113 — the projected-worth box-size mechanism: not decided; a research pass on its
     scalability and quality is owed and running (2026-09-18) — direction B stays the
     pick for looks in the meantime. **[answered 2026-09-18: money worth to the house,
     as an estimate, ranking rules first, in tiers. See 113.]**
  9. **[added 2026-09-18]** 113 — whether box size and order on `/promotions` may ever be
     sold as advertising: his pick is to decide when ads are scoped; a lawyer reviews
     Turkey's Law 4250 and US tied-house rules before any ad product.
- The cellar, help, vendor-price and promotions builds each carry items that came from
  this review and from nowhere else; a build that ships without them has not met the
  review.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | Aldemir (founder), in session | Locked — the gallery review, dictated page by page |
| 2026-09-18 | Opus critic (re-read every cited sketch file and this ADR, line by line) + Aldemir (founder, `AskUserQuestion`) | Corrected — 21 corrections applied; two sections (110, 111) had recorded a sketch README's own recommendation as his pick and are rewritten; 110, 111 and 112 resolved by his 2026-09-18 answers; 113's box-size question answered "not decided — research owed" **[verification 2026-09-18: this row first said the box-size question was "resolved"]**; 8 items left open, not decided, per CLAUDE.md §0.1 **[CORRECTED 2026-09-19, PR #391 audit M2: this count was never updated as items closed the same session — items 1, 2, 3 and 8 were all answered 2026-09-18 (see the rows below and Open item 3's build), leaving 5 open (4, 5, 6, 7, 9), not 8]** |
| 2026-09-18 | Aldemir (founder, `AskUserQuestion`, session `113-box-sizing-research.md`) + Claude (`82aab7d31`) | Answered — 113's box size is money worth to the house, as an estimate, only when the offer qualifies, ranking rules first, sized in tiers (one hero, up to three larger, then compact tiles); Trusted senders/Strangers with their §4c acts move to `/communications`; ads stay open until scoped (new Open item 9). Open items 3 and 8 closed |
| 2026-09-18 | Aldemir (founder, sketch-095 book review) + Claude (`9c6387edd`) | Answered — the cellar keeps direction B as its base and carries three things from the old build: the one-place overview, the bottle list as a full-page view opened by a button, and the bottle leaf's "What the library knows" / "The wine's own detail" sections; his sketch-121 answers recorded under 110 item 11 |
| 2026-09-18 | Verification pass (Opus; every quote re-measured word by word against the dictation and the question-round transcript, every cited sketch line re-read) | Corrected — quotes restored to his words (smoothing undone, typos kept raw with readings bracketed); a deleted 106 quote restored; the 113 §4c "grafted into B" and the 110 "binary" setting un-decided (both open); 107's graft marked proposed; correction numbers aligned to the critic's list; citations fixed (111 README:301, 112 README:410-416/:432-434, 106 README:216 wording) |
| 2026-09-19 | Session (Sonnet 5; build and cut, tests and mutation runs cited in the two CLAIMS rows) | Built — Open item 3 delivered on two uncommitted branches; the flag-gating fork it exposed is answered there: flip the flag first |
| 2026-09-21 | Aldemir (founder), picks relayed verbatim in the shell lane's brief (this session did not re-read the dictation transcript) + Claude (branch `feat/shell-counter`, uncommitted at this row) | Picked — the shell is sketch 119 direction D, **the counter**, with E's day line as a PAGE element on the dashboard and the receiving page, not chrome. Forks answered: (3) a SEALED act may be completed from the counter's sheet on ANY page, with the same HoldToApprove ceremony and server seal as the owning page, nothing weaker; (4) the counter holds the person's own acts (Seal, Verify, Reply, Decide) plus "Mudavym proposes" (`ai_proposed_actions`), applied only by the seal; (5/6) the Judge/market row appears only once its register exists — no 501 placeholder row or route; (10) width is "Open first, then remember": open on a person's first visits at normal widths, tucked below ~1280 px and on `/reports` and `/inventory` to a ~52 px strip that still shows each verb with its count, then each person's choice per page remembered (per-device localStorage keyed by the person in this first version — the server preference route takes its user id from the URL, see the build note); (9) the phone is D's four doors, Counter · Rooms · Search · Ask; (11) the counter's session log, "the house said", clears on reload. Standing: ADR 0149 row 5 (shell rebuilt as house chrome), row 33 / ADR 0145 (WineAgentFab removed; `/ask` and ⌘⇧K are the doors), row 8 (support@mudavym.com), internal tools never in the rooms. Built behind `mudavym_design_shell` (OFF; migration 20260921114300; browser override `mudavym.design.shell`); the day line as a page element is NOT built on this branch. Claims: SHELL-COUNTER-NEVER-PRINTS-A-FAILED-READ-AS-ZERO, SHELL-GATE-IS-OFF-BY-DEFAULT-AND-THREE-LAYERED, SHELL-PROPOSAL-IS-APPLIED-ONLY-BY-THE-SEAL |
| 2026-09-21 | Session (Sonnet 5; second pass on the same branch, `feat/shell-counter`, uncommitted at this row) — the rest of ADR 0149 row 5's house chrome, and E's day line | Built — ONE house toast (`AppToaster.tsx` + `ToastContext.tsx`'s `HouseToastProvider` [corrected at the lane's last call, 2026-09-21: now the hook `useHouseToastApi` inside ONE `ToastProvider` whose tree shape does not change with the gate — the two-component swap remounted the whole app when the flag answered; and the undo toast added, which this row had not built]: every `useToast()` call forwards to `sonner` under the gate, landing on the same `<Toaster/>` its ~30 direct callers use; legacy unchanged); the error boundary's screen (`HouseErrorScreen.tsx`, via a new render-function `fallback` on `ErrorBoundary` — one class, not two); the page loader and skeletons (`HousePageLoader.tsx`, a 400 ms/12 s ladder replacing the App-level Suspense fallback under the gate); the offline banner (`AppOfflineBanner.tsx`, sketch 103's queued-is-never-confirmed rule at the aggregate level — the full per-record four-rung ladder still needs a richer `useSyncManager`, not built); the in-app 404 (`ShellCatchAll.tsx` + `HouseNotFound.tsx`, NESTED under `DashboardLayout`'s route — fixes the "still deciding" race the first pass's build note flagged). `WineAgentFab` deleted outright (not merely unmounted), regardless of the gate, per row 33 — a static guard holds it deleted. E's day line built at REDUCED scope, stated: `GET /house/day` (`house-day.service.ts`) answers 3 of the sketch's 6 registers (deliveries that arrived, today's calendar, today's reminders — one shared read); `deliveryExpected` (an uncosted new capture surface, the sketch's own words), `shifts` (real schema, needs a timezone-aware week pick and a role-based service choice — a bounded follow-up) and `market` (the same no-placeholder rule as the counter's Judge row) are not built, so the head counts "N of 3", never a bigger denominator. Drawn as a wrapping tick-chip row, not the sketch's pixel-timed band with DOM-measured no-overlap labels (`DayLine.tsx`; `dashboard.md` and `receiving.md` carry the full reasoning). Claims: SHELL-WINE-AGENT-FAB-IS-DELETED-NOT-GATED, SHELL-DAY-LINE-NEVER-COUNTS-A-REGISTER-THIS-BUILD-DOES-NOT-READ, SHELL-TOAST-IS-ONE-SYSTEM-UNDER-THE-GATE, SHELL-404-IS-NESTED-UNDER-THE-LAYOUT-ROUTE, SHELL-OFFLINE-BANNER-NEVER-SAYS-WILL-SYNC-WHEN-QUEUED |
| 2026-09-21 | Aldemir (founder), round 6k answers relayed verbatim in the shell lane's round-2 brief (this session did not re-read the question-round transcript) + Claude (Opus 5; branch `feat/shell-counter`, round 2, uncommitted at this row) | Answered and built — two forks this record's 2026-09-21 rows had left open. (a) On /ask, **"Never without the seal"**: the Ask panel's `ProposalCard` no longer applies a proposal with a click on the unsealed `POST /ask-ai/actions/:id/confirm`. It applies only through `HoldToApprove` bound to a server seal minted when the hold begins, after any edits: `POST /ask-ai/actions/:id/seal-challenge` now takes the operator's edited `payload`, checks it through the same allowlist and grounding an apply runs, and binds it into the seal (`args.edit`); `sealed-confirm` carries the same payload back and redeems before anything is written, so an edit made after the hold began, an untouched seal spent on an edit, or an edited seal spent untouched are all refused as "changed after the seal was issued" (the card also refuses the first case locally, before any request). The unsealed route answers **410** with a sentence naming both sealed routes and calls nothing; the service's public `confirm` is now the private `applyAfterSeal`, reached only from `confirmSealed`. Callers swept: the web client's `confirmAction` is deleted, `CounterActSheet` already used the seal (its "from the counter" copy scoping is removed), no other caller exists in `apps/`, `services/` or `scripts/`. Held by `scripts/check_ask_ai_is_gated.py` section 4 (rewritten; 10 guard mutations killed, one of which, a cast-spelled `(this.askAi as any).confirm(`, first survived and the guard was hardened for it) and the rewritten CLAIMS row SHELL-PROPOSAL-IS-APPLIED-ONLY-BY-THE-SEAL (13 of 13 mutations killed). (b) On the day line, **"Count what's built"**: the head stays "N of 3", the three registers this build reads, with no placeholder row for deliveries expected, shifts or the market; `house-day.spec.ts` and `DayLine.test.tsx` now pin it (a fourth register and a six denominator each fail a test). Merge note: `'shell'` joins the held-back list of `useMudavymDesign.test.tsx` beside settings, cellar, recommendations and receiving, never `LIVE_PAGES`; the shell stays flag-gated, default off. |
