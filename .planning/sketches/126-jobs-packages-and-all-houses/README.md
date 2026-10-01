---
sketch: 126
name: jobs-packages-and-all-houses
question: "What do the founder's 2026-10-01 answers look like on screen: the Jobs section on Team, the give sheet, managers' access packages, and the all-houses currency popover?"
winner: null
tags: [people, jobs, rights, give-sheet, packages, managers, all-houses, currency, ecb-rate, from-n-of-m, sketch-only, adr-0252, adr-0253, adr-0175]
---

# Sketch 126 · Jobs, packages and all houses

**Why this exists.** Sketch 125 drew the directions; the founder then answered ADR 0253 rounds 2, 5–8
and ADR 0252 rounds 2–6 on 2026-10-01. These four screens draw those answers before any code. They
pick no new direction: each frame draws what is already decided, and each page ends with what the
answers still leave open.

Open `index.html`. Each page is one self-contained file: inline CSS, Google Fonts only (Fraunces, DM
Sans, JetBrains Mono, falling back to Georgia and system faces), no images, no scripts but the render
beacon. The look and the cast (Sim Bistro, Ayla, Mert, Deniz, Jonah, Empire Merchants, the houses) come
from sketch 125; a few names are new. All data is example data. The generator is in the session
scratchpad and is not committed; the HTML is the record.

Every page folds to one column at ≤780px with a 16px gutter. Checked at 375px on 2026-10-01: no
element past the viewport on any of the five pages, and every layout grid single-track (the only
two-track grids left are avatar + name in a list, and one label + figure pair).

## The frames

| File | Frame | What it draws | From |
|---|---|---|---|
| `team-jobs.html` | 1 · Team → Jobs | Four rows (Receive deliveries, Count stock, Place orders, Set up zones); people as chips; "You and Ayla, by role"; + Add; Deniz's chip "via job" with why; Mert's chip opened to **Take back**; "Jobs you gave" with Open, Late, Asked and Done | ADR 0253 round 7, *"Listed means allowed (Recommended)"*; round 2 (closed until given; late is a notice) |
| | 2 · Take back | The confirm dialog drawn open: today's delivery stays Mert's; **Take back**, **Take back and end his job today**, Cancel; Mert is told and the log records it | ADR 0253 round 7 (a job carries its own right until it ends); wording from the research §6.1 |
| `give-sheet.html` | 1 · Choosing who | The person list open: **Does this** (on the row, or by role) and **Everyone else**, each name with its reason; Away dimmed but pickable; no account / invite not accepted shown, not pickable | ADR 0253 round 7 |
| | 2 · Someone not on the row | **For this job** and **From now on** as two buttons, neither chosen; each says in plain words what Deniz will be able to do and when it ends | ADR 0253 round 7; round 2's *"make it select, permanent and for this"* |
| | 3 · Someone on the row | One button, **Give to Mert** | ADR 0253 round 7 |
| | 4 · A manager giving | Ayla's work list: four kinds open; **Approve orders** and **Send orders to vendors** greyed, *"Your owner hasn't allowed this"* | ADR 0253 round 6 (ADR 0175 D10 as amended); round 8 (Standard gives no money) |
| `manager-packages.html` | 1 · Packages and managers | **Full / Standard / Light** cards with what each opens and doesn't; Ayla **"Standard, adjusted"** with the two differences listed; Burak Full; Can Light by default | ADR 0253 round 8, *"Yes, as drawn"* and *"Yes, shown as adjusted"*; ADR 0252 round 4 (pay access shows profit) |
| | 2 · A package changes later | A changed Light: Can is on the old one; **Give Can the new Light** or **Keep Can as he is**. The change itself is invented to show the flow | ADR 0253 round 8, *"No, you're asked"* |
| `all-houses-currency.html` | 1 · All houses, popover open | One total, **sales first** (₺416,758), goods and hours beside it, "profit comes later"; the **₺** sign opened: lira / dollar, **your rate** winning over **"ECB rate, 1 Oct 2026"**; houses as parts; **from 2 of 3** with Palo Alto **not read**; YARDOM **not set up**, outside the 3 | ADR 0252 round 2 (popover, no combined line, from N of M), round 4 (houses you own today, whole houses), round 6 (ECB daily, dated; each day at its own rate; a typed rate wins) |
| | 2 · No typed rate | The same popover with the ECB rate used, and the converted house line carrying "ECB rate, 1 Oct 2026" | ADR 0252 round 6 |

## Drawn as proposed, not yet confirmed

ADR 0253 round 7 lists these research proposals as "still to confirm". Where a frame touches one, it
is drawn as the research proposes and said so on the page:

- **Place orders stays open** until order approval is fixed (Team → Jobs shows the row with that note).
- **Receive is the door count only** (the give sheet says "count in and sign for" and says nothing about prices).
- **A job may name a backup** (not drawn).

## Open — noticed while drawing, not decided here

Each is also listed at the foot of its page.

**Team → Jobs**
1. "Take back and end his job" leaves a delivery with no one on it: is the giver asked to pick someone, or does it go unassigned?
2. Does an owner's "Jobs you gave" also show the jobs a manager gave?

**Give sheet**
3. Where a greyed money line leads: plain text (drawn), or a way to ask the owner.
4. How much a manager with the owner's allowance may give. Round 6 says it is "designed with the packages"; round 8 confirmed the packages but names no amount.

**Packages**
5. Which money actions Full may give. Round 6 says "for named actions"; none are named. Drawn as approving orders and sending to vendors.
6. One package per person, or one per house, for a manager of two houses.
7. Who may set a manager's package: the owner (drawn), or also a manager who promotes someone (ADR 0162).
8. Who may change a package's contents: each owner, or only Mudavym.
9. When a package changes, does an adjusted manager keep their adjustments on the new version?
10. A Standard manager given pay sees that house's profit (ADR 0252 round 4). Does that profit also show in their All houses, which Standard opens without profit?
11. May a Light manager still place orders by role, given Light doesn't give order work?

**All houses · currency**
12. Today's figures before the ECB publishes the day's rate (in the afternoon, Central European time): yesterday's rate, or none yet. Drawn after publication.
13. Dollar to lira is two ECB rates through the euro. Does the label still read just "ECB rate, <date>"?
14. How long a typed rate lasts: until a newer one, until removed, or that day only.
15. Who may type a rate, and for which houses (round 3 lets managers change currency, with notice).
16. Whether the chosen currency is remembered next time.
17. Profit on the total when only some houses have profit: "from 1 of 2", or wait for all. Drawn with no profit figure.
18. A not-read house: show nothing (drawn), or its last good figure marked with its time.

## Research and checks

No new research. The frames rest on ADR 0252 and ADR 0253 as they stand on `fix/closed-stays-closed`,
and on `p4-scratch/takeover/houses-scratch/research-jobs-labels.md` §6 and §8. Render was proved by the
page beacon in Safari (no images on any page, so the beacon proves load only). Layout was checked in the
Browser pane at 1280px and 375px.
