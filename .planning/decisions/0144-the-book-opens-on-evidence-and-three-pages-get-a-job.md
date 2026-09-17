# 0144 — The book opens on evidence, and three pages are given a job

- **Status:** Locked on four founder calls, 2026-09-12, in session. **[AMENDED 2026-09-16 by [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] rows 11, 13 and 16: the arrival's threshold, `/onboarding` redirect and tutorial action boxes; a correction to section 3's count of locked records; and the `/authorize` residue. Answered, not built. Each is a bracket at the sentence it touches.]**
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** mudavym, onboarding, folio zero, first evidence, help, vendor-prices, price register, promotions, offers, landed cost, design wave
- **Links:** [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] (the same wave's first six answers; this record answers its one open question), [[0108-a-register-is-the-houses-own-books-first]], [[0113-the-assistant-proposes-the-seal-applies]], [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]], [[0124-a-bottle-has-one-identity-and-every-price-names-it]], [[0042-iznik-seal-and-warm-charcoal]]

## Context

[[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] answered six of the
twelve questions the handover analysis raised, and deliberately left one thing
open rather than infer it: whether sketch 104's **direction A** — photograph the
last invoice through the door, then read every register off what the paper said —
opens the book the founder chose. He had named the flyleaf, the contents page,
the talking and the held seal. He had not named the photograph, and it was the
direction I had recommended, so reading it into his silence would have been
exactly the "sensible default" CLAUDE.md §0.1 forbids.

Three more pages had a verdict but no direction: `/help` (*"KEEP. New one
better"*), `/vendor-prices` (*"KEEP+ / more functional"*), and `/promotions`
(*"add more striking aspects"*, which is a mood, not a brief).

## Decision

### 1. Folio 0 is the last invoice through the door, and it is skippable

The contents page opens with a folio that is not a setting: **the last invoice
through the door**. A house that photographs one gets its registers *proposed*
with a provenance — currency, the vendor, terms, what the house pours — and
confirms them in place [CLARIFIED 2026-09-12 by the founder, in ADR 0143's founder answers: a proposal confirmed in place still enters the book with the one held seal, together with everything else Mudavym proposed; only what the person typed posts at once], so nothing is asked that the paper already answered and
nothing is guessed, which is what [[0108-a-register-is-the-houses-own-books-first]] demands
in general and this makes literal at the arrival.

A house that skips it **records the skip as a fact** and opens at folio 1 with
nothing lost. That is the whole reason direction C's book was the right spine:
a folio is a page with a state, not a step in a flow, so the one real weakness of
direction A — a house with no invoice has nothing to start from — stops being a
wall and becomes a folio carried forward.

The founder rejected making it required. A house that genuinely has no invoice to
hand must still be able to open its book on day one.

**Known gaps, which are build tasks under this record and must read as "not yet
answered" rather than silently doing nothing:** the extractor has no
payment-terms field, so terms stay typed either way; nothing matches the paper's
vendor name to a provider, so the person is the match; and register inference
reads house items rather than document lines, so "what it pours" can only be
proposed after the lines become items.

### 2. `/help` is the FAQ with the house's own state on top

Not a support desk. There is no ticketing backend and no status page, and a page
that offers a ticket it cannot track would be the claim
[[0083-a-page-may-not-claim-a-write-it-never-makes]] forbids.

So: the answers people actually search for, and above them a readiness line drawn
from what the gateway **already knows** — which connections are live, what is
waiting on the house, what last failed. No invented apparatus. It is the one page
today that tells a house nothing about itself, and this is the cheapest honest
fix for that.

Rejected: the support desk (a new service, not a page). Rejected: leaving it as a
bare FAQ.

### 3. `/vendor-prices` is the price register; identity is a drawer inside it

The page does two jobs today and reads as neither. It becomes **the price
register**: pick a bottle, see every vendor's observed price side by side with
source provenance and 7/30/90-day trend chips, record a manually observed price.
One question answered well — what does this bottle cost, from whom, on what
evidence, and which way is it moving.

The **identity decisions log** stays reachable, as a panel opened from a row
rather than a co-equal tab, because that is what it actually is: the provenance
behind a price. Six locked ADRs already constrain what this page may *say*
([[0117-a-price-sighting-names-its-source-its-date-and-its-unit]],
[[0124-a-bottle-has-one-identity-and-every-price-names-it]] and the four beside
them); none of them said what it *is*.
[CORRECTED 2026-09-16: "six locked ADRs" was not true when written — both records named were
Proposed on 2026-09-12, and the other four were never named. Measured on 2026-09-16 over the
ADRs `06-pages/vendor-prices.md` cites, reading each file's Status line: **Locked** — 0124 and
0126 (both locked that day by the founder, ADR 0149 row 13) and the cross-cutting 0016 and
0020; **Proposed** — 0117 and 0128 (kept Proposed by the same row), 0125 and 0078. Row 13 adds
the rule that applies here: the page builds only on built behaviour.]

This also fixes the page's oddest property as a consequence rather than as a
separate repair: it is **unreachable by navigation** — no page links to it. A
register earns a link from the cellar and from a document; two co-equal tabs with
no clear entry point do not.

Rejected: two equal tabs (the identity queue has no volume yet to justify equal
billing). Rejected: splitting into two routes (a new route to design and gate,
and the provenance behind a price stops being one click away).

### 4. `/promotions` is the money page: what this offer is worth to *this* house

"Striking" here is not decoration, it is **the number**. An offer is shown
against what the house actually pays for that item today — the price register
already knows — so the page says *"12% under your last landed cost, on a bottle
you bought 40 of last quarter"* instead of relaying the vendor's claim and
leaving the arithmetic to a person.

**An offer on an item with no purchase history can only say so, and it must.** A
zero there would be the fabrication [[0020-no-fabricated-answers]] refuses and
the shape [[0083-a-page-may-not-claim-a-write-it-never-makes]] names; "we have
never bought this" is the honest and, for a buyer, the more useful sentence.

Dismissal becomes a **house-wide act**, not per-device. A peer session's migration
`20260911160000` already assumes this; the decision is now recorded rather than
implied by a schema.

Rejected: leading with senders and trust (duplicates `/communications`, and
leaves the offers as plain relayed claims). Rejected: leaving it three plain tabs
until the supply pipeline leaves shadow mode — shadow mode has no end date, and
the page would stay the least finished surface in the product indefinitely.

## Consequences

- The arrival is now fully specified: direction C's flyleaf and contents page,
  folio 0 as the last invoice, spoken input landing as rows with a provenance,
  one held seal on the batch. Nothing about `/get-started` or `/onboarding` is
  waiting on a founder call any more.
  [ADDED 2026-09-16, ADR 0149 row 11: the house-wide low-stock threshold is one line on
  folio 2; `/onboarding` redirects permanently to `/get-started`; and, in the founder's
  words, *"+ improve the UI for tutorial action boxes"* — drawn as sketch 115 for his
  review before it is built. Also carried into ADR 0143.]
- `/vendor-prices` gains a link from the cellar and from a document, which is a
  change to two pages outside itself.
- `/promotions` becomes a consumer of the price register, so the two pages are
  coupled: the offer comparison is only as honest as the register's landed cost,
  and where the register has nothing the page must say so.
- The `configuration_step_skipped` writer still does not exist. Folio 0's skip is
  a recorded fact by this decision and an unwritten row in the code, and until
  that writer lands, "offered and skipped" cannot be told from "never opened".
  That is the first build task under item 1, not a detail.

## What this decision does NOT settle

- `/login` and `/register` — answered separately the same day (improve today's
  pages in place, no redraw), and recorded with the wave's build brief rather
  than here.
- `/authorize/:integrationId` — answered the same day (the seal ceremony with the
  server's verbatim words held intact), likewise.
  [ANSWERED FURTHER 2026-09-12 by the founder: the seal on `/authorize` is a **server challenge, redeemed at authorize** -- minted when the hold starts and spent once by the authorize call, bound to the integration id, a digest of the exact words the person was shown, and the retention figure. The provider URL is bound to the browser that sealed it, so a leaked link cannot complete the grant elsewhere. That is a third seal kind and a migration, and it extends the founder's 2026-09-04 decision -- challenge-and-redeem for sealing an order and changing how the house pays, ordinary sealed settings left as a logged assertion -- by one place: a grant that opens the house's documents to an outside provider. Rejected: a deliberate hold, logged only (anything holding a session could post authorize without one); the passkey-backed house seal of ADR 0112 (its ledger, authority rule and step-up are not built).]
  [ANSWERED FURTHER 2026-09-16 by the founder, ADR 0149 row 16 — the residue: **the disclosure and every factual claim the page makes are served by the gateway and sealed**, never written into the page; **the connection keeps the seal id and the words digest as its receipt**; and **each return page reads the outcome** rather than assuming it. Answered, not built.]
- `/ask` — [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]]
  defers the assistant's design to its own record *after a research fan-out*. The
  fan-out has not run. Nothing about `/ask` is decided here and nothing should be
  built for it until that record exists.
- `/recommendations/catalog` and the public-document treatment for `/privacy` and
  `/v/:slug` beyond the shared shell.
- Whether any surface other than the sommelier reads the database directly from
  the browser on the anon key. That measurement has still not been run.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-16 | Aldemir, via ADR 0149 | Rows 11, 13, 16: threshold on folio 2, `/onboarding` redirect, tutorial action boxes for review; "six locked ADRs" corrected to the measured statuses; `/authorize` serves and seals its disclosure and claims, keeps the seal id and words digest, and each return page reads the outcome. Brackets only, nothing rewritten |
| 2026-09-12 | Aldemir | Four calls: folio 0 is the last invoice and is skippable; `/help` is the FAQ with the house's own state; `/vendor-prices` is the price register with identity as a drawer; `/promotions` is the money page and dismissal is house-wide |
| 2026-09-12 | — | Created. Answers the one question [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] left open by design |
