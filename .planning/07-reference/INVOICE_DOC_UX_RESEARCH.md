# The WineOps document — what actually hurts, and what the rendered document must carry

**Date:** 2026-07-29
**Scope:** field-level design research for the normalized WineOps document (PDF / CSV / on-screen) produced from any inbound distributor artifact.
**Vocabulary:** matches `apps/api-gateway/src/procurement/documents/document-types.ts` (`DocType`, `Uom`, `SourceChannel`) and `apps/api-gateway/src/procurement/invoice-match.ts` (`MatchVerdict`, `MatchCheckId`, `effectiveUnitCost`, `selfEvidenced`, `creditDue`, `backorderQty`, `ledgerDelta`).
**Method:** web research, primary sources preferred. Every claim in §A–§D carries a source key resolved in §E. Claims I could not verify are marked **[INFERENCE]** or **[CONTESTED]** inline. Nothing marked as a finding is my own reasoning.

---

## 0. Evidence quality — read this before trusting the rankings

Three things you should know up front, because they change how much weight to put on §A.

1. **There is no beverage-specific invoice-error study.** The number everyone in this industry quotes — *"35% of invoices contain at least one overcharge"* — traces to a single 2015 analysis by **Consolidated Concepts** of 11,000+ invoices across 400 restaurants, and it is a **food** purchasing study by a **supply-chain vendor**, republished by FSR Magazine and Food Service Director [S1][S2][S3]. Its companion figure is that the average overcharge is **~1% of invoice value** [S1]. It is repeated verbatim across a dozen content-marketing blogs [S4][S5] with no independent replication I could find. **This is exactly the "unmeasured assumption" the YC wedge plan flags at line 98–103, and this research did not close it.** The closest beverage-adjacent number is Ottimate's own marketing claim that **"26% of invoices matched to a receiver have at least one discrepancy — price mismatches account for 76%"** [S6] — vendor-published, unaudited, but at least it is *receiver-matched*, which is the same comparison our `physical_vs_bill` check makes.

2. **No distributor publishes its AR credit-claim policy.** I attempted Southern Glazer's, RNDC, and Breakthru Beverage. Breakthru's Missouri retailer FAQ refused connection; the corporate pages surface only a phone number and a "Major Brands Merchandise Return Policy" reference [S7][S8]. **There is no published claim window, no published documentation checklist.** What §A3 and §C rely on instead is trade-press testimony from named distribution people [S9] and state regulation on signatures [S10][S11][S12] — which is *better* evidence for what actually decides a claim, but means "the AR desk requires X" is not something I can cite to an AR desk.

3. **The regulatory material is strong and largely unexploited by incumbents.** State ABC rules, TTB recordkeeping, price-posting databases, and credit-law calendars are all primary, public, and specific. This is the part of §B that no food-only invoice tool can copy without doing the same reading.

---

## A. The pain list, ranked

Ranked by **frequency × dollars × how invisible it is**. "Invisible" matters: a pain the manager already knows about is a feature request; a pain the document hides is a wedge.

Roles: **Receiver** (whoever is at the door), **Bev mgr** (wine/beverage manager), **Bookkeeper** (in-house or outsourced), **Owner**.

---

### A1 — Unit-of-measure ambiguity makes every quantity comparison unreliable
**Frequency: every delivery. Dollars: indirect but total — it breaks the check that catches everything else.**

**What happens.** The PO says 2 cases. The packing slip says 2 CS. The invoice bills 24 BT at a bottle price. The receiver counts 2 cases. Naively compared, that is a 22-unit overage. The industry has no single unit: Virginia ABC's own wholesaler invoice form requires **total cases AND total bottles AND size in liters carried to three decimal places AND extended liters** on every line [S10] — a regulator mandating four simultaneous units on one line is the clearest possible evidence that one unit does not exist. Beer is worse: the same brand ships as 12 oz cases, half-barrels, sixth-barrels and "slim quarters" [S13]. Wine adds splits (375ml), magnums, 3L boxes, and canned formats.

**Why the distributor's document causes it.** The distributor prints the unit its *warehouse* picks in, which is not the unit the *buyer* ordered in and not the unit the *receiver* counts in. Nothing on the document reconciles them; `bottles_per_case` (pack size) is often absent entirely, and where present it is in a product-description string, not a field.

**Who suffers.** Receiver (miscounts), Bev mgr (false discrepancy alerts), Bookkeeper (wrong unit cost into the ledger).

**Product note.** This is already modelled — `normalizeUom()` handles `BT`/`CS`/`EA` X12 spellings and `toBottles()` converts through pack size, deliberately refusing to convert `keg` and `liter`. The document must *print* the normalization, not hide it: show the vendor's unit and the bottle-equivalent side by side. Ottimate lists "unit of measure/pack size discrepancies" as a first-class variance type [S6], which confirms this is a real category, not a modelling artifact.

---

### A2 — Billed price ≠ agreed price, and nothing on the document flags it
**Frequency: high. Dollars: ~1% of invoice value where it occurs [S1]; price mismatches are 76% of all receiver-matched discrepancies [S6].**

**What happens.** The invoice prints a unit price. It does not print what you paid last time, what was quoted, or what the current posted price is. Supy identifies **"prior-week rate charging"** — invoicing at last cycle's contracted rate rather than the current agreed rate — as one of the two most common overcharge mechanisms, and gives a worked example of an agreed $380 billed at $412 [S4]. Consolidated Concepts attributes most overcharges not to malice but to **contracts loaded late, contracts only partially loaded, differing contract forms across vendors, and contracts never reaching the vendor** [S1] — i.e. a data-sync failure with no on-document symptom.

**Why the distributor's document causes it.** An invoice is a statement of what is being charged, not a comparison. There is no "was/now" column anywhere in the format.

**Additional angle unique to beverage alcohol: in price-posting states the correct price is a matter of public record.** New York requires wholesalers to file monthly price schedules — due the 25th, two months ahead of the month of sale — and publishes a **public price lookup** at nyslapricepostings.com [S14][S15]. New Jersey's regulator refers to the wholesaler's "CPL" (current price list) as the governing price [S16]. So in these states, "the invoice price is wrong" is not an opinion — it is checkable against a state database. **[INFERENCE]** I found no product that performs this check; I could not find any incumbent claiming it.

**Who suffers.** Bev mgr (margin erosion), Owner (silent COGS drift across 400 SKUs — the wedge plan's "cost drift caught" metric, YC_WEDGE_PLAN §4).

---

### A3 — Short ships are billed in full, and the claim dies because nothing was written on the document at the door
**Frequency: high. Dollars: full line value, unrecoverable once the driver leaves.**

**What happens.** Quantity discrepancies are the other of Supy's two most common mechanisms, estimated at **~12% of all invoice errors** [S4]. The failure is not the shortage — it is the evidentiary window. From the distribution side, quoted directly:

> "Even if you discuss it verbally with the driver, always note any discrepancies with your signature on the Bill of Lading (BOL)." — Elly Hartshorn, Last Mile Hillebrand [S9]
> "A BOL is a legally binding document and a huge piece in determining when things go awry." — Abbey Koenig, T. Elenteny Imports [S9]

And the consequence of not doing it:

> If an issue isn't marked at the time of delivery, an account can request an investigation at the warehouse, but if a physical inventory can't confirm it, **"there is not much we can do."** [S9]

General receiving guidance says the same thing harder: never sign for "10 cases" because the invoice says 10; do not accept driver tallies; record every discrepancy on the note **before the driver leaves**; a signed delivery note is a legal acknowledgment that transfers responsibility [S17][S18].

**Why the distributor's document causes it.** The document that gets signed at the door is the distributor's, is pre-printed with *their* quantities, has no ruled space for exceptions, and is collected by the driver. In several states the signature is *mandatory* — Texas Administrative Rule **35.1(d)**: "the retailer must sign the invoice to acknowledge receipt of the product" [S11]. Virginia requires the invoice copy to accompany the merchandise, **be signed by the retailer, and be returned at once to the distributor** [S10]. So the one document with evidentiary weight physically leaves the building.

**Who suffers.** Receiver (blamed later), Bev mgr (unwinnable dispute), Owner (writes it off).

**This is the highest-leverage design finding in the report.** The WineOps `delivery_receipt` is not a nice-to-have artifact — it is the only copy of the exception record that stays with the restaurant. See §B, Receipt Evidence block.

---

### A4 — Split-case fees, freight, and fuel surcharges sit at the invoice footer and never reach the line
**Frequency: constant for any restaurant that buys by the bottle. Dollars: material and quantifiable.**

**What happens.** A split-case fee is charged whenever a retailer orders less than a full case — precisely the buying pattern of a restaurant with a 300-label list. New York retailers reported being charged **"as much as $3 a bottle or $36 extra a case"**; the SLA imposed a cap of **$7.39 per case** in a November 2022 amendment [S19]. North Carolina's largest wine wholesaler announced a **$2.16** split-case fee effective 1 June 2019 [S20]. Wholesalers "may proceed to post a split case fee **separate from the posted bottle price**" [S19] — i.e. the fee is designed to be a distinct footer line, not folded into the price.

**[CONTESTED]** The legality is unresolved and varies. Southern Glazer's obtained a **temporary restraining order on 2 December 2022** blocking enforcement of New York's split-case cap, and whether the SLA can limit these fees is described as "an open question" [S19]. Separately, a **Wake County (NC) Superior Court order of 16 September 2024** held that "regardless of form, a split case fee is a quantity discount in violation of the administrative rules of the North Carolina ABC Commission" [S20]. Two states, opposite directions, both live.

**Why the distributor's document causes it.** Freight, fuel surcharge, and split-case fees are invoice-level totals. They are never apportioned to lines, so the **unit cost printed on the line is not the cost of the bottle**. Ottimate flags "unauthorized charges" as a variance type [S6], which is the closest incumbent behaviour, but flagging a fee is not allocating it.

**Who suffers.** Bev mgr (thinks a wine costs $22 when it landed at $23.40), Bookkeeper (freight coded inconsistently — the standard guidance is that either rolling freight into product cost *or* keeping it separate works "if applied consistently," which means most operations do neither consistently [S21]), Owner (pour cost is wrong by the fee percentage).

**Product note.** `MatchInput.allocatedCharges` and `effectiveUnitCost` already exist and already do this. The document is where it becomes visible.

---

### A5 — Credits are requested, promised verbally, and never land — and nobody can tell
**Frequency: every claim. Dollars: the entire recovery number.**

**What happens.** This is the single most-corroborated pain in the review corpus, and it comes from the people who do the work:

> "I have had trouble with the amount of time it takes for payments to reach Vendor's. Also **tracking credits is not easy**." — Dana B., Finance and Human Resources Manager, MarginEdge review, Capterra [S22]
> **"invoices are put in with a credit without actually receiving the vendor credit"** — Lupe H., Bookkeeper, MarginEdge review, Capterra [S22]

That second quote is the whole problem in one sentence: the books say recovered, the bank says nothing arrived. MarginEdge's own remedy is a **Vendor Statement Reconciliation Tool** whose documented job is to find the missing credit memo and email the vendor to re-send it, including "the missing document number and total to make it easy to track down," with tracking of "which emails are still awaiting a response" [S23]. That an incumbent built a dedicated month-end tool whose purpose is chasing credit memos is strong evidence the loop does not close on its own.

Statement reconciliation guidance decomposes month-end into four buckets, of which **two are credit failures**: delayed credits (expected, never entered) and **misposted credits** (credit note exists but went to the wrong supplier, location or period) [S24].

**Why the distributor's document causes it.** A credit memo arrives days or weeks later, frequently **applied against a later invoice with no reference back to the original claim, delivery, or line**. Best-practice guidance is literally *"always include relevant invoice numbers on each credit memo you issue"* [S25] — advice that only exists because it is routinely not done.

**Who suffers.** Bookkeeper (reconciles a phantom), Bev mgr (re-asks and looks disorganised), Owner (believes a recovery number that isn't real).

**Product note.** This validates the wedge plan's REVISION 3 position that the `credit_memo` is "the real metric," and the B4 credit ledger's distinction between *claimed* and *recovered*. The document must carry claim state, not a boolean.

---

### A6 — Back-ordered lines vanish, and the deal terms silently change when they reappear
**Frequency: seasonal/allocation-driven, spikes on allocated wine. Dollars: the price delta plus a lost incentive.**

**What happens.** A line is ordered, partially delivered, and the remainder back-ordered. The invoice for the delivered portion is complete and internally consistent — nothing on it says a line is missing. When the balance arrives weeks later, three things may have changed: the posted price, the incentive/deal that made you order it, and — critically — **the product itself**.

**This is the best-documented pain in the report, and the source is a regulator.** New Jersey ABC Advisory Notice **2022-02** (extending 2021-04 and 2020-11) exists solely because back orders broke the pricing and incentive rules. It permits wholesalers **60 days** to complete an order containing back-ordered goods (extended from 30), permits honouring the price posted when the initial order was placed even if delivery falls in a different month, and permits mitigation by **"offering retailers substitute goods within the same brand family"** or **"allowing retailers to cancel the entire transaction, provided no sales of the previously delivered product were made"** [S16].

Then it does something better: it lists, as a mandatory semi-annual report, **exactly the fields a back-order tracker needs**:

> name and size of product on back order; initial invoice date; how much product was initially delivered; how much product is on back order; price of product posted in CPL at time of initial order; RIP associated with product at time of initial order; date of delivery of remaining product; date of RIP payment to retailer and amount; price of product and RIP on CPL in effect at time of delivery; whether retailer accepted substitute product within same brand family; whether retailer cancelled entire transaction; whether wholesaler honored small case RIP and cancelled remaining order [S16]

(RIP = retailer incentive program. CPL = current price list.)

**Vintage/brand substitution** is the sub-case that matters most for wine, and the NJ notice is the strongest evidence I found that it is systematic rather than anecdotal — the regulator names substitution "within the same brand family" as a *sanctioned* mitigation, which means the invoice can legitimately show a different product than the one ordered. Broader trade commentary treats wrong-vintage delivery as a recognised industry irritant, and notes some sellers substitute vintages without informing the buyer, claiming "industry practice" [S26]. **[PARTIAL EVIDENCE]** I found no study quantifying vintage-substitution frequency in on-premise wine buying.

**Why the distributor's document causes it.** The invoice shows what shipped. It does not show what did not. `backorderQty` has to be derived by us; nothing on the paper announces it.

**Who suffers.** Bev mgr (a by-the-glass listing goes dark, or pours a vintage the list doesn't match), Owner, and eventually the guest.

---

### A7 — Deposits get coded to COGS and never come back
**Frequency: every keg, and now every wine bottle in deposit states. Dollars: 5¢–25¢/container plus $30–$50/keg, permanently.**

**What happens.** Keg deposits and container deposits appear as invoice lines indistinguishable from product lines. A keg deposit is a **refundable** fee; the correct treatment is a deposit account, debited back when the keg is returned — **not** COGS [S27][S13].

The scope of this just expanded materially for wine programmes:

| Jurisdiction | Change | Deposit | Effective |
|---|---|---|---|
| California | Wine and spirits added to bottle bill, all container types | 5¢ (<24 oz), **10¢ (≥24 oz — includes 750ml)**, 25¢ (box/bladder) | **1 Jan 2024**; redemption-value labeling from 1 July 2025 [S28] |
| Oregon | Canned wine added | 10¢ all sizes | 1 July 2025; labeling from 1 Oct 2026 [S28] |

Ten states plus Guam operate deposit-refund systems, with per-container deposits typically 5¢–15¢ [S29]. Distributors collect deposits from retailers and remit to the state programme [S28].

**Why the distributor's document causes it.** A CRV line looks like a fee. It is an asset. No distributor document tells you which of its footer lines are refundable.

**Who suffers.** Bookkeeper (miscoded), Owner (overstated beverage cost, understated current assets), Bev mgr (pour cost inflated by a number that isn't a cost).

---

### A8 — Free goods, samples and $0.00 lines break the quantity check and carry compliance exposure
**Frequency: recurring on promoted brands. Dollars: small directly; large as a source of false alarms.**

**What happens.** "11 for the price of 10" is billed as 11 units shipped, 10 units charged, or as 10 units plus a $0.00 line, or as 11 units with a lump discount — inconsistently, sometimes across two lines, sometimes across two documents. Compared naively, an agreed bonus reads as an overage.

**Legal shape varies by state and it changes what the line means.** Straightforward volume discounts and bonus goods are generally treated as price reductions rather than illegal inducements, **provided** the free unit is not so disproportionate as to be a disguised gift — but advertising a "free" unit rather than structuring it as a quantity discount can cross the line in states that prohibit gifts of alcoholic beverages [S30]. Some states go further and prohibit permittees from offering or receiving "free goods, gratuities, gifts, prizes, coupons, premiums, **combination items, quantity prices**, cash returns, loans, discounts, guarantees, special prices, or other inducements" outright [S30]. **[PARTIAL EVIDENCE]** — this is a secondary summary of state statutes; I could not retrieve the Connecticut OLR report that appeared in search results (`cga.ct.gov` refused connection), so treat "which states prohibit quantity discounts" as unresolved.

There is a second, quieter reason to render these lines explicitly. Invoice lines that constitute a thing of value from supplier to retailer are the concrete artifact of tied-house exposure: "free goods included with a paid order, unexplained credits, marketing co-op allowances, slotting-like credits, menu-placement credits, branded equipment shipped at no charge, and rebates or discounts that do not match a documented pricing program" [S13]. The point of surfacing them "is to stop questionable credits or free items from disappearing into the accounting file without review" [S13].

**Why the distributor's document causes it.** There is no `free_goods_qty` field in any format I saw. It is prose in a description, or a zero in a price column.

**Who suffers.** Bev mgr (alert fatigue — see §D1), Owner (compliance exposure), Bookkeeper (unit cost wrong in the safe direction, which is still wrong).

**Product note.** `MatchInput.freeGoodsQty` and its netting into `billableReceived` already exist; the repo's own header calls the alternative "a manager who is alarmed about good news stops reading alarms."

---

### A9 — Payment terms are a licence-threatening deadline, and the invoice doesn't compute it
**Frequency: every invoice. Dollars: the whole beverage programme, if it goes wrong.**

**What happens.** Alcohol payment timing is regulated, varies by state *and by product category within a state*, and non-payment gets you on a published list that wholesalers are legally forbidden to sell to.

| State | Rule | Counted from |
|---|---|---|
| **Texas** | Malt beverages: **cash only**, full payment before or at delivery; post-dated checks do not qualify. Spirits & wine: delivery 1st–15th → due **25th of same month**; delivery 16th–EOM → due **10th of next month**; mailed payments timely within 4 business days [S12] | Delivery date, semi-monthly cycle |
| **New York** | Liquor & wine: **30 days**. Beer: **12–26 days** depending on where delivery falls in the credit cycle. Two separate credit calendars [S31] | Delivery date within credit cycle |
| **Maryland** | Due date set by the Executive Director; invoice **must accompany each delivery** and be delivered on the invoice date, or at latest the next delivery date to that area [S32] | **Invoice date** |

Consequence of missing it: Texas publishes a **Credit Law Delinquent List** on the fifth business day after the 10th and 25th, and "wholesale dealers are prohibited from selling or delivering distilled spirits and/or wine to a retailer who appears on an effective delinquent list" [S12]. New York maintains a **C.O.D. List**; delinquency reporting by wholesalers "is not optional" [S31]. Maryland forbids sales except C.O.D. to any retailer on the current list [S32].

MarginEdge's own guest post frames the same three-way split — cash/COD states, term states, and **combination states where "the payment regulations will vary based on whether the product is beer, wine, or spirits"** [S33]. Or as an operator-facing description of the failure: "A bar that cannot buy beer, wine, or spirits for a weekend because one payment did not apply correctly has a compliance problem and an operational problem at the same time" [S13].

**Related, and worth its own line: the finance charge on late payment is itself frequently wrong.** Southern Glazer's settled a California class action over imposing a **1% monthly "carrying charge" on top of** the statutory penalty; **Cal. Bus. & Prof. Code § 25509** permits only 1% of the unpaid balance on the **43rd day** and an additional 1% per 30 days thereafter. Settlement: **$5.5M paid, $44.1M in carrying charges written off**, and cessation of the practice [S34].

**Why the distributor's document causes it.** The invoice prints "Net 30" or nothing. It does not print the *state-law* due date, does not distinguish product categories with different clocks, and does not say whether the clock runs from invoice date or delivery date.

**Who suffers.** Owner (licence risk), Bookkeeper (pays on the wrong calendar), Bev mgr (can't order Friday).

---

### A10 — GL coding and category splitting is redone by hand, per invoice, every time
**Frequency: every invoice. Dollars: labour, plus every downstream number being wrong.**

**What happens.** A single beverage invoice hits multiple accounts: beer COGS, wine COGS, spirits COGS, N/A beverage, freight, deposits (asset), and occasionally smallwares. Standard guidance is a bucket set of "food, alcoholic beverage, non-alcoholic beverage, packaging and disposables, cleaning and sanitation, freight or delivery, utilities, and other operating expense," with the decision rule that you split by line item when a single posting "would blur categories that management actually tracks" [S21]. Credits should reverse the original category [S21].

Fintech automates exactly this — "GL codes each item to match your product catalog," sorting alcohol purchases into default Beer / Wine / Spirits categories [S35][S36]. So the market has priced this problem. But the timing problem persists, and reviewers name it:

> "The delay in invoices posting makes it less than ideal to catch things posted to the wrong category" — Jeremiah W., General Manager, MarginEdge, Capterra [S22]

**Who suffers.** Bookkeeper (primary), Owner (P&L by category is only as good as the coding), Bev mgr (beverage cost % includes freight and deposits, or doesn't, unpredictably).

---

### A11 — Invoice date ≠ delivery date, so the cost lands in the wrong period
**Frequency: every period boundary. Dollars: distorts period-over-period comparison, not the annual total.**

**What happens.** Under accrual, the invoice date is what hits the P&L, but the expense belongs to the period the goods were received. "A truck unloads on March 31, but the invoice lands on April 2" [S37]. Maryland's rule that the invoice must be delivered on the invoice date "or at the latest, on the next delivery date to the area" [S32] is a regulator explicitly permitting the two dates to diverge.

**Why the distributor's document causes it.** Many distributor invoices carry only one date, or carry both without labelling which is which.

**Who suffers.** Bookkeeper, Owner (a beverage-cost spike that is a calendar artifact).

---

### A12 — One invoice spans several orders and several delivery days
**Frequency: common with large distributors and periodic billing. Dollars: indirect — it defeats matching.**

**What happens.** Consolidated invoicing groups either multiple deliveries against one PO, or all purchases in a billing period, onto a single document. The guidance is explicit that "AP should not rely on the fact that both items appear on the same vendor bill" and that "receipt support has to be tested line by line when matching receipts for one invoice that spans multiple deliveries" [S38][S39]. **[EVIDENCE IS SECONDARY]** — this is AP-practice writing, not a beverage-specific finding, but it is directly relevant because our `line-matcher` must tolerate an invoice whose lines belong to different `procurement_orders`.

**Who suffers.** Bookkeeper, Bev mgr (cannot answer "did we get everything from Tuesday?").

---

### A13 — The paper record is the legal record, and it often lives only in the distributor's portal
**Frequency: continuous. Dollars: zero until an audit, then unbounded.**

**What happens.** Under **27 CFR 31.181**, every retail dealer must keep at the place of business complete records showing quantities of all distilled spirits, wines and beer received, from whom received, and dates of receipt — and *"records of receipts shall consist of all purchase invoices or bills covering distilled spirits, wines, and beer received,"* or at the dealer's option an equivalent book record [S40]. Retention is **not less than three years** under **§ 31.191** [S40]. State ABC rules add on-premises availability and longer retention [S13].

Which means: **the invoice is not paperwork about the transaction — the invoice IS the required record.** And the warning that follows is a real operational risk: *"Do not assume that 'the distributor has it in the portal' means the restaurant has a record"* — portal access can terminate; downloaded files are the stronger evidence [S13].

**Who suffers.** Owner (regulatory exposure), Bookkeeper (reconstructing history from a portal that no longer opens).

---

### A14 — Nobody can say where a unit cost came from
**Frequency: whenever anyone questions a number. Dollars: trust.**

**What happens.** From an xtraCHEF reviewer, via an aggregator that summarised G2: *"unit costs are inaccurate randomly, with no evidence of where the cost came from"* [S41]. **[SECOND-HAND]** — I could not reach G2 directly (403) to verify the verbatim quote; treat the wording as reported, not as a first-party citation. Ottimate reviewers report parallel provenance failures: OCR "will often use variations of vendor names for different invoices," the software "doesn't recognize the 'picture logo' and assigns the wrong vendor," item duplicates, and vendor top-20 lists showing only 10–15 items [S42].

**Why the distributor's document causes it.** It doesn't, directly — this is a *tooling* failure. But it defines what the WineOps document must beat: every number on it should be traceable to a source document, a page, and a rule.

**Who suffers.** Everyone, at the moment they most need to trust the system.

---

### A15 — Excise tax is mostly invisible, and a tool that invents a line for it is wrong
**Frequency: n/a. Included because a naive design will get this wrong in the other direction.**

**Honest finding: state alcohol excise tax is normally NOT a separate line on the retailer's invoice.** It is paid upstream by producers, importers and wholesalers and embedded in the wholesale price — Texas, California and Georgia all place the obligation on the distributor/wholesaler tier [S43][S44][S45]. Tennessee's is levied per gallon on wholesalers and is called the "wholesale gallonage tax" [S46]. Content-marketing sources describe excise as "usually paid upstream by the producer" and "embedded or shown separately" [S13] — that "or" is doing a lot of work and I could not resolve it to a rule.

**Where it does become visible:** Georgia levies **local** (city/county) alcohol excise collected by wholesalers at delivery to the retailer [S45], which is jurisdiction-specific and therefore a plausible itemised line. **[UNVERIFIED]** I could not retrieve a Georgia municipal page confirming invoice presentation (403), and I found no sample invoice showing an excise line.

**Design consequence:** the document needs a **conditional** tax section that renders only what the source document actually contained, never a computed or assumed excise figure. Fabricating a tax line on a beverage-alcohol document is worse than omitting it.

---

### A16 — Your price is not the market price, and you have no way to know
**Frequency: structural. Dollars: potentially the largest single number here, and the least actionable.**

**What happens.** The FTC sued Southern Glazer's in December 2024 alleging that since 2018 it offered volume discounts and rebates to large chains while withholding comparable terms from independents, such that **"disfavored independent retailers paid as much as 32% to 78% more than competing favored retailers"** [S47][S48][S49]. Separately, the New York SLA accepted a no-contest plea from Southern Glazer's over discriminatory sales, and a review of its invoices and books found **"incomplete, inaccurate, and inadequate invoicing practices"** [S50] — a regulator's finding about the quality of the invoices themselves.

**[LITIGATION IS PENDING]** — an FTC complaint is an allegation. Do not render this as a finding to a user.

**Design consequence:** a "you paid X, peers paid Y" surface is legally and commercially loaded. What is safe and defensible is the *state-posted price* comparison (A2) — a public fact, not an inference about another restaurant.

---

## B. Required field inventory for the normalized WineOps document

Legend for **Req**: **R** = required (render or render a visible "not stated on source"), **C** = conditional (render when the condition holds), **O** = optional.
Legend for **Reads**: Rc = Receiver, BM = Beverage manager, BK = Bookkeeper, Ow = Owner, AR = the distributor's AR desk / our own dispute packet.

> **Design rule that governs the whole table.** Absence is not agreement. Every R field that the source document did not carry must render as an explicit *"not stated on source document"* — never blank, never inferred. This mirrors `invoice-match.ts`: a `null` `shippedQty` means "we do not know," never "it matched," and `MatchCheck.ok = null` is distinct from `false`.

### B.1 Document identity

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| `doc_type` (`purchase_order` / `packing_slip` / `delivery_receipt` / `invoice` / `credit_memo` / `statement`) | Four-way match is meaningless if the reader can't tell which of the four documents this is. A photo of a packing slip that reads as an invoice writes a false `physical_vs_bill` pass | all | R |
| `doc_number` | The token every dispute is keyed on; AR desks find nothing without it | AR, BK | R |
| `doc_date` | Legal invoice date; drives the credit-law clock in Maryland-style states (A9, A11) | BK | R |
| `delivery_date` | Distinct from `doc_date`; drives period assignment (A11) and the credit clock in NY/TX-style states (A9) | BK, BM | R |
| `source_channel` (`email`/`photo`/`upload`/`edi`/`sftp`/`manual`/`api`) | Provenance for the audit trail. Rendered as metadata; **no downstream logic branches on it** | BK | R |
| `original_file` reference (+ page) | The TTB record is the invoice itself (A13); a JSON summary is not the record. Also the attachment that makes a claim `selfEvidenced` | AR, Ow | R |
| `doc_status` (`received`/`extracting`/`needs_review`/`verified`/`rejected`/`superseded`) | A `needs_review` document must never be mistaken for a verified one when someone acts on it | BM, BK | R |
| Supersedes / superseded-by link | Revised invoices and re-bills exist; two live versions of one invoice is how double-payment happens | BK | C |

### B.2 Parties — beverage-specific, and where food-only designs fail

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Distributor **legal entity name** (not trade name) | Statements, credits and payments are issued by the legal entity; trade name alone won't match remittance | BK, AR | R |
| Distributor **license number** | DC requires the invoice to list the name, address **and license number of the seller and buyer** [S51]. It is also the join key across a distributor's many trade names | AR, Ow | R (in states requiring it), else C |
| Distributor address | Statutory invoice content in DC [S51] and SC [S52] | AR | R |
| Distributor **AR / credit-desk contact** (name, email, phone) | A5: claims die because they go to the sales rep. Breakthru MO routes credits to a dedicated credit mailbox distinct from customer service [S7] | BM, BK | R |
| Sales rep name/contact | The person who actually resolves it, distinct from AR | BM | O |
| Buyer **licensed premises name + address** | Must match the licensed premises, not the corporate DBA [S13][S51] | Ow | R |
| Buyer **retail license number** | Virginia requires the "correct retail license number, trade name and address" on the wholesaler's invoice [S10]; DC requires buyer license number [S51] | Ow, AR | R |
| Buyer location/unit id | A13 + consolidated invoices posted wholly to one location distort per-site cost [S24] | BK, Ow | C (multi-unit) |

### B.3 Commercial and compliance terms

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Stated payment terms (as printed) | Baseline; what the vendor claims | BK | R |
| **Statutory payment due date** + jurisdiction + rule cited | A9. NY 30 days liquor/wine vs 12–26 days beer [S31]; TX semi-monthly windows and cash-only malt [S12]; MD from invoice date [S32]. This is a *computed* field no distributor prints | BK, Ow | R |
| **Product-category term split** | In combination states the clock differs for beer vs wine vs spirits on the *same* invoice [S33][S35] | BK | C |
| COD / cash-required flag | TX malt beverages are cash-only before or at delivery; post-dated checks don't qualify [S12]. Drives "have the check ready" at the door [S9] | Rc, BK | C |
| Delinquent/COD-list exposure warning | Missing the date bars you from buying spirits and wine at all [S12][S31][S32] | Ow | C |
| Late-fee / carrying-charge line, with statutory cap | A9. SGWS charged 1%/month above the Cal. B&P §25509 schedule; $5.5M + $44.1M [S34] | BK, Ow | C |
| PO reference(s) — **plural** | A12. One invoice, several orders [S38][S39] | BM, BK | R |
| Order date(s) | Needed to evaluate "price posted at time of initial order" for back orders [S16] | BM | C |

### B.4 Delivery and receipt evidence — the block that wins disputes

This block is the reason the WineOps document exists (A3). The distributor's signed copy leaves with the driver [S10]; this is the restaurant's copy of the same facts.

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Driver name / carrier | Identifies who was at the door in a warehouse investigation [S9] | Rc, AR | R |
| Delivery timestamp | Pins the exception window | Rc, AR | R |
| **Receiver name + signature** (image or attested capture) | TX Rule 35.1(d): "the retailer must sign the invoice to acknowledge receipt" [S11]; VA: signed by retailer and returned at once [S10]; DE: signature, electronic or paper, or finger-scan, before handing over possession [S53] | Rc, AR, Ow | R |
| **Exceptions noted at the door**, per line, with timestamp | The whole ballgame: "always note any discrepancies with your signature on the BOL" [S9]; unmarked discrepancies get a warehouse investigation and then "there is not much we can do" [S9]; "do not sign the invoice until you are sure that all discrepancies have been… recorded on the invoice" [S18] | Rc, AR | R |
| `receipt_stage` (`signed_at_door` / `case_count` / `bottle_count` / `reconciled`) | Distinguishes "we signed for cases" from "we counted bottles." Signing for a case count is not evidence about bottles | BM, AR | R |
| Photo evidence refs (damage, pallet, seal) | Makes a `rejected` verdict `selfEvidenced` rather than assertion | AR | C |
| Temperature / condition note | Wine damage claims; also a fee driver where temperature surcharges are billed [S54] | Rc | O |
| BOL number | The freight-side legal document; "a huge piece in determining when things go awry" [S9] | AR | C |

### B.5 Line fields — product identity

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Our internal SKU / product id | Joins to inventory and the wine list | BM | R |
| **Vendor SKU / item code** | Highest-confidence match method (`vendor_sku` in `MATCH_METHODS`); the only stable key across a distributor's description changes | BM, AR | R |
| **State ABC / control-state product code** | Virginia requires the "code number issued by Virginia ABC" on the line [S10]; control states list products by code [S55] | Ow | C (17 control-state jurisdictions [S55]) |
| UPC / GTIN | Independent identity when the description drifts | BM | O |
| Description as printed on source | Never overwrite the vendor's words — the dispute is conducted in their vocabulary | AR | R |
| Producer / brand | NY §101-b price posting keys on "exact brand or trade name" [S56]; DC requires "brand of each product" [S51] | BM | R |
| **Vintage** | A6. Substitution "within the same brand family" is a sanctioned back-order remedy [S16]; a vintage change is a different wine on the list | BM | R (wine) |
| Appellation / region / varietal | Wine-list correctness; not on the distributor doc, added by us | BM | O |
| **Container size / format** (750ml, 375ml split, 1.5L, 3L, 12 oz, ½ bbl, ⅙ bbl) | A1. Beer alone spans 12 oz cases, half-barrels, sixth-barrels, slim quarters [S13]; VA requires size in liters to three decimals [S10] | Rc, BM | R |
| **Pack size** (bottles per case) | The conversion factor `toBottles()` needs. Without it every case/bottle comparison is a guess | Rc, BM | R |
| Age / proof | NY §101-b requires "age and proof where stated on the label" in the posting [S56] | Ow | C (spirits) |
| Allocated / limited-availability flag | NY marks limited-availability items "L" and bars quantity discounts on them [S15] | BM | O |

### B.6 Line fields — quantity, the four-way spine

Rendered as one row per line with four quantity columns, because collapsing them is exactly the failure `invoice-match.ts` was written to prevent.

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| `qty_ordered` + its UOM | The 850/PO leg | BM | R |
| `qty_shipped` + its UOM (from `packing_slip`) | The distributor's own statement of what left the warehouse — the leg that makes `overbilled_vs_ship` unarguable | AR | C (render "no packing slip on file" when absent — **never blank**) |
| `qty_received` (accepted + rejected) + its UOM | The physical count. Must never be pre-filled from the invoice | Rc | R |
| `qty_accepted` / `qty_rejected` split | "Vendor sent 24, 2 broken" and "only 22 shipped" are different failures with different counterparties | Rc, AR | R |
| `qty_billed` + its UOM | The 810 leg | BK | R |
| **`uom` as printed** and **normalized `Uom`** | A1. Show both: the receiver counted cases, the invoice billed bottles, and hiding either loses the argument | Rc, BM | R |
| **Bottle-equivalent for every quantity** | The only basis on which the four legs are comparable | BM | R |
| Comparability flag | `keg` and `liter` do not convert; a converted keg is confident, wrong maths | BM | C |
| `qty_backordered` | A6. Derived — the invoice does not announce what is missing | BM | C |
| Back-order provenance set (initial invoice date, qty initially delivered, qty on back order, posted price at initial order, incentive at initial order, expected delivery of remainder) | The NJ ABC reporting schedule is a regulator's own field list for this exact situation [S16] | BM | C |
| Substitution flag + substituted-from product | A6. "Substitute goods within the same brand family" is sanctioned [S16]; the wine list must be told | BM | R (when detected) |

### B.7 Line fields — money

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Unit price as billed | Baseline | BK | R |
| Unit price basis (per bottle / per case) | A1. The same number means two different things | BM | R |
| Agreed / PO price | The `price` check's other operand | BM | R |
| **Last price paid + date + doc number** | A2. The single most-asked question the distributor's document cannot answer | BM | R |
| **Price delta vs last paid** (abs + %) | Makes creep legible without a spreadsheet | BM, Ow | R |
| **Price trend across last N deliveries** | Distinguishes a one-off from a ratchet — the "cost drift caught" metric | Ow | R |
| **State-posted price for the sale month + source + as-of date** | A2. In posting states this is a public fact [S14][S15][S16], not our estimate | BM, Ow | C (posting states) |
| Quantity/time-of-payment discount applied | NY §101-b requires posted schedules to state "discounts for quantity and time of payment" [S56]; NY permits only one unit of measure discounted per product per month [S15] | BK | C |
| **Free-goods qty and its treatment** | A8. Netted out of every quantity comparison so a negotiated bonus stops firing `qty_over` | BM | C |
| Sample / $0.00 / no-charge flag | A8. Tied-house artifact that must not disappear into the accounting file [S13] | Ow, BK | C |
| Extended line total | Arithmetic tie-out | BK | R |
| **Deposit amount, per line, marked REFUNDABLE** | A7. Keg deposits belong in a deposit account, not COGS [S27]; CA CRV now applies to wine and spirits [S28] | BK, Ow | C |
| Deposit type (keg / container-CRV / pallet) + expected refund mechanism | Different recovery paths; pallet deposits credit back against pallet IDs [S54] | BK | C |
| **Allocated freight** (this line's share) | A4. Freight is a cost component, not a price variance | BK, BM | R |
| **Allocated fuel surcharge** | A4 | BK | R |
| **Allocated split-case fee** | A4. Posted separately from the bottle price by design [S19]; up to $7.39/case in NY [S19], $2.16 in NC [S20] | BM, Ow | C |
| Other allocated charges (temperature, handling) | [S54] | BK | O |
| Allocation method used (by value / by units / direct) | Provenance. A14 — every number traceable to a rule | BK | R |
| Tax as printed on source, by type | A15. Render only what the source carried. **Never compute or assume excise** | BK | C |
| **`effectiveUnitCost` — landed cost per accepted unit** | The whole match is theatre if the books keep the PO price. `(billed + allocatedCharges) / accepted`, free-goods aware | BM, Ow, BK | R |
| Landed-cost delta vs last landed cost | The honest version of price change | Ow | R |
| GL account + class/category | A10. Beer/wine/spirits/N-A/freight/deposit, split at line level [S21][S35] | BK | R |

### B.8 Verdict and money-at-risk block

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| `MatchVerdict` headline, per line and per document | One headline, ordered by evidentiary strength then severity | BM | R |
| The seven `MatchCheck`s with tri-state `ok` (**true / false / null-not-evaluable**) | A `null` because no packing slip exists must never read as a pass | BM, AR | R |
| Check detail strings ("their slip says 22, their invoice says 24") | The sentence you read to the AR desk | AR | R |
| **`selfEvidenced` badge** | Marks the claim their own two documents prove — needs no argument, only the attachment | AR, BM | C |
| **Dollars at risk**, per line and summed | Sorts the manager's queue. Nothing else should | BM, Ow | R |
| `creditAmount` (null when unpriced — never zero) | Zero means "we owe nothing"; null means "we can't compute it" | BM, AR | R |
| `backorderQty` and open-order state | Keeps the order open rather than stranding shadow stock | BM | R |
| `requiresOverride` + override reason + who + when | An accepted price variance needs a named human | Ow | C |
| `priceVerified` | Only on exact match. Never write it for a delivery nobody looked at | Ow, BK | R |
| `ledgerDelta` | The correction from optimistic stocking back to counted reality | BK | R |
| Arithmetic self-check (Σ lines vs subtotal vs total) | A hallucinated quantity usually breaks the arithmetic — cheap deterministic detection | BK | R |

### B.9 Credit claim block (renders on `credit_memo`, and as a state chip on any claimed line)

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| **Claim state**: `not_claimed` → `claimed` → `acknowledged` → `credit_issued` → `credit_applied` → `denied` / `expired` | A5. "Claimed" is not "recovered." A bookkeeper posting a credit that never arrived is the documented failure [S22] | BM, Ow, BK | R |
| Original invoice number + line + date the credit refers to | A5. Best practice is "always include relevant invoice numbers on each credit memo" [S25] — advice that exists because it isn't done | BK, AR | R |
| Claim reason code (short ship / overbill vs ship / damage / price variance / return / deposit refund) | Different reasons need different evidence and route to different desks | AR | R |
| Evidence manifest (which documents/photos are attached) | What the warehouse investigation will actually be run against [S9] | AR | R |
| Date claimed, days open, aging bucket | A5. Nothing else makes a stale claim visible | BM, Ow | R |
| Which later invoice/statement the credit landed on | A5. Credits routinely appear on a later document with no back-reference; the fourth statement-recon bucket is misposted credits [S24] | BK | R |
| Amount claimed vs amount issued vs amount applied | Partial credits are normal and silently under-recover | Ow, BK | R |

### B.10 Statement tie-out block (`doc_type = statement`)

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Statement period, opening and closing balance | Frame | BK | R |
| Format: open-item vs balance-forward | Balance-forward statements need reconstruction because opening balances carry unresolved history [S24] | BK | R |
| **Invoices on statement not in our books** | Bucket 1 [S24] | BK | R |
| **Invoices in our books not on statement** | Bucket 2 [S24] | BK | R |
| **Credits we expect that are absent** | Bucket 3 — the money [S24]; MarginEdge's tool exists to email the vendor for exactly this [S23] | BM, BK | R |
| **Credits present but misposted** (wrong supplier / location / period) | Bucket 4 [S24] | BK | R |
| Verbal disputes never converted to an entry | The bucket that quietly writes itself off [S24] | BM | R |

### B.11 Provenance footer (every rendered document)

| Field | Why it exists | Reads | Req |
|---|---|---|---|
| Per-field source: document id, page, region | A14. "No evidence of where the cost came from" is the complaint to beat [S41] | all | R |
| Extraction model + version + per-field confidence | Corrections become the eval set | BK | R |
| Human-edit log (field, old, new, who, when) | Distinguishes extracted from typed-over | Ow | R |
| `match_method` used per line (`vendor_sku` / `description` / `qty_price` / `manual` / `edi_reference`) | A low-confidence auto-assignment silently corrupts cost basis for months | BM | R |
| `link_method` used to tie documents together | Same reason, one level up | BM | R |
| Retention marker: "TTB 27 CFR 31.181 record — retain ≥3 years (§31.191)" | A13. Tells the reader the artifact's legal weight [S40] | Ow | R |
| Generated-at timestamp + "rendered by WineOps from vendor document N" | This is a derived document; never let it be mistaken for the distributor's original | AR, Ow | R |

---

## C. What the distributor's document does not have — the actual product surface

Ranked by defensibility (how hard it is for an incumbent to copy) × how legible it is to a buyer.

**C1. Last price paid, on the line, at the moment you read it.** No distributor document has ever contained it. Incumbents deliver it as a *separate* email alert configured per item (see D2). Putting it inline on the document turns a notification into a fact.

**C2. Price trend across the last N deliveries, per SKU.** Answers "is this a one-off or a ratchet." Feeds the "cost drift caught" metric the wedge plan prefers over dollars-recovered (YC_WEDGE_PLAN §4). Structurally larger than recovery because it compounds across hundreds of SKUs.

**C3. Landed unit cost after fee allocation (`effectiveUnitCost`), free-goods aware.** The bottle that says $22 landed at $23.40 after freight, fuel, and split-case. `landedCost()` already exists in `analytics/engine/finance.ts`. Fintech's invoice-data page — the deepest alcohol-invoice product in the market — makes **no claim** of price-variance detection, PO matching, receiving verification, or reconciliation; it standardises, GL-codes, and pays [S36].

**C4. The four-way match verdict, with tri-state checks.** Ordered / shipped / received / billed. The `null` state — "no packing slip on file" — is itself a product surface, because it tells the manager which vendors never send an ASN and therefore which disputes will always be his-word-against-theirs.

**C5. `selfEvidenced` — the claim their own paperwork proves.** When their 856 says 22 and their 810 says 24, there is nothing to argue. Given A3's finding that unmarked discrepancies effectively cannot be recovered [S9], a claim that needs no physical-count testimony is categorically stronger than every other claim type.

**C6. Dollars at risk, sorted.** Not a list of discrepancies — a queue ordered by money. This is what makes the manager view survivable (D1).

**C7. Credit claim state with aging.** `claimed` ≠ `recovered`. Reviewers name both halves of this failure [S22]; MarginEdge built a month-end tool for one half of it [S23]. Nobody appears to carry claim state *on the document*.

**C8. The state-law payment due date, computed per product category.** A9. TX malt-beverage cash rule vs TX spirits/wine semi-monthly windows vs NY 30-day vs NY beer 12–26-day vs MD invoice-date counting [S12][S31][S32]. The distributor prints "Net 30." The consequence of getting it wrong is the delinquent list.

**C9. Deposit lines marked REFUNDABLE, with expected recovery.** A7. Nothing on the distributor document distinguishes a fee from an asset; CA's 2024 extension of the bottle bill to wine and spirits [S28] made this materially bigger for wine programmes overnight.

**C10. Posted-price comparison in posting states.** A2. The month's legal price is public [S14][S15]. **[NO EVIDENCE ANY PRODUCT DOES THIS]** — I searched and found none. Treat as an opportunity, not as a validated gap.

**C11. The exception record that stays in the building.** A3. The distributor's signed copy leaves with the driver by regulation in Virginia [S10] and by practice everywhere. A WineOps `delivery_receipt` — signed, timestamped, exception-annotated, photo-backed, retained — is the restaurant's only copy of the one document that decides claims.

**C12. Back-order provenance.** A6. Price at time of order vs price at delivery, incentive at order vs at delivery, substitution accepted or not — the NJ regulator's own field list [S16], rendered for the buyer instead of filed with the state.

**C13. TTB-grade retention.** A13. The invoice *is* the required record; portal access is not custody [S13][S40].

---

## D. Anti-patterns — what makes managers stop reading

### D1. Alerting on things that are not problems (the fatigue mechanism)

The best-quantified evidence is clinical, and it is directly transferable because the shape is identical — a busy operator, an interrupting alert, a decision to accept or dismiss. **Ancker et al., BMC Medical Informatics and Decision Making (2017)**: analysing clinical decision support alerts, **"the likelihood of reminder acceptance dropped by 30% for each additional reminder received per encounter"**; alert acceptance was associated with work complexity and repeated alerts, and roughly one-quarter of drug alerts and one-third of clinical reminders were repeats for the same patient within the same year [S57]. Note the mechanism the paper identifies: **repetition**, not volume. An alert that fires on the *same* thing again is the one that gets ignored.

Security operations reproduces the pattern at scale: organisations receive ~2,992 alerts daily with 63% unaddressed; ~83% of alerts turn out to be false alarms; **32% of practitioners say they ignore alerts they no longer trust**, and **40%+ say their tools don't provide enough context** [S58][S59]. **[CROSS-DOMAIN — no restaurant-specific alert-fatigue study found.]**

Applied here, the three false alarms that will kill the product are exactly the three defects the wedge plan already identified: **split cases read as `qty_over`** (A1), **agreed 11-for-10 deals read as `qty_over`** (A8), and **an inferred invoice quantity producing a self-comparing `physical_vs_bill` pass** that later reverses. All three are fixed in the engine; the document must not reintroduce them by rendering raw units or unnetted quantities.

### D2. Configuration that must be done per item, by hand, before the product works

> "I wish we could choose the Price Alerts in bulk with a quick check list instead of having to select them one-by-one" — Jennifer T., Executive Chef, MarginEdge, Capterra [S22]

A wine list is 300–800 SKUs. Any surface requiring per-SKU setup is dead on arrival, and at the plan's $20–50/mo price point there is no human implementation step to absorb it (YC_WEDGE_PLAN, REVISION 2). Defaults must be derived, not configured.

Related, from the same corpus: *"Maintenance on products is required almost daily to make sure items are allocated correctly"* — Chef De Cuisine [S60]; *"You have to put A LOT of work into adding the recipes. The conversions are very time consuming"* — Katie C., AGM [S22]. **Unit conversion is the thing users report as the most tedious work in the incumbent product.** That is our A1.

### D3. Latency between the event and the document

> "The delay in invoices posting makes it less than ideal to catch things posted to the wrong category" — Jeremiah W., GM [S22]
> "invoice processing turnaround time" [needs improvement] — Yogesh H., Team Leader [S22]
> "The delay between uploading an invoice and having it available in the invoices window is noticeable" — Ottimate reviewer, G2 [S61]

The operational reason this matters more in beverage than in food: the goal is "to catch discrepancies close enough to the delivery that they're easy to resolve, not weeks later when the vendor's records are harder to pull and your receiving team can't remember the details of a specific delivery" [S5]. Combined with A3 — the evidentiary window closes when the driver pulls away — a document that arrives the next morning is already late for the highest-value claim class.

### D4. Numbers with no provenance

*"unit costs are inaccurate randomly, with no evidence of where the cost came from"* [S41] **[SECOND-HAND]**. Compounded by extraction failures reviewers name specifically: OCR using "variations of vendor names for different invoices," the wrong vendor assigned from a logo, item duplicates, and "manually changing every invoice" despite prior corrections [S42]. One reviewer's verdict: *"Frequent errors in their system's indexing that result in more time spent fixing issues than with hand entering"* [S42]. **A document that costs more to check than to retype has negative value.** Every number in §B carries a source reference for this reason.

### D5. Showing prices to the person at the door

Not evidence-backed — **[INFERENCE]**, but it follows from A3 and from the receiving guidance in [S17][S18]: the receiver's single job is to count and to write exceptions before the driver leaves. Line cost is not an input to that decision and is the largest available source of hesitation. This is the wedge plan's Track D staff view, and the research supports the *shape* (count-and-annotate under time pressure) even though I found no study on price disclosure to receiving staff.

### D6. Presenting the verdict as certainty when a document is missing

`MatchCheck.ok = null` must render visibly differently from `false`. If "no packing slip on file" renders as a passing check, the manager learns the checks are decorative — the fastest possible route to D1. This is a design rule the engine already enforces and that the document can silently break.

### D7. Fabricating regulated fields

A15. Do not compute an excise line. Do not infer a licence number. Do not derive a signature. A beverage-alcohol document with an invented tax figure is worse than one with a gap, because the artifact is a **TTB-required record** [S40] and a dispute exhibit.

---

## E. Sources

Primary regulatory and legal sources are listed first within each group. Marked **[VM]** = vendor marketing, **[REV]** = user reviews, **[TP]** = trade press, **[AGG]** = aggregator/second-hand.

### Regulatory — invoice content, delivery, signature
- [S10] Virginia ABC wholesaler wine invoice requirements (Form 703-35): delivery date, retail licence number, trade name/address; per line total cases, total bottles, size in liters to 3 decimals, ABC code, brand/type, extended liters, value; invoice must accompany merchandise, be signed by retailer and returned at once — https://www.abc.virginia.gov/library/licenses/pdfs/distributor-wine-invoice.pdf (form) and Virginia ABC wholesaler guidance via https://townhall.virginia.gov/L/GetFile.cfm?File=C:\TownHall\docroot\GuidanceDocs\999\GDoc_ABC_5818_v1.pdf — *retrieved via search summary; both hosts were unreachable to direct fetch (DNS). Treat line-field list as high-confidence but not directly verified.*
- [S11] TABC Industry Notice — Wholesale Deliveries to Retailers, Temporary Process for Signing the Invoice (2020); TABC Administrative Rule **35.1(d)**, "the retailer must sign the invoice to acknowledge receipt of the product" — https://www.tabc.texas.gov/news/articles/industry-notice-wholesale-deliveries-to-retailers-temporary-process-for-signing-the-invoice-2020/
- [S51] DC ABRA, Quick Guide: General Guidance for Wholesalers — invoice must list date of sale; name, address and **licence number of seller and buyer**; quantity, character and brand of each product; price of each and total — https://abca.dc.gov/sites/default/files/dc/sites/abra/publication/attachments/Quick%20Guide%20General%20Guidance%20for%20Wholesalers.pdf *(PDF not machine-readable to fetch; content per search summary)*
- [S52] South Carolina — invoices must list items by quantity, type, brand, size, price, plus point of origin and destination — https://dor.sc.gov/alcohol-beverage-licensing-abl/liquor-licensing
- [S53] 4 Del. Admin. Code § 507-4.0, Requirements for Delivery — copy of invoice/bill of sale stating name and address of receiving customer and type, brand, quantity of each beverage; signature (electronic or paper) or finger-scan before handing over possession — https://www.law.cornell.edu/regulations/delaware/4-Del-Admin-Code-SS-507-4.0
- [S56] NY ABC Law § 101-b — posting must state exact brand or trade name, capacity of package, nature of contents, age and proof where labelled, bottles per case, bottle and case price to wholesalers, discounts for quantity and time of payment — https://codes.findlaw.com/ny/alcoholic-beverage-control-law/abc-sect-101-b/

### Regulatory — credit law, payment terms, delinquency
- [S12] TABC, Cash and Credit Law — malt beverages cash only before/at delivery, post-dated checks excluded; spirits and wine: delivery 1st–15th due 25th, 16th–EOM due 10th of next month, mailed payments timely within 4 business days; Credit Law Delinquent List published 5th business day after the 10th and 25th; wholesalers prohibited from selling spirits/wine to listed retailers — https://www.tabc.texas.gov/texas-alcohol-laws-regulations/cash-credit-law/
- [S31] NY SLA, Delinquency Reporting — liquor and wine 30 days; beer 12–26 days depending on position in credit cycle; C.O.D. list; "Delinquency reporting is not optional"; separate Beer/Cider/Wine and Liquor/Wine credit calendars — https://sla.ny.gov/delinquency-reporting
- [S32] COMAR 14.23.01.03, Wine and Distilled Spirits Credit Control — period runs from **the date of the invoice**; invoice must accompany each delivery and be delivered on the invoice date or at latest the next delivery date to that area; no sales except C.O.D. to listed retailers — https://regs.maryland.gov/us/md/exec/comar/14.23.01.03
- [S34] Dickenson Peatman & Fogarty, "Southern Glazer's Class Action Settlement a Reminder to Comply with Maximum Late Payment Penalties on Retailers" — Cal. Bus. & Prof. Code **§ 25509** permits 1% on the 43rd day and 1% per 30 days thereafter; SGWS charged an additional 1% monthly carrying charge; **$5.5M** to the class, **$44.1M** written off — https://www.dpf-law.com/articles/southern-glazers-class-action-settlement-a-reminder-to-comply-with-maximum-late-payment-penalties-on-retailers
- [S30] Tied-house and discount practice summaries (secondary legal explainers): https://legalclarity.org/is-it-illegal-to-discount-alcohol-state-promotion-laws/ ; https://legalclarity.org/tied-house-rules-prohibited-supplier-retailer-practices/ ; NY SLA Trade Practice Issues https://sla.ny.gov/trade-practice-issues — *CT OLR report 2004-R-0593 (cga.ct.gov) appeared in results but the host refused connection; state-by-state prohibition on quantity discounts is **unresolved***

### Regulatory — back orders, price posting, deposits, records
- [S16] NJ Division of ABC, **Advisory Notice 2022-02** (extending AN 2021-04 / AN 2020-11) — 60-day back-order completion window; honouring price posted at time of initial order; substitute goods within the same brand family; retailer cancellation; mandatory semi-annual report field list (product name/size on back order, initial invoice date, qty initially delivered, qty on back order, CPL price at initial order, RIP at initial order, delivery date of remainder, RIP payment date and amount, CPL price and RIP at delivery, substitution accepted, transaction cancelled, small-case RIP honoured); cites N.J.S.A. 33:1-3.1(b)(6),(7),(10); signed James B. Graziano, Director, 28 June 2022 — https://www.nj.gov/oag/abc/downloads/AN%202022-02%20Advisory%20Notice%20to%20Industry%20Extending%20AN%202021-04%20Regarding%20Back-Ordered%20Products.pdf *(read directly as PDF)*
- [S14] NY SLA Price Posting overview — https://sla.ny.gov/price-posting
- [S15] NY SLA public price lookup; wholesale postings due the 25th two months before the month of sale; retail postings due the 5th one month before; only one unit of measure discounted per product per month; limited-availability items marked "L" and ineligible for quantity discounts — https://www.nyslapricepostings.com/public/price-lookup
- [S28] Davis Wright Tremaine, "Bottle Bill Changes in California and Oregon Will Soon Affect Wineries and Distilleries" — CA wine and spirits added 1 Jan 2024 at 5¢ (<24 oz) / 10¢ (≥24 oz) / 25¢ (box/bladder), labeling from 1 July 2025; OR canned wine 1 July 2025 at 10¢, labeling from 1 Oct 2026; distributors collect deposits from retailers and remit to CalRecycle less a 1.5% administrative fee — https://www.dwt.com/insights/2023/08/bottle-bills-california-oregon-wine-spirits
- [S29] NCSL, State Beverage Container Deposit Laws — 10 states plus Guam; deposits typically 5¢–15¢ — https://www.ncsl.org/environment-and-natural-resources/state-beverage-container-deposit-laws
- [S40] **27 CFR § 31.181** (Requirements for retail dealers) and **§ 31.191** (retention ≥3 years) — records of receipts shall consist of all purchase invoices or bills, or at the dealer's option a book record — https://www.ecfr.gov/current/title-27/chapter-I/subchapter-A/part-31/subpart-J/subject-group-ECFR2eaeea9744fd5b8/section-31.181 *(eCFR redirected; content per search summary of the section and TTB retailer guidance at https://www.ttb.gov/laws-regulations-and-public-guidance/liquor-laws-regulations-retail-dealers)*
- [S43] TABC Alcohol Excise Taxes — https://www.tabc.texas.gov/services/alcohol-excise-taxes/
- [S44] CDTFA Alcoholic Beverage Tax industry topics — https://cdtfa.ca.gov/taxes-and-fees/alcoholic-beverage-tax/industry-topics.htm
- [S45] Georgia DOR Alcohol Excise Taxes — https://dor.georgia.gov/alcohol-tobacco/alcohol-tobacco-excise-tax/alcohol-excise-taxes
- [S46] Tennessee DOR Alcoholic Beverages Taxes (wholesale gallonage tax) — https://www.tn.gov/revenue/taxes/alcoholic-beverages-taxes.html
- [S55] NABCA Control State Directory; 17 control jurisdictions — https://www.nabca.org/control-state-directory-and-info

### Fees, price discrimination, invoicing quality
- [S19] NYC Hospitality Alliance / Danow Group on split-case fees — retailers charged "as much as $3 a bottle or $36 extra a case"; SLA cap **$7.39 per case** (Nov 2022 amendment); wholesalers "may proceed to post a split case fee separate from the posted bottle price"; **TRO issued 2 December 2022** blocking enforcement, outcome open — https://www.thenycalliance.org/news-item/sla-split-case-fees-/ *(404 on direct fetch; content per search summary)* and https://thedanowgroup.com/split-case-fees-and-the-case-that-followed/ *(fetched)*
- [S20] North Carolina split-case fee — $2.16 announced effective 1 June 2019; Wake County Superior Court order 16 September 2024 holding a split case fee is a quantity discount violating NC ABC rules — https://ncrma.org/government-relations/alcohol-laws-regulations/
- [S47] FTC press release, "FTC Sues Southern Glazer's for Illegal Price Discrimination," Dec 2024 — https://www.ftc.gov/news-events/news/press-releases/2024/12/ftc-sues-southern-glazers-illegal-price-discrimination
- [S48] Food Dive coverage — https://www.fooddive.com/news/federal-trade-commission-sues-souther-glazers-wine-spirits-price-discrimination/736092/
- [S49] BevNET, "FTC: Southern Glazer's Charges Independent Stores Up to 67% More Than Chain Retailers"; complaint alleges disfavoured independents paid **32%–78% more** — https://www.bevnet.com/spirits/2025/ftc-southern-glazers-charges-independent-stores-up-to-67-more-than-chain-retailers/ **[ALLEGATION — litigation pending]**
- [S50] Wine Enthusiast, NY SLA $3.5M settlement with Southern Glazer's; review of invoices and books found "incomplete, inaccurate, and inadequate invoicing practices" — https://www.wineenthusiast.com/culture/industry-news/nys-officials-fine-southern-glazers-3-5-million-pay-play-scam/ *(403 on direct fetch; content per search summary)* **[TP]**

### Error rates and operational practice
- [S1] FSR Magazine, "Overcharges Continue to Show Up on Restaurant Invoices" — Consolidated Concepts, 2015, **11,000+ invoices, 400 restaurants, at least one overcharge 35% of the time, average overcharge ~1% of invoice value**; causes cited as contracts loaded late/partially, differing contract forms, contracts never reaching vendors; explicitly "not the result of tricks or bad intentions" — https://www.fsrmagazine.com/content/overcharges-continue-show-restaurant-invoices **[TP — vendor-sourced analysis]**
- [S2] Food Service Director, "Analysis: 35% of college food invoices have overcharges" — https://www.foodservicedirector.com/colleges-universities/analysis-35-of-college-food-invoices-have-overcharges
- [S3] Forbes coverage of the same analysis — https://www.forbes.com/sites/geoffwilliams/2016/02/29/to-keep-menu-prices-from-rising-some-restaurants-look-for-ways-to-cut-costs/
- [S4] Supy, "Supplier Overcharging Restaurants" — quantity discrepancies and prior-week rate charging as the two most common mechanisms; ~12% of errors are quantity; worked example $380 agreed vs $412 invoiced, $1,600+/yr per supplier relationship — https://supy.io/blog/learn-supplier-overcharging-restaurants **[VM]**
- [S5] meez, "Restaurant Invoice Management: The Complete Guide for Operators" — reconciliation cadence (weekly minimum, daily for high-volume F&B); document the invoice number, line item, billed price and expected price, then request a credit memo; catch discrepancies close to delivery — https://www.getmeez.com/blog/restaurant-invoice-processing-to-maximize-efficiency **[VM]**
- [S9] Beverage Journal (MD/DC), "What Delivery Drivers Wish You Knew" — Elly Hartshorn (Last Mile Hillebrand) and Abbey Koenig (T. Elenteny Imports) on noting discrepancies with your signature on the BOL; unmarked issues get a warehouse investigation and otherwise "there is not much we can do"; have checks ready in payment-on-delivery markets — https://www.beveragejournalinc.com/new/easyblog/entry/what-delivery-drivers-wish-you-knew *(host unreachable to direct fetch; quotes per search summary)* **[TP]**
- [S17] Nelson-Jameson, Acceptance of Shipment Do's and Don'ts — https://nelsonjameson.com/policies/shipping/acceptance-of-shipment-dos-and-donts
- [S18] Receiving best-practice guidance — never sign for "10 cases" without counting; do not accept driver tallies; record every discrepancy on the delivery note before the driver leaves; a signed delivery note is a legal acknowledgment — https://dietetics.academy/entrepreneurship-food-service-mgt/best-practices-receiving-inspecting-food/ and https://psu.pb.unizin.org/hmd329/chapter/ch10/
- [S37] GRNI / accrual timing — "a truck unloads on March 31, but the invoice lands on April 2" — https://invoicedataextraction.com/blog/goods-received-not-invoiced **[VM]**
- [S38] One vendor invoice, multiple purchase orders — https://invoicedataextraction.com/blog/one-vendor-invoice-multiple-purchase-orders **[VM]**
- [S39] Consolidated invoicing mechanics — https://www.bill.com/learning/consolidated-invoicing
- [S25] Credit memo best practice: include relevant invoice numbers on each credit memo — https://www.bill.com/learning/credit-memos
- [S27] Keg deposits are refundable and belong in a deposit account, not COGS — https://www.coalitionbrewing.com/whats-a-deposit-on-a-keg/ and https://www.accountingtools.com/podcast-blog/269
- [S54] Wholesaler invoice charge types incl. pallet deposits credited on return, freight with BOL, temperature surcharges — https://invoicequick.com/invoice-templates/wholesaler-invoice-template **[VM]**
- [S13] "Alcohol Distributor Invoice Recordkeeping for Restaurants" — beer formats (12 oz cases, half-barrels, sixth-barrels, slim quarters); keg deposit is not beverage cost; tied-house invoice cues (free goods, unexplained credits, co-op allowances, menu-placement credits, branded equipment at no charge); "Do not assume that 'the distributor has it in the portal' means the restaurant has a record"; TTB three-year retention — https://invoicedataextraction.com/blog/alcohol-distributor-invoice-recordkeeping-restaurants **[VM — self-identified as marketing; compliance content cross-checks against S40, S12, S31]**
- [S21] Restaurant supplier invoice GL coding — bucket set, line-split decision rule, freight treated consistently either way, credits reverse the original category — https://invoicedataextraction.com/blog/restaurant-supplier-invoice-coding **[VM]**
- [S24] Restaurant supplier statement reconciliation — open-item vs balance-forward; four buckets (missing invoices, delayed credits, misposted credits, undocumented disputes); consolidated invoice posted wholly to one location distorts per-site cost — https://invoicedataextraction.com/blog/restaurant-supplier-statement-reconciliation **[VM]**
- [S26] Vintage substitution as recognised practice; sellers substituting without informing the buyer — https://www.winespectator.com/articles/i-purchased-wine-online-and-they-gave-me-the-wrong-vintages-can-i-return-them-51383 and https://www.wineberserkers.com/t/wrong-wine-delivered/334446 **[weak — consumer/retail context, not on-premise]**

### Incumbents
- [S35] Fintech.com — "EDI-powered invoice automation… Any format, any purchase — captured, GL coded, and paid"; PaymentSource handles regulated COD and term payments; mixed payment rules on one invoice (30-day beer/wine vs COD liquor); ~311,000 businesses, 57M invoices/yr, 9,700 distributors, 1,200+ managed integrations — https://www.fintech.com/ **[VM]**
- [S36] Fintech PaymentSource Invoice Data Management — captures EDI 810, CSV, TXT, flat file, XLS/XLSX, XML; standardises, GL-codes, maps pack size across vendors; 15-month searchable archive ("invoice vault"); AI extraction for **non-alcohol invoices only**. **Makes no claim of price-change detection, variance detection, credit memo tracking, PO matching, receiving verification, or three-way match** — https://fintech.com/paymentsource-retailers/invoice-data-management **[VM]**
- [S6] Ottimate, "Prevent Revenue Loss With Accurate AP" — compares invoices line-by-line against POs, cost files/pricebooks, contracts and receipts; flags price, quantity, **unit of measure/pack size**, duplicates, unauthorised charges; 2-way and 3-way matching with Receiver Validation; claims **"26% of invoices matched to a receiver have at least one discrepancy — price mismatches account for 76%"**; customers request an average of $673,714 in credits annually — https://ottimate.com/feature/catch-cost-discrepancies/ **[VM]**
- [S22] MarginEdge reviews, Capterra page 1 — Dana B. (Finance/HR Mgr) "tracking credits is not easy"; Lupe H. (Bookkeeper) "invoices are put in with a credit without actually receiving the vendor credit"; Jeremiah W. (GM) on posting delay and wrong category; Yogesh H. on turnaround time; Jennifer T. (Exec Chef) on per-item price alerts; Katie C. (AGM) on conversions — https://www.capterra.com/p/187718/MarginEdge/reviews/ **[REV]**
- [S60] MarginEdge reviews, Capterra page 2 — Business Analyst: "Sometimes the OCR technology is not able to break down complicated invoices"; Chef De Cuisine: "Maintenance on products is required almost daily" — https://www.capterra.com/p/187718/MarginEdge/reviews/?page=2 **[REV]**
- [S23] MarginEdge Vendor Statement Reconciliation Tool — email the restaurant or the vendor for a missing credit memo, including the missing document number and total; track which emails await response from Bill Pay > Reconciliation; credit memos export to R365 as AP Credit Memos — https://help.marginedge.com/hc/en-us/articles/23635825774611-Vendor-Statement-Reconciliation-Tool *(403 on direct fetch; content per search summary)* **[VM]**
- [S33] MarginEdge blog, "Alcohol beverage payments 101" (guest post by iControl) — cash/COD states, term states, combination states where rules vary by beer/wine/spirits; iControl described as "the only third-party payment solution in the food and beverage industry that handles alcohol payments" — https://www.marginedge.com/blog/alcohol-beverage-payments-101-what-you-need-to-know **[VM]**
- [S62] MarginEdge acquires Freepour (March 2024) — 2-in-1 scale and scanner, ~20 bottles/minute, scan and weigh in any order, syncs to MarginEdge for combined food and liquor cost; claimed 2–4% liquor spend reduction. **Beverage capability added is inventory counting, not invoice normalisation** — https://www.globenewswire.com/news-release/2024/03/19/2848490/0/en/MarginEdge-Acquires-Freepour-Empowering-Restaurant-and-Bar-Operators-with-Enhanced-Liquor-Inventory-Management-Solution.html
- [S63] MarginEdge price alerts — email as soon as prices come in at unexpected costs, customisable per-item thresholds, shown on the home screen — https://help.marginedge.com/hc/en-us/articles/218389107-How-do-I-set-up-a-Price-Alert *(403 on direct fetch; content per search summary)* **[VM]**
- [S42] Ottimate / Plate IQ reviews, Capterra — Jeremy F. (AP Specialist): "OCR will often use variations of vendor names for different invoices"; Amanda V. (Office Manager): "software doesn't recognize the 'picture logo' and assigns the wrong vendor"; Lauren W. (Accounting Specialist): "Frequent errors in their system's indexing that result in more time spent fixing issues than with hand entering" — https://www.capterra.com/p/148741/Plate-IQ/reviews/ **[REV]**
- [S61] Ottimate G2 pros/cons — noticeable delay between upload and availability; accuracy issues with unexpected input errors and unwanted item re-entries — https://www.g2.com/products/ottimate/reviews?qs=pros-and-cons *(403 on direct fetch; content per search summary)* **[REV/AGG]**
- [S41] xtraCHEF by Toast — Capterra ~4.3 (6 reviews) vs G2 ~2.4 (12 reviews); support and OCR-accuracy complaints; reported reviewer complaint that "unit costs are inaccurate randomly, with no evidence of where the cost came from" — https://restaurantinventorymanagementsoftware.com/solutions/xtrachef **[AGG — second-hand, verbatim not confirmed]**
- [S64] Provi (buyers) — search every distributor's catalogue at once, message reps, route order requests, order history, delivery confirmation. Order requests are "sent to your rep via email and text." **"The final invoice still comes from the distributor and all payments are still handled between the restaurant/bar and their distributors."** No invoice display, price history, receiving, or reconciliation — https://www.provi.com/buyers and https://www.provi.com/go **[VM]**
- [S65] BlueCart — claims incoming invoices matched to POs with price/quantity/item discrepancies flagged before payment; reviewer reports of invoices printing blank, dollar amounts in quantity columns, printed delivery dates differing from actual orders, HTML code printing on invoices; ordering-focused with limited in-app inventory/accounting; Capterra ~4.1 — https://restaurantinventorymanagementsoftware.com/solutions/bluecart and https://www.capterra.com/p/150106/BlueCart/reviews/ **[REV/AGG]**
- [S66] Restaurant365 — AP credit memo object exists with review/approve workflow; reviewer complaints centre on setup/onboarding and feature gaps rather than invoice extraction; BBB complaint re onboarding — https://docs.restaurant365.com/docs/ap-credit-memos-review-and-approve-a-credit-memo and https://www.g2.com/products/restaurant365/reviews?qs=pros-and-cons **[REV]**

### Alert fatigue
- [S57] Ancker JS et al., "Effects of workload, work complexity, and repeated alerts on alert fatigue in a clinical decision support system," *BMC Medical Informatics and Decision Making* (2017) — reminder acceptance likelihood dropped **30% for each additional reminder** received per encounter; acceptance associated with work complexity and repetition but not with amount of work; ~¼ of drug alerts and ⅓ of clinical reminders were repeats for the same patient within the year — https://bmcmedinformdecismak.biomedcentral.com/articles/10.1186/s12911-017-0430-8 (PubMed 28395667; note published correction, PubMed 31739801)
- [S58] Vectra AI, alert fatigue — ~2,992 alerts daily, 63% unaddressed; ~30% of alerts ignored in large organisations — https://www.vectra.ai/topics/alert-fatigue
- [S59] SANS 2025 Detection and Response Survey via Splunk/Stamus summaries — 73% name false positives the top detection challenge; 40%+ say tools lack context; **32% ignore alerts they no longer trust** — https://www.splunk.com/en_us/blog/learn/alert-fatigue.html and https://www.stamus-networks.com/blog/the-hidden-risks-of-false-positives-how-to-prevent-alert-fatigue-in-your-organization **[cross-domain]**

### Explicitly NOT found — do not present these as gaps we validated
1. **No beverage-alcohol-specific invoice error-rate or dollar-impact study.** The 35% / ~1% figures are food, 2015, single vendor-authored analysis [S1].
2. **No published distributor AR credit-claim policy** — no claim window, no documentation checklist, from SGWS, RNDC, or Breakthru. Breakthru's Missouri retailer FAQ was unreachable (connection refused) [S7][S8].
3. **No product observed performing a state-posted-price vs invoiced-price check.**
4. **No product observed rendering a normalized document back to the operator.** Every incumbent examined delivers data into an accounting or inventory system, or a review queue — none produces a document the operator hands to an AR desk.
5. **No sample beverage invoice showing an itemised state excise line** was retrieved. Do not design a required excise field.
6. **No evidence on which US states prohibit quantity discounts / free goods outright** — the CT source was unreachable.
7. **No restaurant-specific alert-fatigue research.** §D1 is cross-domain.
