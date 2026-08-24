---
type: agenda-full
division: commercial
department: media-brand
team: narrative-collateral
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[narrative-collateral-charter]]"
  - "[[narrative-collateral-premortem]]"
  - "[[narrative-collateral-agenda-board]]"
  - "[[YC_WEDGE_PLAN]]"
---

# Narrative & Collateral (M2) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Two artifacts, in this order:

1. **The company story.** A narrative — how a restaurant loses money it never sees, why
   nobody catches it, and what changes when someone does. Not a feature list. The founder
   asked for this shape explicitly and the shape is the requirement.
2. **A simple internal reference deck.** For us. Marked internal on every page. Allowed to
   be honest about what is not yet verified.

Everything else — the external deck, the demo script, the case study — descends from these
two and is not started until they exist.

## How

### Structure before styling

The order of the argument is the deliverable. It can be written today, with no visual
reference, because it is made of claims rather than of design.

```
1  The loss        a restaurant is overbilled and never catches it
2  Why not caught  the invoice and the delivery are compared by a human, at the door,
                   at 6am, line by line
3  The catch       photograph the invoice; the discrepancy appears with a dollar figure
4  The proof       dollars recovered — verified, one number, source-lined
5  The ask         one thing, named
—— everything else lives here, in one line each, after the ask ——
6  "and it also does"  sommelier, calendar, promotions, insights, wine library
```

**Step 6 is the whole discipline.** [YC_WEDGE_PLAN.md:323](../../../../YC_WEDGE_PLAN.md)
names surface area as this repo's biggest risk, and every item in step 6 is real, good, and
expensive work that will want to move up the page. The rule is that it may not.

### The demo is already specified

[YC_WEDGE_PLAN.md](../../../../YC_WEDGE_PLAN.md) §3: photograph a real invoice with a real
error → the discrepancy appears with a dollar figure → one tap drafts the vendor email.
Sixty seconds, no dashboard tour. M2's job here is a script and a recording, not a new idea.

**It has a prerequisite this team does not control.** The headline check currently cannot
fire end to end because the invoice half is typed by hand per line item
(`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:401,440`), and the design
partner connection is unmade (`DEP-06` unchecked,
[PROJECT.md:101](../../../../../PROJECT.md)). Until then any recording is a demo of a demo,
and it must be labelled as one.

### The internal deck

Short. Marked. Honest. Its job is to let the founder and any future collaborator hold the
same picture — what we claim, what we can prove, what we cannot prove yet. It is the only
artifact allowed to say "we asked, not received" without a fact-check, because it never
leaves.

## Why now

Because the argument already exists in prose and has been peer-reviewed, and the gap between
"a good argument in a planning document" and "something you can hand someone" is the entire
remaining distance. Because the internal deck costs little and prevents the founder holding
five slightly different versions of the pitch. And because the *ordering* discipline is
cheapest to establish before there are artifacts to reorganise.

Not because there is a deadline. There is no funding round, no announcement, and one
customer. Producing an external deck ahead of a verified recovery number would be
premortem mechanism 3, on schedule.

## Next steps

1. **Ask the founder for the ElevenLabs deck** — export or screenshots into the repo. This
   is the single blocked input and it blocks styling only.
2. Draft the story to the six-step structure above. No visuals.
3. Build the internal reference deck. Mark every page.
4. Freeze the sentence: [YC_WEDGE_PLAN.md:312](../../../../YC_WEDGE_PLAN.md), verbatim, as
   the headline for every artifact until a founder decision changes it.
5. Write the demo script. Do not record until `DEP-06` is checked, or label the recording as
   a demo build.
6. Case study: **blocked** until S1 has one verified credit memo.
7. External deck: only after 2, 4, and 6.

## Questions for the founder

1. **The ElevenLabs pitch deck.** It is in your Instagram saves and nothing in this org can
   reach it — Claude cannot fetch content behind a personal authenticated account, and
   should not try. Please export it or screenshot it into the repo. What specifically do you
   want taken from it: the visual system, the slide order, the density, or the tone?
2. **The sentence.** [YC_WEDGE_PLAN.md:312](../../../../YC_WEDGE_PLAN.md) reads:
   *"Restaurants get overbilled by their distributors and never catch it. We catch it from a
   photo of the invoice."* Frozen as-is, or reworked before it becomes the headline
   everywhere?
3. **The ask.** Step 5 of the structure needs one named ask, and it differs by room —
   investor, customer, partner. Which room is the first deck for?
4. **The internal deck's audience.** Just you, or you plus a future collaborator? That
   changes how much context it has to carry.
5. **Case-study timing.** Wait for a verified credit memo, or publish a
   process case study now that is explicit about being pre-verification?
