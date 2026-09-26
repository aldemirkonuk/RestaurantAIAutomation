# 0111 — The calendar is the house's day-book of events, deadlines and the world outside

- **Status:** **Proposed — 2026-09-03. Slices 1-3 and the iCal fixes are BUILT behind
  `mudavym_design_calendar`; founder review open.** The document was a draft until the
  founder answered five of its six forks the same day. Those answers are recorded below,
  the build order they unblocked was executed as far as slice 3, and slices 4-9 remain
  unbuilt and undispatched.

  **The founder's five decisions, 2026-09-03 — each supersedes what this ADR proposed:**

  | # | Fork | The decision | What it changed here |
  |---|---|---|---|
  | 1 | A — weather licence | **NWS now, behind a `WeatherProvider` interface**, so Open-Meteo commercial can be added the day a non-US house appears. The NWS attribution and the issuer + issue time travel with every reading | §2a said "defaulting to Open-Meteo". It does not: `NwsWeatherProvider` is the only implementation, `weather-provider.ts` is the seam, and a coordinate outside US coverage gets NWS's own 404 rendered as a sentence rather than a blank |
  | 2 | B — where the coordinate comes from | **"When google maps API address is being used, take the geocode as well in sign up."** For the 13 existing rows: a one-off backfill from Places Details keyed on `google_place_id`, as a script with a dry run — never a migration that calls an external API | §6 slice 1 said "a map pin, or a geocode of the address". Neither: the point is captured from the place the operator *chose*, at the moment they choose it. A hand-typed address carries no point and `/settings` says so |
  | 3 | E — public commodity indexes | **In, but as a separate register that never sits beside a vendor quote.** USDA My Market News is real and free; a national terminal-market price is simply not a price this house can be quoted | Moves from "rejected, filed as a fork" to a decided shape. Still unbuilt — the price mark is slice 4's dependency and `vendor_price_observations` holds 0 rows |
  | 4 | F — the 90/180-day floors | **The numbers stand, and they are per RESTAURANT, never pooled across the chain** | Closes the fork this ADR raised without answering. Cross-tenant pooling stays unauthorised under ADR 0048 §Consequences until a DPA says otherwise; the floors are not a placeholder to be relaxed by a later builder |
  | 5 | C — Google app verification | **Submit the app for verification now**, rather than staying in testing behind a user cap | Unblocks slices 7-8 on the calendar scopes. Nothing in slices 1-3 depends on it; the gateway's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` pair is still unset on every deployment |

  **2026-09-04 — the verification submission gains a second scope.** The founder
  added the sending integration the same day ("add the gmail send integration
  now"; ADR 0118), so the submission is no longer calendar-only. Both are
  restricted/sensitive consent-screen scopes and both go in one submission —
  Google reviews the OAuth client, not the feature, and a second submission later
  would re-open the first one's approval.

  | Scope | Feature it serves | Justification text for the submission |
  |---|---|---|
  | `https://www.googleapis.com/auth/calendar.app.created` | The day book (slices 7-8) | Mudavym creates one secondary calendar of its own and writes only the events it created there. It never reads, edits or deletes the user's existing calendars; `calendar.app.created` is the narrowest scope Google publishes that can do this, and a broader `calendar` or `calendar.events` scope would grant access to personal calendars the product has no use for. |
  | `https://www.googleapis.com/auth/gmail.send` | The house's own letters (ADR 0118) | A restaurant manager writes a letter to a supplier by hand in Mudavym and releases it themselves; it is sent from their own mailbox so the envelope matches the sign-off and the supplier's reply returns to them, instead of leaving from an address shared by every restaurant on the deployment. `gmail.send` is the narrowest scope that can send: it grants no ability to read, search, list or modify any message, and Mudavym requests no other Gmail scope. Nothing is ever sent automatically — every message is composed by a person, held for a two-minute window in which they can pull it back, and blocked outright if it contains language that could form a binding purchase commitment. |

  Both scopes need the consent screen, the privacy policy and the demo video to
  show the *narrow* behaviour, and `gmail.send`'s reviewer question is always
  "why not a draft?" — the answer is that a draft cannot be pulled back on a
  timer and would leave the supplier's reply in a mailbox the house does not
  watch. **Unsubmitted as of 2026-09-04**, and the gateway's
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pair is still unset on every
  deployment, so neither scope has ever been exercised against a real consent
  screen.

  Fork **D** — whose Google account is the house's when a manager leaves — is the one
  left open, and slice 7 is where it becomes urgent.

  **What is built, and where:** slice 1 (`apps/api-gateway/src/auth/auth.service.ts`
  `coordinateColumns`, `apps/web/src/pages/Register.tsx`,
  `scripts/backfill_restaurant_coordinates.py`); slice 2
  (`apps/api-gateway/src/weather/`, `supabase/migrations/20260903162000_a_forecast_names_its_issuer.sql`,
  `GET /calendar/weather`, `apps/web/src/pages/calendar/next/SkyMark.tsx`); slice 3
  (`apps/api-gateway/src/calendar/recorded-days.service.ts` and `day-record.service.ts`,
  `GET /calendar/day-record`); and the four iCal fixes
  (`calendar.controller.ts`, `calendar.service.ts`, `calendar/zoned-time.ts`).

  **Amendment — 2026-09-04, two founder decisions after the first build:**

  | # | Decision | What it changed |
  |---|---|---|
  | 6 | **Record weather OBSERVATIONS beside the forecasts, so a forecast can be scored.** Per refresh, the nearest reporting station's observations for the same coordinate | §2a said the weather overlay was "transcription" with "no maths", and slice 3 wrote `prediction_outcomes` with `accuracy_score` NULL for a stated reason — *"no temperature observation is recorded anywhere"*. That reason is now gone. `weather_observations` (a sibling table, `20260904140000`) records what the station measured, and `day-record.service.ts` writes **the first real `accuracy_score` this product has ever produced**: the absolute error of the forecast daily high against the observed daily high, **in degrees Celsius, lower is better**, stated in words in every row's `context.metric` and withheld with a reason when either side is missing |
  | 7 | **A scheduled prefetch: one refresh per house per hour, for every house with a coordinate**, so a house nobody opens still accumulates history | Closes the cost this ADR's §Status admitted and filed rather than fixed. It does **not** go through `ScheduledTenantsService.runPerTenant` — that scheduler serves one house of ten (measured 2026-08-26, `communications/scheduled-tenants.service.ts:80-87`), which is this ADR's own finding — so it required an amendment to [[0022-scheduled-jobs-serve-opted-in-tenants|ADR 0022]], dated 2026-09-04, naming exactly the two NWS reads it permits and nothing else |

  **Why the score is an error and not a goodness, and why that had to be written
  down.** `prediction_outcomes.accuracy_score` is a `double precision` carrying
  an index (`idx_prediction_accuracy`), and its name says "score" while the
  number written is an error — anything reading it as higher-is-better would
  read every row backwards. Three defences, all in the row itself: the metric is
  stated in English in `context.metric`; both raw sides are kept in
  `predicted_value` / `actual_value` so the number can be recomputed rather than
  trusted; and the rows sit under their own `agent_name`
  (`mudavym.calendar.day_record`), separate from the only other writer,
  `services/self-evolution/main.py`.

  **The unit disagreement is a measured fact, not a design choice.** NWS
  publishes its gridpoint forecast in **Fahrenheit** and its station
  observations in **Celsius** (measured 2026-09-04: MTR/91,89 vs KPAO,
  `wmoUnit:degC`). Celsius is the common unit because it is the *observation's*
  own — converting the measurement would put our arithmetic on the side of the
  comparison that is supposed to be ground truth.

  **What is still not scored, and this has not moved:** the covers forecast.
  It is slice 9, gated on ninety observed service days, and the best-covered
  tenant had twenty-two. A row can now carry a real weather score and still
  carry no claim whatever about trading — which is why the recorded covers
  travel in `actual_value` unscored.

  **One thing this ADR proposed and the build did NOT do,** because the measurement
  contradicted it: §6 slice 2 said the weather refresh should run under
  `ScheduledTenantsService.runPerTenant`. It does not. That scheduler enumerates only
  tenants carrying `restaurant_feature_flags.flag_name = 'scheduled_communications'` or
  matching `DEFAULT_RESTAURANT_ID` (`communications/scheduled-tenants.service.ts:88-125`),
  and production has **one** such tenant out of **ten** (measured 2026-08-26 and recorded
  in the service's own header, `communications/scheduled-tenants.service.ts:80-87`; the `:88-125` range is the
  `list()` query and carries no count — the earlier "one of fourteen" cited it for a
  number it does not hold, corrected 2026-09-04) — so a cron behind that gate
  would have left nine houses with a permanently blank weather column and no sentence
  explaining it, which is the absence-reported-as-health fault delivered by the mechanism
  meant to prevent it. The refresh is **on read with a 60-minute max age**
  (`weather/weather.service.ts`), which costs strictly fewer issuer calls than a cron and
  works for every tenant. The cost is stated rather than hidden: a house nobody opens
  accumulates no history, which matters for slice 9's ninety-day floor and is filed in
  `calendar.md` §13.
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** calendar, day-book, weather, forecast, covers, quant, vendor-cutoff,
  lead-time, spoilage, deadlines, google-calendar, caldav, microsoft-graph, two-way-sync,
  conflict, command-palette, ask-ai, mcp, hold-to-approve, ADR-0013, ADR-0020, ADR-0048,
  ADR-0109
- **Links:** [[0013-one-commitment-guardrail]] (the line the assistant may not cross),
  [[0020-no-fabricated-answers]] (why a forecast must name its issuer),
  [[0022-scheduled-jobs-serve-opted-in-tenants]] (the scheduler every overlay refresh runs
  under), [[0042-iznik-seal-and-warm-charcoal]] (the ground and the one seal),
  [[0048-domain-quant-under-research-math]] (the quant program this is the first surface
  of), [[0109-a-reminder-is-the-houses-job-not-the-browsers]] (reminders, already built),
  `.planning/06-pages/calendar.md` §1b/§12/§13,
  `.planning/06-pages/DESIGN-FOUNDATION.md` §6 `/calendar` and §6c,
  `.planning/08-softwares/mudavym-mcp.md`,
  `.planning/sketches/098-calendar-quant-overlay/`

---

## Context

The founder kept `/calendar` unreservedly and then asked it to carry two things it does
not carry:

> "We're going to add weather forecast (basically all Quant detailed work) to predict
> weather, pricings, transportation, quality of food and so on."

> "Calendar is important because that will be a place to see all of them and all in one
> of events and deadlines. We need to keep the customer inside the app and not let them
> use outer sources so MCP or API connections is a must."

and, on 2026-09-03, widened it: *"meetings, notes, daily actions, reminder, combine
calendar, google meets, and others; make sure the command K (AI) can help you become
your assistant for overall event actions, notifications"*, with all four quant signals
and all four connection directions in scope.

### The measurement that decides the build order

Every tenant-sourced input the ask names was measured against the live production
database (project `exzueerziesmczwlhomd`) on 2026-09-03. Five of six find nothing:

| Input | Column exists? | Rows in production | Consequence |
|---|---|---|---|
| Restaurant coordinate | **yes** — `restaurants.latitude` / `.longitude` (`supabase/migrations/20260807001252_distributor_geo_foundation.sql:50-51`) | **0 of 14 populated.** 13 carry `address`, 14 carry `timezone`, 11 carry `postal_code`, and `google_place_id` exists | Weather has nowhere to point. One geocode away, not one query away |
| Covers series | **yes** — `pos_checks.covers integer` (`20260805000000_baseline_from_production.sql:4192-4208`) | 173 rows, 129 with covers, **26 distinct days — 22 of them one restaurant**, 2026-08-03 → 2026-09-05 | `holtWintersAdditive` needs `series.length >= 2 * period` (`analytics/engine/forecasting.ts:136`), so 22 points *runs* and means nothing. A weather coefficient is **not estimable at all** |
| Vendor price observations | **yes** — `vendor_price_observations` (`20260805154027_vendor_price_observations.sql:50`) | **0 rows.** Table, five indexes and RLS all in place; nothing has ever written one | The price mark has no reading |
| Delivery promise vs actual | **yes** — `procurement_orders.expected_delivery_date`, `.delivered_at` (`baseline:4533-4534`) | **2 orders, 0 with either date.** `providers.lead_time_days` set on 11 of 21 — and **4 of those are exactly 7, which is the column DEFAULT** (`baseline:4864`) | No lead-time distribution exists, and a *stated* lead time may be a default nobody chose |
| Shelf life / storage temperature reading | **no column anywhere** in 88 migrations. The only temperature fact the house records is `procurement_receipt_events.refusal_reason = 'temperature'` (`20260901220000_door_facts_are_columns.sql:125`) — an outcome, not a reading. `storage_locations.temperature_min/max` (`baseline:5498-5499`) is a zone *specification* | — | A spoilage *score* is unbuildable; a door *record* is buildable today |
| Dated deadlines | partly | `team_certifications` **0 rows** (the table and `idx_team_certs_expiry` exist, `baseline:5609`, `:11390`) · `recurring_orders` **0 rows** (`next_order_date date` exists) · `provider_promotions` **0 rows** · `procurement_documents` **0 rows and no `due_date` column at all** — only `doc_date` · **no vendor cutoff column anywhere in the schema** | `calendar_events` has 19 rows; `notifications` has 663 | Only the calendar's own entries can carry the strip on day one |

Two further measurements shape §5:

- `GET /api/v1/integrations/oauth/catalog` on the local gateway (dev-bypass session,
  2026-09-03) returns both connectors with
  `"available": false, "unavailableReason": "Google OAuth is not configured on this
  deployment."` — and `integration_oauth_connections` has **0 rows in production**, exactly
  as `20260826170000_integration_oauth_tables.sql` predicted ("Nobody has ever successfully
  connected anything").
- The connections table constrains `provider` to `('google','microsoft')` but leaves
  `integration_id VARCHAR(64)` **unconstrained**, so a `google_calendar` connector is a row
  in `INTEGRATION_DEFINITIONS` (`integrations-oauth.constants.ts:33`) and **needs no
  migration**.

### The tension this decision has to resolve

`DESIGN-FOUNDATION.md` §6, the competitive lens for `/calendar`, lists under **Do not
copy**: *"Weather-driven forecasting on the grid — a guess on a page whose virtue is that
everything is a fact."* The founder is now asking for the thing the lens told us not to
build. That objection is right and it is survivable, and the distinction is the whole
design (§2).

---

## Decision

### 1. One entry model: everything with a date is an entry in one day-book

Today `/calendar` shows `calendar_events` and nothing else, and the founder's list —
meetings, notes, daily actions, reminders — is scattered across five tables and one
surface that discards what it collects. The day-book takes **five kinds**, and the kind
is what decides how a line is drawn, never a separate view:

| Kind | Source of truth | State today |
|---|---|---|
| **Entry** — delivery, tasting, meeting, private event, audit | `calendar_events` | Built. 19 rows; carries `event_type` values (`audit`) the gateway's own enum does not contain — calendar.md §9.2 |
| **Meeting** — an entry with people and, where connected, a Google Meet link | `calendar_events` + a `conference` column that does not exist | Not built. Meet links are created by the Calendar API `conferenceData.createRequest` with `conferenceDataVersion=1`; the link is the *provider's*, so it can only exist on an entry that has been pushed (§5 direction 1) |
| **Note / memo** — what a human knows that no table does | nothing | **Collected and discarded today.** `MeetingMemoPrompt` asks for notes and `handleMemoSave` drops them (`apps/web/src/pages/calendar/CalendarPage.tsx:307-310`). The rebuilt page deliberately does not render it (calendar.md §1a) |
| **Daily action** — a recommendation acted on, a one-tap, a proposal confirmed | `recommendation_actions`, `one_tap_actions`, `ai_proposed_actions` | The tables exist and are written; **none is dated onto a day** anywhere |
| **Reminder** — a dispatch against an entry | `calendar_events.reminder_*` + `calendar_reminder_dispatches` | **Built and proven** ([[0109-a-reminder-is-the-houses-job-not-the-browsers]]). Off behind `CALENDAR_REMINDERS_ENABLED` |

**The rule that makes this one model rather than five lists:** a kind may be *drawn* on a
day, but only an **Entry** may be *edited* there. A note attaches to a day; a daily action
is a projection of a row that lives elsewhere and links back to it; a reminder is a
property of an entry. Nothing gets a second home.

**The note is where the honesty bites.** Persisting a memo needs somewhere to put it, and
`/documents-reports` has no upload path at all (documents-reports.md §10). So the note
gets its **own** table — `calendar_day_notes (restaurant_id, business_date, body,
author, created_at)` — rather than waiting on documents. A note is a day's marginalia, not
a document; conflating them is what left the memo prompt writing into a void for a year.

### 2. Four quant overlays — and the line between a record and a forecast

**The structural idea, and the answer to §Context's tension:** a calendar is the only
surface in this product that draws the past and the future in one grid. So the grid
*admits* it. Left of today, a cell holds what the ledger recorded. Right of today, it
holds a forecast **that names its issuer and its issue time**. When a day passes, the cell
keeps both and states the error.

That converts the objection. `DESIGN-FOUNDATION` §6 forbids *our guess drawn as a fact*.
It does not forbid *a meteorologist's published number, cited*. And the thing it really
forbids — a covers figure we derived and presented without its error — is precisely what
§Context proves we cannot honestly ship first anyway. The same section's other "need it
now" idea, *"The day that already happened — past cells hold what the ledger recorded"*,
is the other half of the same mechanism. Both are satisfied by one rule.

Consequence: after ninety days the house does not merely have a covers model, it has
**evidence about whether to believe one** — which is the only thing ADR 0048's method
commitments (RMSSE, pinball loss at τ = the critical ratio, never MAPE/MASE) can be
enforced against.

#### 2a. Weather — the only overlay that needs nothing from the tenant but a coordinate

- **What it is.** Daily high/low, hourly precipitation and wind for the house's own
  location, 16 days out, plus any active advisory.
- **Source.** **Open-Meteo** `https://api.open-meteo.com/v1/forecast` — no key, hourly and
  daily variables, `timezone` and `past_days` parameters, up to 16 forecast days
  (<https://open-meteo.com/en/docs>). **The trap, and it is a licensing one, not a
  technical one:** the keyless tier is **CC-BY 4.0 and explicitly non-commercial** —
  300,000 calls/month, and "websites or apps that have subscriptions" are named as
  commercial use (<https://open-meteo.com/en/terms>). A commercial Mudavym needs the paid
  API Standard tier (1M calls/month, ~$29/month, <https://open-meteo.com/en/pricing>).
  At one coordinate per house refreshed hourly, 14 houses is ~10k calls/month, so **price
  is never the constraint; the licence is.**
- **The genuinely free alternative, and why it is not the default.** NWS
  `api.weather.gov` is open data, "free to use for any purpose", needs no key (only a
  descriptive `User-Agent`), and serves `/points/{lat},{lon}` forecasts plus
  `/alerts/active` advisories (<https://www.weather.gov/documentation/services-web-api>).
  It is **United States only** — fine for Meyhouse Palo Alto, useless for a house in
  Istanbul. OpenWeather's One Call 3.0 is keyed, global, and free to 1,000 calls/day
  (<https://openweathermap.org/price>).
- **Decision.** A `WeatherProvider` interface with three implementations selected by
  environment, defaulting to Open-Meteo; the row states which issuer answered. Never a
  hardcoded vendor.
- **The maths.** None. It is transcription. Everything read is stamped with the issuer,
  the issue time and the forecast horizon, and **kept**, so §2b can be scored later.
- **Honest state when absent.** No coordinate ⇒ the weather line reads *"No location set
  for this house"* with a link to set it — never a blank, never a default city.
  **[AMENDED 2026-09-22 by the founder after the preview review — "remove the 'no
  reading' sign, leave blank". The page-level weather line still says why; a DAY CELL
  with no reading is now blank, which this ADR (and `SkyMark.tsx`) had forbidden as
  reading like fair weather. He chose blank knowing that.]** Provider
  unreachable ⇒ *"Weather could not be read at 06:14"*, and the last successful read stays
  visible with its age.
- **Day cell.** Icon + high/low in tabular mono, a six-bar hourly precipitation
  micro-chart with the millimetres beside it. Ink, not colour; the seal appears only in
  the rain bars.

**Why weather is defensible at all**, since the whole overlay rests on it moving covers:
Badorf & Hoberg, *The impact of daily weather on retail sales*, Journal of Retailing and
Consumer Services **52** (2020), 673 stores — weather moves daily sales by **up to 23.1%
by store location and 40.7% by sales theme**, the effect is **non-linear** (models without
non-linear terms misestimate extremes), and **weather forecasts improve sales-forecast
accuracy up to seven days ahead, with the improvement diminishing as the horizon grows**
(<https://www.sciencedirect.com/science/article/abs/pii/S0969698919303236>). Bujisic,
Bogicevic & Parsa, *The effect of weather factors on restaurant sales*, Journal of
Foodservice Business Research **20**(3) (2017), 350-370, tested 17 weather factors and
found the effect **differs by menu item and by daypart** — lunch was the most
temperature-sensitive service
(<https://www.tandfonline.com/doi/abs/10.1080/15378020.2016.1209723>). Two design
consequences follow directly: the covers term must be non-linear, and the forecast's
weight must **decay with horizon** rather than being drawn identically on day 2 and day 14.
Commercially the field already does this — 7shifts shows the local weather forecast beside
projected labour when a manager builds a schedule
(<https://kb.7shifts.com/hc/en-us/articles/14620377028627-7shifts-Sales-Forecast>), and
Tenzo says the effect is about *extremes* rather than absolute temperature, with rain's
impact saturating past a point
(<https://www.gotenzo.com/resources/insight/how-does-weather-affect-restaurant-sales/>).

#### 2b. Covers — the house's own guess, and it says so

- **What it is.** Expected covers per service day, with a band.
- **Source.** `pos_checks.covers` bucketed to the restaurant's business date, with days
  the house was shut removed rather than counted as zero (`analytics_day_exclusions`,
  `supabase/migrations/20260903091000_days_the_engine_must_not_count.sql` — **on this
  branch, not yet in production**) and unobserved days withheld rather than zero-filled.
- **The maths.** `holtWintersAdditive(series, 7, {α,β,γ})`
  (`apps/api-gateway/src/analytics/engine/forecasting.ts:120`, already called at
  `analytics/insights/insight-generator.service.ts:699`) for level, trend and weekday
  seasonality. Weather enters as a **ridge regressor on the residual, never on the level**,
  through `multipleRegression(X, y, {ridgeLambda})`
  (`analytics/engine/regression.ts:47`), which already returns `standardizedBetas`,
  `adjustedR2` and a `predict` closure. Non-linear terms per Badorf & Hoberg: temperature
  as a deviation from the seasonal norm plus its square, precipitation as
  `log(1 + mm)` so the effect saturates.
- **Selection and error.** Per [[0048-domain-quant-under-research-math]] §Method
  commitments: **never MAPE or MASE** for model selection (MAE-family metrics are minimised
  by the conditional median, which for intermittent demand is zero); RMSSE for point error
  and pinball loss at τ = the critical ratio for selection. `mase` stays as the reported
  benchmark against `seasonalNaive`, which today has **zero callers** anywhere in the repo.
- **Honest state when absent — the load-bearing rule of this whole ADR.** Below **90
  observed service days** the covers line is **withheld**, and the cell says
  *"Not enough of this house's own history yet — 22 of 90 days"*. Below **180** days the
  weather term is withheld separately and the line says the forecast is weekday-and-trend
  only. Both floors are stated on the face of the cell, never in a tooltip. A forecast that
  cannot beat `seasonalNaive` on RMSSE is not shown at all.
- **Day cell.** `96 ±21 · covers · forecast` in tabular mono, ink-2. Past days show
  `131 · covers · recorded` in ink-1 with `forecast said 124 · out by +7` beneath.

#### 2c. Price — a trend, never a quote

- **What it is.** Items quoted materially away from their own 30-day median, marked on the
  day the order window that would buy them closes.
- **Source.** `vendor_price_observations` (restaurant-scoped, `observed_at`,
  `signature_hash`, `content_hash`). Public commodity indexes — USDA My Market News, whose
  API is free with a registered key (<https://mymarketnews.ams.usda.gov/mymarketnews-api>)
  — are **deliberately excluded from v1**: a national terminal-market price for a commodity
  is not a price this house can be quoted, and putting one beside a real quote invites
  exactly the comparison it cannot support. Recorded as a fork, not a rejection (fork E).
- **The maths.** Trailing 30-day median per `(item, vendor)` pair; a move is reported only
  where **at least 5 observations** back it. One quote is a quote.
- **Honest state when absent.** A **dashed** mark reading *"no quote"* — not a calm mark,
  not "flat". The distinction between *stable* and *unobserved* is the entire ADR 0020
  fault, and a flat mark over an empty table is the version of it this page would commit.
- **Day cell.** One of three fixed marks: `↘ −4%` / `↗ +9%` / dashed `no quote`.

#### 2d. Delivery risk — a distribution, not a promise

- **What it is.** For each delivery drawn on a day: the vendor's promise, and how that
  vendor's promises have actually landed.
- **Source.** `delivered_at − expected_delivery_date` over completed `procurement_orders`
  per vendor; `providers.lead_time_days` / `restaurant_providers.custom_lead_time_days` for
  the *stated* term; a public road/weather advisory (NWS `/alerts/active`, or the national
  equivalent) for the corridor.
- **The maths.** p50 and p90 of the realised lead-time distribution over the last 30
  completed orders per vendor. **Fewer than 8 completed runs ⇒ a count, never a
  percentile.**
- **Honest state when absent.** Two states that must never collapse into one: *"stated 7
  days — the column default, not measured"* when `lead_time_days` equals its DEFAULT and no
  run backs it, and *"no completed run"* when the vendor has never delivered. Production
  today is the second, on every vendor.
- **Day cell.** A truck mark reading `p50 2d` / `p90 +1d` (marked) / dashed `no run`.

#### 2e. Quality at the door — a record, plus a reason to check

- **What it is.** Whether this delivery, on this day, is one to meet at the door.
- **Source.** `procurement_receipt_events.outcome` and `.refusal_reason`
  (`accepted|short|refused`, `wrong_wine|broken_case|temperature|other`) — the house's own
  door record — read against the forecast temperature for the delivery hour.
- **The maths.** No score. Three facts side by side: the forecast temperature at the
  delivery hour, the cold-holding line (FDA Food Code 3-501.16: TCS food at **41 °F / 5 °C
  or below**, hot at 135 °F or above; food held without temperature control is limited to
  **4 hours** under 3-501.19 — <https://www.fda.gov/media/127796/download>), and this
  vendor's refusal history.
- **Honest state when absent — and this is the one to be strictest about.** There is **no
  shelf-life column and no temperature reading** anywhere in the schema. A spoilage risk
  *score* would therefore be invented arithmetic wearing a number's clothes. The mark
  renders the forecast temperature and the door history and nothing else, and the register
  says in one line that a score needs `shelf_life_days` on the item first.
- **Day cell.** A thermometer mark reading `23°` where a delivery lands; dashed `no read` where none does.

### 3. The deadlines strip — one place, and every line names its table

Six classes, drawn as a strip above the grid and again on the day they fall:

| Deadline | Field it needs | State |
|---|---|---|
| Vendor order-window cutoff | **no column exists.** Needs `vendor_terms(restaurant_id, provider_id, weekday, cutoff_time, delivery_weekday, minimum_order, provenance)` — where `provenance` is `stated \| inferred \| unknown` | DESIGN-FOUNDATION §6 already names this as `/settings`' "need it now": *"Vendor terms as a tab … each with provenance … Unblocks the calendar and notification ideas"* |
| Invoice due | `procurement_documents` has `doc_date` and **no `due_date`**; 0 rows | Needs the column and a terms field |
| Certificate expiring | `team_certifications.expires_at date` + `idx_team_certs_expiry` — **purpose-built and empty** | Needs rows, not schema |
| Recurring order firing | `recurring_orders.next_order_date date` — exists, 0 rows | Needs rows |
| Promotion ending | `vendor_promotions.valid_until` / `provider_promotions` — exist, 0 rows | Needs rows |
| The entry itself | `calendar_events` — 19 rows | Works today |

**The rule:** every strip card carries the table it came from and whether the term was
*stated* by the vendor or *inferred* from N orders. A cutoff nobody stated and no order
implies does not appear as a guess; it appears as *"no order window recorded for this
vendor"* with the one control that records one.

### 4. ⌘K — the day's assistant, and the line it may not cross

The machinery exists and is proven; this extends it rather than inventing it.
`POST /ask-ai/propose` → a human looks → `POST /ask-ai/confirm` → execute **[amended
2026-09-21: the confirm step is now a sealed hold — `seal-challenge` then `sealed-confirm`
under `/ask-ai/actions/:id/`; the unsealed confirm answers 410 (the founder's "Never
without the seal", ADR 0160's review trail of that date)]**, with a
validated allowlist, grounding against candidate ids, and a status lifecycle
`proposed → confirmed → executed | failed | discarded`
(`apps/api-gateway/src/ask-ai/ask-ai.service.ts:305,429-444,525,653,700`;
`apps/web/src/services/api/askAi.ts` header: *"this module never executes anything by
itself"*). The allowlist is two families today — `procurement.reorder` and
`communications.vendor_draft` — and widening it is stated in the code as a **founder
decision, not a UI change**.

**A third family, `calendar`.** Split by exactly one test, which is [[0013-one-commitment-guardrail]]'s:
*does this leave the house?*

**May act alone** (reversible, in-house, written to the settings ledger with the utterance
that asked for it): create · move · resize · annotate an entry; set or clear a reminder;
write a day note; exclude a day from the baselines; draft an in-house notification.

**May never act alone** — each is a proposal with the hold-to-approve seal: mail or message
a vendor; place or amend an order; **push an entry to a connected external calendar other
people read**; invite an outside attendee; create a Meet link that generates invitations.
The third of those is the one this ADR adds to ADR 0013's surface and it is not obvious:
a push is a write to someone else's system that other humans see, which is the same class
of act as sending mail.

MCP's own specification arrives at the same place from the other side — clients **SHOULD**
prompt for confirmation on sensitive operations and show tool inputs before the call
(<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>). Mudavym does not
rely on the client to do that; the server-side allowlist is the gate.

### 5. Four connection directions, in this order

The order is not preference. Each direction earns the trust the next one spends, and each
is a strict superset of the machinery of the one before.

**All four ride the OAuth apparatus that already exists** —
`integration_oauth_connections` / `integration_oauth_states`, AES-256-GCM token
encryption, a CSRF state row, a scope-disclosure screen at `/authorize/:integrationId`
(`apps/web/src/App.tsx:285`), and an `availability()` gate that refuses to offer a
connector whose credentials or crypto are unconfigured
(`integrations-oauth.service.ts:88-118`). Adding `google_calendar` is **a row in
`INTEGRATION_DEFINITIONS`, not a migration** (§Context).

**1 — Push.** Mudavym writes its entries into a Mudavym-owned *secondary* calendar on the
connected account. Scope `calendar.app.created` — Google's narrowest: create a secondary
calendar and manage events on it, see nothing else
(<https://developers.google.com/workspace/calendar/api/auth>). Cost: one mapping table
(`entry id → provider event id`), one write per mutation, no sync token, no webhook.
Risk: duplicates if the mapping is lost — closed by an idempotency key on
`(restaurant, entry, provider account)` and by updating the provider's own event id rather
than searching. Deleted-on-one-side: **only we can delete**; a copy deleted in Google
returns on the next push, and the row says so before the operator connects.

**2 — Pull.** External events are read into a **read-only lane** of the day. Scopes
`calendar.events.readonly` + `calendar.readonly`. Incremental sync by `syncToken`;
deletions arrive explicitly; a `410 GONE` means discard and full-sync
(<https://developers.google.com/workspace/calendar/api/guides/sync>). Push notifications
are an optimisation over polling and never the only path: channels need HTTPS with a valid
certificate, do not auto-renew, and Google states plainly that "notifications are not 100%
reliable"
(<https://developers.google.com/workspace/calendar/api/guides/push>). Quotas are not a
constraint here — 10,000 requests/minute per project, 600 per user
(<https://developers.google.com/workspace/calendar/api/guides/quota>). Risk: a pulled event
mistaken for a house record — closed by drawing it in a separate lane carrying the account
it came from, **never as a ribbon in the delivery spine**.

**3 — Two-way.** The only direction that can lose data. Everything pull needs, plus a
per-entry version pair (our `updated_at`, their `etag`), a conflict table, and a place to
render the conflicts nobody can resolve automatically.

> **Conflict rules, stated so a builder cannot invent them.**
> 1. **Last writer wins per field**, comparing our `updated_at` against their `etag`
>    generation — not per record, so a title change and a time change on opposite sides
>    both survive.
> 2. **A delete never wins silently.** One side deleted and the other edited ⇒ the delete
>    is **refused**, the entry is marked `disputed`, and it goes to the day's conflict line
>    for a person. Nothing is ever resolved by discarding a row nobody saw.
> 3. **The loser is kept**, as a note on the entry, not overwritten.
> 4. **The echo is closed structurally**: every outbound write is stamped with our own
>    request id, and an inbound change whose `etag` we produced is ignored.
> 5. **A pulled-then-promoted event keeps its origin.** An external event a human turns
>    into a house entry records which account it came from, permanently.

**4 — Expose.** Not a calendar connection: the house's day-book offered to whatever
assistant the house already uses, over MCP. Per `08-softwares/mudavym-mcp.md` — *"it reads
freely and it commits nothing"* — and this ADR names **the calendar tools as the MCP
server's first shipped tools**: `calendar.read_day`, `calendar.list_deadlines`,
`calendar.propose_entry`. The propose verb lands in the same proposal queue §4 uses, so
there is one approval surface and not two. Risk of an assistant that commits is closed
**structurally**: no send verb is implemented, so there is nothing to refuse at runtime —
the same choice [[0107-a-declared-server-is-not-a-reachable-one]] made by shipping the
handshake without `tools/call`.

**And the feed that already exists.** The iCal publish endpoint is live and, per
`v3.0-TECH-DEBT.md:243-245`, has never been observed to subscribe. Four concrete suspects,
all one-line fixes, are recorded here because they are cheaper than any of the four
directions: `Content-Disposition: attachment` tells clients to save a file rather than
subscribe (`apps/api-gateway/src/calendar/calendar.controller.ts:647-650`); every event is
built with `new Date('YYYY-MM-DDTHH:mm:00')`, which resolves on the **server's** clock
rather than the restaurant's IANA zone (`calendar.service.ts:1287-1294`); no
`X-PUBLISHED-TTL` / `REFRESH-INTERVAL` is emitted, so clients choose their own refresh; and
the token endpoint returns a **relative path** with no absolute origin and no `webcal://`
alternative (`calendar.controller.ts:666`). CalDAV (RFC 4791, Proposed Standard, March
2007) is the standards-track two-way answer for Apple clients and is **out of scope**: it
requires WebDAV Class 1, ACLs, ETags and the `calendar-query`/`calendar-multiget` REPORTs
(<https://datatracker.ietf.org/doc/html/rfc4791>), which is a server to build, not a client
to call.

### 6. Build order

Nine slices. Each is independently shippable, behind `mudavym_design_calendar` unless
noted, and each states its size.

| # | Slice | Size | Why here |
|---|---|---|---|
| 1 | **The coordinate.** A location field on the restaurant (map pin or geocode of the `address`/`google_place_id` already stored), written to `restaurants.latitude/longitude` | S — one form, one geocode call, no migration | Nothing in §2 exists without it, and it is empty on all 14 rows |
| 2 | **Weather overlay.** `WeatherProvider` interface + Open-Meteo implementation, cached per (coordinate, day) and refreshed under `ScheduledTenantsService.runPerTenant`; a `weather_readings` table that **keeps** each reading with its issuer and issue time | M — one gateway module, one migration, one day-cell block | The only signal that produces a real number for every tenant on day one |
| 3 | **Past cells hold the record**, and a passed day states its forecast error | S — the reconciliation line, no new data | Turns slice 2 from a guess into a scored claim; it is also DESIGN-FOUNDATION §6's own "need it now" |
| 4 | **Deadlines strip** over what exists (`calendar_events`, `recurring_orders`), plus `vendor_terms` with `provenance` and `procurement_documents.due_date` | M — one migration, one `/settings` tab (coordinate with the settings owner) | The founder's "all in one place"; unblocks the cutoff mark |
| 5 | **Notes and daily actions on the day.** `calendar_day_notes`; recommendation/one-tap/proposal rows projected onto their date | M | Closes the memo-into-a-void fault; the founder named notes and daily actions explicitly |
| 6 | **⌘K calendar family.** `calendar.create/move/annotate/remind/note` on propose→confirm, with the leaves-the-house split of §4 | M — extends a proven module | Needs slices 1-5 to have anything worth acting on |
| 7 | **Google Calendar connector — push.** `google_calendar` definition row, `calendar.app.created`, mapping table | M — no migration for the connector itself | First direction; also the only way a Meet link can exist |
| 8 | **Pull, then two-way** on the same connector, with the §5 conflict rules and the conflict line rendered | L — sync tokens, watch channels, conflict table | Earns its trust from 7 |
| 9 | **Covers overlay**, gated on 90 observed days; the weather regressor gated on 180 | M, but **time-gated not effort-gated** | It cannot be honest before the history exists. Slice 2 is what accumulates it |

**Two fixes that belong to no slice and should ship immediately**, because each is one
line and each is currently a live defect: the iCal `Content-Disposition` header, and the
zone-less `new Date()` in the feed.

---

## Alternatives rejected

**Ship the covers forecast first, because "quant" is what was asked for.** Rejected on
measurement: 22 observed days for the best-covered tenant. `holtWintersAdditive` would
return a number, the page would draw it, and it would be noise wearing tabular mono —
the exact failure ADR 0020 exists to prevent, on the page whose whole virtue is that
everything on it is a fact.

**Ship the deadlines strip first, because those are the house's own facts.** The
attractive answer, and it fails the same test harder: of the six deadline classes,
`team_certifications`, `recurring_orders`, `provider_promotions` and
`procurement_documents` are all **empty**, `procurement_documents` has no `due_date`
column at all, and no vendor cutoff column exists anywhere. A strip built today shows one
class out of six.

**Obey DESIGN-FOUNDATION §6 and draw no weather at all.** The strongest counter-argument
in the repo, and it loses on a distinction §6 itself implies: it forbids *forecasting*
drawn as fact, and a published meteorological forecast attributed to its issuer is a
citable observation about the future, not our guess. What §6 actually forbids — our covers
number derived from weather and shown without its error — is slice 9, deliberately last
and explicitly gated.

**A keyless Open-Meteo call, shipped as-is.** Technically perfect and legally wrong: the
keyless tier is non-commercial, and Mudavym is a commercial product. Recorded as a licence
decision (fork A) rather than left as a default nobody chose.

**A weather-driven labour or prep recommendation.** The obvious next step, and the one the
architecture is worst at: ADR 0048 records that this system is *"structurally a
regression-to-the-mean machine — it flags outliers, acts on outliers, then measures
outliers,"* under which random recommendations report a win. Not until there is a holdout.

**CalDAV as the two-way answer.** It is the standards-track one and it means building a
WebDAV server with ACLs, ETags and REPORT queries. Google and Microsoft cover the great
majority of what a restaurant actually uses, over HTTP APIs we can call rather than a
protocol we must serve.

**Public commodity indexes on the price mark.** USDA My Market News is free and real
(<https://mymarketnews.ams.usda.gov/mymarketnews-api>), and a national terminal-market
price is not a price this house can be quoted. Beside a real vendor quote it invites a
comparison it cannot support. Filed as a fork.

**Let the assistant push to a connected calendar without a seal.** Rejected: a push is a
write to a system other humans read. That is the same class of act as sending mail, and
ADR 0013 exists because a runtime that could bind the house ran the weakest of three
guardrails while two code comments guaranteed nobody would notice.

---

## Consequences

- **`/calendar` stops being a dead-end page.** It gains inbound dependencies on
  `/settings` (vendor terms, the location), `/team` (certificates), `/orders` (recurring
  orders, lead times) and `/recommendations` (daily actions). Every one of those is a
  *read*; the calendar writes to none of them.
- **A new external dependency in the request path.** The first third-party data source
  this product reads on a schedule. It must fail the way ADR 0020 requires: a stale
  reading with its age, never a silent gap.
- **Three tables and two columns are proposed**: `weather_readings`,
  `calendar_day_notes`, `vendor_terms`; `restaurants.latitude/longitude` populated (the
  columns exist), `procurement_documents.due_date`. Plus `calendar_external_events` and a
  mapping table when slice 7 lands.
- **The ⌘K allowlist widens for the first time since it was written.** The dispatcher
  already fails loudly when the allowlist and the switch disagree
  (`ask-ai.service.ts:955-959`), so the widening is safe by construction.
- **The Mudavym MCP server gets its first three tools**, which makes
  `08-softwares/mudavym-mcp.md` stop being entirely aspirational.
- **The covers overlay is time-gated, not effort-gated.** Slice 9 may sit unbuilt for
  three months after slice 2 ships. That is the correct outcome and the page should say
  which day of ninety it is on.
- **ADR 0048's Lane A gets its first surface.** `seasonalNaive` has zero callers today and
  `prediction_outcomes` is written by nothing; slice 3's reconciliation line is the first
  thing in the product that would fill either.

---

## Forks this raises — filed, not decided

Not written to `OPEN-DECISIONS.md` by this draft (the register's row order shifts
citations across ~89 files — see the register-row memo); the parent files them.

| Fork | Question |
|---|---|
| A | **Weather licence.** Paid Open-Meteo commercial (~$29/mo, global), free NWS (US only), or keyed OpenWeather? A keyless call on the free tier is not available to a commercial product. |
| B | **Where the coordinate comes from.** Geocode the stored `address`/`google_place_id` for all 14 rows in a migration, or ask each house to drop a pin? A geocode is a guess about a legal entity's location; a pin is a fact the operator asserted. |
| C | **Google app verification.** Calendar scopes are consent-screen scopes. Stay in testing with a user cap, or verify the app? *(Answered — submit. As of 2026-09-04 the submission also carries `gmail.send`; see the decision table above.)* |
| D | **Whose calendar.** A connection is per *user* (`integration_oauth_connections.user_id`) but the day-book is per *restaurant*. When a manager leaves, whose Google calendar was the house's? |
| E | **Public commodity indexes** on the price mark — in, out, or in a separate register that never sits beside a vendor quote? |
| F | **The 90/180-day floors.** Are they the right numbers, and are they per-restaurant or per-chain? Cross-tenant pooling would relax them and is unauthorised under ADR 0048's §Consequences until a DPA says otherwise. |

---

## Review trail

- 2026-09-22 (round 6y) — **the lapsed-`valid_until` fork, closed.** The
  founder, 2026-09-22, verbatim: *"Feed stays stricter (Recommended)"*. The
  calendar feed keeps reading a lapsed `valid_until` as the end of
  membership: once it has passed, the link serves only the expired notice,
  and the first fetch after it stops the link for good (as `system`,
  `revoke_reason = 'left_house'`; a stop that fails is logged and tried
  again on the next fetch, and the notice is served either way). The app's
  role reads (`house-role.ts` `roleInHouse`,
  `OrganizationsService.resolveRestaurantRole`) do not yet honour it, so
  such a person keeps the app and loses the calendar link.
  - No code changed this round; the pick and the build already agree.
    `feedRoleOf` (`feed-scope.ts:117-135`) filters on `valid_until`,
    `CalendarLinksService.roleOf` (`calendar-links.service.ts:172-178`)
    selects it into that check, and `renderFor`
    (`calendar-links.service.ts:631-634`) stops a live link when the role
    comes back empty.
  - Pinned by `feed-scope.spec.ts` and `calendar-links.service.spec.ts`.
    Last-call mutation, 2026-09-22: dropping the `valid_until` filter from
    `feedRoleOf` fails 3 cases across both files (86 run); restored, the
    calendar suites pass, 12 suites and 264 tests.
  - The app catching up is **not built here**: teaching `roleInHouse` and
    `resolveRestaurantRole` to read `valid_until` the way the feed does is
    another lane's work. The digest's recipient read
    (`RecommendationDigestService.readMemberIds`) already honours it. It is
    not filed as a new open decision, because no gateway code writes
    `valid_until` (measured 2026-09-22), so the gap is latent, not live.

- 2026-09-21 (round 6t) — **the five forks the personal links left open,
  answered and built.** The founder, 2026-09-21, verbatim, one pick per fork:
  1. On a person who leaves: *"Yes, revoke on leaving (Recommended)"*.
  2. On who may stop an owner's link: *"No, owners only (Recommended)"*.
  3. On the address being shown only once: *"Show once (Recommended)"*.
  4. On who may narrow their link by category: *"Everyone can narrow
     (Recommended)"*.
  5. On what a staff link carries until areas exist: *"Same as the app
     (Recommended)"*.

  This supersedes the entry below wherever they differ.

  Built:
  - **(1) Leaving ends the link for good.** `calendar/stop-links-on-leaving.ts`
    stops the leaver's live link in that house (`revoke_reason =
    'left_house'`, `revoked_by` = whoever made them leave) and files one
    `system_audit_log` row per link (`calendar_link_revoked`, with
    `changes.via` naming the door and never the secret or its hash). The
    doors that end a membership were found by reading every write in
    `apps/api-gateway/src` that deletes a `user_restaurant_access` row or
    clears `users.restaurant_id`: `MembersService.removeMember` (both
    branches: the access row, and a member known only by the `users` row),
    `TeamService.deleteMember`, `AuthService.leaveRestaurant`, and
    `AuthService.deleteAccount` (every house at once; without this, the
    `users` delete would cascade the rows away with no record). No gateway
    code writes `is_active = false`, `deactivated_by` or `valid_until`.
    - Each door calls the stop after its refusal checks and before its first
      membership write. A refused removal stops nothing. A stop that fails
      throws, and nothing about the membership has changed.
    - A membership that ends outside those doors (a lapsed `valid_until`, a
      hand-run delete) is caught by the feed: a live link whose person has no
      role is stopped the same way, as `system`, before the notice is
      answered. *[Last call, same day: only the feed reads a lapsed
      `valid_until` as the end of membership (`feedRoleOf`, since the entry
      below). The app's role reads (`house-role.ts` `roleInHouse`,
      `OrganizationsService.resolveRestaurantRole`) do not read
      `valid_until`, so such a person would keep the app and lose the link.
      No gateway code writes `valid_until` (measured). Put to the founder,
      not decided here.]* *[Closed 2026-09-22, round 6y — the founder,
      verbatim: "Feed stays stricter (Recommended)". The calendar feed stops
      the link once `valid_until` has passed, even though the app's role
      reads do not yet honour it (`feedRoleOf` unchanged by this round — code
      already matched the pick, confirmed by re-reading
      `feed-scope.ts:117-135` and `stop-links-on-leaving.ts:29-32`). The app
      catching up — `house-role.ts` `roleInHouse` and
      `OrganizationsService.resolveRestaurantRole` reading `valid_until` the
      same way — is not built here; it is another lane's work. See the review
      trail entry of that date.]*
    - A returning person connects again. The old address never serves again.
    - Migration `20260926130100_a_person_who_leaves_loses_their_calendar_link.sql`
      widens the revoke-reason CHECK to allow `left_house`. It is additive and
      idempotent.
  - **(2) Owners manage owners** (ADR 0162's owner rule).
    `CalendarLinksService.revokeFor` reads BOTH roles before any write, the
    way the ADR 0162 removal doors read them (`house-role.ts` `roleInHouse`:
    the active access row, else a `users` row naming the house, at its role).
    - An owner may stop anyone's link.
    - A manager may stop a manager's or staff's link, never an owner's. This
      includes an owner known only by a `users` row.
    - Staff and non-members may stop nobody else's.
    - A refusal writes nothing. A stop's audit row records `actor_role` and
      `target_role`. The controller's `assertCanManageRestaurant` stays the
      outer door.
    - The register (`GET /calendar/ical-links`) now gives, per row, the
      person's role now (null when they are no longer a member; an active
      access row with a NULL role reads as staff) and whether the caller may
      stop it. Where the caller may not, the sheet shows "Only
      an owner can stop an owner's link." in place of the button.
  - **(3) Shown once.** Storage stays hash-only. One sentence, `SHOWN_ONCE`
    in `apps/web/src/components/calendar-link/calendar-link-copy.ts`, is used
    on all five surfaces (the `/calendar` sheet, `/settings`, legacy
    Settings, `/connections`, get-started): *"Your address is shown only
    once, when it is made. If you lose it, "Get a new link" makes a new
    address, and the old one stops working."*
  - **(4) Everyone can narrow; a pick never shows more.**
    - `feedScopeFor` now applies a saved pick for every role. The role alone
      sets the ceiling (which shifts, which events). The pick is only a set
      of known categories to keep, so every filter it adds removes rows.
    - A staff pick naming "shifts" still serves only her own shifts. A pick
      saved as an owner narrows a demoted person's lower ceiling and never
      lifts it.
    - The owner-only checks in `validatePick` and `setCategories` are gone.
      `canPickCategories` is true for every member. The sheet tells them
      *"Picking narrows your link. It can only show less than you may see
      here, never more."*
  - **(5) Same as the app.** Until a provider binds `PERSON_AREAS`, a staff
    link carries exactly the house events that person sees in the app plus
    their own shifts, never more.
    - Measured: `GET /calendar/events` (`CalendarService.listEvents`) filters
      by house and, by default, `parent_event_id IS NULL`, with no role
      filter. The feed's `readEvents` reads the same set with no further
      filter.
    - That is every event of the house today, which is wider than "only
      bar-area events". It narrows by itself the day areas are bound.

  Evidence, measured 2026-09-21 in the lane worktree:
  - Tests: gateway `src/calendar` 12 suites / 264 tests pass. With
    `src/restaurants`, `src/team` and `src/auth` added, 41 suites / 637 tests
    pass; `src/notifications` (which shares the fake store) 20 suites / 298.
    The web's calendar-link surfaces pass 10 files / 284 tests. `tsc` is
    clean on both apps, and the gateway boots.
  - `calendar-links-leaving.spec.ts` drives every door for real over the
    filter-honouring stub. It checks that the link is stopped for good and
    audited, that nobody else's link is touched, that the stop comes before
    the first membership write, that a failed stop refuses the whole
    removal, that re-adding the person revives nothing, and that a link
    stopped earlier keeps its record (who, when, why) with no second audit
    row.
  - The owner rule is tested both ways, plus a 16-cell truth table.
  - The never-more rule is tested exhaustively: 3 roles x 1024 category
    subsets x 2 area worlds, with junk words mixed in.
  - The same-as-app test compares the staff feed's event UIDs with the real
    `listEvents` over the same rows.
  - Mutations, each failing its suite. 27 in the gateway:
    - every door's stop removed, not awaited, or moved after the membership
      write;
    - a swallowed stop failure;
    - a stop ignoring the house, or filing no audit row, or writing the wrong
      reason, or rewriting a link stopped earlier (this one survived until
      the lane's last call added the test);
    - the feed backstop removed;
    - a manager stopping an owner, staff stopping others;
    - the target's role read the feed's way;
    - the register saying everyone may stop, or showing an active NULL-role
      member as someone who left;
    - a failed role read passing;
    - a staff pick widening shifts or areas;
    - an unknown word turning the pick off;
    - picks ignored for staff, or the owner-only pick restored;
    - occurrences in the feed, or cancelled events hidden from staff.

    6 in the web:
    - Stop offered on an owner's row;
    - the pick made owner-only again;
    - the shown-once sentence dropped from the sheet, from `/settings`, or
      from legacy Settings;
    - the narrow-only sentence dropped.
  - The migration was applied after the other 193 in PGlite (not Supabase),
    and 13 checks held:
    - `left_house` is refused before it and accepted after it;
    - unknown reasons and the revoke pair are still refused;
    - the earlier reasons are still accepted;
    - a leaver can connect again;
    - there is one named reason CHECK;
    - a second run leaves the same constraints;
    - the table comment is updated;
    - RLS is on.
  - CLAIMS row `ADR-0111-PERSONAL-CALENDAR-LINKS` gains a clause for each
    answer. Each of its 21 new mutations fails the verify.

  Not built, and why:
  - A DB trigger on the membership tables. The doors are in code, carry the
    actor, and are tested. A trigger would lose the actor and sit where no
    spec reaches.
  - One gap remains. If a membership ends outside the doors AND is restored
    before any calendar app fetches the link, the link revives: the feed's
    own stop only runs when the address is asked for. No gateway code can end
    a membership that way today (measured above).

- 2026-09-21 (later) — **a calendar link belongs to one person.** The founder,
  2026-09-21, verbatim: *"every manager, staff and their labeled
  taskforces/areas, owners have different calendar subscriptions, they can
  connect their own. Soit should be personalized"*, confirmed on this example:
  *"Ayse (bar staff) connects HER OWN link to her phone. It shows only her
  shifts and bar-area events (deliveries to the bar, bar tasks). The owner
  connects his own link, which shows everything, or just the parts he picks.
  When Ayse leaves, only her link stops; nobody else re-subscribes."* ->
  *"Yes, personal links"*. On a revoked or rotated link: *"an empty calendar
  with a little text appeared, and saying calendar link expired, connect
  again"*. This supersedes the entry below wherever they differ.

  Built (`calendar-links.service.ts`, `feed-scope.ts`, `ical-render.ts`,
  migration `20260926130000_a_calendar_link_belongs_to_one_person.sql`):
  **[Renumbered 2026-09-25, merging `origin/main` 059169a5 into #438: the two migrations were `20260921170600` and `20260921170700`, below main's newest `20260922231300`, which ADR 0212's `check_migration_order.py` refuses. Moved by `git mv` to `20260926130000` and `20260926130100`, same order, content unchanged except the versions they cite (including the `'migration'` value in 180300's audit row); every citation in this ADR, CLAIMS, the page notes and the calendar code was rewritten. No main migration after `20260921170600` touches `calendar_feed_links`, `calendar_ical_token`, `user_restaurant_access` or `team_members`.]**
  - `calendar_feed_links`: one row per person per house, at most one live
    (partial unique index on `(restaurant_id, user_id) WHERE revoked_at IS
    NULL`), actor FKs to `public.users(user_id)`, RLS on, service_role only.
    The secret is stored as a SHA-256 hash and shown ONCE, on the answer to
    the click that made it — the way `mcp_server_credentials` keeps its keys.
    A returning reader is told that and offered a new link; they are never
    shown a dash that reads as "no link".
  - Made only by the person, by pressing "Connect my calendar"; reading
    (`GET /calendar/ical-token`, now "my link") never writes. The person may
    get a new link (rotate, one UPDATE) or stop theirs; an owner or manager
    may list who has connected (`GET /calendar/ical-links`) and stop anyone's
    (`DELETE /calendar/ical-links/:userId`), gated by
    `assertCanManageRestaurant` *[round 6t, above: a manager never an
    owner's, and every member may pick for their own link]*. Create, rotate,
    stop and an owner's category pick are each filed to `system_audit_log` under the caller's
    `public.users.user_id`, never with the secret or its hash.
  - What a link serves is decided when the calendar app asks, from the
    person's role in the house AT THAT MOMENT (`feedRoleOf`): owner —
    everything, optionally narrowed to the categories they pick *[round 6t,
    above: every member may narrow their own, never widen]*; manager —
    the house calendar and every shift (`calendar_events` has no private or
    owner-only column and `listEvents` has no role filter, measured on the
    baseline, so "minus owner-private items" removes nothing today;
    `selectEvents` is where such a flag would be honoured); staff — their own
    shifts plus events for their areas. **The areas model is another lane's
    build**: the typed hook is `PersonAreasSource` / `PERSON_AREAS`
    (`feed-scope.ts`), and until a provider is bound a staff link carries
    their own shifts plus the house events they already see in the app —
    which today is every event, wider than the founder's "only bar-area
    events". The page says so to the person. Labor cost is in no feed.
  - A person removed from the house (access row deactivated, expired or
    gone) has no role, so their link answers the notice from the next
    request, with no revocation step and nobody else's link touched. *[Round
    6t, above: leaving now also stops the link for good, audited.]*
    Nothing expires on a timer.
  - Every dead address — revoked, rotated away, removed from the house, the
    retired shared link, never existed, malformed — answers ONE VCALENDAR
    with exactly one all-day event, *Calendar link expired - connect again*,
    carrying no data, byte-identical for every cause on a given day (so it is
    no oracle for once-real secrets, T-30-09's reason). A read that FAILS is
    not a dead address: it answers 503 with `Retry-After`, so a subscriber
    keeps its last good copy instead of being told to reconnect.
  - The shared house link is migrated away: the migration nulls every
    `restaurants.calendar_ical_token` and files one `system_audit_log` row
    (`calendar_ical_house_link_retired`) per house it switched off. The
    column is kept (additive only) and no gateway code reads it. Owners and
    managers of such a house are told on `/calendar`, `/settings`,
    `/connections` and legacy Settings that it was switched off and to connect their own.
  - UI: "Connect my calendar" on `/calendar` (a sheet: what my link shows,
    connect, the address once with copy and open-in-app, get a new link,
    stop; owners pick categories; owners and managers see who has connected
    and can stop anyone's), and the same own-link row on `/settings`, legacy
    Settings, `/connections` and get-started's `OptionalTail`, all through one
    hook (`useMyCalendarLink`) that reads on mount and writes only on a
    click. The dashboard's old copy-URL button opens the sheet
    (`/calendar?connect=1`).

  Evidence, measured 2026-09-21 in the lane worktree: gateway
  `src/calendar` 11 suites / 220 tests pass; web calendar-link surfaces 10
  files / 281 tests pass; `tsc --noEmit` clean on both. Mutations, each
  failing its suite: staff link serving every shift (6 fail), an unknown role
  word read as manager (6), a removed person still served (3), a revoked row
  still found by the feed (2), `getMine` minting (1), the notice varying per
  request (5), stop-for without the tenant filter (1), anyone picking
  categories (1), the secret stored in clear (21), the register and stop-for
  gates removed (2 and 3), the shared hook minting on mount (18 across four
  surfaces), `OptionalTail` connecting on mount (2). The migration was
  applied after the other 192 migrations in PGlite (not Supabase; see the
  pglite-full-corpus-build recipe) and 16 checks held: tokens nulled, one
  audit row for the one house that had a link and none on a second run, the
  live-person index, the hash and category CHECKs, the revoke pair, RLS on,
  no anon/authenticated SELECT, both actor FKs on `public.users`. CLAIMS row
  `ADR-0111-PERSONAL-CALENDAR-LINKS` pins it statically (each of its
  clauses mutation-tested; it fails on `origin/main`).

  Not built: a `/profile` entry (connections live on `/connections` and
  `/settings`, both done) and anything in the mobile app (it has no calendar
  link surface). A person known only by `users.restaurant_id` with no access
  row reads as staff in the feed, never by `users.role` (TeamService's rule,
  not `resolveRestaurantRole`'s).

  Open, for the founder (found by the lane's last-call review, 2026-09-21):
  leaving the house stops what a link serves, but does not revoke its row. So
  the register still lists a person who left, and if that person is added
  back, the same old address serves again without them connecting. Whether
  leaving should end the link for good is not decided here. *[Answered the
  same day, round 6t, above: "Yes, revoke on leaving (Recommended)"; built.]*

- 2026-09-21 — **a page view minted the feed's bearer credential; fixed, and
  existing tokens stay valid until an owner or manager revokes or rotates
  them.** *[Superseded later the same day — see the entry above: links are
  personal, any member makes their own, the shared house tokens were retired
  by migration `20260926130000`, and a dead link answers one notice event
  instead of an empty 200. `ical-token-no-mint-on-read.spec.ts` and
  `ical-token-role-gate.spec.ts`, cited below, were replaced by
  `calendar-links.service.spec.ts` and `calendar-links.gate.spec.ts`.]* Measured by the merge-train session: `GET /calendar/ical-token`
  (`getOrGenerateICalToken`) ran `crypto.randomBytes(32)` and `UPDATE
  restaurants SET calendar_ical_token` whenever the house had none — a read
  minting and persisting a permanent, unauthenticated bearer credential. It
  was reached on mount by `/connections` (`useConnectionsNextData.ts:589-595`
  pre-fix), by legacy `Settings.tsx:284-296` with no role gate at all, by the
  `/settings` calendar section (`useSettingsNextData.ts`) and by get-started's
  `OptionalTail.tsx`; `Dashboard.tsx`'s copy button reached it on a click.
  Production baseline (that session's read-only census, not re-measured
  here): 14 houses, 9 with `calendar_ical_token IS NULL`, 5 already set.

  Fixed in `calendar.service.ts` / `calendar.controller.ts`: the GET
  (`getICalToken`) is a pure read that returns the token or null and never
  writes; a failed read is an error, not "no link" (pinned in
  `ical-token-no-mint-on-read.spec.ts` on a stateful double that records every
  UPDATE; mutation-tested — a write put back on the read path fails 5 of its
  12 cases). Minting is `createICalToken`, reached only from the new `POST
  /calendar/ical-token`, gated on manager/owner
  (`OrganizationsService.assertCanManageRestaurant`, the helper
  `SettingsController` uses) and audited to `system_audit_log` under the JWT's
  `public.users.user_id`, never with the token's value. Its UPDATE is
  conditional on the column still being NULL, so two racing creates cannot
  both mint: the loser returns the winner's token, `created: false`, no audit
  row. Two acts this feed never had: `DELETE /calendar/ical-token` (revoke —
  nulls the token, audited) and the existing `POST
  /calendar/ical-token/regenerate` (rotate), which had no role gate and no
  audit and now has both. Every client surface now reads on open and creates
  only on a click: `/connections` and `/settings` offer "Create a calendar
  link", legacy Settings the same behind a client-side role check (the route
  is the rule), and `OptionalTail` reads on mount with a create button — the
  first cut of this fix had swapped its mount-time GET for a mount-time POST,
  which moved the defect instead of closing it (caught at verify, fixed
  before merge; pinned in `OptionalTail.calendar.test.tsx`). A refused create,
  rotate or revoke on `/connections` now says so on the row.

  **Revoke and rotate answer the old token the way T-30-09 answers any bad
  token — an empty 200, not the 404 the lane brief asked for.** T-30-09 is
  Phase 30's threat-model entry (`30-03-PLAN.md`, commit `9280954a6`,
  retired with the phase trees under ADR 0032), not a clause of this ADR; it
  survives as the comment at `calendar.service.ts`'s `getICalFeed` ("Return
  empty calendar (not 404)") and the test at `ical-feed.spec.ts:132`: a
  404-for-bad / 200-for-good split would make the feed URL an oracle for valid
  tokens. Revoking or rotating makes the old token match no `restaurants` row,
  so it gets the byte-identical empty calendar a never-issued token gets, and
  stops serving events (pinned: events before revoke, none after; the new
  token serves after a rotate). A visible "revoked" answer — which a
  subscriber's calendar app would surface as an error instead of silently
  showing nothing — is a founder question, not built either way.

  **Existing tokens are unaffected.** The 5 houses already holding a token
  keep it, and it keeps serving until an owner or manager revokes or rotates
  it; nothing here expires, rotates or revokes on its own. Whether a token
  should ever EXPIRE is a founder question — no expiry was built. The GET stays
  open to any signed-in member of the house, staff included, as it was before
  (reading is not the gated act); whether staff should see the address at all
  is also a founder question.

  No migration: `restaurants.calendar_ical_token` and `system_audit_log`
  already existed (baseline, `20260805000000`); nothing new is stored.

- 2026-09-04 — **observations recorded from today, and the forecast is scored.**
  `weather_observations` (`20260904140000`) stores what the nearest station
  measured; `day-record.service.ts` writes the first non-null `accuracy_score`
  in this product's history. Measured live through the compiled provider on
  2026-09-04: station **KPAO / Palo Alto Airport**, zone `America/Los_Angeles`,
  five local days, highs 19/22/25/24/20 °C, **precipitation null on every one of
  them** — that station does not report rainfall at all, which is exactly the
  case a `DEFAULT 0` would have turned into a dry week. The 2026-09-03 pair is
  the first real score: forecast 75 °F (23.89 °C) against an observed 24 °C,
  **error 0.11 °C**. Also added: the hourly prefetch, and the ADR 0022 amendment
  it required.
- 2026-09-03 (later) — **the founder answered five of the six forks and slices 1-3 plus the
  iCal fixes were built.** The five answers are in §Status. Three things the BUILD measured
  that the research pass had not, each of which changed the code:
  - NWS's forecast property carrying the forecaster's own time is `updateTime`, not
    `updated`; `generatedAt` refreshes on every poll, so keying "how old is this forecast"
    on it would have made a twelve-hour-old grid read as new. Measured live against
    `gridpoints/MTR/91,89` on 2026-09-03: `updateTime 12:26:50Z`, `generatedAt 13:01:51Z`.
  - The NWS gridpoint forecast is **seven days**, not the sixteen an Open-Meteo response
    carries. `horizonDays` is on the response so a cell past it says "beyond the forecast"
    rather than looking broken.
  - NWS publishes a probability of precipitation and **no quantitative amount at all**, so
    `precipitation_amount_mm` is NULL on every row this issuer produces, and the rain bar
    draws a chance rather than a depth. A `DEFAULT 0` would have published "no rain
    expected" for every day of every forecast.
- 2026-09-03 — drafted from a research pass against the live production database and the
  running local gateway. Every schema and row-count claim in §Context was measured, not
  inferred; every external claim carries a URL. The leading recommendation (deadlines
  first) was killed by its own measurement and replaced (weather first) before this was
  written; both are recorded under Alternatives rejected so the discarded version is not
  quietly dropped.
