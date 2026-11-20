# /inventory: state of the art (2026-11-07, short)

Sources are listed at the end. Vendor accuracy and speed claims are marketing, not independently verified.

## Counting
- **Barcode + Bluetooth scale + manual, in one count (WISK).**
  - A partial bottle is counted three ways: scale weight, visual estimate, or a typed amount.
  - Barcode → weigh → remaining volume is computed from the bottle's known tare and full weight.
  - Large pre-loaded bottle and ingredient catalogue.
  - Lesson: every line keeps a manual path; the device only fills the field.
- **Tap-the-level partials (Partender).**
  - A bottle picture is shown; the person taps where the liquid sits, then swipes to the next bottle.
  - Marketed as a full bar count in about 15 minutes. The count stage only, not reconciliation.
  - Equivalent to "tenthing", which matches founder ruling F3 (tenths → ml).
- **Phone camera shelf scan (NomadGo/METAshelf, others).**
  - Computer vision plus AR over a shelf, flagging discrepancies.
  - Evidence is mostly sponsored content.
- **Barcode-only stocktakes (Syrve).** Low risk and fast where packaged goods have barcodes; `beverages` already carries barcode/sku/upc.

**Takeaway.** No one credible ships unconfirmed CV counts. The state of the art is:
- the camera or scale proposes;
- a person confirms line by line;
- partials are measured (scale), or tapped or tenthed (visual);
- manual entry is always one tap away.

That is the shape for G9-G12.

## Usage, variance, "used in"
- **MarketMan Actual vs Theoretical.**
  - Actual usage = opening count + invoices − closing count.
  - Theoretical usage = recipes × POS sales.
  - Variance is the gap, per item.
  - It only works with disciplined counts, clean vendor-item mapping and recipes kept current with invoice cost.
  - A common rule of thumb is under 2% for well-run houses and over 5% meaning a systematic problem (a vendor blog figure).
- **Lesson.** A "used in" view and a variance KPI both require recipes linked to inventory items by id. Free-text recipes (our G3) cannot produce either. Sub-recipes (preps) are standard; Apicbase computes nutrition per recipe portion from its ingredient composition.

## Nutrition and allergens
- **USDA FoodData Central.**
  - Public domain (CC0 1.0). Free API with a data.gov key. Attribution is requested.
  - Best for raw ingredients.
  - No allergen data; allergens must be added by a person.
- **Open Food Facts.**
  - Barcode lookup `api/v2/product/{barcode}.json`, keyless.
  - ODbL database: attribution plus share-alike on a redistributed derived database.
  - Crowdsourced, so completeness varies.
  - Best for packaged goods.
- **Legal floor.**
  - The EU 1169/2011 requirement covers non-prepacked food, including restaurant dishes and cocktails, since 2014.
  - Turkey's Gıda Etiketleme ve Tüketicilerin Bilgilendirilmesi Yönetmeliği has required restaurants to give allergen information for the 14 Ek-1 allergens via menu, board or poster since 1 Jan 2020. It was amended 2024-04-06; the content of that change is not verified.
  - US FDA calorie labelling applies only to chains of 20+ locations, so it does not bind our houses today.
- **Takeaway.**
  - Allergens are a legal duty in both of our markets.
  - Calories are optional for us.
  - Recommended source order: a person states it (label read, then confirm) → OFF by barcode → USDA FDC for raw ingredients.
  - Show the source on every figure. Unknown values show as unknown.

## Sources
- WISK partial counting: https://help.wisk.ai/en/articles/3286765 ; https://wisk.ai/bar-inventory-software ; https://wisk.ai/es/for/wisk-bar-management-software
- Partender: https://apps.apple.com/us/app/-/id726829071 ; https://www.getbackbar.com/how-to-do-bar-inventory ; https://pouriq-website-drew.pages.dev/blog/tenthing-bottles-explained/
- Bluetooth scale counting: https://www.getbackbar.com/bluetooth-scale-bar-inventory
- CV shelf scan: https://www.qsrmagazine.com/sponsored/why-manual-inventory-counts-are-thing-past ; https://modernrestaurantmanagement.com/how-ai-is-revolutionizing-restaurant-inventory/ ; https://mwm.ai/apps/syrve-inventory/6746640581
- MarketMan AvT: https://marketman.com/actual-vs-theoretical-food-cost-report ; https://www.getmeez.com/blog/actual-vs-theoretical-food-costs ; https://blog.stocktake-online.com/theoretical-vs-actual-food-cost-closing-the-variance-gap
- Apicbase nutrition per portion: https://apicbase.readme.io/docs/allergens-and-nutritional-data
- USDA FDC licence and API: https://fdc.nal.usda.gov/api-guide ; https://catalog.data.gov/dataset/fooddata-central
- Open Food Facts API/ODbL (third-party summaries; confirm on openfoodfacts.org): https://apify.com/grit-77/food-barcode-nutrition ; https://freeapihub.com/apis/open-food-facts-api
- EU 1169/2011 non-prepacked: https://www.fsai.ie/business-advice/running-a-food-business/allergens/allergen-information-for-non-prepacked-food ; https://food.gov.uk/node/25461?print=1
- Turkey allergen duty: https://tesk.org.tr/resimler/2020014.pdf ; https://www.karar.com/tarim-bakanligindan-yeni-duzenleme-alerjen-gidalar-menude-belirtilecek-1430740 ; https://ordu.tarim.gov.tr/Belgeler/Gıda%20ve%20Yem/TOPLU%20TÜKETİM%20İŞLETMECİLERİNİN%20ETİKETLEMEDEKİ%20SORUMLULUKLARI.pdf
- FDA menu labelling (20+ locations): https://www.cdph.ca.gov/Programs/CEH/DFDCS/CDPH%20Document%20Library/FDB/FoodSafetyProgram/RetailFood/RMLRequirements.pdf ; https://huschblackwell.com/newsandinsights/New-Menu-Labeling-Requirements
