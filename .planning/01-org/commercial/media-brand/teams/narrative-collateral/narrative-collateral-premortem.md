---
type: premortem
division: commercial
department: media-brand
team: narrative-collateral
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[narrative-collateral-charter]]"
  - "[[media-brand-premortem]]"
  - "[[YC_WEDGE_PLAN]]"
---

# Narrative & Collateral (M2) — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this unit has failed. What happened?

Five mechanisms, most likely first.

---

### 1. The deck listed everything the repo contains

Because it all exists, and all of it was expensive to build. The sommelier AI, the calendar,
promotions, 573 insight types, an 860-path UX catalogue, a UX optimizer, a wine library.
Every one of those is real work and every one of them is a reasonable slide. The reader
finished the deck and concluded there is no wedge — which is exactly the failure
[YC_WEDGE_PLAN.md:323](../../../../YC_WEDGE_PLAN.md) predicted in writing before this team
existed.

Nothing needed deleting from the product. One thing had to be the headline, and nobody was
willing to demote the rest.

**Earliest observable signal.** Slide three is a feature grid. Or, subtler and earlier: the
first draft's outline has more than one "and it also does" branch before the ask.

**What would have prevented it.** The one-sentence test, applied per artifact before it
leaves, as a binary. And a stated demotion rule written down in advance: everything that is
not the headline is *"and it also does X"*, in one line, after the ask — never before it.

---

### 2. The internal reference deck became the external deck

Someone needed something to send on short notice, the internal deck was the only deck, and
it went out. The internal deck was honest in the way internal documents are allowed to be:
it said "we asked" where the external one would have needed a verified credit memo. It also
contained the roadmap, the open questions, and a frank paragraph about the design partner
being a friend. All of that was correct internally and none of it was safe externally.

**Earliest observable signal.** The internal deck is attached to an outbound email, or its
file is shared outside. Earlier still: the internal deck has no "INTERNAL" marking on every
page, so nothing about it resists being forwarded.

**What would have prevented it.** Two named artifacts with two different gates, stated in
[[narrative-collateral-charter]], and a marking on every page of the internal one. The
external artifact is the only one that routes through G3, and the only one that exists in a
sendable format.

---

### 3. The narrative claimed verified recovery before Sales had one

The deck said "$X recovered". The truth, at the time, was that $X had been *requested*.
[YC_WEDGE_PLAN.md:31-33](../../../../YC_WEDGE_PLAN.md) had already established the
distinction in this repo's own analysis: until an 812 credit memo lands on a later invoice,
"dollars recovered" means "we asked." A reader asked how the number was verified, there was
no answer, and every other claim in the deck became suspect at the same moment.

**Earliest observable signal.** Any dollar figure on an artifact without a source line
pointing at a specific credit memo. And a structural early warning: the design partner
connection is still unmade — `DEP-06` is unchecked at
[PROJECT.md:101](../../../../../PROJECT.md) — so any number produced before that is
necessarily from a demo.

**What would have prevented it.** The gate in [[narrative-collateral-charter]]: every number
carries a source line, and G3's fact-check is mandatory on anything outward. The number
itself is [[design-partner-operations-charter|S1]]'s to produce, not M2's to estimate.

---

### 4. The blocked visual reference was worked around instead of waited for

The ElevenLabs deck reference never arrived — it lives in the founder's personal Instagram
saves and nothing in this org can reach it. Two weeks passed, a deadline appeared, and the
deck was built to a guessed aesthetic. When the reference finally surfaced it looked nothing
like the guess, the deck was rebuilt from scratch, and the second build inherited the first
one's structure because rebuilding the argument as well felt like starting over.

**Earliest observable signal.** Visual production starting while the reference is still
listed as blocked. Which is visible: it is a checkbox on
[[narrative-collateral-agenda-board]].

**What would have prevented it.** Structure first, styling second — the order of the
argument is reference-independent and can be finished while the reference is missing. And
one direct ask to the founder rather than a standing hope: export it, or screenshot it, into
the repo.

---

### 5. The story was written once and then never moved

The narrative was good on the day it was written and was still the same document a year
later, while the wedge sharpened underneath it. The company learned which half of the
invoice problem actually converts, and the deck kept arguing the original half — because
rewriting a finished artifact feels like undoing work, and because nothing scheduled ever
asked whether it was still true.

**Earliest observable signal.** The story document's `updated:` field is older than the most
recent change to [YC_WEDGE_PLAN.md](../../../../YC_WEDGE_PLAN.md) or to S1's recovery
evidence.

**What would have prevented it.** The headline-claim loop closes monthly and takes
`inputs_from` Strategy & Fundraising and Sales, so a change in the underlying argument
arrives as an input rather than as someone's recollection. And the sentence is allowed to
change — it is a founder decision, taken deliberately, rather than a thing that quietly
cannot be revisited.
