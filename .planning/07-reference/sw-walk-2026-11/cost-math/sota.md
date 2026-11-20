# cost-math: state of the art (2025-2026)

These notes were checked on 2026-11-07. Most sources are vendor documentation or marketing, so treat feature claims as claims.

## What the best products do

1. **The invoice line becomes a per-unit cost through an explicit pack model.**
   - Toast xtraCHEF records the purchasing UOM (case or bottle) plus Pack × Size × Unit for each product.
   - That model is what turns a $233.94 case of 6×1 L into a cost per bottle and a cost per litre. The unit type (weight, volume or count) must match.
   - AI suggests the pack, and a person confirms it once per product, not on every invoice.
   - Here: G4 and G8. Mudavym has `price_base_qty/uom` but the delivery path ignores it.

2. **Price changes flow automatically into recipe and plate cost.**
   - In MarginEdge, every line is digitised, coded and linked to vendor and recipe, and plated items re-cost as invoice prices move.
   - "Price Movers" tracks the vendor's price, not the landed cost.
   - Here: G14 and G16.

3. **Actual vs theoretical (AvT) is the core report, not purchases.**
   - Theoretical cost = POS product mix × mapped recipes × current cost.
   - Actual cost = beginning inventory + purchases − ending inventory.
   - Restaurant365, xtraCHEF, MarginEdge and WISK all ship this report. xtraCHEF's is available 2-3 business days after the period.
   - The report requires recipes and PMIX first.
   - Here: G1, G2 and G3. Mudavym has neither the theoretical side (no recipes, no cost stamped on a sale) nor a COGS on actual usage. It has purchases only.

4. **Credits and late paper re-price the cost.**
   - In Restaurant365, AP invoices and credit memos are cost-updating transactions on approval. A credit memo lowers carried cost.
   - Landed-cost practice routes a freight credit through the same channel that capitalised the freight, or books it as a named variance.
   - Here: G5, G6 and G11.

5. **Freight is apportioned to items by a chosen basis.**
   - The basis is quantity, value, weight or volume (Sage, Odoo, Supy). A person picks the rule and the system keeps the result.
   - Restaurant-specific note: freight often arrives on a separate, later bill.
   - Here: G7.

6. **Bar depletion runs by volume, and variance is reported per item.**
   - WISK, BinWise and BevSpot map POS items to pour volumes. Each sale depletes theoretically, and the variance is sold vs poured.
   - Here: ADR 0011 already does this in pos-hub. Toast does not (G13), and Floor Checker sales do not reach it (G18).

7. **Tax basis comes from the e-invoice.**
   - Turkish e-Fatura (UBL-TR) carries line-level KDV, so net vs gross is machine-readable.
   - I found no authoritative source on restaurant input-KDV deductibility. That remains the accountant's call per house, which matches the founder's per-house ruling of 2026-10-12.
   - Here: G10.

## The pattern to copy

- **Cost at receipt.** Net line value = qty × price / price base − allowance − share of discount. Add an apportioned share of charges. Stamp the tax basis. Shortfalls go to the claim only.
- **Cost at sale.** Stamp the cost of the units that left (FIFO or WAC at that moment) on the consumption row. Food goes through a recipe.
- **Corrections.** A late price, a credit or a revaluation is posted as a cost-variance row against what was already sold, not dropped.
- **Reports.** COGS = the sum of stamped sale costs. AvT = that against counts plus purchases.

## Sources
- [MarginEdge help: At a glance](https://help.marginedge.com/hc/en-us/articles/360057072773-MarginEdge-At-A-Glance-An-Overview)
- [MarginEdge: how it works](https://www.marginedge.com/how-it-works)
- [SpotOn: MarginEdge integration](https://www.spoton.com/integrations/margin-edge/)
- [Restaurant365: inventory and food cost control](https://www.restaurant365.com/restaurant-inventory-software-food-cost-control)
- [Restaurant365: AvT, closing the gap](https://restaurant365.com/?p=39346)
- [Restaurant365 help: item costing](https://restaurant365.freshdesk.com/support/solutions/articles/12000039197-item-costing)
- [Restaurant365 help: current cost method](https://restaurant365internal-help.freshdesk.com/support/solutions/articles/12000068392-inventory-cost-method-current-cost)
- [Toast xtraCHEF: Actual vs Theoretical](https://support.toasttab.com/en/article/xtraCHEF-Get-Started-With-Actual-vs-Theoretical-Analysis-Reports)
- [Toast xtraCHEF: product verification (pack/size/unit)](https://intercom.help/toast-central/en/articles/14727562-xtrachef-product-verification)
- [Toast xtraCHEF: reassign product unit](https://support.toasttab.com/en/article/xtraCHEF-Reassign-Product-Unit-for-Products-and-Associated-Items)
- [Supy: restaurant landed cost allocation](https://supy.io/blog/learn-restaurant-landed-cost-allocation)
- [Sage 100: landed cost FAQs](https://help-sage100.na.sage.com/2022/Subsystems/FAQs/FAQs/landed_cost_faqs.htm)
- [WISK: actual vs theoretical](https://www.wisk.ai/actual-vs-theoretical)
- [WISK help: FAQ](https://help.wisk.ai/en/articles/5671793-wisk-bar-faq)
- [BinWise: pour cost](https://home.binwise.com/pour-cost-calculator)
- [ecosio: compliance for Turkey (e-Fatura)](https://connect.ecosio.com/docs/compliance-for-turkey)
- [UBL-TR format explained](https://accounts-os.com/blog/ubl-tr-format-explained)
