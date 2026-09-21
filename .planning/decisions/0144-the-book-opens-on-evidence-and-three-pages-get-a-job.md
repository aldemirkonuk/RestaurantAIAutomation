# 0144 — The book opens on evidence, and three pages are given a job

- **Status:** Locked on four founder calls, 2026-09-12, in session. **[AMENDED 2026-09-16 by [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] rows 11, 13 and 16: the arrival's threshold, `/onboarding` redirect and tutorial action boxes; a correction to section 3's count of locked records; and the `/authorize` residue. Answered, not built. Each is a bracket at the sentence it touches.]** **[2026-09-19, founder batch 4, KL lane — three of the four residue items below answered and two built; see the Review trail and the bracket at each.]** **[2026-09-21, KL lane round 5 — the `/authorize` frame built 2026-09-19 was a regression (no masthead at all on `/authorize/:integrationId` with the flag on); corrected, one frame for both routes, plus three attribution relabels. See the Review trail and the bracket at each.]**
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

## Amendment, 2026-09-17 — what the `/authorize` lane actually built, and the defect a first fix round missed

Two fix rounds on `feat/p1-readout` worktree `wt-fin-KL` built the seal
ceremony this record specifies at line 135 above, and a second round closed a
defect the first round's own tests did not cover. Recorded per CLAUDE.md
§0.4/§4 — this is an amendment to an existing record, not a new document, so
the retire-to-write rule does not apply.

**Founder's row 16 answer** (ADR 0149's table, quoted verbatim): *"The
disclosure and every factual claim the page makes are served by the gateway
and sealed; the connection keeps the seal id and words digest as a receipt;
each return page reads the outcome."*

**What was built, matching the design at line 135 above:**
- A seal challenge is minted when the hold starts and redeemed once by
  `POST /integrations/oauth/:integrationId/authorize`
  (`integration-consent.service.ts`), bound to the integration id, the house,
  a digest of the exact disclosure words shown, and a browser-proof hash the
  sealing tab alone holds the preimage of.
- The provider callback (`GET /integrations/oauth/:provider/callback`,
  `@Public()` by necessity — the provider calls it, not the user's session)
  never exchanges a code. It only PARKS an encrypted `{code|error}` payload on
  the single-use state row and redirects the browser to
  `/authorize/complete#state=...&request=...&delivery=...` — the `delivery`
  fragment is the round-2 delivery secret described below; a bullet showing
  the pre-round-2 shape without it would describe a completed grant that no
  longer completes
  (`integrations-oauth.service.ts:handleCallback`).
- Completion is a second, also-`@Public()` route,
  `POST /integrations/oauth/complete`, requiring BOTH the tab-held proof and
  the delivery secret from that same redirect fragment, and
  claiming the parked payload atomically (`consumed_at IS NULL`) before the
  PKCE-verified token exchange runs (`completeCallback`/`consumeBrowserState`).
- PKCE S256 is used on both legs (`buildProviderUrl` / `exchangeCode`).
- The receipt (`integration_consent_receipts`, migration `20260921111100`) is
  append-only — `service_role` INSERT/SELECT only, no UPDATE/DELETE grantable
  to anyone, asserted by a DO block at the end of its own migration — and the
  connection row names it (`consent_receipt_id`).
- `IntegrationReturnNotice` reads the outcome on the return page, for both the
  manager and the non-manager branch (the manager branch was a gap the first
  fix round closed).

**D1, the defect this amendment exists to record.** The first fix round closed
only the two-callback race — `poisonState` firing when a SECOND provider
callback finds nothing left to park. It left open the ONE-callback attack that
a naive reading of "bound to the browser that sealed it" does not close by
itself: a dishonest sealer mints her own proof, never clicks Allow, and
forwards the bare provider URL to someone else. Exactly one callback occurs,
so the double-callback defence never fires. When the other person clicks
Allow, their provider code parks under the sealer's state; the sealer — who
never received that redirect — still holds her own original proof (it was
never anything the OTHER person had) and can complete with it, binding a
stranger's provider account into her own house. The connection would record
the sealer as owner; `assertConsentMembership` checks the sealer, who is a
genuine member, so it would have passed.

The second fix round (2026-09-17) closed this with a second, independent
secret: `browser_delivery_secret_hash` (migration `20260921111100`, column
added this round), minted fresh only when a callback actually parks a result,
sent ONLY in that redirect's own fragment, and required alongside the sealing
proof at `/authorize/complete`. The sealer's proof is chosen before any
redirect exists and can be forwarded; the delivery secret cannot, because it
does not exist until a real provider round trip completes, and it travels
only to whichever browser that round trip returns to. Completing now needs
BOTH, from the SAME browser. A completion attempt holding only one of the two
POISONS the state (`consumeBrowserState`), so a later, correct-looking retry
by either party also fails. Proven in `integration-consent.spec.ts`'s describe
block *"completing a grant needs the delivery secret from THIS callback, not
just the sealing proof (KL audit D1, round 2)"*: a sealer holding only her
proof is refused and cannot retry even with the real secret afterward; the
browser that only received the callback, holding no proof, is refused the
same way and poisons the state against the sealer too; and a legitimate
single-browser completion is proven to bind only to the user/house recorded
when the state was minted, never to anything the completing call supplies —
the public `IntegrationConsentCompleteDto` carries no user or house field at
all, by construction.

**Deploy-window consequence of this fix (found by the round-2 confirmer,
recorded here per CLAUDE.md 0.5 — not a shortcut, but a cost worth naming).**
A state row parked by a gateway instance running BEFORE this round has no
`browser_delivery_secret_hash` column value to check; completing it against
an instance running AFTER this round is refused (missing delivery secret),
cleanly — nothing is written, no token is exchanged, and the state is left
unpoisoned so the person can restart the grant. During a rolling deploy this
can refuse an in-flight grant for as long as a state row stays alive, which
is `STATE_TTL_MS` (`integrations-oauth.service.ts:35`) — 10 minutes.

**Also fixed this round:**
- Migrations `20260921111000` and `20260921111100` are now idempotent
  (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and the DO-block
  guard idiom from `20260902210000` for the one `ADD CONSTRAINT`, which has no
  `IF NOT EXISTS` form of its own) — a re-application (a repeated
  `supabase db push`, a rebuilt shadow database) is now a no-op rather than a
  42P07/42701/42710. Proven at runtime, applying each migration twice, in a
  fresh PGlite build (36/36 checks).
- `CompleteIntegrationConsent.tsx`'s error exit pointed at `/connections`, a
  managers-only page; a staff person refused there landed on a page they
  cannot open. It now points at `/profile`, the same page `PublicShell`'s own
  `homeHref` already uses.

**Still open, not settled by row 16 or any other ADR 0149 row (carried from
the first fix round's judge, unchanged this round):**
- Consent copy still says "WineOps" in three places and one sentence carries
  raw identifier backticks — a repo-wide rename question, not scoped to this
  page, since three other lanes' tests pin the exact "WineOps" string today.
- Tab vs. browser binding: this decision's words say "the browser that sealed
  it"; the build binds to the TAB (`sessionStorage`), so a second tab of the
  same browser is refused. The D1 fix above is orthogonal to this question —
  it is about a second PERSON, not a second tab of one person.
  **[CONFIRMED 2026-09-19, founder batch 4 — the recorded answer, not a
  quotation (see the paraphrase note dated 2026-09-21 below the amendment
  heading): provider grant stays tab-scoped. The build's narrower promise
  stands as built; no change made.]**
- `/authorize` and `/authorize/complete` render on `PublicShell`, built for
  signed-OUT pages, for a signed-IN ceremony; `/authorize/complete` also
  ignores the house's design flag and the ADR 0133 public-door switch.
  **[ANSWERED AND BUILT 2026-09-19, founder batch 4, on `/authorize` and
  `/authorize/complete` — his words, verbatim: "do what's needed, not short
  term" -> give both pages a proper signed-in frame that honours the design
  flag and the ADR 0133 public-door switch, instead of `PublicShell`. Built
  this round as `AuthorizeShell`
  (`apps/web/src/pages/authorize-integration/AuthorizeShell.tsx`): a house
  known via `AuthContext` is gated on the per-house flag
  (`useMudavymDesign('authorize_integration')`, the same flag
  `/authorize/:integrationId` already carries via `PageGate`); no house known
  (a lapsed session on the return leg) falls back to the ADR 0133 public-door
  switch (`usePublicDesign`) rather than defaulting to legacy for an
  unrelated reason. Flag/switch OFF still renders `PublicShell` unchanged --
  byte for byte today's page. Flag ON renders a light, signed-in-capable
  frame that never imports `DashboardLayout` or its sidebar nav, preserving
  App.tsx's own reason for keeping this ceremony outside it ("a decision
  point... sidebar navigation... would only offer ways to wander off
  mid-grant"); `/authorize/:integrationId`'s Next component uses
  `chrome="ambient"` (content only -- `PageGate` already mounts a
  `HouseHeader` above it) so the redesign no longer draws two competing
  signed-in mastheads on one screen, a defect this fix incidentally closes
  along the way. No founder-reviewed sketch exists for this ceremony's
  signed-in visual treatment, so no new chrome was invented beyond reusing
  `PublicShell`'s own tokens and structural classes -- the same
  delegate-the-shape split ADR 0144 §2 drew for `/help`. Tests:
  `AuthorizeShell.test.tsx` (12 cases) plus the pre-existing
  `consent-flow.test.tsx` (8 cases, unmodified, still green).]**
  **[CORRECTED 2026-09-21 — the sentence above naming `chrome="ambient"` and
  a `HouseHeader` `PageGate` mounts was FALSE, and it was a regression, not a
  detail. `authorize_integration` is listed in `NO_CHROME`
  (`apps/web/src/lib/mudavym/pageNames.ts`) precisely so this ceremony gets
  no app-wide chrome, and `HouseHeader` returns `null` for any `NO_CHROME`
  page (`apps/web/src/components/mudavym/HouseHeader.tsx`). So with the
  design flag ON, `/authorize/:integrationId` had NO masthead at all — no
  wordmark, no skip link, no exit link — while `/authorize/complete`'s
  `chrome="own"` frame drew a Wordmark with no identity claim, indistinguishable
  from `PublicShell`. Confirmed with a DOM probe mounting `PageGate` with the
  flag on: 1 wordmark and 2 links before this build, 0 and 0 after. Round 5
  (2026-09-21) fixed this: the `chrome` prop and its two-mode split are
  deleted. `AuthorizeShell` now has exactly ONE design-ON frame, used
  unconditionally by both call sites, which additionally states WHO is
  granting (`AuthContext.user.name`) and FOR WHICH HOUSE (the matching
  `AuthContext.availableRestaurants` entry) whenever a house is known — no
  navigation accompanies it, only the shell's pre-existing single exit link —
  and falls back to the plain Wordmark signature with no identity claim only
  when no house is known. Tests: `AuthorizeShell.test.tsx` (14 cases,
  replacing the `chrome="ambient"` describe block with one covering the
  identity frame) plus `consent-flow.test.tsx` (10 cases — re-measured at 9
  pre-existing and unmodified, correcting this same bracket's earlier "8"
  above, plus 1 new: a `PageGate`-mounted regression test proving the exact
  defect this correction describes, shown failing against the pre-round-5
  code and passing after). Verified against a real browser too, not only
  jsdom: a temporary, uncommitted Vite harness mounted the actual
  `AuthorizeShell.tsx` through Playwright, confirming design OFF renders
  literally `.mudavym.mdv-pub` (no `mdv-auth-shell` class — real
  `PublicShell`), design ON with no house renders `.mdv-auth-shell` alone,
  and design ON with a house renders `.mdv-auth-shell.mdv-auth-shell--identity`
  with the identity text present and exactly two links (the skip link and
  the `/profile` exit) — no navigation. `apps/web` `tsc --noEmit` clean.]**
- `integration_consent_receipts` is `ON DELETE CASCADE` with the user and the
  house; whether a consent record should outlive the account it was made on
  is undecided.
  **[CONFIRMED 2026-09-19, founder batch 4 — the recorded answer, not a
  quotation: consent receipts delete with the account. The existing
  `ON DELETE CASCADE`
  (`supabase/migrations/20260921111100_integration_consent_receipts.sql`) is
  the intended behaviour; no migration change made.]**

**Paraphrase note, added 2026-09-21 (round 5, KL must-fix 6).** Two of the
three brackets above previously read "his words: \"...\"" around text the
founder did not say verbatim. On this ceremony, across the whole 2026-09-19
session, his only two
verbatim sentences are quoted in full above: *"do what's needed, not short
term"* (the frame question) and, on `/ask`'s roles (a different record —
[[0145-mudavym-answers-out-of-a-reading]]), *"do not give money or sensitive
incentives like sales etc to the staff, maybe we should exclude staff from
this equation."* Everything else attributed to him above — "provider grant =
tab scope OK", "consent receipts = delete with the account", and the
"/authorize and /authorize/complete:" preamble that used to precede the real
quote — is this session's own paraphrase of what he confirmed, not something
he said in those words. Relabelled in place; no answer changes.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | KL lane, round 5 (fixing a round-4 review's must-fix list) | Corrected a regression the 2026-09-19 row below shipped: `/authorize/:integrationId` had no masthead at all with the design flag on, because `PageGate` never mounts a working `HouseHeader` for a `NO_CHROME` page. `AuthorizeShell`'s `chrome="own"`/`chrome="ambient"` split is deleted; one frame now states who is granting and for which house when `AuthContext` knows one, with no navigation, and falls back to a plain Wordmark signature otherwise. Also relabelled three paraphrases that had been recorded as the founder's verbatim words as the recorded answers they actually are (see the paraphrase note above). Brackets and the code both changed this round — see AuthorizeShell.tsx's own file header for the full correction |
| 2026-09-19 | Aldemir (founder, batch 4), built same day by KL lane | Answered three of the four residue items: tab-scope binding confirmed as built (no change); consent-receipt cascade confirmed as intended (no change); `/authorize` + `/authorize/complete` given a proper signed-in frame (`AuthorizeShell`) honouring the design flag and the ADR 0133 public-door switch, replacing `PublicShell`. The WineOps-copy item stays open, unscoped. Brackets only, nothing rewritten |
| 2026-09-17 | KL lane (2 fix rounds) | Built `/authorize` per line 135 and row 16 of ADR 0149; closed D1 (account injection via a one-callback forwarded provider URL) with a second, delivery-secret binding; made migrations `20260921111000`/`111100` idempotent; fixed the error exit's dead-end link. See amendment above |
| 2026-09-16 | Aldemir, via ADR 0149 | Rows 11, 13, 16: threshold on folio 2, `/onboarding` redirect, tutorial action boxes for review; "six locked ADRs" corrected to the measured statuses; `/authorize` serves and seals its disclosure and claims, keeps the seal id and words digest, and each return page reads the outcome. Brackets only, nothing rewritten |
| 2026-09-12 | Aldemir | Four calls: folio 0 is the last invoice and is skippable; `/help` is the FAQ with the house's own state; `/vendor-prices` is the price register with identity as a drawer; `/promotions` is the money page and dismissal is house-wide |
| 2026-09-12 | — | Created. Answers the one question [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] left open by design |
