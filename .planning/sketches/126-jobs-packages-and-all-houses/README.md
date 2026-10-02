---
sketch: 126
name: jobs-packages-and-all-houses
question: "What do the founder's 2026-10-01 and 2026-10-02 answers look like on screen: the Jobs section on Team, the give sheet, managers' access packages, and the all-houses currency popover?"
winner: null
tags: [people, jobs, rights, give-sheet, packages, managers, all-houses, currency, ecb-rate, from-n-of-m, sketch-only, adr-0252, adr-0253, adr-0175]
---

# Sketch 126 · Jobs, packages and all houses

**Why this exists.** Sketch 125 drew the directions; the founder then answered ADR 0253 rounds 2, 5–8
and 11 and ADR 0252 rounds 2–6 on 2026-10-01, then four money-right readings ("round 12") and four
more money and people answers ("round 13") on 2026-10-02.
These four screens draw those answers before any code. They pick no new direction: each page lists what
is decided, marks research proposals he has not confirmed as **proposed**, and ends with what the
answers still leave open.

**Where the sources are.** ADRs 0252 and 0253 and OD-208 to OD-217 are on PR #566 (open), not on
`main`; this sketch was checked against its head `475ac5cd8`, which records rounds 12 and 13 in ADR
0253 ("Answered 2026-10-02 (round 12)" and "Answered 2026-10-02 (round 13), verbatim"). Round 12's
picks, verbatim: *"Yes, per action (Recommended)"*, *"Owner sets the cap (Recommended)"* (OD-209), *"No amount of its own (Recommended)"* (OD-210 path B)
and *"As F3 said (Recommended)"* (OD-217 path A). Round 13 is cited as ADR 0253 round 13, on PR #566.
Its picks, all recommended, verbatim: *"When the job closes (Recommended)"* (OD-211), *"Fix holes
first, then close (Recommended)"* (OD-213), *"Full pre-ticks, you adjust (Recommended)"* and *"One
right, amount in approvals (Recommended)"* (narrows OD-208 to one order right). The rest of OD-208,
and OD-212, OD-214, OD-215 and OD-216, stay open.

Open `index.html`. Each page is one self-contained file: inline CSS, Google Fonts only (Fraunces, DM
Sans, JetBrains Mono, falling back to Georgia and system faces), no images, no scripts but the render
beacon. The look and the cast (Sim Bistro, Ayla, Mert, Deniz, Jonah, Empire Merchants, the houses) come
from sketch 125; a few names are new. The people are invented. The house names stand in: every
figure and state drawn for them is invented. The generator was outside the repo and is not
committed; the HTML is the record.

Every page folds to one column at ≤780px with a 16px gutter. Checked at 375px on 2026-10-01: no
element past the viewport on any of the five pages, and every layout grid single-track (the only
two-track grids left are avatar + name in a list, and one label + figure pair). Re-checked after each
round of 2026-10-02 wording fixes, round 13 included, in headless Chromium from `file://`, with every non-file request blocked, at
390px and 1280px: page scroll width equals the viewport and no element sits past it, on all five pages.

## The frames

| File | Frame | What it draws | From |
|---|---|---|---|
| `team-jobs.html` | 1 · Team → Jobs | Four rows (Receive deliveries, Count stock, Place orders, Set up zones; proposed, OD-208); people as chips; "You and Ayla, by role"; + Add; Deniz's chip "via job" with why; Mert's chip opened to **Take back**; "Jobs you gave" with Open, Late, Asked and Done | ADR 0253 round 7, *"Listed means allowed (Recommended)"*; round 2 (closed until given; late is a notice); round 13 (Place orders closed until given from the first day, OD-213; one right, its amount in the approval rule; a "for this job" right ends when the job closes, OD-211) |
| | 2 · Take back | Drawn as proposed. The confirm dialog open: today's delivery stays Mert's; **Take back**, **Take back and end his job today**, Cancel; Mert is told and the log records it | The jobs-and-labels research (a job keeps its right until it closes). Round 13 settles when a "for this job" right ends; Mert's job was given while he was listed, a case it did not ask |
| `give-sheet.html` | 1 · Choosing who | The person list open: **Does this** (on the row, or by role) and **Everyone else** (proposed), each name with its reason; Away dimmed but pickable; no account / invite not accepted shown, not pickable | ADR 0253 round 2's dropdown, read so (research owed); groups from the research |
| | 2 · Someone not on the row | **For this job** and **From now on** as two buttons, neither chosen (proposed); each says in plain words what Deniz will be able to do and when it ends; the delivery it covers (OD-212, OD-214) and who takes From now on back are proposed | ADR 0253 round 7's option text; round 2's *"make it select, permanent and for this"*; round 13 (when For this job ends, OD-211) |
| | 3 · Someone on the row | One button, **Give to Mert** | ADR 0253 round 7 |
| | 4 · A manager giving | Ayla, on Full, at Sim Bistro: four kinds of work open, Place orders as one right with each person's amount in the approval rule (up to her $750 cap); **Send to vendors** greyed, *"Your owner unticked this for you"* | ADR 0253 round 6, confirmed per action in round 12; round 12 (owner sets the cap; F3's view); round 13 (Full pre-ticks, the owner unticks; one order right) |
| `manager-packages.html` | 1 · Packages and managers | **Full / Standard / Light** cards with what each opens and doesn't, each turning on the house's money; Ayla **"Full, adjusted"**, Send to vendors unticked (as sketch 125 draws her, on Full); Burak Standard; Can Light by default | ADR 0253 round 8, *"Yes, as drawn"* and *"Yes, shown as adjusted"*; round 11 F2, F4, F9 and F14 (profit needs money and pay); round 12 (per action, owner sets the cap); round 13 (Full pre-ticks each money and sending action, the owner unticks) |
| | 2 · A package changes later | A changed Light: Can is on the old one; **Give Can the new Light** or **Keep Can as he is**. The change itself is invented to show the flow | ADR 0253 round 8, *"No, you're asked"* |
| `all-houses-currency.html` | 1 · All houses, popover open | One total, **sales first** (₺416,758), goods and hours beside it, "profit comes later"; the **₺** sign opened: lira / dollar, **your rate** winning over **"ECB rates, 1 Oct 2026"**; houses as parts; **from 2 of 3** with Palo Alto **not read**; YARDOM **not set up**, outside the 3 | ADR 0252 round 2 (popover, no combined line, from N of M), round 4 (houses you own today, whole houses), round 6 (ECB daily, dated; each day at its own rate; a typed rate wins) |
| | 2 · No typed rate | The same popover with the ECB rate used, and the converted house line carrying "ECB rates, 1 Oct 2026", the round-6 option's label | ADR 0252 round 6 |

## Drawn as proposed, not yet confirmed

These are the jobs-and-labels research's proposals (outside the repo, so not re-checkable from it)
or this sketch's own drawing, not his picks. ADR 0253 at #566's head says so of the research's in its
round-7 bracket and its "still to confirm" line, and files them among OD-208 to OD-216. Team → Jobs
and the give sheet list them under "Drawn as proposed" and tag them in the frame:

- **The four Jobs rows** (Receive deliveries, Count stock, Place orders, Set up zones): the rights list is open (OD-208), except that Place orders is one right (round 13).
- **The dropdown's two groups**, "Does this" and "Everyone else", and **neither button preselected**: the research's, per the round-7 bracket.
- **A job given while listed keeps its right after Take back**: Mert's delivery stays his. Round 13 settled when a "for this job" right ends (OD-211), not this case.
- **A receive job is one vendor's delivery on one day** (OD-214): Deniz's "Sysco's delivery, today" and the give sheet's "Empire Merchants' delivery today".
- **Who may take a right back**: the give sheet's From now on says "until you or a manager take it back", and Team → Jobs draws the owner doing it. No OD covers it on its own; OD-216 asks who may move or cancel a job.
- **Take back's dialog**, "via job", and "Jobs you gave" with its Asked state: the research's wording.
- **Receive is the door count only** (OD-212; the give sheet says "count in and sign for" and says nothing about prices).
- **A job may name a backup** (OD-215; not drawn).

## Open — noticed while drawing, not decided here

Each is also listed at the foot of its page.

**Team → Jobs**
1. "Take back and end his job" leaves a delivery with no one on it: is the giver asked to pick someone, or does it go unassigned?
2. Does an owner's "Jobs you gave" also show the jobs a manager gave?
3. A job given while on the row: does it keep its right after the row is taken back (drawn so, as the research proposes)? Round 13 answered when a "for this job" right ends, not this.

**Give sheet**
4. Where a greyed line leads: plain text (drawn), or a way to ask the owner.
5. Where a manager sets an order amount: on the give sheet, or in the approval rule's own screen. Drawn in words only, with no field. (This replaces "Place orders, twice", which round 13 answered: one right, its amount in approvals.)

**Packages**
6. Which money actions there are. Round 12 named two, placing orders up to an amount and sending to vendors, each allowed separately; round 13 made the first one Place orders with each person's amount in the approval rule. Whether there are more is OD-208.
7. One package per person, or one per house, for a manager of two houses; and whether an untick can differ by house.
8. Who may set a manager's package: the owner (drawn), or also a manager who promotes someone (ADR 0162).
9. Who may change a package's contents: each owner, or only Mudavym.
10. When a package changes, does an adjusted manager keep their adjustments on the new version?
11. A Standard manager given pay, who also sees the house's money, sees that house's profit (F14). Does that profit also show in their All houses, which Standard opens without profit?
12. May a Light manager still place orders by role, given Light doesn't give order work?

**All houses · currency**
13. Today's figures before the ECB publishes the day's rate (in the afternoon, Central European time): yesterday's rate, or none yet. Drawn after publication.
14. Dollar to lira is two ECB rates through the euro. Round 6's label already reads `"ECB rates, <dates>"`; does the popover also show the two rates it combined?
15. How long a typed rate lasts: until a newer one, until removed, or that day only.
16. Who may type a rate, and for which houses (round 3 lets managers change currency, with notice).
17. Whether the chosen currency is remembered next time.
18. Profit on the total when only some houses have profit: "from 1 of 2", or wait for all. Drawn with no profit figure.
19. A not-read house: show nothing (drawn), or its last good figure marked with its time.

## Research and checks

No new research. The frames rest on ADR 0252 and ADR 0253 at PR #566's head `475ac5cd8` (open),
rounds 12 and 13 included, and on the jobs-and-labels research that ADR 0253 cites (outside the
repo, so not re-checkable from it). Render was proved by the page beacon in Safari on 2026-10-01 (no images
on any page, so the beacon proves load only).
