> Annex to [ADR 0103](0103-a-delivery-is-agreed-before-it-is-verified.md) and [ADR 0104](0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md) — a Sonnet adversary pass run 2026-09-03 before any build, at the founder's request that the irsaliye process be bulletproofed. Findings are folded into the ADRs' amendment sections; this file is the evidence, not the decision. Paths inside refer to the session scratchpad and are historical.

# Adversarial review — ADR 0103 (delivery agreed before verified) & ADR 0104 (canonical document)

Read-only. Web research read 2026-09-03/04. `[F]` = sourced fact with URL, `[J]` = judgement.
Goal: kill the decisions, not improve them. Ranked by likelihood of being decisive.

## Verdict summary

| # | Attack | Axis | Verdict |
|---|---|---|---|
| 1 | Consolidated/split invoicing breaks "delivery is the unit of record" | Model | **LANDS — decisive, unaddressed** |
| 2 | Door step won't be used → flow degrades to the option the ADR rejected | Behavioural | **LANDS — decisive, unaddressed, self-contradicting sequencing** |
| 3 | Turkish incumbents already ship kabul/kısmi kabul/red as a product button | Premise | **NEAR-DECISIVE — narrows the differentiator claim** |
| 4 | Clocks are built on the research's own admitted-uncertain legal basis | Legal | **NEAR-DECISIVE — D4 locks what the research calls unresolved** |
| 5 | Monetisation thesis has zero market evidence | Economic | **MODERATE — score should drop, decision survives** |
| 6 | "Silence never agreement" + LAPSED risks misleading a manager | Legal | **MODERATE — largely answered, UI-communication gap open** |
| 7 | Layer 1 is structurally empty for the fields that differentiate the product | Model | **MINOR — temper the claim** |
| 8 | Ingesting signed XML makes Mudavym a party to e-fatura obligations | Legal | **DOES NOT LAND — evidence supports the ADR's own scoping** |
| 9 | Storing originals abroad violates VUK GT 509 localisation | Legal | **DOES NOT LAND — ADR flags this itself; my search corroborates the carve-out** |
| — | Simplest 80%-value design | Simplicity | real alternative, founder's call — §10 |

---

## 1. Model — "delivery" is not a stable unit of record (LANDS)

**Strongest form.** 0103 D1 / 0104 D7 make the delivery the spine: "One physical
delivery… is what the PO, the door document, the door count, the invoice and the credit
memo attach to." This assumes a document maps to *one* delivery. It doesn't:

- **Many deliveries → one invoice.** "Many suppliers — particularly produce merchants,
  dairy co-ops, and imported goods distributors — send consolidated weekly invoices
  covering multiple deliveries… invoice matching automation works on an assumption [that
  breaks]: one delivery creates one invoice, one invoice matches one PO… [instead it's] a
  one-to-many relationship." [F — invoicedataextraction.com/blog/food-and-beverage-
  distributor-invoice-processing and .../restaurant-invoice-management, read 2026-09-03]
- **One delivery → many invoices/entities.** Split shipments each carry their own partial
  invoice [F — uphance.com/blog/manage-split-orders-shipments, read 2026-09-03]; "a
  supplier may consolidate several shipments into one month-end invoice… or combine
  charges from separate requisitions" [F — invoicedataextraction.com/blog/one-vendor-
  invoice-multiple-purchase-orders, read 2026-09-03]. A single truck can carry wine under
  one distributor entity/VKN and food under an affiliated one, invoiced separately.

**Checked in both docs:** `grep -i "consolidat|batch|multiple deliver|split.*invoice"`
returns nothing on this case. Neither research doc names it; D7's language ("attach to")
reads one-to-many from delivery→document, never many-to-many.

**Shape of the error.** Wrong shape, not over- or under-engineering: needs a
`document_deliveries` join, not a document FK to one delivery, or slice-1 duplicate
detection and the "received 10 vs billed 12" column — D7's own justification for the
entity — is wrong for every produce/dairy/imported-goods vendor on day one.

**What would have to change:** 0104 D7 needs one line stating the relationship is
many-to-many, naming the join, and saying which of 0103's clocks attach to the *document*
vs. the *delivery* when a consolidated invoice's issue date isn't any covered delivery's
date.

---

## 2. Behavioural — the door step is load-bearing and unproven, and ships last (LANDS)

**Strongest form.** 0103's differentiation rests on capturing agreement *at the door*
(D2, D6, D8). 0104 D12 sequences the door view (`receiving_advice`, mobile) **last**, in
slice 5. Three facts converge:

1. **No surveyed tool proves a live door mechanic works.** A9's own finding: "Not one of
   these tools implements the founder's 'agreed invoice'… The invoice is never
   co-authored" [research-invoice-proofing:353-355]. All 9 US tools surveyed are desk
   exception queues over an already-final invoice.
2. **Even the closest analogue lacks mobile parity.** MarginEdge users: "the mobile
   application lacks a lot so it requires you to log into the web site for most of the
   functionality… continuously working towards parity with their desktop functions" [F —
   capterra.com/p/187718/MarginEdge/reviews, g2.com/products/marginedge/reviews, read
   2026-09-04]. The category leader hasn't solved this after years of iteration.
3. **The underlying behaviour fails under load, and nobody has measured how often.**
   "Busy restaurant service causes manual checks of handwritten delivery notes against
   invoices to be skipped, allowing errors to pass through" [F —
   blog.getjelly.co.uk/common-invoice-processing-complaints-uk, read 2026-09-03]. I found
   no hard adoption-rate statistics anywhere — an entire "best practice receiving
   checklist" literature exists only because the check is known to be skipped.

**The logical trap.** D1 lets `ACKNOWLEDGED`/`IN_TRANSIT` be skipped. If door capture is
also skipped (no photo, signature, or real-time e-İrsaliye Yanıtı) — the modal case
everywhere surveyed — `RECONCILING` becomes a purely retrospective desk comparison of PO
vs. final invoice: **Option 2, invoice-centric three-way match, the option the ADR
explicitly rejects.** The ADR's "what carried it" claims to be "the only design under
which 'verified' means what a regulator and a restaurateur both think it means" —
conditional on door usage the ADR never measures and ships last.

**What would have to change:** move the door view earlier in 0104's slice order, or 0103
must specify what `RECONCILING`→`AGREED` means with zero door evidence — today it silently
degrades to trusting whichever document arrives, exactly what D3 says agreement must never
do.

---

## 3. Premise — Turkish incumbents already ship the "agreed invoice" mechanic (NEAR-DECISIVE)

**Strongest form.** The founder's differentiator — *"the agreed invoice is the
product"* — is not a novel capability in Turkey; it's a **commodity checkbox** wrapping
the GİB-mandated e-İrsaliye Yanıtı, already shipped by mainstream SME accounting software:

- **Paraşüt** mobile app: "Gelen irsaliyeye yanıt verirken… tümünü kabul et, kısmi kabul
  et ve reddet seçenekleri" (accept-all/partial/reject buttons on the incoming waybill
  screen), 7-day silence-accepts on the same page [F —
  parasut.com/kullanim-kilavuzu/gelen-irsaliyeyi-yanitlama, parasut.com/mobil-uygulamalar,
  read 2026-09-04].
- **Logo/eLogo, Uyumsoft, ERC Soft** document the identical kabul/kısmi kabul/red flow as
  shipped, not roadmap [F — uyumsoft.com/blog/e-irsaliyede-dikkat-etmeniz-gereken-5-onemli-
  madde, ercsoft.com.tr/e-irsaliye-yaniti-kabul-ret.html, elogo.com.tr (support article on
  mistaken rejection), all read 2026-09-04].

**Does the ADR answer this?** No. 0103 cites 125 sources and is exhaustive on the *legal*
mechanism (B3–B5), but A9's competitive scan covers **nine US tools and zero Turkish
ones** — a striking gap given the founder's own venue and mental model are Turkish.
Neither doc names Paraşüt, Logo, Mikro, or Uyumsoft as a product.

**What survives.** These tools stop at sending the GİB response — none tie it to
inventory movement, COGS, vintage/substitution logic, or a US-side equivalent under one
screen. The defensible differentiator is "one receiving experience across TR and US that
also drives inventory and COGS," not "we invented bilateral agreement."

**What would have to change:** 0103's Context should name this finding and restate the
differentiator to the narrower claim above; "the agreed invoice is the product" oversells
against the Turkish competitive set as written.

---

## 4. Legal — clocks are built on the research's own admitted-uncertain rule (NEAR-DECISIVE)

**Strongest form.** 0103 D4 locks `vendor_terms` clocks (TR 7-day response, 7-day
issuance, 8-day objection). The research the ADR is built on flags the basis date for the
most important one as unresolved: "**[UNCERTAIN — and important]** If a supplier
hand-delivers to the restaurant and the transaction is treated as delivery at the business
premises, the '7 days to agree' window… may not legally exist… a question for a Turkish
YMM, not a question this research can close" [research-invoice-proofing:433-437].

Every restaurant delivery *is* delivery at the business premises — not an edge case, the
modal case the whole ADR is written for. If the exception applies, the invoice must issue
**at delivery**, not within 7 days, collapsing two of D4's five clocks into "no window —
decide at the door," a materially different UX than the countdown-banner design implies.
D9's escalation ladder (50%/80% of "the shortest clock") is meaningless if that clock is
zero.

**Does the ADR answer this?** No — 0103 never surfaces this uncertainty; it exists only in
the underlying research. This is the clearest breach of CLAUDE.md §0.1/§3 in the pair: an
item the research itself calls "a question for a Turkish YMM" was folded into a **Locked**
decision without being flagged as an open fork.

**What would have to change:** D4 needs an explicit `unknown`-until-YMM-confirms state for
the TR response/issuance clocks specifically, surfaced to the founder as still open.

---

## 5. Economic — the monetisation thesis has zero market evidence (MODERATE)

**Strongest form.** 0104's scoring gives "(a)" **monetisation 5/5**, the deciding factor
in a 21-vs-10-vs-14 total: "(a) is the only one the founder's monetisation thesis
survives." No evidence shows a restaurant paying, or willing to pay, specifically for a
canonical bilateral document rather than AP automation generally.

**What the market pays for, and it isn't this:**
- **MarginEdge: $350/month/location** (+$50/mo on Toast; +$150/mo for Freepour), priced as
  bundled restaurant-management software, not per "agreed invoice" [F —
  dishcost.com/blog/dishcost-vs-marginedge, read 2026-09-04].
- **Ottimate: ~$300–500/month/location**, quote-based; no single primary pricing page
  found — **[UNCERTAIN]** on the exact figure, directionally consistent with MarginEdge.
- Neither markets a bilateral/co-authored document as a line item. Pricing reflects
  generic invoice-processing savings (manual ≈$12.90/invoice vs. automated $1–2 [F —
  highradius.com/resources/Blog/ap-automation-pricing, read 2026-09-04]) that exist whether
  or not the invoice is ever "agreed" in the ADR's sense.

**Does the ADR answer this?** No — the "5" is `[J]` in the source table, not `[F]`, but
the ADR states flatly: "the branded canonical document *is* the product surface." An
assertion, not a finding.

**What would have to change:** downgrade "monetisation" from settled input to a
post-slice-2 hypothesis to validate; carry the `[J]`-not-`[F]` caveat into the ADR text.

---

## 6. Legal — "silence never agreement" + LAPSED may itself mislead (MODERATE, largely answered)

**Strongest form.** TTK 21/2 makes silence past 8 days a **rebuttable presumption of
acceptance**; e-İrsaliye guidance makes 7-day silence **deemed full acceptance** (both
sourced in the research). D3 records this honestly: "the clock chip says 'silence accepts
in full on day 7,' the state does not lie about who said what." D9's `LAPSED` extends it:
"records *what the law now deems*… without pretending the restaurant agreed."

**Already answered — yes, largely.** D3/D9 are direct, on-point answers to the risk that a
"not agreed" screen could mislead a manager past the legal deadline.

**Residual gap.** Neither D3 nor D9 specifies **UI warning copy** at the moment a clock
lapses — only that the state "records" the conclusion internally. A manager glancing at a
`RECONCILING` chip without reading the small print could still believe a dispute is open
after day 7/8: nothing mandates an interrupting warning ("this is now legally deemed
accepted; you cannot dispute it further") distinct from D8's passive, informational
notifications ("day 5 of 7 — response due"). Separately, TTK 21/2's presumption covers
only *ordinary* invoice content (kind, quantity, type, price) — "extraordinary clauses…
are not binding merely through silence" [research-invoice-proofing:555-556] — and D9's
"TR: accepted in full" framing doesn't carry that distinction.

**What would have to change:** D9 should require the `LAPSED` transition to render an
explicit, un-dismissable legal-consequence statement, not just a data-model record, and
note "accepted in full" covers ordinary content only.

---

## 7. Model — Layer 1 is structurally near-empty for the differentiating fields (MINOR)

**Strongest form.** 0104 D1 promises `EXTRACTED` = "what the document says," with
`as_printed` always available. But the research concedes the fields the founder cares
about most are exactly what **no parser extracts**: "price base quantity, line-level
allowance/charge reasons, the four-way quantity spine… item identity resolution, and
provenance. Those are computed or captured by *us*, not extracted"
[research-invoice-template §2.3]. Azure's own field list has no vintage, no
price-base-quantity, no substitution field. For the beverage-specific fields that are the
product's stated edge, `source` will rarely legitimately read `extracted` — usually
`computed`, `carried_from_po`, or `human_entered`.

**Verdict.** Not fabrication risk — the `source` enum is exactly what prevents pretending
a computed field was read from the page — but the ADR's prose oversells layer 1's
*coverage*. One sentence fix, not architectural.

---

## 8. Legal — ingesting signed UBL-TR XML makes Mudavym a party to e-fatura obligations (DOES NOT LAND)

**Strongest form:** does parsing a GİB-signed XML require özel entegratör licensing or GİB
registration?

**Evidence.** Turkish ERP/accounting software routinely consumes e-fatura XML via API
without becoming the entegratör: "Logo (Tiger, GO), Mikro, Netsis, Paraşüt ve Zirve…
açık API'si… ile çalışılabilir," connecting to the *taxpayer's own already-licensed
entegratör* (e.g. NES) rather than becoming one [F — nes.com.tr/e-fatura-entegrasyonu,
read 2026-09-04]. The mandatory-central-routing rule and its penalty exposure binds the
entity that *transmits* invoices, not a downstream reader of an already-compliant copy.

**Does the ADR answer this?** D14 already takes this shape without stating the reasoning:
"Ingest needs an integrator connection or an inbox that receives the XML — scoped, not
built, here." That matches the market pattern (consume via the tenant's chosen
entegratör; don't become one). **Attack does not land** — the scoping is legally sound,
though it would be stronger with this citation instead of an unstated assumption.

---

## 9. Legal — storing originals outside Türkiye breaches VUK GT 509 localisation (DOES NOT LAND)

**Strongest form:** D8's claim that "a secondary copy abroad is expressly allowed" is
load-bearing for storing Turkish originals in a US-region Glacier bucket.

**Evidence.** A secondary source quotes clause (h) directly: *"Elektronik belge ve
raporların Türkiye Cumhuriyeti sınırları içerisinde… muhafaza edilmesi zorunludur… Bu
zorunluluk, yurt dışında ikincil bir arşivleme yapılmasına engel teşkil etmez"* (primary
preservation must be in Turkey; this does not prevent secondary archiving abroad) [F —
dunya.com/kose-yazisi/vergi-usul-kanununa-gore-e-arsiv-belgelerin-muhafaza-ve-ibrazi/426223,
read 2026-09-04] — corroborating the ADR's claim.

**Caveat.** I attempted the primary mevzuat.gov.tr PDF and hit the same TLS failure the
original researcher did. **Neither pass has read the primary text.** Two independent
secondary sources now agree on the same clause and quote, raising confidence, but this
remains the one load-bearing legal fact in 0104 never read at the source — the ADR's own
review trail already flags it. **Does not land as a kill, but nothing further should be
built on Glacier until the primary text is actually read.**

---

## 10. Simplicity — the 80%-value, quarter-scope design

1. **Invoice-centric ingest** (the rejected Option 2), forfeiting bilateral co-authorship
   and the delivery spine.
2. **One named-exception flag per invoice line** (short-ship, over-ship, price-variance,
   substitution) — no bilateral proposal loop, no `vendor_terms` table; one hard-coded
   clock per jurisdiction (TR 7-day, US-CA 30-day) as a countdown banner.
3. **Door photo attached directly to the invoice record**, no separate `deliveries`
   entity — loses multi-document-per-event modelling and `UNORDERED` analytics, but ships
   the founder's actual stated want ("is this the same as what you ordered?") in one
   screen.
4. **Two-pane canonical view + original**, EN 16931 field names, **flat** schema
   (value + `source` + `as_printed`), boolean `verified_by_human` instead of a full
   revision log.
5. **No PDF/A-3 hybrid export, no vendor_terms table, no LAPSED/escalation ladder** — a
   countdown banner and one notification at 80% of the clock.

**Given up, named plainly:** true bilateral agreement (the founder's actual premise),
`UNORDERED` reporting, vintage-aware substitution as a first-class model, the append-only
audit trail, cross-jurisdiction `vendor_terms` flexibility, and the "canonical document as
product surface" monetisation story. Not a recommendation to build this instead — the
measuring stick every piece of scope in 0103/0104 should be checked against.

---

*Sources cited inline at first use, all read 2026-09-03/04. Turkish incumbents: parasut.com
(×2), uyumsoft.com, ercsoft.com.tr, elogo.com.tr, nes.com.tr. Consolidated/split invoicing:
invoicedataextraction.com (×3), uphance.com. US tool behaviour/pricing: capterra.com,
g2.com, dishcost.com, highradius.com, blog.getjelly.co.uk. VUK GT 509: dunya.com.*
