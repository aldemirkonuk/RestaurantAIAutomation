# 0160 — The founder's sketch review: what he valued, and what each page becomes

- **Status:** Locked 2026-09-17 — the founder reviewed the sketch gallery page by page and dictated his reading of each. His words are quoted; the decisions below are his picks, and the build items are what those picks owe.
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** sketch review, app shell, receiving, cellar, help, vendor prices, promotions, recommendations, picks, grafts, Stripe, Toast, quant, bundles, label reader, heat map
- **Links:** [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (rows 21, 23, 38 and the gallery this reviews) · [[0144-the-book-opens-on-evidence-and-three-pages-get-a-job]] · [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] · [[0112-one-modal-policy-three-shapes-one-primitive]] · sketches `.planning/sketches/106-app-shell`, `107-receiving-structure`, `108-recommendations-directions-3`, `109-settings-directions-2`, `110-cellar-directions-2`, `111-help-directions`, `112-vendor-prices-directions`, `113-promotions-directions`, `119-app-shell-sota`, `120-recommendations-round-4` · gallery artifact `4aFbY744aZv1GR2YmytzdQ`

## Context

Thirteen sketch sets went to the founder on 2026-09-17 as a published gallery. He
answered the first four in a question round (107, 108, 109 picked; 106 sent back for
better directions), then opened the rest in the browser and dictated a page-by-page
review. He closed it with: *"go by each of them. Go by my text. Extract what is valued
... find the matches, find the why I did like them, and then let's finalize it."*

This record is that extraction. Each section quotes him, says what he valued and why,
states the decision, and lists what the decision owes the build. Where he asked for a
note rather than work, it is marked NOTE ONLY.

## The picks, page by page

### 106 — the app shell · direction A, in the Stripe and Toast idiom

> *"Do it as in how the Stripe and other startups do, like Toast, mimic that behavior."*
> Earlier the same day: *"I need the most sota with best user experience, (do not care
> about cheapest rebuild) I need full quality, use mudavym atlas to see the endpoints."*

**What he valued:** the rooms rail of direction A, but held to the standard of the
dashboards he uses — Stripe's and Toast's — rather than to what is cheapest to rebuild.

**Decision:** direction A is the shell. Its chrome follows the conventions those products
settled: a persistent, grouped left navigation with the house's identity and switcher at
the top, a thin top bar carrying search/command and the account, page headers that state
where you are and what you can do here, and one consistent place for state (empty,
loading, refused, offline). Sketch 119 draws two further directions at that bar; if one of
them beats A on his review, it supersedes this row and nothing else in this record moves.

**Owed:** the 404, the error screen, the loader, the offline banner and one toast system;
the floating assistant button removed; internal tools never listed for a house.

### 107 — receiving · B+ (the composed grid), with A's vendor boxes and its bolder figures

> *"the first look, [A's] desktop look doesn't look bad, especially those Southern Glazers
> wine warehouse little boxes plus the more striking main values. ... you have to consider
> if there are too many operations for the record, what could happen."*
> *"For overlay part, looks good, especially it looks like it has been extracted from that
> area. ... it's concise and it gives you everything as well. Plus the hold to send money
> sender."* · *"For three, the states. Okay, that's approved. For mobile, that's also
> approved."*

**What he valued:** the vendor box as an object on the page, figures that carry weight,
an overlay that reads as lifted from the row it came from, the hold ceremony on a send
that costs money, and the state and mobile renderings as drawn.

**Decision:** build B+, the composed grid picked in the question round, and graft A's
vendor boxes and its heavier treatment of the line's main figures. The overlay, the
states and the mobile rendering are approved as drawn.

**Owed:** answer his scale question in the build — what the desk does when one delivery
carries far more operations than the drawing shows (long line counts, repeated partial
receipts, many verdict records on one line): the grid must page or group rather than grow
without end, and the verdict history stays append-only (ADR 0149 row 23).

### 108 — recommendations · A with C's quiet tier, and one more round

> Question round: *"A with C's quiet tier (Recommended)"*. Then: *"Mudavym wave four
> artifact has the best reports, /recommendations rework needs one more time, (but still
> the mudavym wave four seems to be great compared to others find a way to improve
> functionality without disrupting UI experience currently), bestt/calendar."*

**What he valued:** the Wave Four work — reports and calendar above all — as the visual
bar; the letter as the page's identity; the quiet tier as proof of what is withheld.

**Decision:** direction A with C's quiet tier, and a fourth round (sketch 120) that adds
function without disturbing the experience Wave Four already earns.

### 109 — settings · A, the interview, with two grafts

Question round: *"A with two grafts (Recommended)"* — C's *read by* line under every
answer, and B's day sheet as the editor for opening hours.

### 110 — cellar · A and B together; C rejected

> *"Direction B. Okay, it looks really good. Especially the details part, the handling, I
> really like the way we extract all the menu like that ... It looks clean. That's how I
> wanted it."* · *"if ... 95 wines more wines in the index keeps [saying] keep scrolling
> ... if we can keep scrolling that will just work fine so the direction a looks great"* ·
> *"the gazetteer ... with nothing chosen ... looks good. I'm able to see everything from
> there. Maybe we could add one or two more analytics but however it looks really clean."*
> · *"these boxes with the analytics should be able to be configured based on customer
> needs."* · *"adapting to the house is really good. I like it. The way it handled great."*
> · *"sketch 110c is not good I don't like it the wall."*

**What he valued:** B's extraction of the menu and its detail handling; A's plain list as
long as it keeps scrolling; the empty gazetteer reading well; the register adapting to the
house. He rejected C, the wall, on sight.

**Decision:** the cellar is A's list with B's gazetteer detail; C is dropped.

**Owed, from his words:**
1. The index keeps scrolling at 95 bottles and beyond — paging or virtualised, never a
   wall that stops.
2. One or two more measures on the gazetteer, and **the analytics boxes are configurable
   per house** ("based on customer needs").
3. The space-peek promotes to a fuller reading, and the peek itself carries the compact
   fact set he dictated: *"nine [on] hand. Part 12. Sixty-two bottles. Fifteen glass"*,
   then a divider, then the sales line *"thirty-eight sold, nine days"*.
4. **Where a wine's own detail lives** — *"it came from this area, this vintage, formats,
   the taste notes ... what we were working on and the machine learning side, the details,
   the features of those wines. How can we present them? And it's only going to be for
   wines for now."* This needs its own drawing before it is built; it is wines only.
5. The label reader overlay is the preferred one (*"I can see many more things there at
   the same time ... not that crowded"*); "Photograph the label" is approved as drawn.
6. Hold-to-order is approved, **and a house setting decides the ceremony**: straight
   through on a hold, a confirm step ("are you sure"), or auto-approve.
7. `/menu`: a person can add and discard items.
8. **NOTE ONLY, do not build now:** the fast-moving non-alcoholic lines (Turkish coffee,
   tea, American black coffee, water) need their own analytics — the present heat map is
   unreadable (*"the heat map looks blue as hell. It doesn't show anything. I cannot
   understand what this means"*). Record it and keep the pipeline able to feed it.

### 111 — help · A, drawn the way the industry's best do it

> *"just mimic how the big companies are doing. Such as Anthropic, and other fintech
> startup companies."* · *"make sure that we have a collection of great how to use the AI
> agent ... how to go between tasks, configure tasks, goals, and the general overview,
> readme type of thing, document."* · *"Always show who to email ... Just emails, no Slack
> or anything for now."* · *"it's a good idea to alert the user so that in order to get the
> mails, this configuration needs to be done ... if the access just revoked or anything
> else that we cannot access anymore, we're gonna pop up a notification for mobile. For
> web ... maybe not."* · *"What to do next is okay. I like it. Write to support model is
> good. I like it. Promote one tap acts. That's a big one."*

**What he valued:** a real help centre of the kind Anthropic and the fintech companies
publish, guides for working with the assistant, one email address in plain sight, an
alert when mail access is missing, the next-act line, the write-to-support panel, and the
one-tap acts given a place.

**Decision:** direction A, built to that bar.

**Owed:** the guide collection (using the assistant, moving between tasks, configuring
tasks and goals, a general overview); email contact only (`support@mudavym.com`), no
Slack; a standing alert when the house's mail grant is absent or revoked, pushed on
mobile, decided later for web; keep "what to do next", the write-to-support panel, and
promote the one-tap acts.

### 112 — vendor prices · A's ladder with C's graph and paper trail

> *"this has to be the most technical area. So look for financial companies who have
> managed to do anything ... this is gonna be a quant type of thing. Even though we're not
> gonna show all of the features and the parameters we're using, we want to make sure that
> everything is basically very well built and very organized and tidy looking so that
> people can understand what they're looking at."*
> *"[B] the desk is not looking bad ... but it might be hard to find what you need, just
> scrolling would take a lot of muscle power."*
> *"[C] I like the graph, graph is really good ... when pick the bottle ... keep this, this
> is great work."* · *"Whenever we choose a wine and look for the details, but if you click
> on it a couple times or ... look at full chart, etc., then we open this up. So do not add
> this to the cache."* · *"all of the invoices we receive, that's perfect as well. And also
> where we got it from. Let's say if we find from WhatsApp or whoever we communicated with,
> I want to see that in the report as well."* · *"I also like the ladder look since I can
> see everything. ... I also like the comparison between our house and the public pages."*

**What he valued:** the ladder's completeness at a glance, C's chart, C's document trail,
the provenance of every price including the conversation it came from, and the house's own
prices set against the public register. He was cool on B for the hunting it costs.

**Decision:** direction A is the spine; C's chart and paper trail are grafted, the detail
opening on demand (opened after real interest, not pre-fetched or cached ahead), and the
house-versus-public comparison stays.

**Owed:** the price register drawn at the standard of a financial instrument — every
figure tidy, named and openable, with the machinery behind it unexposed; each price
carries its source document and, where it came from a conversation (WhatsApp, mail), the
message and the person; the ladder never hides a rung the house has.

### 113 — promotions · B, with C's density and bundles

> *"113B just looks like a great promotions page. I would like to see that if I were the
> user and I like ... as long as the bigger the sale, the bigger the box. I like this kind
> of approach and I would definitely pick this one. However, ... I'm only able to see three
> of them. If I can see more than 10, just like in 113C ... everything is just put down
> next to each other, I'm able to see everything. And maybe I can just do bundles there."*
> *"I like the overlays of the 113C. And also the 113B, the overlays of it ... the ordering
> is also good."* · *"For 113A, since this is going to be live data, dynamic data, maybe we
> should do something else, but think about it."* · *"hold to trust is great."*

**What he valued:** worth expressed as size, seeing ten or more offers at once, bundles as
a first-class thing, both overlay treatments, the ordering, and the hold-to-trust
ceremony.

**Decision:** direction B, with C's density so more than ten offers read at once, and
bundles added as their own shape. Hold-to-trust stays.

**Owed:** decide and draw how a bundle is graded and shown (his open question, *"if
bundles, how should we react? Maybe add another part for it"*); reconsider A's register
under live data before any of it is reused.

## Consequences

- Eight pages now have a locked direction, which unblocks their builds: shell, receiving,
  recommendations, settings, cellar, help, vendor prices, promotions.
- Three drawings are owed before their builds can start: the wine detail surface (110.4),
  the bundle shape (113), and — if it wins — sketch 119's shell.
- Two of his notes are deliberately not built now: the non-alcoholic heat map (110.8) and
  A's register under live data (113).
- The cellar, help, vendor-price and promotions builds each carry items that came from
  this review and from nowhere else; a build that ships without them has not met the
  review.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | Aldemir (founder), in session | Locked — the gallery review, dictated page by page |
