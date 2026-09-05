# 0128 — An approval fits the decision

- **Status:** Proposed — the founder locks
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** approval, maker-checker, four-eyes, segregation of duties, price book, upload, price-index, seal, escalation, tier, admitted_at, second pair of eyes
- **Links:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q17, Q18),
  [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]],
  [[0107-a-declared-server-is-not-a-reachable-one]] (the seal addendum),
  [[0110-a-card-on-file-is-the-providers-record-not-ours]],
  [[0111-the-calendar-is-the-houses-day-book]],
  `supabase/migrations/20260905180000_a_carried_book_waits_for_a_second_pair_of_eyes.sql`

---

## Context

ADR 0117 Q18 asked the founder a question this repository could not answer for itself:

> **A doctored workbook is undetectable, and that is not fixable by code.** … Is provenance
> enough, or should an uploaded book require a second person's confirmation before it is shown?

The founder answered on 2026-09-05, verbatim:

> Yes, it needs an approval however we can't wait 2 people to approve a small decision, or a big
> one. Research about this, deploy agents(opus) and decide how to move forward

Both halves are constraints and the second one is not rhetoric. It is a fact about this estate,
and it was measured before anything was built.

### What the act actually is

`POST /price-index/upload` (`apps/api-gateway/src/price-index/price-index.controller.ts:69`)
parses a hand-carried state price book and writes its rows into `price_index_postings`. That
table **has no `restaurant_id`, on purpose** — `supabase/migrations/20260904200000_a_posted_price_names_its_state.sql:30`
says so in its own header: *"NOT restaurant-scoped. There is deliberately no restaurant_id: this
is a …"* register keyed by STATE.

So one manager's upload is not one house's number. It is **every house in that jurisdiction's**
number, and the read that draws it
(`price-index.service.ts` `forState`) orders by `issued_at DESC`, so a newly carried edition
displaces every fetched line above it.

### Sizing the blast radius, measured on this tree

- **Who reads it.** `GET /price-index/:state` and `/me`, owner/manager only, drawn by
  `apps/web/src/pages/notifications/next/MarketIndexPanel.tsx`. Command:
  `grep -rn "PriceIndexService" apps/api-gateway/src | grep -v "src/price-index/"` returns
  **nothing** — no module outside `price-index/` consumes the read service.
- **Can it place an order?** No. ADR 0111 keeps the index register separate and the panel's own
  closing sentence says *"This box reads public lists; it never places an order."* The one other
  reader of the table is `vendor-intel/identity.service.ts`, which resolves bottle identity and
  is another builder's work in flight the same day.
- **Can it fire an alert?** No producer reads it (`ls apps/api-gateway/src/notifications/producers`
  — the market-price producer reads `VendorComparisonService`, class A/C, not this register).

So an uploaded book **does not move money and cannot cause an order.** It sets what the houses in
a state BELIEVE they pay. That is a reference-data act, not a transaction, and the field treats
those two very differently.

### The census — the fact that decides the shape

Read-only, against production Supabase through PostgREST with the gateway's own service key,
2026-09-05. Command (values redacted; run from `$WT`):

```
set -a && . apps/api-gateway/.env && set +a
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/restaurants?select=id,name,state_province,country&limit=100"
curl -s ... "$SUPABASE_URL/rest/v1/user_restaurant_access?select=restaurant_id,user_id,role,is_active&limit=1000"
curl -s ... "$SUPABASE_URL/rest/v1/users?select=user_id,restaurant_id,role,email&limit=1000"
```

Membership is the UNION of the two sources the gateway itself consults
(`restaurants/members.service.ts:assertMembership` reads `user_restaurant_access` and falls back
to `users.restaurant_id`). Project `exzueerziesmczwlhomd`.

**Measured twice, and the estate moved between the reads.** The first read (13:0x UTC) saw 14
restaurants / 16 active access rows; the second (13:2x UTC) saw **15 restaurants / 17 active
access rows** — a new house, `Sim Vanilla Kaleiçi` (TR, one owner-or-manager), appeared while this
was being built, almost certainly a scenario run writing production. The **second** read is the
one of record below and the capture is at `$SP/p4at-census-2026-09-05.txt`. The drift changed no
conclusion; it strengthened one, and it is recorded because a census quoted without its instant is
a number that will be wrong tomorrow.

**Per house — how many people could ever sign anything:**

| House | state / country | owner+manager |
|---|---|---|
| ADMIN 1 | England / United Kingdom | 1 |
| ADMIN ROOM | Michigan / United States | 1 |
| ALDEMIR | Michigan / United States | 2 |
| Chez Community | Muğla / Türkiye | 1 |
| Gullit's Tavern | MI / United States | **0** |
| Meyhouse Palo Alto | CA / United States | **0** |
| Meyhouse Palo Alto | (none) | 3 |
| Sim Bistro | (none) / USA | 2 |
| Sim Meyhouse | CA / USA | **0** |
| Sim Meyhouse | CA / US | 1 |
| Sim Vanilla Kaleiçi | (none) / TR | 1 |
| The Old House Pub | (none) / Türkiye | 1 |
| YARDOM | Illinois / United States | 2 |
| YAREN | IL / United States | 2 |
| Yaren's Fine Dine | IL / united States | **0** |

**Ten of fifteen houses have one owner-or-manager or none** (four have zero, six have exactly
one). Distribution: `{0: 4, 1: 6, 2: 4, 3: 1}`.

**Per jurisdiction — which is the level the harm actually reaches:**

| Jurisdiction | houses | distinct owner+manager people |
|---|---|---|
| US-MI | 3 | **3** |
| US-IL | 3 | 2 |
| US-CA | 3 | **1** |
| GB-ENG | 1 | **1** |
| Muğla (TR) | 1 | **1** |
| Türkiye (country only) | 1 | **1** |
| TR (country only) | 1 | **1** |
| USA (country only) | 1 | 2 |
| *(one house records neither state nor country)* | 1 | 3 |

**Five of the eight jurisdictions this estate resolves to contain exactly one person.** A rule of
"always two" is, for most of this estate, a rule of "never". And US-MI — the only jurisdiction
with an uploadable source today — is the one place where a real second pair of eyes exists.

---

## What the field does, with every source fetched on 2026-09-05

**Dual control is a rule about TRANSACTIONS, and it states no thresholds.**
[Maker-checker](https://en.wikipedia.org/wiki/Maker-checker): *"For each transaction, there must
be at least two individuals necessary for its completion. While one individual may create a
transaction, the other individual should be involved in confirmation/authorization of the same."*
The article gives no thresholds and no exemptions, and its scope is banking transactions.

**For REFERENCE data the same vendors apply it selectively, by field, not universally.** SAP's
dual control for master records
([SAP Help, sensitive fields](https://help.sap.com/doc/saphelp_dbm800/8.0/en-US/fc/310950e53ed247e10000000a44176f/content.htm?no_cache=true);
same text at [IS-H 618](https://help.sap.com/doc/d62f53efeaa84fc4a7c176ce2ce06408/IS-H%20618%20SP%20006/en-US/fc310950e53ed247e10000000a44176f.html)):
*"If you define a field in the customer/vendor master record as sensitive, the corresponding
customer/vendor account is blocked for payment if the entry in this field is changed."* and *"To
remove the block, a second person with authorization must check the change, and confirm or reject
it."* Three things are borrowed here almost intact: **only nominated fields are sensitive**, the
record is **BLOCKED rather than hidden** while unconfirmed, and the confirmer is **a second
person**.

**Amount-tiered approval is the norm, and the bottom tier has no second approver at all.**
Restaurant365, the ERP built for this industry
([Approvals in Workflows](https://docs.restaurant365.com/docs/approvals-in-workflows)): *"Saved
with No Applicable Workflow (Dollar value is less than lowest Workflow threshold) - Approve menu
present to all users with Approve permissions."* against *"Saved with an Applicable Workflow -
Approve menu is present only for the authorized approver."* Odoo's purchase module
([two levels of approval](https://odoo-users.readthedocs.io/en/latest/purchase/purchases/rfq/approvals.html))
is the same shape in one setting: *"Set here the amount limit for second approval and set approval
from manager side"*, and an order above it enters a **To Approve** state.

**Where segregation of duties is impossible, the standard does not say "do it anyway".** GAO,
*Standards for Internal Control in the Federal Government*, GAO-25-107721 (May 2025), fetched from
[gao.gov](https://www.gao.gov/assets/gao-25-107721.pdf), §10.21: *"Management considers segregation
of duties in designing control activities so that incompatible duties are segregated. Where such
segregation is not practical, management designs alternative control activities to mitigate the
risk."* And §10.23, which is this estate exactly: *"If segregation of duties is not practical
within a business process because of limited personnel or other factors, management designs
alternative control activities to mitigate the risk of fraud, waste, or abuse in the business
process."*

**Auto-approval below a bar is a documented product feature.** Ramp
([expense approval policies](https://support.ramp.com/hc/en-us/articles/27132114712723-Setting-up-expense-approval-policies-for-transactions-and-reimbursements)):
*"If you have set transactions to auto-approve, the transactions won't show up in your team's
reviewer queues …"*.

**One thing the research did NOT find.** No vendor document fetched today states an escalation
window for a stalled approval. The 24-hour window below is therefore **reasoned, not borrowed**,
and it is named as such in the code.

---

## The finding that changed the design

**A tier cannot detect a forgery, and neither can a second human being.**

The measured MLCC book carries **12,530 product rows** (ADR 0117). A doctored workbook that moves
ONE bottle's price by thirty percent is 1 row in 12,530 — 0.008 % of the book. No share band, no
median, no row-count check will ever see it. Nor will a second person: nobody reads 12,530 rows,
and a confirmation that consists of a human scrolling a table is a click wearing the costume of a
control.

Two consequences follow, and they are the spine of this decision.

1. **The tier is a SIZING control, not a fraud detector.** It catches the faults that are common,
   detectable and jurisdiction-wide: the wrong book, the wrong state, a mangled parse, a bulk
   rewrite, and the FIRST book — which has no baseline at all, so every comparison is vacuous for
   it. One band is aimed at a targeted edit, and only one: a single item moving more than half
   again. A forged price worth forging has to move a long way, and a single large move is visible
   even when the aggregate is not.
2. **The only confirmation worth anything is the BYTES.** The MLCC publishes no signature (ADR
   0117), so a second person's real job is to fetch the book from the issuer themselves and
   compare the sha256. `POST /price-index/uploads/:id/confirm` therefore accepts the file,
   hashes it, and records `byte_match` **only when the bytes actually agree** — and records
   `attested` honestly when the confirmer produced nothing, rather than letting a click look like
   a check.

---

## Options considered

1. **Always two people, on every uploaded book.** The maker-checker default. Rejected on the
   census: five of eight jurisdictions have one person, so this is "the feature is off" for most
   of the estate, dressed as a control. It is also the one option the founder ruled out by name.
2. **Never two people; provenance alone (the status quo of ADR 0117).** Rejected because the
   FIRST book has no baseline whatsoever — every check that compares editions is vacuous for it —
   and because the register is jurisdiction-wide, so one person's mistake becomes three houses'
   truth with nobody having looked.
3. **Time-based auto-approval: hold it, and admit it if nobody objects in N hours.** Rejected
   outright. That is silence read as consent — the [[absence-reported-as-health]] inversion with a
   timer on it — arriving through the one door in this module that puts numbers on other people's
   screens. The escalation here tells people again and **admits nothing**.
4. **The pool is the HOUSE.** Rejected on the census and on the table shape: `price_index_postings`
   has no `restaurant_id`, so the harm is jurisdiction-wide; and per house, ten of fifteen have
   nobody to ask. Per jurisdiction, US-MI has three people — the ceremony is real exactly where
   the feature is real.
5. **Refuse self-admission absolutely.** Rejected against GAO §10.23: where segregation is not
   practical because of limited personnel, the standard asks for an *alternative control*, not for
   the process to stop. A lone manager in California would otherwise be permanently unable to use
   the only route by which a state price reaches their house.
6. **A tier by AMOUNT, like every ERP.** Not applicable: an uploaded book has no amount. The
   analogue of the dollar threshold here is the DIFF against the last admitted edition, which is
   what was built.
7. **An amendment to ADR 0117 or 0116 rather than a new ADR.** Argued and rejected. ADR 0117 is
   about what a *sighting* must NAME (source, date, unit) and 0116 about a *threshold stopping an
   order*. This decision introduces a state a posting can be in (`admitted_at`), a new table, a
   new seal subject kind, an escalation sweep and a rule about WHO — none of which is a property
   of a sighting or of an order threshold. Folding it into 0117 would bury a mechanism inside a
   provenance ADR that is already 1,900 lines and holds four separate builds. A review-trail row
   in 0117 marks Q18 answered and points here.

---

## Decision

**How many people an uploaded price book needs is decided by the book, not by a policy setting —
and where the jurisdiction has nobody else, one person may admit their own book with a stated
reason that is recorded as exactly that.**

### 1. The tier, from the book itself

`apps/api-gateway/src/price-index/upload-tier.ts`. Every band is tested and every one that trips
is recorded — not the first match.

| Band | Constant | Value | Basis |
|---|---|---|---|
| a later edition exists at all | — | — | no admitted edition ⇒ `first_book` |
| the comparison could be MADE | — | — | unreadable baseline ⇒ `diff_untestable` |
| catalogue size | `CATALOGUE_SHIFT_LIMIT` | 20 % | reasoned: a fifth of 12,530 is 2,506 products appearing in a quarter |
| share of items repriced | `MOVED_SHARE_LIMIT` | 25 % | reasoned |
| the middle item's move | `MEDIAN_MOVE_LIMIT` | 5 % | reasoned; median, so one outlier cannot move it |
| any single item's move | `SINGLE_MOVE_LIMIT` | 50 % | reasoned; the only band a targeted edit must clear |
| noise floor | `MOVE_NOISE` | 1 % | reasoned: a cent on a case price is not a decision |

**These bands are UNMEASURED and the file says so.** Setting them from evidence needs two real
consecutive editions of a state book; this repository holds one (the 2025-08-03 MLCC workbook).
Every upload records its real diff on the review row, so the second edition replaces the reasoning
with evidence rather than confirming it. See Q1 below.

- **ROUTINE** — every band inside. One person's upload STANDS. Status `stood`, not `confirmed`:
  nobody confirmed it, and a column that said otherwise would be a lie in a column. The other
  owners and managers in the jurisdiction are **told** — a notice, not a request.
- **SECOND PAIR OF EYES** — any band tripped, or a comparison that could not be made. The rows are
  written and **HELD**.

### 2. What "held" means

`price_index_postings.admitted_at`. A row is the market when `uploaded_by IS NULL` (fetched, never
held) **or** `admitted_at IS NOT NULL` (carried, and let in). The predicate lives in exactly one
exported constant, `MARKET_VISIBILITY` in `price-index.service.ts`, applied to the line read and
to the row counts, because a query that forgets it does not fail — it just shows unconfirmed
numbers.

It is called `admitted_at` and not `confirmed_at` because a routine book's rows are admitted
without anybody confirming anything.

The panel says so: `heldBooks` travels on `GET /price-index/:state`, and both the endpoint's
silence sentence and a dedicated label in `MarketIndexPanel` name the waiting book. A held book
that read as "nothing is posted here" would tell a Michigan house to go and find a book its own
manager already carried in — the same fault ADR 0117 corrected for Illinois, wearing the other hat.

### 3. Who may admit, and what it is worth

The pool is **every owner or manager of a house in that jurisdiction**, resolved through the same
`jurisdictionCovers` the register itself is scoped by.

| Situation | Outcome | Recorded as |
|---|---|---|
| a different eligible person, with the same bytes | admitted | `byte_match` |
| a different eligible person, no bytes | admitted | `attested` |
| the uploader, and the jurisdiction has nobody else | admitted, reason required | `same_person` |
| the uploader, others exist, escalation not yet fired | **refused**, with how many others and when the override opens | — |
| the uploader, others exist, escalation has fired | admitted, reason required | `same_person` |
| the pool could NOT be read | **refused** | — |

The database enforces the second-person rule rather than the code alone:
`price_index_upload_reviews_second_person_is_another` admits a confirmation only when
`confirmation_evidence = 'same_person' AND confirmed_by = uploaded_by AND confirmation_reason` is
present, or `confirmation_evidence <> 'same_person' AND confirmed_by <> uploaded_by`. A silent
self-confirmation dressed as `attested` is refused by a CHECK.

**Sealed.** Admitting a book is challenge-and-redeem through `SealChallengeService`, subject kind
`price_index_upload`, args `(sha256, tier, reasons, rows)` — so a seal minted while a book was held
for one reason cannot be spent after the reason changed. Refusing is deliberately **not** sealed:
the seal guards the act that puts numbers on other people's screens, and refusing is the direction
that takes them off.

### 4. Escalation, which decides nothing

`ESCALATION_HOURS = 24`, reasoned (a posted book is a quarterly artefact; a day costs the house
nothing, and it bounds how long a jurisdiction with one person in practice can be blocked). An
hourly sweep tells the pool again and stamps `escalated_at`. It writes that column and nothing
else — the test asserts the update's key set is exactly `["escalated_at"]`.

### 5. A refusal reopens once, by an owner (Q3, 2026-09-05)

`POST /price-index/uploads/:id/reopen`, owner-only at the guard AND checked again against the
BOOK's jurisdiction in the service, because "are you an owner" and "are you an owner of a house
this book reaches" are two different questions and only the second one is about this book.

| Rule | Where it is enforced |
|---|---|
| an OWNER, not a manager | `@Roles("owner")` + the pool's role in `reopen()` |
| never the person who refused it | `reopen()`, and **not** a CHECK — see below |
| once per set of bytes | `reopened_at IS NULL` in the UPDATE's own filter |
| a reason, always | `reopen()` + `price_index_upload_reviews_reopen_complete` |
| the refusal is kept, not deleted | `price_index_upload_reviews_reopen_has_history` |
| its own seal act | `price_index_upload.reopen`, never `.admit` |

Two consequences are stated rather than left to be discovered.

**The database cannot check "not the refuser".** A reopened row is no longer refused, so
`refused_by` must be cleared to satisfy the refusal CHECK that already existed — and the refuser
moves into `decision_history`. The rule therefore lives in the service and in
`price-index-review.spec.ts`, and nobody should read the absence of that CHECK as the absence of
the rule.

**`escalated_at` is cleared on a reopen, and that is a decision.** It is the clock that opens the
self-admission override. A book that had already sat out its hold before being refused would
otherwise return instantly self-admittable, and an owner reopening their own upload could put it
on three houses' screens in two requests. The hold starts again.

---

## Consequences

**Easier.** A Michigan manager can bring in the quarterly book and it stands, with provenance and
a notice, the way Restaurant365 lets a below-threshold invoice be approved by anyone. The first
book, and any book that moved oddly, gets a person. Every decision has a row naming who, when, on
what evidence, and against what measured diff. "Which manager's upload put this number on the
screen, and who let it in" is two columns and an index, not a scan and a guess.

**Harder / given up.**
- A held book means a Michigan house has **no index line at all** until somebody acts. The panel
  now says why, but the line is gone in the meantime. That is the cost of the decision and it is
  paid in full the first time the feature is used, because the first book is always held.
- Every upload now carries a baseline read and a fingerprint write (~12,530 entries of JSONB per
  book, quarterly). `FINGERPRINT_CAP` refuses a baseline past 50,000 items rather than truncating
  one, and a book past the cap is permanently `diff_untestable` — held every quarter. No source in
  the registry is near it today.
- `GET /price-index/:state` now issues one extra `head` count per read. Deliberately on EVERY
  successful read, not only an empty one: a label that appeared only when the panel was empty
  would hide a waiting book at exactly the moment the panel looked healthy.
- The tier will hold books nobody needed to look at, whenever a state genuinely reprices its
  catalogue. That is the false-positive cost of unmeasured bands, and it is the reason Q1 exists.

**What would trigger revisiting this.** The second real edition of the Michigan book — the moment
the bands can be measured instead of reasoned. Also: any source acquiring a published signature or
a machine endpoint, which would make the whole human-fetch path, and therefore this decision,
unnecessary for it.

---

## Founder-only questions

**Four of the five are ANSWERED (2026-09-05). The answers and what each one ruled out are
recorded here rather than in a chat log, because a decision that is not written did not happen.**

1. ~~**The bands are reasoned, not measured. Do you want them measured before this is armed?**~~
   **ANSWERED (batch 44): the tiers stay UNARMED until a second Michigan edition has been carried
   in and measured.** Every constant in `upload-tier.ts` (20 % catalogue, 25 % share, 5 % median,
   50 % single move) is an argument, not an observation, because this repository holds ONE edition
   of one state book. The system records the real diff of every upload, so the second edition
   replaces all four with evidence.
   *Rejected: arm now on reasoned bands.* It would have shipped a false-positive rate nobody could
   state — a state that genuinely reprices its catalogue would hold every quarter, which is the
   "always two" rule the founder ruled out, arrived at by accident.

2. **Is 24 hours the right time before a lone person may admit their own book?**
   **ANSWERED: 24 hours stands, and it is PRINTED where the waiting book is shown.** Built: the
   endpoint sends `heldBookHoldHours` and both the silence sentence and the panel's waiting label
   name it. The panel never carries its own copy of the number — `ESCALATION_HOURS` is imported
   into the read service, so the number a reader is promised and the number the sweep waits out
   cannot drift.
   *Rejected: leaving it implied.* "Waiting for a second pair of eyes" with no clock beside it
   reads as "waiting indefinitely", which is the opposite of what the hold is for — it exists to
   bound how long one person can be blocked by another person's inbox.

3. ~~**Should a refused book be re-uploadable at all?**~~
   **ANSWERED: *"Owner reopens with a stated reason."*** An owner — never the person who refused
   it — may reopen a refused book **once**, with a reason; the reopening is a logged, sealed
   decision and the book goes back through the tier it was already in. The bytes stay one record
   and the decision history grows: the refusal is appended to `decision_history` and then cleared,
   because the row's own CHECK requires the three refusal columns to be empty once the status
   leaves `refused`. Built as `POST /price-index/uploads/:id/reopen` (owner-only, its own seal act
   `price_index_upload.reopen`, migration `20260906020000`).
   *Rejected: never — upload a corrected file.* That answers a doctored book and punishes a
   mistake, and it loses the thread: a corrected file is different bytes, so the refusal and the
   correction become two unrelated records and nobody can see that one followed the other.

4. ~~**US-CA, GB-ENG and both Türkiye groupings have exactly ONE owner-or-manager each.**~~
   **ANSWERED: *"Acceptable: reason + record."*** A lone owner-or-manager may admit their own book
   after the 24-hour hold with a stated reason; the row says `same_person` forever, and the index
   box on `/notifications` prints that basis in words — *"admitted by the same person who brought
   it in, because this jurisdiction has no second owner or manager — this is not a second pair of
   eyes"* — with the reason they gave beneath it. The reason is required by the service AND by
   `price_index_upload_reviews_second_person_is_another`, so a silent self-admission dressed as
   `attested` is refused by the database.
   *Rejected: block until a second person exists.* It would make the only route by which a state
   price reaches a Californian or British house permanently unusable, against GAO-25-107721 §10.23,
   which asks for an alternative control where segregation is not practical rather than for the
   process to stop.
   *Rejected: a Mudavym-side review list.* It would put this company between a house and its own
   state's published prices, and it is a control nobody in the house can see, audit or appeal.

5. **`admitted_at` is per row, so admitting a book is an UPDATE over every row it wrote** — 12,530
   for the real Michigan book. It is one indexed statement and it happens quarterly, and the
   alternative (filtering the read through a second query against the review table) fails open
   whenever that second read fails. Confirm the trade.

---

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (research + build, approval tiers) | **Created.** Answers ADR 0117 Q18 with a tier rather than a rule. **The census is the finding**: read-only against production and taken twice (the estate gained a house between the reads and the later figures are the ones of record), ten of fifteen houses have one owner-or-manager or none, and five of eight jurisdictions contain exactly ONE person — so "always two" is "never" for most of this estate, while US-MI (the only uploadable jurisdiction) has three people and a real second pair of eyes. **The adversarial pass changed the design**: a forged single price is 1 row in 12,530 and no band and no human reader will ever see it, so the tier is a SIZING control and the only evidence-producing confirmation is a byte comparison — which the confirm route now performs and records as `byte_match`, distinct from `attested`. Built: `upload-tier.ts` (pure), `price-index-review.service.ts` (pool, seal, admission, escalation), `price_index_upload_reviews` + `price_index_postings.admitted_at` + the seal kind (`20260905180000`), `MARKET_VISIBILITY` on every read, four routes, and the panel's waiting label. **Pre-fix proof, measured then deleted**: `git show HEAD:apps/api-gateway/src/price-index/price-index.service.ts` into a same-depth probe (HEAD was `b1d64869`; still pre-fix at `d84d8d39`) showed HEAD drawing a carried, unadmitted row as Michigan's index line, with no query asking anything about admission; the probe was removed and the measurement recorded in `price-index-held-book.spec.ts`'s header. `npx jest src/price-index src/common/seal` on the tree reported here: **230 passed / 21 suites**, of which **38 in 3 new suites** (`upload-tier`, `price-index-review`, `price-index-held-book`) plus **7 added to `price-index-upload.spec.ts`** are new here — 45 in total. Gateway `tsc --noEmit -p tsconfig.spec.json` clean; `check_gateway_boots.sh` PASS (the NotificationsModule forwardRef and SealModule resolve); `eslint --quiet` clean on the 12 touched gateway files (web eslint CANNOT run in this checkout at all: `eslint-plugin-jsx-a11y` is not installed anywhere in the tree). Web `vitest run src/pages/notifications/next`: **108 passed / 6 files**, 4 new. Curled live on the local gateway (production data, read-only): `GET /price-index/uploads` returns the no-jurisdiction sentence for the demo house, `GET /price-index/MI` returns `heldBooks: 0` with *"The index register could not be read. This is unknown, not empty."* — `price_index_postings` still does not exist on the production project, so this whole path is correct in code and inert there, as ADR 0117's 2026-09-05 row already recorded. The migration's in-file `DO $$` assertions are **UNEXECUTED**: Docker is down in this environment and no local Postgres was available. Nothing was written to any database, no flag was armed, and no upload was committed. Five founder questions. |
| 2026-09-05 | Claude (build, Q2/Q3/Q4) | **Q2, Q3 and Q4 answered by the founder and BUILT; Q1 answered earlier (batch 44) and recorded above.** Q3 — *"Owner reopens with a stated reason"*: `POST /price-index/uploads/:id/reopen` and its own seal challenge, owner-only at the guard and re-checked against the BOOK's jurisdiction, refused for the refuser, refused a second time on the same bytes with a sentence that names the date the door was used, and refused with no reason. The refusal is APPENDED to `decision_history` and then cleared, because 20260905180000's refusal CHECK forces the three columns empty once the status leaves `refused` — so the bytes stay one record and the history grows, exactly as the founder put it. `escalated_at` is cleared so the 24-hour hold restarts; without that, an owner reopening their own upload could self-admit in two requests. Migration `20260906020000` adds `reopened_at`/`reopened_by`/`reopen_reason`/`reopen_seal_id`/`decision_history` with all-or-nothing and history-kept CHECKs, both proven to refuse in-file. **A latent defect this question exposed:** `admittersFor` deduped a person by keeping whichever access row came back first, so an owner of one Michigan house who also manages another could be refused their own owner privilege on a coin flip — the dedupe now keeps the strongest role, with a test. Q4 — *"Acceptable: reason + record"*: the reason was already required by the service and by `price_index_upload_reviews_second_person_is_another`; what was missing was the RECORD being visible, so `GET /price-index/:state` now returns `carriedBooks` (sha256, file, edition, basis, reason) and `MarketIndexPanel` prints, beneath a carried line, that it *"was admitted by the same person who brought it in, because this jurisdiction has no second owner or manager — this is not a second pair of eyes"*. Only books whose lines are actually drawn are annotated, and a `null` from the gateway draws no basis rather than a guessed one. Q2 — 24 hours stands and is PRINTED: `heldBookHoldHours` travels on the wire and `ESCALATION_HOURS` is imported into the read service, so the panel never carries its own copy of the number. **Both are dark until arming**: no review row can exist unless an upload was committed with `PRICE_INDEX_UPLOAD_ENABLED` armed (`price-index-upload.spec.ts` "refuses a commit while the flag is off"), and the flag stays off per Q1. `npx jest src/price-index src/common/seal`: **244 passed / 21 suites**, 14 of them new here (10 reopen cases in `price-index-review.spec.ts`, 4 basis-and-hold cases in `price-index-held-book.spec.ts`). `npx vitest run src/pages/notifications/next`: **128 passed / 7 files**, 6 of them new here. Gateway and web `tsc` clean of my files; `check_money_routes_are_sealed`, `check_route_exposure`, `check_read_errors_not_swallowed`, `check_windowed_figures` all exit 0. The migration's in-file assertions are **UNEXECUTED** — Docker is still down here. |

## Review trail, continued (parent, 2026-09-05)

| Date | Who | What |
|---|---|---|
| 2026-09-05 | Claude (parent) | Migration `20260906020000` PROVEN on PGlite after the commit that said it was not: `p4-scratch/pglite-probe/p4at-reopen.mjs` applies the real chain `20260904200000 -> 20260905160000 -> 20260905180000 -> 20260906020000` on stubbed parents (users, restaurants, mcp_seal_challenges): applies, idempotent, the five reopen columns exist, both reopen CHECKs present — 7 passed / 0 failed. |
| 2026-09-05 | Claude (parent) | Correction: the commit message of d965ae4e said "gateway tsc: 0 errors"; that was measured with tsconfig.json only. Under tsconfig.spec.json two test-file type errors existed at that tip (an archive spec mock, a main-merged notifications spec), fixed in 7bbc37c9. The ADR's own review row above ("clean of my files") was accurate. |

## The census, on the founder's word (2026-09-05, batch 56)

Asked directly whether the fifteen houses this ADR's census counts are real, independently
owned restaurants or test tenants, the founder answered **"All real."** The census stands as
counted; the jurisdiction-by-jurisdiction figures above are figures about real houses.
