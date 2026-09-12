# Sources — Meyhouse Palo Alto behaviour profile

All URLs below were read on **2026-09-03** (America/Los_Angeles). Every price, hour and
capacity figure in `profile.json` traces to a row in this file. Anything not found here is
recorded as `null` / "not found" in the profile and listed under **Gaps** at the bottom —
nothing was inferred, rounded, or filled in from general knowledge.

---

## 1. Venue's own website (primary — authoritative for menus, prices and hours)

| URL | What was taken from it |
|---|---|
| https://www.meyhouserestaurant.com/palo-alto | Address "640 Emerson Street, Palo Alto, CA 94301"; phone "(650) 521 - 0935"; hours: Lunch Mon–Sun 11:45 am–2:00 pm, Dinner Mon–Thu & Sun 5:00 pm–9:30 pm, Fri & Sat 5:00 pm–10:00 pm; OpenTable reservation link |
| https://www.meyhouserestaurant.com/ | Site map: location subpages, menu, private events, catering, events calendar, jazz venue link |
| https://www.meyhouserestaurant.com/palo-alto-menu | Index of the four menu documents (dinner, lunch, lunch prix fixe, by-the-bottle wine list) |
| https://www.meyhouserestaurant.com/private-events | "private events & large parties ranging from 8 to 100 people"; "exquisite Istanbul room provides the perfect ambiance for hosting a party of up to 40 people"; A/V + private bar; 3/4/5-course pre-set menus |

### 1a. Menu images (the actual price source)

The menus are **published only as JPEG images** on a Wix site — there is no HTML or PDF text
layer, so `WebFetch` could not read them. They were downloaded at full resolution
(2550×4200 px), sliced into overlapping tiles and read visually. Filenames carry the menu's
own revision date, recorded in `profile.json._menu_versions_read`.

| Image URL | Menu filename (venue's own) | What was taken |
|---|---|---|
| https://static.wixstatic.com/media/d400d4_49a99167d8e54a8c84aaaefd45cb9f6a~mv2.jpg | `DINNER FOOD Palo Alto - 2026.06.27.jpg` | Full dinner food menu: tasting menu $105pp, all meze, Salata & Çorba, Mangal ve Fırın, Sebze, Yancılar, plus service charge / living-wage surcharge / corkage / raw-item policy |
| https://static.wixstatic.com/media/d400d4_24ecff4d5d6a48d1aa089f12427b8ed9~mv2.jpg | `ALL DAY DRINK Palo Alto - 2026.06.27.jpg` | By-the-glass wine (5oz–8oz–BTL), half-bottle wine (375ml), rakı (single/double/½btl/full btl), 11 craft cocktails, 3 NA cocktails, full spirits list |
| https://static.wixstatic.com/media/d400d4_d8d9e6df1cd740d08c649c993c96fd93~mv2.jpg | `DESSERT - PALO ALTO - 2026.06.25.jpg` | Desserts, ice creams, 5 dessert craft cocktails, dessert wines by the glass, coffee & tea |
| https://static.wixstatic.com/media/d400d4_7eaa2aa0891948478a9dfdb1f82c8f21~mv2.jpg | `LUNCH FOOD Palo Alto - 2026.06.27.jpg` | Lunch menu incl. lunch-only "Starter Flatbreads & Pide" (Lahmacun $13, pide $16–19) and lunch main-course prices |
| https://static.wixstatic.com/media/d400d4_90ce333cf76f42739c56742db9a0504a~mv2.jpg | `BTB Palo Alto - 2026-05-14.jpg` (p1) | Corkage policy; Leaving the Cellar; Sparkling; Rosé; New/Old World White; **Ancient World** White & Red (Türkiye, Greece, Georgia, Armenia, Hungary, Lebanon, Israel) |
| https://static.wixstatic.com/media/d400d4_561ccd0aa8494edcae302b7742269e9e~mv2.jpg | `BTB Palo Alto - 2026-05-141.jpg` (p2) | Old World Red (France, Italy, Spain, Morocco); New World Red; Library Wines |
| https://www.meyhouserestaurant.com/palo-alto-wine-list | Page hosting the two BTB images |
| https://www.meyhouserestaurant.com/palo-alto-dinner-menu | Page hosting dinner/dessert/drink images |
| https://www.meyhouserestaurant.com/palo-alto-lunch-menu | Page hosting the lunch image |

**Source defect found — Library Wines price column.** On BTB page 2, the FRANCE and SPAIN
rows under *Library Wines* are typeset with the price column shifted down by one row: the
first wine (2010 Chateau Montrose) has no number on its baseline, and a trailing `1125` sits
below the last wine (2012 Vega-Sicillia). Verified by cropping and upscaling that region of
the original image — it is a defect in the published document, not a misread. The printed
number sequence in column order is `[660, 4500, 3367, 3334, 672, 1750, 934, 2150, 1125]`.
Realigning it would be a guess, so **all nine of those wines carry `bottle_price: null`** with
the sequence preserved in `price_unavailable_reason`.

**Other published-menu defects carried through verbatim:** "GEROGIA" (for Georgia) as a
section heading; `Hennesey XO $` with no number; the dessert menu image is a two-up duplicate
of the same page.

---

## 2. Reservation platform

| URL | What was taken |
|---|---|
| https://www.opentable.com/r/meyhouse-palo-alto-palo-alto | Rating 4.7 (918); price band "$31 to $50"; cuisines Mediterranean/Turkish/Middle Eastern; **Dining areas: Main Dining Room, Bar seating – 21 and over only, Outdoor Seating**; Dining style "Fine Dining"; Dress code "Smart Casual"; payment options; parking "None"; features incl. Beer, BYO Liquor, BYO Wine, Corkage Fee, Full Bar, Patio/Outdoor Dining, Weekend Brunch; noise "Moderate"; "Booked 33 times today"; FAQ text on busy nights, lunch being quieter, and the jazz room |
| https://www.opentable.com/r/meyhouse-palo-alto-palo-alto?dateTime=2026-09-11T19:00&partySize=2 | **Live availability probe.** For a party of 2 on Friday 2026-09-11, the only slots offered were 6:30 / 6:45 / 7:00 / 7:15 / 7:30 PM → reservation granularity is **15 minutes**; the picker itself steps in 30-minute increments 12:00–21:00; party size 1–20 |

Reached with a real browser; both `WebFetch` and `curl` are blocked by OpenTable's bot
protection.

> **⚠ OpenTable's hosted menu was deliberately NOT used.** It is stamped
> *"Last updated: January 17, 2026"* and its prices are systematically lower than the venue's
> own June 2026 menus (Atom $14 vs $16; Ahtapot $24 vs $25; Levrek $50 vs $55; Çorba $11 vs
> $12). It also lists dishes absent from the current menu (Lahana Sarma, Kuzu İncik, Karpuz
> Çıgı, Giant Lobster Tail) and omits current ones. Using it would have put stale prices into
> a POS. Same for its hours, which are a narrower last-seating grid (lunch to 1:45 pm, dinner
> to 9:00 pm) than the door hours the venue and Yelp both publish.

---

## 3. Listings

| URL | What was taken |
|---|---|
| https://www.yelp.com/biz/meyhouse-palo-alto-2 | Price level **$$$**; categories Turkish, Mediterranean, Music Venues; 4.5 stars / 318 reviews; **hours for all seven days, identical to the venue's own site**; attributes Casual/Trendy/Romantic/Classy/Upscale/**Outdoor seating**; highlights Outdoor seating, Private events, Live music, Large group friendly, Catering; takes reservations, delivery, take-out; "Lunch Starting October 2nd" notice |
| https://www.google.com/maps/search/Meyhouse+640+Emerson+St+Palo+Alto | Google rating 4.6; listing name "Meyhouse & Meyhouse Jazz Club"; "Opens 11:45 AM Thu". **No Popular Times** — Google served a signed-out "limited view" |
| https://thevendry.com/venue/236560/meyhouse-palo-alto-palo-alto-ca/space/146132 | **"Full Buyout of Meyhouse Palo Alto — SEATED: 100"** — the only published seated-capacity number found; "private parties ranging from 10 to 100 people" |
| https://www.eventective.com/palo-alto-ca/meyhouse-753187.html | "Max Number of People for an Event: 200" (event maximum, not a seat count) |

Yelp and The Vendry required a real browser (403 to `curl`/`WebFetch`).

---

## 4. Jazz venue (drives late-seating behaviour)

| URL | What was taken |
|---|---|
| https://www.meyhousejazz.com/locations | **"Meyhouse Jazz Palo Alto seats 30 guests per seating"**; "offers full Meyhouse menu during and before the performances"; opened November 2023; 250+ events in year one |
| https://www.meyhousejazz.com/ | **"Arrive at 5:00 PM, show begins around 6:30 PM"**; **"Arrive at 8:00 PM, show begins around 8:30 PM"**; sets ~1 hour 15 minutes; "Your ticket price is for the performance. Food and beverages are not included and are charged separately" |

---

## 5. Press and reviews (behaviour notes only — no prices taken except where noted)

| URL | What was taken |
|---|---|
| https://www.foodgal.com/2023/10/palo-altos-meyhouse-is-a-must-visit/ | The meyhane rhythm: guests *"arrive at 5 p.m. to drink and savor small plates, drink some more, eat again, and not leave until 11 p.m."*; cold meze first and in volume; *"one could easily make a meal out of the assorted hot and cold meze alone"*; occupies the former Dan Gordon's / original Gordon Biersch. **Historical prices only** — tasting menu $95pp and Raki Rollie $17 in Oct 2023, both since raised ($105 / $22); the current menu figures were used |
| https://www.hautelivingsf.com/2025/10/28/meyhouse-sunnyvale-palo-alto-a-modern-tribute-to-turkey/ | Rakı *"served straight, in cocktails, or by the bottle for the table to share"*; the "ancient world" wine-list thesis and GM/Beverage Director **Refet Tugay**; founders Omer Artun & Koray Altinsoy; speakeasy-style jazz venue built with **SFJAZZ** sound engineers; guests "dine before or after the show" |
| Yelp review corpus (same URL as §3) | Family-style ordering; *"a large bar"*; *"Cute outdoor seating"*; street parking downtown; a **corkage billing dispute** ($35 for two bottles vs $35 per bottle); *"truly fabulous collection of Greek and Turkish beers"* (the only evidence of a beer program); lunch prix fixe cited at $44.95 with a whole-table rule; Lahmacun is lunch-only |
| OpenTable review corpus + FAQ (same URL as §3) | *"had to reserve outside because of jazz show inside"*; noise complaints at peak; a party of 5 spending ~$600 incl. the $260 meat plate; FAQ citing a $40 lunch prix fixe and a $98 tasting menu (both conflict with the current menu — see Gaps) |

---

## 6. What I could NOT establish (gaps)

| Gap | Why |
|---|---|
| **Table count** | Not published on any source found. Left `null` rather than divided out of the seat count. |
| **Bar seat count** | A bar exists, is bookable as a dining area, and is 21+; guests call it "large". No number published. |
| **Beer list and prices** | Beer is demonstrably served (OpenTable features "Beer"/"Full Bar"; a reviewer praises Greek and Turkish beers) but the published ALL DAY DRINK menu has **no beer section** and no beer price appears anywhere. `beer: []`. |
| **Popular times / hourly traffic** | Google served only a signed-out limited view with no histogram; Yelp showed none. |
| **Dining-room turn time** | Never published. Only the jazz room's seating structure implies dwell (~3h first seating). |
| **9 Library Wines (8 France + 1 Spain)** | Price column misaligned by one row in the published image — see §1a. |
| **Lunch prix fixe price** | The venue's own prix-fixe page renders no readable text. Third parties conflict: $44.95 (Yelp) vs $40 (OpenTable FAQ). Not recorded as a price. |
| **Chef's tasting menu price history** | Current menu says $105pp; OpenTable FAQ says $98; Food Gal (2023) says $95. Only the current menu figure ($105) is used. |
| **Hennesey XO price** | Printed on the menu as `$` with no number. |
| **Weekend brunch** | OpenTable lists "Weekend Brunch" and a reviewer mentions a Mother's Day brunch, but no brunch menu or hours are published. |
| **Square footage** | Not published. |
| **Covers per service** | **No cover counts are published anywhere.** The figures in `service_rhythm.covers_per_service_estimate` are explicitly flagged `ESTIMATE`, derived from the 100 seated capacity × assumed turn counts. The turn counts are assumptions, not measurements. The only real booking-volume datum found is OpenTable's "Booked 33 times today", which covers OpenTable parties only — not phone, walk-ins, or other channels. |

## 7. Method notes / caveats

- **Hours conflict resolved in favour of the venue.** The venue's own site and Yelp agree exactly
  across all seven days; OpenTable publishes a narrower window. The venue's hours are used;
  OpenTable's variant is preserved in `operating_hours._note`.
- **Seat count is a proxy, not a census.** `seats: 100` comes from a full-buyout listing's
  seated capacity — the closest published figure. It may include or exclude bar and patio
  seats; `seating.seats_basis` says so.
- **Item names are verbatim**, including Turkish diacritics, the venue's own inconsistencies
  (`Köpoğlu` on the dinner menu vs `Kopoglu` in press; `Çemenli Tavuk` vs `Cemenli Tavuk` on the
  lunch menu; `Sögüş Dil`), the leading `*` raw-item markers, and the smart quotes used in
  wine names. A POS carries the venue's names, not corrected ones.
- **Peak windows carry confidence levels.** Only the jazz second seating is high-confidence
  (published times). Dinner prime is medium (inferred from which slots OpenTable had left).
  The lunch peak is low — inferred from service length alone, and labelled as such.
