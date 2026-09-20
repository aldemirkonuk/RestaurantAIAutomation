---
type: research
title: Endpoint universe and comms plan (founder brief)
status: adopted
updated: 2026-09-20
supersedes: none — indexes the 2026-09-19/20 comms-lane research; plan of record via ADRs 0178–0181
---

# Endpoint universe + one-tap + email blocks — founder brief

Written 2026-09-20. Plan only: nothing here is built. The long form lives in the
session scratchpad (`plan/synth/S1`–`S8`); this file is the readable brief.

**What you asked:** every endpoint an app like this could have, compared with
us; improve it, especially one-tap; make the template modal able to carry
graphics, analysis and recommendations. Scope: everything in detail, including
domains we do not touch yet.

**What is already locked (do not reopen):** ADRs 0170 (vendor body is text),
0171 (house-scoped conversations), 0172 (MIME headers), 0173 (catalogue then
slot editing; buttons only to Mudavym destinations — **D2 slot-only is
superseded below**), 0174 (email is a paper sheet, the house signs it),
0175 (one-tap is staged; Android lock-safe; iOS per-phone, fail closed,
7-day stale), 0176 (phone swipe-up is the intent gesture).

**Founder answers, 2026-09-20 (this session):**
- Push title is **not** the email subject (decouple).
- The three confirmed security holes are fixed **after** this plan is
  adopted, still in this session.
- **Phase 0 is all of it**, then Phase 1. No skipping a defect, no
  parallel pitch work on an unsealed send.
- **Guests / reservations / waitlist: in scope, not built.** Named and
  reserved in the software (routes, tables, nav, one-tap classes). A
  U10 catalogue is owed before any code. See "Guests, reserved" below.
- **Mail is not a closed palette and not drag-and-drop.** It is a
  compositional grammar (see "The mail composer" below).
- Unmounted Python: the founder asked the lane to decide after research.
  Decision: **delete the unmounted HTTP surface, keep `router_preview`
  (already authed and mounted), keep tables, add a ratchet.**
  Evidence: see "The orphan Python" below.

**What was measured:** 888 of our routes/surfaces vs 1,559 benchmark
capabilities (U1–U8 fully graded; U9 one-tap patterns used as design
precedent). Census at `origin/main` `79dfea023`. Adversary verdict on the
draft plan: **BREAKS** (2 critical, 6 high) — the safety model survived;
several items cannot be executed as written. Completeness: guests /
reservations / waitlist has **no universe file at all**, despite being in
scope.

---

## The shape of the product, if you adopt this

One sentence: **the house acts with a gesture; mail informs; the phone is
the pitch.**

- **Phase 0 — stop the bleeding.** Tenant leaks, the open HTML sender,
  unsealed vendor sends, mobile approve 403, the swipe sheet that Phase 1
  depends on, auto-send retired, `approveOrder` always needs authority.
  Each on its own branch. The adversary's two criticals are applied *in
  the plan* before any of this is scheduled: S4-024 dies as a duplicate of
  OT-02 (a click must not mint a seal); the phone swipe sheet (OT-18) moves
  into Phase 0 so mobile approve is not shipped without it.
- **Phase 1 — the pitch, without native code.** A push tap opens the seal
  sheet (full-page swipe on the phone, hold on the web). `/communications`
  is a read-only catalogue, then the compositional mail editor (atoms +
  combinators). v1 renders HTML/CSS on the paper sheet; a combinator that
  needs a PNG waits on a spike. One "Review in Mudavym" button per mail,
  never an act. Push title is composed from lock-safe fields; houses edit
  the email subject separately.
- **Phase 2 — native shade.** In-notification hold, under a per-order
  ceiling and a daily cap, both default 0. Only `approve_and_send` until
  you name more. Owner enrols the house switch; a person enrols their own
  phone.
- **Phase 3 — new domains, one at a time, after a fork.** Record-only AP
  (no money movement). Scheduling stays ours and deepens. Time clocks are
  imported, not built. Payroll is an export, never ours. Guests /
  reservations: **reserved in the tree, not built** (U10 first).
  Food recipes: integrate when a food-heavy tenant arrives.

---

## What is broken today (Phase 0, confirmed)

These are live on the production tenant. The first three you already
ordered fixed after this plan.

| Hole | Why it matters |
|---|---|
| `GET providers/:id/{orders,performance,contacts}` | No tenant filter. Another house's vendor data. |
| `GET/PUT users/:userId/preferences` | IDOR. |
| `POST notifications/send-email` | Any signed-in user can send arbitrary HTML from the Mudavym domain. |
| Mobile approve | Returns 403: no seal. The pitch's headline act. |
| Four vendor sends | Client-supplied text/CC, no seal, no authority. |
| `approveOrder` | Role check skipped when no ADR 0116 rule fires. |
| Vendor auto-send | Four live paths. Retired by 0175 D5, not yet removed. |
| `sw.js` push actions | Posts routes that do not exist, with no credential, default quantity 12. |
| 49 unmounted Python routers | No auth. The day someone mounts them, they are public. |

Path/query `:restaurantId` **is** protected (`assertTenantMatch`). Census
IDORs on those routes were false positives.

---

## One-tap, as the plan would build it

| Surface | What it may do |
|---|---|
| In-app (web hold, phone swipe) | Read, undo-after (F10 list only), seal, seal+authority |
| Push, Phase 1 | Opens the sheet. Tap is never the intent. |
| Shade, Phase 2 | Hold, only `approve_and_send`, under ceilings at 0 |
| Email button | Opens a Mudavym page. Says "review". Never acts. |
| Widget / watch / Siri | Read, or open the sheet. Not an act until you say so. |

## The mail composer (amends 0173 D2)

You rejected both a 20-block palette and a drag-and-drop page builder.
The model that matches "add everything, combinations shape more complex
charts, not drag-and-drop" is a **typed composition grammar**:

1. **Atoms** (each with a data contract, a freshness line, and an empty
   behaviour of *hide, never invent*): a figure (named metric), a series,
   a set (vendors, items, weeks), a goal, a recommendation, a destination
   (Mudavym page only), a slot of house words, the house mark.
2. **Combinators**: overlay, stack, compare, filter, window, group. Two
   series + compare → a chart. A figure + a goal → a meter. A
   recommendation + a destination → a Review card. The puzzle is the
   combinators, not the pixels.
3. **The editor** is a sentence you assemble (slash or picker), with a
   live preview of the house's real data. Dropdowns bind to house data
   (this vendor, this week, this goal), never to a free URL.
4. **Buttons** stay 0173 D5: Mudavym destinations, "review" never
   "approve", never GET-mutation.
5. **Vendor letters stay text** (0170). This grammar is for house mail:
   PAR, recaps, reminders, reports, the briefing.
6. **v1 still HTML/CSS** on the paper sheet (Outlook, Gmail 102KB). A
   combinator that needs a PNG waits on the same spike as before. Depth
   of understanding is the grammar and the data, not a raster.

This needs a new ADR amending 0173 D2. It is not "full HTML"; raw markup
and free URLs stay refused.

## Guests, reserved (in scope, not built)

The founder needs this domain in the product map. Completeness was right
that no part catalogued it. That is a research hole to fill, not a
licence to skip the domain and not a licence to start coding it.

**What "reserved in the software" means, exactly:**

- A **U10 catalogue** (research only) covering at least: book / modify /
  cancel a table, waitlist, covers, guest profile, no-show, deposit,
  seating chart, turn time, guest messaging (SMS/WhatsApp/email),
  review-request after a visit, POS cover-count as a signal, one-tap
  classes for "seat now / bump waitlist / cancel booking".
- **Empty places in the tree**, so a later session cannot collide:
  nav slot `Guests` (dark), route prefix `/guests` and
  `/reservations` unpublished, table names `reservations`,
  `waitlist_entries`, `covers`, `guest_profiles` not used by anything
  else, one-tap act ids `guest.*` listed as class SA or N and **not
  implemented**. A CLAIMS row holds while those prefixes have no
  controller.
- **One-tap, when it ships:** a booking is money-adjacent (deposit,
  covering a table that could have been walked). Default class **SA**.
  Guest free-text send is a send (0112). Guest templated "your table is
  ready" is a send-window, not a seal, once you lock that fork.
- **Build vs integrate:** not decided. The brief's leaning stays
  integrate-a-reservation-platform for the system of record, Mudavym
  for the seal and the guest-facing message — but that is a later
  fork, after U10 exists. Until then the places stay empty.

**Do not build:** no controller, no migration, no OpenTable scrape
(that scrape lives in the unmounted `collection_routes` and is part of
what Phase 0 deletes).

## The orphan Python (F24 — decided)

Counted at `plan-census` `79dfea023`. Four files are never passed to
`app.include_router` in `main.py:151-194`. Zero `Depends()` on their
handlers, except the *other* router in `scan_routes.py`:

| File | Handlers | Auth | What it can do if mounted |
|---|---|---|---|
| `api/admin_routes.py` | 8 | none | Wine-tier promote/demote, alias, edit, submission approve/reject |
| `api/collection_routes.py` | 7 | none | `POST /web` takes a caller URL and scrapes it (SSRF); also Google/Yelp/Vivino/OpenTable pulls |
| `api/templates_routes.py` | 9 | none | CRUD + render of `{variable}` bodies. **Cannot import** (`get_db_connection` does not exist) |
| `api/scan_routes.py` `router` | 24 + 1 WS | none | Scan, crawl, quality queue, learning cycle, training export |
| `api/scan_routes.py` `router_preview` | 1 | `verify_admin_key` | **Keep.** Already mounted. |
| `services/self-evolution/main.py` | 11 | none | Separate app, port 8090, **not in docker-compose**, `restaurant_id` from the caller |

No first-party importer of the four unmounted modules (grep of the
orchestrator tree). `wineDetection.ts` is gone from this tree. The
mounted preview detect is the only live scan door.

**Why not mount them behind auth:** (1) `templates_routes` does not
import, so "mount + auth" is a rewrite, not a one-line fix. (2)
`collection_routes` `POST /web` is an arbitrary-URL fetch — auth does
not make SSRF safe. (3) Wine-tier and submission approve are
house-data writes that belong on the **gateway** with a seal, not on
an internal FastAPI with an admin key. (4) The day a well-meaning
patch adds `include_router(admin_router)`, 8 unauthenticated writes
are on the internet; a ratchet is cheaper than hoping nobody does
that.

**Decision:** delete the four unmounted routers' *unmounted* surface
(`admin_routes.py`, `collection_routes.py`, `templates_routes.py`, and
the `router` object in `scan_routes.py` plus its websocket). Keep
`router_preview`. Delete the self-evolution **HTTP app**; keep any
tables. Tombstone in the retiring ADR. CI ratchet: every `APIRouter`
in `services/agent-orchestrator/api/` is either in `main.py`'s include
list **and** has a `Depends` auth on every write, or the build fails.
A later product that needs scan or admin wine review is a **new
authenticated gateway route**, not a resurrection.

## Completeness (S8) folded in

The matrices are complete (1,432/1,432 U1–U8 graded; 34/34 census
defects owned). The plan they feed is not: 653 of S1+S3's graded rows
have no item. Extra P0/P1 the brief now carries:

- **RLS as defence in depth.** RLS *does* exist on some tables
  (password_resets, vendor_portal, menu_price_versions, and an archived
  2026-07 tenant-policy migration). The live tenant model is still the
  gateway guard plus the **service role**, which bypasses RLS — that is
  why the three IDORs exist. Per-route fixes do not prevent the next
  one. Phase 0 includes a ratchet: every new table is RLS-on, and
  gateway reads that are house-scoped must not be the only check
  forever. A dedicated ADR, not a silent default.
- **Prompt injection.** Vendor-controlled text reaches LLMs that draft
  vendor letters. 0170 makes the *send* text, not the *prompt*. Phase 0
  names this; the build is a later ADR.
- **Turkish tax.** VAT/KDV/ÖKC is almost absent from the plan. Not
  Phase 0. Named so a costing ADR cannot ship with a single rate.
- Guests: **in scope, reserved, not built.** U10 is owed.

---

## Email blocks, as the plan would build them

A typed composition grammar, not a 20-block palette and not a page
builder. Atoms (figure, series, set, goal, recommendation, destination,
words, mark) plus combinators (overlay, stack, compare, filter, window,
group). Empty data **hides the block**; it never fabricates a number.
Vendor letters stay text (0170). Staff never receive money/sales/staff
figures; vendors receive text only; the house cannot override that.
v1 is HTML/CSS on the paper sheet; PNG only when a combinator needs it,
after a spike. Buttons: Mudavym destinations, "review", never an act.

---

## What the adversary said must change in the plan itself

Applied here; not yet rewritten into S1–S6 item text.

1. **S4-024 vs OT-02.** Same P0, same files. S4's acceptance lets a click
   mint a seal. Kill S4-024; OT-02's negative test is the bar.
2. **S5 Phase 0 is circular.** Mobile approve depends on the swipe sheet
   which was scheduled in Phase 1. Move the swipe sheet (and the seal
   subject kinds for vendor letters) into Phase 0.
3. **Email subject ≠ push title.** You already chose decouple.
4. **NULL / mixed currency** has no seal-withholding refusal. Add it
   before Phase 1 binds a total.
5. **S2-006 "limit is 0 until typed"** disables every stock write-off
   because no passcode exists. Split seal from passcode.
6. **Class N** is not "never one tap"; 0175 D2 says stay on the seal
   sheet. Narrow N to bank details.

---

## New domains — recommendation in one line each

| Domain | Rec |
|---|---|
| Staff scheduling | Keep ours, deepen (warnings, availability, swaps). |
| Time clocks | Integrate punches; do not build a clock. |
| Payroll | CSV export. Never build payroll. |
| AP / payments | Record-only now (bills, aging, sealed mark-paid). Integrate a bill-pay API when the house asks. Never hold funds. |
| Food recipes / plate costing | Integrate when a food-heavy tenant arrives. Beverage recipes we can build. |
| HACCP / sensors | Our logs; partner for hardware. Never prefill a reading. |
| SSO / SCIM | Defer until a group operator asks. Then a provider, never ours. |
| Public API / outbound webhooks | Defer. MCP already serves the assistant case. |
| Guests, reservations, waitlist | **In scope. Reserved in the tree. Not built.** U10 catalogue first. Integrate vs build is a later fork. |
| Loyalty, gift cards, DSP / online ordering, CarPlay, kitchen printers | Out, with a written reopen trigger. |

---

## Forks that actually block the next build

The six parts list ~150 forks. Most wait. These eight decide Phase 0 and
Phase 1. Recommendations are the research's, not decisions.

| # | Question | Rec |
|---|---|---|
| 1 | Phase 0 defects before any Phase 1 surface? | **Decided: all of Phase 0, then Phase 1.** |
| 2 | Unmounted Python routers: delete, or mount behind auth? | **Decided: delete the HTTP surface, keep tables, ratchet.** |
| 3 | Which reversible in-app acts join 0112 F10 (undo-after), so they can later live in the shade? | A named set, not a rule: acknowledge, claim an open shift, snooze, done, a spot count corrected by a recount. Not money, not a send. |
| 4 | Send window after a vendor-letter seal? | 2 minutes, with Cancel. 5 s in the mock is too short to undo a letter. |
| 5 | Template editing | **Decided: compositional grammar, not palette, not drag-and-drop.** Amends 0173 D2. |
| 6 | Graphics in v1 mail? | HTML only. PNG only when a combinator needs it, after a Gmail/Outlook spike. |
| 7 | Guests / reservations | **Decided: name it, reserve places in the SW, do not build. U10 first.** |
| 8 | Studio promote / queue writes: product surface (sealed) or ops-only? | Ops-only behind a service key, unless you intend houses to see Studio. |

The rest of the fork tables stay in S1–S6 and are asked in later batches
(inventory F10 amendments, AP rails, labour-law jurisdiction, TR/EN keys).

---

## What happens after this brief (adopted 2026-09-20)

1. This docs PR: ADRs 0178–0181 + this file. One audit round.
2. Then, this session: the three security holes, each on its own branch.
3. Then the rest of Phase 0, one operation per branch. S5's phase table
   and S4-024 live in 0178; they are not rewritten into the scratchpad.

**Not verified:** no route was called, no device or mail client was used,
production `mobile_devices` was not re-counted, no benchmark URL was
re-fetched, S3's tail was finished after the adversary so those forks were
not attacked. The adversarial pass was one agent, not the §3 fan-out that
any item still needs before it becomes an ADR.

Sources: `plan/synth/S1`–`S8`, census at `79dfea023`, ADRs 0112 / 0116 /
0170–0176, founder batches 1–10 plus 2026-09-20 answers (decouple push
title; security after the plan; Phase 0 in full then Phase 1; guests
reserved not built; mail as a compositional grammar; Python unmounted
surface deleted).
