# Sources — Vanilla Restaurant (Kaleiçi, Antalya) behaviour profile

All URLs below were read on **2026-09-05** (Europe/Istanbul). Every price, hour, rating and
capacity figure in `profile.json` traces to a row in this file. Anything not found here is
recorded as `null` / "NOT PUBLISHED" in the profile and listed under **Gaps** at the bottom —
nothing was inferred, rounded, converted, or filled in from general knowledge.

**All prices are Turkish lira (₺ / TRY) and are recorded as integers with no currency
conversion.** See §1b for how that was established rather than assumed.

---

## 0. Why this venue, and what it beat

The brief was one real Antalya cocktail bar or bistro in Kaleiçi / Lara / Konyaaltı with the
best **public** data. Candidates were scored on one thing that cannot be worked around: does
the venue publish a **priced drinks list** that can be read without guessing?

| Candidate | District | Own site? | Priced drinks list? | Verdict |
|---|---|---|---|---|
| **Vanilla Restaurant** | Kaleiçi | yes, `vanillaantalya.com` | **yes — 215 drink rows, 194 of them priced, machine-readable, currency declared** | **chosen** |
| The Barrels Pub (Konyaaltı) | Konyaaltı | yes, `konyaalti.thebarrelspub.com` | yes — 425 price tokens across 13 drink categories, two pour sizes | **runner-up** |
| Kaleiçi Steak Gastro Bar | Kaleiçi | yes, `kaleicisteakgastrobar.com` | **no** — `/en/menu/` contains exactly one `TL` string and no price pattern; `/en/wines/`, linked from its own nav, returns **404** | rejected |
| No 14 Kaleiçi | Kaleiçi | **not established** — the guessed domain `no14kaleici.com` does not resolve; no site URL was found | not established | rejected on that basis |
| Kaleiçi Buda | Kaleiçi | **not established** — only aggregator pages were found | **not established** | rejected on that basis |
| Tipsy Old Town, Off Cocktail Bar | Kaleiçi / Konyaaltı | **not established** — guessed domains do not resolve | not established | rejected on that basis |

**The bottom three rows are a weaker rejection than the top three, and the table says so.** For
Kaleiçi Steak Gastro Bar the menu page was fetched and read: it demonstrably carries no prices.
For the last three, no own-site URL could be found at all, so the honest statement is "no
published priced drinks list was found", not "none exists". A listing summary mentioned "a litre
of house wine for 750 TL" at Kaleiçi Buda; that figure was never seen on a page and is recorded
here only as the reason the venue was looked at, never as a price.
**Why Vanilla over The Barrels Pub.** The Barrels genuinely publishes more raw price tokens.
It lost on four things:

1. **Fit.** The brief said cocktail bar *or bistro*. The Barrels is a pub — its list is beer-led
   (fıçı / craft / şişe biralar, beer cocktails, "deepshotlar"). Vanilla is a bistro with a full
   cocktail bar: 46 alcoholic cocktails in four named sections, 78 spirit rows, 37 wines, and a
   69-row kitchen menu. Turkish listings independently file Vanilla under **"Bar & Pub"** with
   **"Egzotik Kokteyller"** as a cuisine type, so it satisfies both halves of the brief at once.
2. **Provenance strength.** Vanilla's menu is not an image and not scraped prose — `menu.php`
   ships the card twice, as a JavaScript array *and* as schema.org `MenuSection` / `MenuItem`
   JSON-LD with an explicit `priceCurrency`. Nothing had to be OCR'd, so no price in this
   profile is a visual guess.
3. **Rhythm data.** Google publishes a full 7-day × 18-hour popular-times histogram for Vanilla
   (§4). That is the single most useful input for simulating a night, and the Meyhouse profile
   never got one.
4. **Age gate.** The Barrels puts its menu behind an 18+ confirmation interstitial. Vanilla does
   not, so its card is genuinely public.

The Barrels Pub is recorded here as the runner-up on the record, not discarded: if a second
Antalya tenant is ever needed, its menu is real and readable at
`https://konyaalti.thebarrelspub.com/tr/menu` (read 2026-09-05).

---

## 1. Venue's own website (primary — authoritative for the menu)

| URL | What was taken from it |
|---|---|
| https://www.vanillaantalya.com/ | Site structure; JSON-LD `Restaurant` block → address `Hesapçı Sk. No:33, Kaleiçi, Antalya`, postal `07100`, `addressCountry: TR`, geo `36.8841 / 30.7056`, `servesCuisine` (Mediterranean, International, Steak, Seafood, Thai, Pizza), `priceRange "$$$"`, `acceptsReservations: true`, `openingHoursSpecification` Mon–Sun 11:00–23:59, self-published `aggregateRating 4.6 / 1000` |
| https://www.vanillaantalya.com/menu.php | **The whole menu.** 284 rows with prices, descriptions and dietary tags; the second JSON-LD block (`@type: Menu`) confirming `priceCurrency: "TRY"` on every offer |
| https://www.vanillaantalya.com/config.php | `VA_CONFIG`: phone `+90 242 247 60 13`, WhatsApp `+90 532 353 19 33`, email, full address `Barbaros, Hesapçı Sk. No:33, 07100 Muratpaşa / Antalya`, `hours {open 11:00, close 24:00}`, and `currency.rates` with **`TRY: 1`** as the base |
| https://www.vanillaantalya.com/about.php | "Established 2007"; "A British chef's kitchen"; "Executive Chef & Owner · **Wayne**"; "an aged stone house lit by copper lamps and candlelight"; "Mediterranean, Turkish, Thai & grill — by candlelight" |
| https://www.vanillaantalya.com/contact.php | Address, phone, WhatsApp, email; the rendered hours string (see §2) |
| https://www.vanillaantalya.com/booking.php | The reservation grid: 16 time options, party sizes `1`–`8` and `8+`, occasion list, "Nothing is charged online", "For the same evening, a quick call is best" |

### 1a. The menu is text, not an image — and that matters

Unlike the Meyhouse Palo Alto card (JPEGs on a Wix site that had to be tiled and read
visually), Vanilla ships its menu as data. `menu.php` contains:

```
const MENU = [ … ]      // 5 groups → 22 sections → 284 items {n, p, d, t, img}
```

and mirrors the same card as schema.org JSON-LD. The array was lifted byte-for-byte and
parsed. **Every `name`, `price` and `description` in `profile.json` is the venue's own string**,
including its own typos, which are preserved verbatim and listed in
`menu._published_defects_carried_through`.

Consequence for provenance: there is **no OCR risk in this profile at all**. A row either has a
number in the published payload or it has an empty string. The 21 rows with an empty string are
recorded as `price: null` with `price_unavailable_reason`; none was guessed.

### 1b. How "these prices are ₺" was established rather than assumed

Two independent confirmations, both on the venue's own pages:

1. `menu.php`'s schema.org `Menu` markup gives every item an `Offer` with
   `"priceCurrency": "TRY"`.
2. `config.php` ships `currency.rates` as `{TRY: 1, EUR: 0.017782, GBP: 0.01528,
   USD: 0.020654, RUB: 1.790097}` — TRY is the base and the others are derived multipliers,
   so the stored numbers are lira.

The page's own switcher defaults to `₺ (TL)` and offers €, £, $, ₽ as conversions. **No price in
this profile was converted.**

### 1c. Published defects carried through verbatim

Recorded because a POS carries the venue's card, not a corrected one:

- `Beefeater Pink 4c`, `Don Julio Blanco 4c`, `Limoncello 4c` — the `l` of `cl` is missing.
- `San Pelegrino 75c` — misspells Pellegrino **and** drops the `l`.
- `Absolute Vanilla` (Absolut), `Jaegermeister` (Jägermeister), `Mon Réve` (Mon Rêve),
  `Chardonay` inside the Signium description.
- `İced Mocha` carries a Turkish dotted capital İ where the sibling iced coffees use a Latin I.
- **`Vodka — by the bottle` is a sub-heading shipped as an item row** with no price. Kept, and
  flagged `is_section_heading_row: true`, rather than silently dropped.
- **`Buffalo Burrata` (1650) is printed twice** — identical name, identical price, identical
  description — once under *Salad* and once under *Pizza*. Both rows kept.
- **A price conflict inside one card:** `Liqueur & Coffee` is **750** under *Aperitifs /
  Liqueurs* while `Liqueur Coffee` is **850** under *Hot Drinks*. Both recorded; neither
  corrected.
- `Mulled Wine` (600) is printed inside the *Red Wines* section.
- `House Rose (70cl)` is 70cl where the white and red house bottles are 75cl; the rosé carafe is
  named `House Wine (500ml Carafe)` with the word "Rose" dropped.

### 1d. Rows the venue publishes with no price (21)

| Section | Rows |
|---|---|
| Whisky | `Jack Daniels 70cl`, `Jim Beam 70cl`, `Macallan 15 Y.O. 70cl`, `Chivas Regal 12 Y.O 70cl`, `Chivas Regal 18 Y.O 70cl`, `Johnnie Walker Blue Label 70cl`, `Glenfiddich 12 Y.O 70cl`, `Glenmorangie 10 Y.O 70cl`, `Laphroaig 10 Y.O 70cl` |
| Vodka | `Vodka — by the bottle` (heading), `Smirnoff 50cl`, `Beluga 70cl`, `Belvedere 70cl`, `Absolute Vanilla 70cl` |
| Tequila | `Olmeca Silver 50cl`, `Don Julio Blanco 70cl`, `Patron Silver 70cl` |
| White Wines | `Antre` |
| Red Wines | `Smyrna Shiraz-Petit Verdot (glass)`, `Mon Réve Tempranillo`, `Mon Réve Montepulciano` |

The pattern is legible — **the entire by-the-bottle spirits offer is listed and unpriced** —
but the pattern is not a price. All 21 carry `price: null`.

---

## 2. The opening-hours problem — seven published ranges

This is the single largest provenance issue with this venue, and it is worth stating plainly
because a sim tenant has to be programmed with *one* answer.

| Range | Where it is published | Read |
|---|---|---|
| **Mon–Sun 11:00–23:59** | the venue's own JSON-LD `openingHoursSpecification`, on every page | 2026-09-05 |
| every day **11:00–24:00** | the venue's own `config.php` (`VA_CONFIG.contact.hours`) — this is what actually renders in the live "Open now" badge and the footer once the page hydrates | 2026-09-05 |
| every day **12:00–23:30** | the un-hydrated HTML of every page, the `og:description` meta tag, and the i18n string `footer.contact.hours` in **all 14 languages** | 2026-09-05 |
| every day **11:30–24:00** (EN) / **10:30–24:00** (TR, RU, DE) | home page i18n override `home.resband.p` | 2026-09-05 |
| every day **11:30–24:00** (EN) / **12:00–23:30** (TR, RU, DE) | home page i18n override `home.visit.hoursVal` | 2026-09-05 |
| every day **11:00–24:00** (EN) / **12:00–23:30** (TR, RU, DE) | about page i18n override `about.know.hours.label` | 2026-09-05 |
| every day **10:30–24:00** | contact page hero paragraph **as rendered in English in a real browser** | 2026-09-05 |
| **Mon–Sun 11:30–23:30**, all seven days listed individually | Google listing hours table | 2026-09-05 |
| **Mo–Su 11:30–23:30** | Restaurant Guru JSON-LD `openingHours`; page says "Updated 12 days ago" | 2026-09-05 |
| **12:00–00:00** | meyhankoli.com (Turkish listing), *Çalışma Saatleri* | 2026-09-05 |

**Method note — this was measured, not read off one page.** The static HTML of `contact.php`
says `12:00–23:30`; the same page rendered in a headless Chromium at 1440×900 says
`10:30–24:00` in the hero, `Open now · 11:00 – 24:00` in the badge and `Open every day ·
11:00 – 24:00` in the footer — **three different ranges on one screen**, because the page's
i18n engine overwrites the static markup from `config.php` and from per-page string overrides
that themselves differ by language. A `curl` of that page and a browser render of that page
disagree.

**What the profile records and why.** `operating_hours` carries **Mon–Sun 11:00–23:59**, from
the venue's own `openingHoursSpecification`, because it is the only *per-weekday,
machine-readable* statement the **venue itself** makes, and it agrees with `config.php` on the
11:00 open. Every other variant is preserved in `operating_hours._conflicts` with its exact
location. The two independent third parties (Google, Restaurant Guru) agree with each other on
**11:30–23:30**, and that agreement is recorded rather than merged.

**Seasonality — the brief's specific question.** Antalya bars do shift hours in summer.
**No source found publishes a seasonal split for this venue**: not the venue's site, not
Google, not Restaurant Guru, not meyhankoli, not any guide. `operating_hours._seasonality`
says exactly that, and dates what was published. The hours above are a 2026-09-05 reading and
carry no seasonal qualifier.

**Per-weekday variation.** None. **Every** source states one range for all seven days.

---

## 3. Listings and aggregators

| URL | What was taken |
|---|---|
| https://restaurantguru.com/Vanilla-Antalya | `#109 of 9251 restaurants in Antalya`; 3003 votes; JSON-LD `aggregateRating 4.8 / 3003`, `openingHours Mo–Su 11:30-23:30`, `priceRange "$$$"`, geo `36.883462 / 30.70663250`; page badge `$$$$`; **price range per person `TRY 800 - TRY 2,000`**; per-source ratings **Zomato 3.7/5 (9), Foursquare 7.8/10 (196), Google 4.5/5 (1188), Yandex 4.6/5 (23), Trip 4.6/5 (1582)**; features **Outdoor seating, credit cards accepted, Wi-Fi, Booking, Wheelchair accessible, Parking, Takeaway, Delivery**; "cozy terrace and picturesque flower boxes"; "dine outside, separated from the crowd by a glass screen, or inside the chic dining room"; a guest price-per-person band of ₺800–1,000 |
| https://share.google/hi8k1EvBU8BDjCsLE (resolves to the Google knowledge panel) | Google **4.5 / 1,197 reviews**; hours table for Sat 2026-09-05 → Fri 2026-09-11, **each day 11:30 AM–11:30 PM**; the popular-times histogram (§4); TripAdvisor snippet **4.6 (1,582), price range $$ – $$$**; Instagram snippet **8.7K+ followers** |
| https://wanderlog.com/place/details/1141120/vanilla-restaurant | Google 4.5 (1119) and TripAdvisor 4.5 (1526); star split 804/166/70/31/49; `$$$$ expensive`; **#3 on "Where to eat: the 50 best restaurants in Antalya Province"**; five dated Google review texts (Sep 2025 – May 2026) used for the behaviour notes; "Run by a British chef and his Turkish wife"; "Make reservations in advance due to popularity"; "Be cautious about portion sizes as they tend to be large"; "complimentary bread served with olive oil and balsamic vinegar" |
| https://www.meyhankoli.com/restoran/antalya-muratpasa-vanilla-restaurant-5860 | Categories **Bar & Pub / Restaurantlar**; cuisine types **Atıştırmalık, Egzotik Kokteyller, Meze Çeşitleri**; features **Dış Mekan, İnternet, Kredi Kartı, Meze Dolabı**; hours **12:00–00:00**; rating 4,3; a 2019 review giving historical prices (`50cc bira 26 TL`, `Pizzalar 35-50 TL`) and "Müzik kaliteli" |
| https://www.cvent.com/venues/antalya/restaurant/vanilla-antalya/venue-a84f35bf-dcec-45dc-89e1-0c427fc3ef7c | **The capacity answer: a dash for every field** — total meeting space, seating capacity, standing capacity, guest rooms. Address `Barbaros District Hesapcı St. No:33 Kaleici`. Its description is stale (see §6) |
| https://www.instagram.com/vanillaantalya/ | **8,695 followers**, 98 following, bio "International Restaurant Authentic Thai, French, Mediterranean Cuisine in the heart of the Old Town, Antalya. Est.2007", one visible highlight "Christmas Menu" |
| https://www.arrivalguides.com/en/Travelguide/ANTALYA/dining/vanilla-restaurant-1042 | "The family-run Vanilla Restaurant … boasts elegant Ottoman architecture in a contemporary setting." Its cuisine claim is stale (see §6) |

Google Maps' own place page served a signed-out **limited view** with no data, exactly as it
did for Meyhouse; the knowledge panel reached through the venue's own `share.google` link is
what carried the figures above.

---

## 4. Google popular times — the one measured traffic curve

Google's `BusynessHistogram` was embedded in the knowledge-panel payload and is recorded in
`profile.json` at `service_rhythm.popular_times.by_day`, hours 06:00–23:00:

| Day | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 |
|---|--|--|--|--|--|--|--|--|--|--|--|--|--|
| Mon | 25 | 46 | 57 | 55 | 53 | 44 | 48 | 42 | 42 | 40 | 40 | 34 | 27 |
| Tue | 29 | 34 | 42 | 53 | 55 | 65 | 65 | 65 | 61 | 53 | 42 | 34 | 27 |
| Wed | 19 | 19 | 31 | 31 | 44 | 42 | 48 | 42 | 46 | 42 | 48 | 38 | 29 |
| Thu | 19 | 19 | 27 | 29 | 31 | 34 | 29 | 38 | 42 | 44 | 42 | 36 | 29 |
| Fri | 19 | 25 | 36 | 42 | 42 | 38 | 40 | 46 | 44 | 42 | 36 | 27 | 29 |
| **Sat** | 34 | 42 | 42 | 42 | 46 | 57 | 65 | 78 | 93 | **100** | 89 | 59 | 36 |
| **Sun** | 23 | 40 | 57 | 65 | 78 | **93** | 89 | 85 | 70 | 61 | 55 | 44 | 38 |

Hours 06:00–10:00 are 0 on every day and are carried in the profile.

**Day-index basis.** Google's own `data-day` attribute: `1`=Monday … `7`=Sunday. Verified
against the panel's `aria-checked="true"` day, which was `data-day="6"` labelled *Saturday* —
and 2026-09-05 was a Saturday. The histogram blocks carry the same 1–7 indices.

**Units.** Google's relative busyness index, 0–100, scaled to **this venue's own** busiest hour.
It is not covers, not guests, and not comparable to another venue. Google's own text label at
Saturday 20:00 is "Usually as busy as it gets".

**What it contradicts.** Saturday is the peak day and **Sunday afternoon** (16:00 = 93) is the
second-busiest block, while **Friday is the second-quietest day of the week** (peak 46, behind
only Thursday's 44). A simulated week built on a Friday/Saturday peak pair would be wrong about
this venue in a way Google's own data contradicts.

---

## 5. Behaviour evidence, by claim

| Claim in `behaviour_notes` | Evidence | Source |
|---|---|---|
| The card is drink-led | 215 drink rows vs 69 food rows, counted from the published payload | menu.php |
| Cocktails repeat within a visit | "the amaretto sour, which my fiancé couldn't stop ordering" (Google review, 9 Jan 2026) | wanderlog |
| Three table-share formats exist | `Sangria 1LT` 2250; `House * Wine (500ml Carafe)` 1500; rakı 20/35/50 cl rows 1550–3550 | menu.php |
| Rakı is sold in five sizes per brand | 4 brands × {4, 8, 20, 35, 50} cl = 20 priced rows | menu.php |
| Saturday 20:00 is the week's peak; Friday is quiet | the histogram in §4 | Google |
| An all-day room, not two services | Monday holds 40–57 from 12:00 to 21:00; the venue's own copy says "Kitchen serves through the evening" | Google; about.php |
| The terrace is the constrained resource | "if you want a garden seat, it's best to make a reservation in advance"; "separated from the crowd by a glass screen" | wanderlog; restaurantguru |
| Free bread never rings | "complimentary bread served with olive oil and balsamic vinegar" | wanderlog |
| Evening arrivals cluster on the half hour | booking grid steps 30 min from 17:30 to 22:00, hourly before that | booking.php |
| A Thai section drives orders | 12 of 29 mains are Thai in 3–4 proteins; "a killer pad thai" | menu.php; wanderlog |
| Prices roughly doubled in ~a year | nine dishes at 45–58% of today's price on the year-old owner-supplied card | restaurantguru menu; menu.php |
| Guests arrive in several currencies | live TRY-based switcher for €/£/$/₽ and 14 UI languages | config.php |

**A claim deliberately NOT recorded.** A web search summary asserted "live music on Fridays and
Saturdays with very nice jazz music" at this venue. **No source could be found that says it.**
The only music evidence is a 2019 meyhankoli review saying "Müzik kaliteli" — the music is
good — which is evidence of music, not of live music and not of a schedule. It is listed under
Gaps instead.

---

## 6. What I could NOT establish (gaps)

| Gap | Why |
|---|---|
| **Seats, tables, terrace seats, bar seats** | Not published anywhere found. Cvent — a site whose purpose is publishing venue capacity — shows a **dash for every capacity field**. Left `null` rather than derived. |
| **Covers per service** | **Deliberately not estimated.** The Meyhouse profile derived a covers range from a published seat count; there is no seat count here, so a derivation would have nothing under it. `covers_per_service_estimate` is `null` and says so. |
| **Turn time / dwell / last seating** | Not published. |
| **21 unpriced menu rows** | Listed in §1d. The whole by-the-bottle spirits offer plus four wines. |
| **Bottle size for 25 of 31 bottle-listed wines** | The rows print no volume. Only the house and Smyrna rows state 75cl / 70cl / 500ml. Not assumed. |
| **Vintages, producers, grapes** | The card prints a name and sometimes a region or grape in quotes. **No vintage appears for any wine.** |
| **Spirit doubles** | Only rakı has a published double (8 cl). Every other spirit is a single 4 cl pour with one price. |
| **Opening hours** | Seven distinct ranges — see §2. |
| **Seasonal hours** | Not published by anyone, despite the Antalya norm. |
| **Service charge / VAT / kuver / minimum spend / corkage / allergen notice** | None published on the card, the booking form or the site. |
| **Live music** | Not established — see §5. |
| **TripAdvisor's own page** | **403 to every attempt**, including a headless Chromium with a real UA, `Sec-Ch-Ua` headers and an anti-automation init script. Its figures appear only as mirrored by Google and Restaurant Guru. |
| **Trip.com, Yelp, Foursquare** | Trip.com redirects to a bot-verification wall; Yelp returns 403; Foursquare redirects to a login wall. No CAPTCHA was attempted. |
| **Restaurant Guru per-source review pages** | `/reviews`, `/reviews/google` returned **503** on every attempt, twenty seconds apart. Only the summary page could be read. |
| **Instagram posts** | Login wall. Only the profile header could be read — no menu images, no event posts. |
| **Absolute traffic** | Google's popular-times values are a relative index with no absolute scale. There is no published count of guests, checks or covers for any hour. |

---

## 7. Method notes / caveats

- **Third-party descriptions of this venue are stale or simply wrong, and none was used.**
  Cvent says "modern Italian cuisine, charcoal grilled steaks from grass fed cattle";
  ArrivalGuides says the menu "revolves around Italian cuisine". Neither matches the current
  card, which is Mediterranean / international with a large Thai section. The concept in
  `profile.json` comes from the venue's own copy and its own `servesCuisine`.
- **⚠ Restaurant Guru's hosted menu was deliberately NOT used.** It is labelled *"Menu from
  owner a year ago"* and its prices are systematically lower than the venue's current card —
  Guacamole 300 vs 550, Hummus 290 vs 460, Atom 300 vs 490, Dynamite Prawns 575 vs 850, Garlic
  Prawns 650 vs 890, Grilled Octopus 1150 vs 2750, Buffalo Burrata 875 vs 1650, Lamb Shank
  1050 vs 2200, Fillet Of Beef 1300 vs 2250, Foie Gras De Canard 2200 vs 2550. It also carries
  **no drinks at all**. Using it would have put year-old prices into a POS. This is the same
  trap the Meyhouse profile hit with OpenTable's hosted menu, from a different aggregator.
- **The venue's self-published rating is quarantined.** `aggregateRating 4.6 / 1000` appears in
  the venue's own JSON-LD and matches no third party exactly. It is stored under
  `ratings_as_read.venue_self_published` with a warning, never merged with the measured ones.
- **Ratings were read from several places on one day and they disagree.** Google itself said
  4.5 / 1,197; Restaurant Guru's mirror of Google said 4.5 / 1,188; Wanderlog said 4.5 / 1,119.
  All three are recorded rather than averaged.
- **Two different geo coordinates are published** for the same address (the venue's
  `36.8841 / 30.7056`, Restaurant Guru's `36.883462 / 30.7066325`). Both recorded, neither
  averaged.
- **Item names are verbatim**, Turkish diacritics, em-dashes, curly quotes, double spaces
  (`House White Wine (glass )`), truncations (`4c`) and misspellings included. A POS carries the
  venue's names, not corrected ones.
- **The reservation grid's option order is a published defect**, not a transcription error: the
  markup lists 12:00–14:00, then 18:00–22:00, then 15:00–17:30 last.
  `reservation_grid.times_offered_verbatim` preserves that order; `times_sorted` is the same set
  in clock order and is labelled as derived.
- **Peak windows carry confidence levels.** Unlike the Meyhouse profile, all four peak windows
  here are `high` confidence, because each is read directly off Google's published histogram
  rather than inferred from service length or from which reservation slots were left.
