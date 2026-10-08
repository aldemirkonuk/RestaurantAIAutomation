# 0313 — An order-request letter is house prose around fact blocks

- **Status:** Proposed. Decided by executor R2 under the founder's 2026-10-07T20:04:10Z delegation ("Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers"). It is the coordinator lane's call, not the founder's pick, and he may override it. F3 (the default words, number-word lists, TR/EN) and F9 stay his.
- **Date:** 2026-10-08
- **Decider:** executor R2 (coordinator d3's lane), under the delegation above; the founder's override stands over it
- **Keywords:** W25, F5, order_request, LETTER_CATEGORIES, renderer, fact blocks, prose predicate, PR-4a, ORDER_REQUEST
- **Links:** [[0266-an-orders-vendor-letter-is-staged-once]] (F2, F4, F5 at :37, the PR split), [[0173]] D2/D4 (template guardrails, roles), [[0260-communications-walk-through-r2-rulings]] (W25). Research: `p4-scratch/review-snap-2/research/w25-f106-design-2026-10-02.md` §3; `w25-pr4a-f5-rescope-2026-10-08.md`; `w25-pr4a-f5-adversary-2026-10-08.md`.

## Context

ADR 0266 F5: the founder ruled "Editable now" against the recommendation. The order request becomes a sixth `LETTER_CATEGORIES` purpose (`house-letters.service.ts:156-165`), and its template writes get an owner/manager guard and 0173 D2's guardrails. The 2026-10-02 design (§3) had a deterministic renderer with no house editing, so PR-4a had to be re-scoped.

Measured at c4005eb09 (the re-scope, confirmed by the adversary):
- There is no server merge engine. The composer pastes a template verbatim, and the queue refuses any `{{…}}` left in it (`ComposeSheet.tsx:221-228`, `composer-guardrails.ts:101-108`).
- None of 0173 D2's guardrails are in code: no versions, no draft or publish step, no preview, no reset.
- Template writes have no role guard. `house-letters-drafts-roles.spec.ts:186-200` pins the five purposes open to staff.
- `procurement_orders.created_by` is NULL on recurring orders.
- A no-price order stores `final_price = 0` (`procurement.service.ts:1076`).

## Options considered

1. **A — fixed prose slots.** The house edits a few named sentences, and the renderer places them around the facts. Safest, but it is close to read-only. It does not meet "Editable now" as F5 was asked: "a sixth purpose", edited like the other five.
2. **B — house prose around block tokens (chosen).** The house writes the body. A closed set of tokens each stand for a whole block, never a single figure:
   - required: `{{greeting}}`, `{{order_lines}}`, `{{ask}}`, `{{signer}}`;
   - optional: deliver-to, needed-by, payment terms, the courtesy line.

   There is no price, quantity or order-number token. The renderer owns the subject and the Mudavym line (F4), and the facts hash covers every fact any template can show.
3. **C — full body plus a checker.** The house writes everything, and a validator compares the figures. This gives the house the most freedom and is the hardest to make safe; a missed figure reaches a vendor. (F2 at 0266:35 rejected the *AI* writing the whole body. That is a different author, so it is not cited against C.)
4. **Do nothing.** F5 stays unbuilt and PR-4b drafts from fixed words. That goes against a founder ruling.

## Decision

B, with the adversary's eleven required changes.

- **Predicate on the house's prose** (everything outside the tokens), run at save and at publish:
  - Normalise first: NFKC, then strip `\p{Cf}`.
  - Refuse any `\p{N}` and any `\p{Sc}`, ISO currency codes and currency words, any URL or bare domain, and any `{` `}` `<` `>` left after the tokens are removed.
  - Refuse an unknown or missing required token.
  - Refuse money-and-terms words in EN and TR: price/fiyat, free/bedava, discount/indirim, payment/ödeme/vade.
  - Refuse the commitment patterns.
  - Weekdays, months and Turkish number words are not refused by list, because they collide with everyday words (bir, on, Pazar, Ocak, May). Number words are part of F3: EN "two" and up plus dozen/hundred are proposed; TR refuses a number word only when it is followed by a unit or currency noun. 4a-i enforces this proposal as written (fail-safe while F3 is open; it changes only what a house may save in 4a-ii and which courtesy lines are dropped). Email addresses (`@`) are refused with links.
- **The invariant is stated narrowly:** no numeral, currency symbol, link or figure token outside the blocks. It is not "by construction". Figures by reference ("same price as last time", "free delivery" in a language not listed, "by Friday") can still get through. The house's own reading is the backstop, as 0173:48 already accepts.
- **Price comes from the order line** (`procurement_order_items`: `final_unit_price`, then negotiated, then quoted, the price already told under W12c F7), and only when the placer is an owner or manager (W12b F6). A header price of 0 with no positive line price means "no price on file": `{{ask}}` then asks for a price and never says "confirm". [Corrected 2026-10-08 at build: this first cited `readAgreedLine` (`procurement.service.ts:2497`). It is private to `ProcurementService`, reads `final_unit_price` only, and maps a NULL price to 0 (`Number(null)`), so 4a-i reads the line itself and treats NULL or 0 as no price.] A NULL `created_by`, or a placer with no role, fails closed: quantities only, and the house alone as signer.
- **Guard scope (fork R2): only `order_request`.** Writes to it need owner or manager, and the role is checked against the *stored* category, so staff cannot switch a row's purpose to get around the guard (`TemplateSheet.tsx:403-414`, HLS `:1532-1549`). The five composer purposes stay as they are. They are a decided, working feature that the spec pins open, and 0173 D4 is about the catalogue, while 0173:60 leaves vendor-letter storage open. An OD row asks whether D4 reaches them.
- **Split:**
  - **4a-i** (`feat/w25-order-request-renderer`) ships no template write. It holds the renderer, the internal door, the `ORDER_REQUEST` kind and the default words.
  - **4a-ii** (`feat/w25-order-request-editable`) adds `order_request` to `LETTER_CATEGORIES`, plus the predicate on writes, versions, publish, preview, reset and the role guard. It never auto-publishes a body saved earlier, and it refuses a duplicate `order_request` row by name.
  - **PR-4b's flag** waits for both F3 and 4a-ii.
- **Other forks, decided on evidence:**
  - R3: versions go in a new append-only `letter_template_versions` table.
  - R5: a template edit does not make a waiting letter stale; only the facts hash does.
  - R7: the renderer owns the subject.
  - R8: `order_request` is kept out of the composer's template picker.
  - R11: this decision gets a new ADR rather than an amendment to 0266.
  - R13: a published house version is never touched when the default changes; a notice is shown instead.
  - R4 (a `locale` key on versions, default `en`) is part of F3. It is built now, and he may change it.
- **The internal door** (`POST /internal/letters/order-request`, `@Public()` + `ServiceKeyGuard`) takes `restaurant_id` from the order row, never from the request body. `check_route_exposure.py` reports it as "public", so a mutation-tested CLAIMS row is its real guard.

## Consequences

- The house writes its own order letter, and no figure it types reaches a vendor; figures come only from the facts blocks.
- Some legitimate prose is refused: a digit in "2 days", or "free" in a sentence. The refusal names the class.
- The commitment patterns have no Turkish entries (`commitment-patterns.ts:30-50`), so that check does nothing for the Turkish house. Adding Turkish patterns is a separate lane.
- ServiceKeyGuard is the founder's `ADMIN_API_KEY`. The precedent is `ux-optimizer.controller.ts:66-79`.
- **Revisit when:**
  - F3 is answered (the words and number-word lists);
  - a vendor letter is reported carrying a figure the order does not hold;
  - the OD on 0173 D4's reach is answered;
  - Turkish commitment patterns land.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | — | Created, executor R2, branch feat/w25-order-request-renderer (4a-i). Re-scope by one research agent; an adversary pass upheld B with 11 required changes, and all are adopted above |
