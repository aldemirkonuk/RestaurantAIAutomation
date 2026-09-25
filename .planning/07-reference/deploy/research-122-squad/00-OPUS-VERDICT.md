# 00 · Opus verdict — get-started after sketch 122

**Date:** 2026-09-22 (~20:10 ET) · **Role:** final synthesis over papers 01–04 in this folder.
**Measured against:** `origin/main` = `cc73f9f66`. **Status:** **locked 2026-09-22** —
founder approved all 17 Opus recs as A. Record: [ADR 0213](../../../decisions/0213-get-started-is-account-then-house-then-first-proof.md).
Build started on `feat/arrival-first-proof`. #414 / #454 remain unmerged. `mudavym_design_arrival` is not flipped.

**Founder brief (2026-09-22, post-122):** keep the drop-menu openness of the arrival frame, but
simpler and more elegant overall. Flow: *Welcome {name}, let's create your restaurant* →
personal info (location advice, Gmail, name, phone, + whatever else matters) → restaurant
address → *Skip for now* → drop menu → after extraction, show the **digitized menu** in a
Mudavym-formatted presentation, categorized (beer / wine / whiskey / soft / spirits…), not
necessarily a modal. Later: maybe the last invoice. Likes 122's reading + frame 3 look and
121's look. **Dislikes `certain` / `likely`** — wants copy that admits a double-check is needed.

---

## 1. Adversarial pass on the four papers

### 01 · Onboarding flows — mostly sound; two holes
- **Holds:** "house before upload" (Square, Owner.com, Linear, Notion) and "ask only what
  changes the next screen / what the capability needs" (Stripe `currently_due`). This is the
  strongest evidence for the founder's new order.
- **Weak:** every flow is read from help docs or third-party recordings (pageflows), no live
  signup — self-disclosed. Square's help order (ID + bank before menu) is irrelevant to us: it
  is tied to money movement, which Mudavym does not do.
- **Hole:** "Gmail — offer after house exists" is right but misses the real cost. The repo
  already has a Gmail *reading* path (`GMAIL_READ_SCOPE = gmail.readonly`,
  `communications/inbox/house-inbox-flag.ts:33-34`, per-house flag `enable_house_inbox_read`
  default `false`). `gmail.readonly` is a Google **restricted** scope — offering it to every new
  signup depends on Google's verification/security-assessment status, which nobody checked. So
  "Gmail" in onboarding can only honestly mean **Google sign-in** today, not inbox reading.

### 02 · Menu-reveal UX — right surface, wrong object
- **Holds:** modal and bottom sheet are wrong homes for a long review (NN/g); progressive settle
  is a companion, not a surface; checkbox confirmation is the rubber-stamp pattern.
- **Challenge 1 — it contradicts the founder.** The paper (and 121/122 frame 3) reframes the
  reveal as *registers* ("what the house pours") and argues against showing items. The founder
  asked to **see the digitized menu itself**, categorized. A register readout is one level
  above what he asked for. The verdict below shows the items, grouped — which satisfies both.
- **Challenge 2 — "needs `placed`/`not placed` API" is overstated.** The extractor already emits
  a per-line category from a fixed vocabulary — `red, white, rose, sparkling, orange, dessert,
  fortified, beer, cider, sake, cocktail, spirit, whiskey, soft drink…`
  (`menus/wine-extract-item.interface.ts:20+`), pinned to the SQL classifier by
  `a-beer-line-classifies-as-beer.spec.ts`. Per-line grouping may be nearly free; what is
  missing is a per-line *"worth a second look"* signal (§8 R1).

### 03 · Soft-confidence copy — best research, weakest pick
- **Holds:** outcome first, bounded count, local doubt, reason beside the mark, no percentages,
  no "verified", no "AI may be inaccurate" disclaimers, no "just/only".
- **Challenge 1:** "Read clearly" still asserts, and it asserts the wrong thing. `certain` in
  `cellar-registers.ts:422-433` means *the database classifier said so*, not *the OCR was
  crisp*. Copy about reading quality over a classification signal will be wrong the first time a
  crisp line is misclassified.
- **Challenge 2:** "Quick look" violates the paper's own minimizer rule when 17 of 42 lines need it.
- **Challenge 3:** it maps 2 of the 4 states. The enum is `certain | likely | none | unknown`
  (`cellar-registers.ts:38`) and `unknown` must never read as absent (`:31-37`). A copy system
  that drops `none`/`unknown` will reintroduce exactly the bug that comment guards.
- **Challenge 4:** it is purely verbal. The founder liked frame 3's *look*; a visual mark carries
  softness with fewer words (§4).

### 04 · Fields & skip — strongest code evidence; one framing error
- **Verified (spot-check on `cc73f9f66`):** address is required at `/register`
  (`Register.tsx:1450` submit guard), timezone is auto-sent (`:1056`), phone is optional and is
  the **restaurant's** phone (`:1403`), Google sign-in is not on `/register`, and verify-email
  sends straight to `/get-started` unless a menu exists (`VerifyEmail.tsx:43-45`). The paper's
  line numbers are stale (measured on `feat/p1-readout`); substance holds.
- **Challenge:** it reads the brief as "make the address skippable" and rates that gap High. The
  brief places *Skip for now* between address and menu; the more natural reading is the menu's
  escape. Address is also load-bearing: vendor matching takes it
  (`match_restaurant_providers(p_address…)`, migration `20260811020000`), and it seeds timezone
  and currency. Skipping it degrades the product silently. Flagged as a fork (§8 F2), not assumed.
- **Challenge:** "Gmail not in early onboarding — High" is overstated for the restricted-scope
  reason above.

**Gap:** no paper checked what the extractor does with **food** lines on a mixed menu, or whether
it returns anything per line that could drive a "second look" mark. Both go to §8, not guessed.
No extra agent was spawned — these are cheap code reads for the next session, not research holes.

---

## 2. Recommended step sequence (exact)

Four screens before the reveal, one question-group each. Same 56px app bar + 24px mark
throughout (122); white ground default, charcoal on toggle.

| # | Screen | Asks | Primary | Secondary |
|---|---|---|---|---|
| 0 | **`/register` — account only** | Name, email, password — **or** *Continue with Google* | Create account | — |
| — | Verify email | nothing | — | — |
| 1 | **You** — headline *"Welcome, {first name}. Let's set up your restaurant."* | Name (prefilled), mobile phone, role | Continue | — |
| 2 | **Your restaurant** | *Find your restaurant* (Places search, optional *Use my location* bias) → confirm card with name, address, restaurant phone; country → currency + timezone derived and shown | This is us | *Enter it by hand* |
| 3 | **Your menu** | the 122 drop well; photo / file / typed lines as three ruled lines (121) | Read my menu | *Skip for now — open the house* (quiet, under a rule) |
| 4 | **Reading** | nothing — 122 frame 02, facts settle once, no loop, no % | — | — |
| 5 | **The first proof** (§4) | only pencilled lines ask anything | Check the 17 pencilled lines | Open the house |
| 6 | **The house** | 121/122 contents page; exactly one line asks (vendors, currency, alerts…) | — | — |

Why this order: it is the founder's order, and it is the Square / Owner.com / Linear shape
(paper 01) — the house exists before the upload, so the reveal lands *in* a named place.
The welcome is the headline of screen 1, not its own screen (one fewer click, same warmth).
The threshold step and the OptionalTail dump (`ThresholdStep.tsx`, `OptionalTail.tsx`) leave
onboarding and become contents lines on the house page.

**Cost the founder must see:** screen 0 shrinking to account-only means the restaurant is no
longer created at `/register` (`register-restaurant.dto.ts` today creates it with the address).
That is a backend change to tenant creation, not a copy change → fork F1.

---

## 3. Field list

| Field | Tier | Where | Why |
|---|---|---|---|
| Full name | **Must** | 0 (or from Google) | Welcome line, audit trail |
| Email | **Must** | 0 | Auth, recovery, digests |
| Password *or* Google sign-in | **Must** | 0 | Auth — Google is the honest meaning of "Gmail" today |
| Restaurant name | **Must** | 2 (prefilled by Places) | The house |
| Restaurant address (+ country) | **Must** | 2 | Vendor matching, currency, timezone |
| Timezone, currency | **Must, never asked** | derived at 2, shown, editable | Alert windows, ₺/€ on every price |
| Mobile phone (owner) | **Optional, recommended** | 1 — label: *"Only for urgent stock alerts. Never marketing."* | Owners answer SMS; distinct from restaurant phone |
| Role (Owner / GM / Beverage lead / Chef) | **Optional** | 1, one tap | Changes the first contents line and who digests go to |
| Restaurant phone | Optional | 2 (from Places) | Vendor-facing |
| Number of locations | **Later** | house page, only if > 1 | Multi-unit is a later capability |
| Gmail inbox reading (invoices) | **Later** | house contents line, once scope verification is confirmed | Restricted scope (§1) |
| Vendors, POS, team invites, calendar | Later | house contents lines | Already deferred; keep |
| Last invoice | Later | second inscription on the house (same proof pattern, §4) | Founder's "maybe" |
| EIN / tax ID / bank / cuisine | **Not asked** | — | No capability needs them (paper 01) |

SMS consent needs its own line under the phone field in whatever jurisdiction the house is in
(KVKK / TCPA) — wording not researched here (§8 R5).

---

## 4. The reveal — "The first proof"

**The idea:** the menu comes back **typeset by Mudavym as the house's own drinks list** — a
printer's *first proof*. Sections in house order (*Wine* — red, white, rosé, sparkling… ·
*Beer & cider* · *Whiskey* · *Spirits* · *Cocktails* · *Soft drinks*), every line reset in
Mudavym type with name, producer/vintage, price. Where Mudavym would double-check, there is a
**pencil mark in the margin** with a one-line reason (*"Read as beer from the word 'IPA'"*).
Everything else is set in ink. It is a page at its own URL (`/house/menu`), not an overlay.

**Interaction**
1. Reading (screen 4) settles facts, then the proof *is* the page — no transition object.
2. Head of page: 122's three counts, reworded: **42 read · 25 set · 17 pencilled**.
3. Tapping a pencilled line **opens it in place** (inline expansion, not a modal or sheet): the
   crop of their original photo/PDF beside the reset line, and the section choices as one-tap
   chips — weak guess dashed and **never preselected**, no "select all" (122 frame 04 logic,
   moved inline). Choosing erases the pencil; ink settles; the count ticks.
4. *Show my original* toggles a desktop split view (paper 02 candidate B) for anyone who wants
   to audit the whole page. Off by default.
5. Sections with no lines are not printed as empty tabs. One footer line instead:
   *"Not on this menu: sake, cider. Pour any of these? Add it."* — `none` stays honest without
   cluttering the proof; `unknown` never appears here because a menu was read.
6. Non-drink lines (if the extractor returns them — §8 R2): one collapsed line,
   *"31 kitchen lines set aside — not Mudavym's job yet."* Counted, never silently dropped.
7. Failed read (122 frame 06): *"We couldn't read this file"* — never an empty proof.

**Why it beats a modal**
- **A proof admits checking by definition.** The honesty the founder wants is carried by the
  metaphor, so the copy never needs "AI may be wrong."
- **It persists.** A modal is dismissed and lost; the proof is the living menu page the house
  returns to. The founder's "Mudavym formatted presentation" becomes a real artifact.
- **Only exceptions are actionable** — the HITL "queue fields, not documents" rule (121 §4.2)
  with no approve-all button to rubber-stamp.
- **It is the item list *and* the meaning** — the founder sees his menu; the sections are the
  registers, so 121/122's register logic survives underneath.
- **It scales to the invoice.** "Invoice proof" is the same page shape for the future
  last-invoice inscription; a menu modal would not transfer.
- **It folds to a phone** as a plain scroll with inline expansion — the NN/g-safe pattern.

**Cost / risk:** needs a per-line pencil rule (§8 R1) and the source-crop per line (bounding
boxes may not exist — if not, show the page thumbnail scrolled to the section). If R1 finds no
usable per-line signal, the fallback is deterministic: pencil = extractor category missing, or
category not in the vocabulary, or classifier lands `unknown`.

---

## 5. Soft-confidence copy system (replaces `certain` / `likely`)

Visual first, words second. The internal enum does not change; only the UI.

| Service state | Mark | Line / section copy | Reason text |
|---|---|---|---|
| `certain` (classifier) | **Ink** — no label at all | the line is simply set | on hover/expand: the `basis` sentence, verbatim |
| `likely` (name only / menu only) | **Pencil** in the margin | *"Worth a second look"* | the reason, e.g. *"read from the word 'IPA'"* |
| no candidate section | **Open pencil ring** | *"Needs a place"* | *"We couldn't tell which section this belongs in."* |
| `none` | not printed | footer: *"Not on this menu: whiskey."* + *Add it* | — |
| `unknown` | not printed on the proof | house page only: *"Not read yet — nothing to go on."* | never "you don't carry it" |

**One support sentence** on the proof: *"Here's your menu, set by Mudavym. It's a first proof —
we've pencilled the lines worth a second look."*
**One marketing line** (landing / email): *"Mudavym sets your menu in minutes and pencils
anything worth a second look."*
**Banned in customer copy:** certain, likely, confidence, %, verified, accurate, 100%, "AI-powered
magic", failed/error for normal ambiguity, just/only, approve all.
Paper 03's system 1 is rejected (§1); its guardrail ("no soft label without a candidate") is kept
as the *Needs a place* row.

---

## 6. What to keep from 121 vs 122

| Keep from 122 | Keep from 121 |
|---|---|
| White ground default, charcoal on toggle (ADR 0169) | The book typography — ruled lines, not cards; the folio "look" the founder likes |
| 56px app bar, 24px A+M mark, house chip | Three ways in drawn as three ruled lines on the drop screen |
| Frame 02 reading — settle once, no loop, no % | Contents page as the guidance: exactly one line asks, in the seal |
| Frame 03's three counts, no checkboxes | Vendors skip-first, named as a recorded act |
| Frame 04's placement rules (dashed guess, no preselect) — moved **inline** | Motion tokens only: `turn`, `settle`, `ink`, `tally` |
| Frame 06 thin/failed honesty | Phone fold rules (§6 of 121) |

**Drop:** confidence chips (both sketches); 122's separate frame-04 page (now inline in the
proof); 122's Q2 three-way switch (replaced by §5's footer line — still the founder's call, F7);
121's flyleaf-before-house order (superseded by the founder's new order).

---

## 7. Decide now vs research further

**Decide now (founder)** — §8 F1–F7. **Research further before build** — §8 R1–R6.
Nothing here needs a new Workflow fan-out; R1/R2 are code reads, R3 is a console check.

## 8. Open forks and research items

Filed and resolved 2026-09-22 as OD-134–OD-139 and OD-141 (F1–F6 and F7). OD-123–129 were
already other forks on `main`; they were not reused. OD-140 is `#414`'s unpublished draft.

**Forks — the founder's call**
- **F1** Move restaurant creation out of `/register` (account-only signup) — *recommended*; costs a
  tenant-creation change. Alternative: keep `/register` as is and make screens 1–2 prefilled
  confirms (cheap, but asks twice — against "simpler").
- **F2** What *Skip for now* skips — *recommended:* the menu only; address stays required.
  Alternative: address skippable too (degrades vendor matching / currency silently).
- **F3** What "location advice" means — *assumed here:* Places search biased by *Use my location*
  to find the restaurant. Could instead mean multi-location guidance, or advice text on why the
  address matters. Ask.
- **F4** Add *Continue with Google* to `/register` — *recommended*; this is what "Gmail" can mean
  today.
- **F5** Adopt "The first proof" as the reveal pattern (§4).
- **F6** Adopt the ink / pencil copy system (§5).
- **F7** `none` registers as one footer line (supersedes PAGE-WAVE-BLOCKERS §5 Q2's three options).

**Research — before build**
- **R1** Does the extractor return anything per line (section header seen, keyword vs context) that
  can drive the pencil rule? Read `menus.service.ts` + extract prompt on `origin/main`.
- **R2** What happens to food lines on a mixed menu today — extracted, dropped, or misfiled?
- **R3** Google verification status of the `gmail.readonly` restricted scope for this OAuth client.
- **R4** Does the extractor keep per-line source regions (for the in-place crop)?
- **R5** SMS-consent wording for the owner mobile field (KVKK / TCPA).
- **R6** Run three real menus (PDF wine list, phone photo, 9-line chalkboard) through staging
  extraction and count the pencils — the proof is only as good as that ratio.

---

## 9. Brief for sketch 123

**Question:** *Does "the first proof" make the digitized menu feel like Mudavym's own
presentation — and does the pencil admit a double-check without looking unfinished?*

Frames, white ground first, 1440 + 390, charcoal shot for frame 5:
1. **You** — "Welcome, Selin. Let's set up your restaurant." Name, mobile (with alert-only note),
   role chips. 121 ruled-line field style, 122 app bar.
2. **Your restaurant** — Places search, *Use my location* link, confirm card with derived ₺ + timezone.
3. **Your menu** — 122 frame 1 drop well, three ruled ways in, *Skip for now — open the house*.
4. **Reading** — 122 frame 2 unchanged.
5. **The first proof** — 42-line mixed menu typeset in sections; 17 pencils; one line expanded in
   place with source crop and dashed guess; footer "Not on this menu: sake, cider"; kitchen-lines
   collapse. Counts *42 read · 25 set · 17 pencilled*.
6. **The house** — contents with one seal line asking; last-invoice line drawn as a greyed future
   inscription.
7. **Thin & failed** — 9-line chalkboard proof (mostly ink, 1 pencil); unreadable file.

Rules: no confidence words anywhere (grep the HTML for `certain|likely|confidence` = 0); motion
tokens only `turn / settle / ink / tally`; no modal, no sheet; no checkboxes.

---

## Disclosures
- Papers were read in full; claims were spot-checked in code only where cited above. Industry
  claims in papers 01–03 were **not** re-fetched — I relied on their citations.
- R1–R6 are unresolved; §4's per-line pencil depends on R1.
- #414 / #454 untouched; no flags, no merges, no product code.
- Retire-to-write: this squad adds five docs; on the founder's pick, `GET-STARTED-REDESIGN-2026-09-22.md`
  and sketch 122's §"Still open" should be superseded by the resulting ADR — not done here.
