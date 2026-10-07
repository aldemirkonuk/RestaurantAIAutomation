# 0294 — The /team Performance card prints every figure with its unit, and its median says what it covers

- **Status:** Locked, for the two rulings and for the method (M1–M6). [2026-10-07: the founder kept all six method picks as built, answered 2026-10-07 (recorded 12:54:27Z; the answer's own second was not taken), quoted under "The founder's words on the method" below. Was: *"Locked for the two rulings, and Proposed for the method."*, and this line ended *"The method below (which services a per-cover figure counts, the self-only refusal on the wire, the unknowns, the currency read) is the build's pick, for review."*] The rulings are the founder's, AskUserQuestion 2026-10-04 ~03:00Z, verbatim picks: benchmark *"House median (Recommended)"* (only the sentence changes), and wine label *"Rename on the card (Recommended)"* (the card says 'Wine share of sales'). The option texts read: *"(a) Keep the house median. Print how many services and how many servers it covers and that it includes this person. When this person is the only one with per-cover figures, refuse the comparison: 'the only per-cover figures in the house's recent services are {name}'s own'."* and *"(a) Relabel the card 'Wine share of sales' and keep the measure."* The method below (M1–M6) was the build's pick, and is the founder's since 2026-10-07. The residuals (a)-(c) stay open.
- **Date:** 2026-10-04 (method locked 2026-10-07)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** /team, PerformanceCard, performance.service, house median, benchmark, per cover, sales per cover, revenue per cover, wine share of sales, wine attach, average check, house currency, server_sales, A-048, AW18, Tuzlu Rüzgar
- **Links:** `claims.d/fix-team-performance-units.jsonl`; `tech-debt.d/2026-10-04-fix-team-performance-units.md`; [[0215-money-on-team-is-the-owners-and-hours-are-worked-hours]] (residual (f) closed here; ADR 0215's own text is not edited, because the audit gate owns that file and the founder chose on 2026-10-04 to drop the bracket from this PR); [[0051-rebuilt-pages-show-live-data-only]] (unknown is the em dash; a windowed figure carries its mark); [[0067-a-failed-read-is-never-an-empty-one]]; [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q25: "currency not recorded"); PR #599 (A-020/A-040, the other half of lane `fmt`)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) filed A-048 from code, not from a render. Every cite below is at origin/main `f5f658934`.

- `apps/api-gateway/src/team/performance.service.ts:209-228` takes the median of `net_sales / covers` over the house's 200 newest `server_sales` rows, this member's own included. `:242` labels the unit `/cover`. `:243` returns the member's own per-cover series, which nothing prints.
- `apps/web/src/pages/team/next/PerformanceCard.tsx:84` printed *"Against a house median of 72, taken over …"*: no currency and no "per cover", under `:79-80`, *"Sales / shift $1,900"* and *"Average check $186"*, the only money on the card. With Tuzlu's own POS figures (average check about $186, revenue per cover about $72), the card would set a $186 check over "a median of 72". That is a 2.6x gap made by the unit, not by the person.
- When the only per-cover figures are the member's own, the "house median" is their own figure. When the read failed, or no recent service records covers, `:85` said *"no other server here has enough attributed services"*. That is false in both cases.
- `:81` labelled `wine_sales / net_sales` "Wine attach". /reports uses that name for checks-with-wine over checks (`table-analytics.service.ts:451`), a different measure.
- The two literal `$` at `:79-80` are ADR 0215 residual (f), held on `scripts/money_currency_baseline.json` "for a follow-up". This is that follow-up.

The card is latent at Tuzlu today: no sale has been logged there, so it prints only its empty sentence. The header's *Log sales* makes it live.

## Options considered

1. **House median, every figure with its unit, comparison refused when it is self-only (chosen; the founder's pick).** The method stays. The card says what the median is: in the house's currency, per cover, over how many services by how many servers, and whether this member is among them. The member's own sales per cover sits beside it.
2. **Peer median, this member left out.** Rejected by the founder. It is a method change, and no benchmark would exist until a second server records covers.
3. **Print the unit and nothing else.** This leaves the median beside figures it cannot be compared with, and leaves the self-only and failed-read sentences false.
4. **Do nothing.** The first night logged through *Log sales* puts a unitless 72 under a $186 check, and a house that keeps any currency but the dollar sees its sales printed in dollars.

For the wine label, the founder picked the relabel over a note (b) and over a true attach rate (c). (c) needs a wine-check count on `server_sales`: a schema change and a new field on the Log-sales form.

## Decision

The card prints every figure with its unit, and its benchmark sentence says what the median covers or why there is none.

**Rulings (Locked):**

- **R1.** The benchmark stays the house median: every server's services among the house's 200 newest, this member's included. The card prints the median *"per cover"*, the number of services and servers it is taken over, and *"{name}'s own included"* (or *"none of them {name}'s"*). When every per-cover figure in that window is the member's own, it refuses: *"the only per-cover figures in the house's recent services (the restaurant's ≤200 most recent) are {name}'s own, so there is nothing to set them against."*
- **R2.** The card labels `wine_sales / net_sales` *"Wine share of sales"*. "Wine attach" keeps meaning checks-with-wine over checks, as on /reports.

**Method (Locked 2026-10-07, the founder's *"Keep all six (Recommended)"*) [Was: "Method (Proposed, the build's picks)"]:**

- **M1. The member's own "Sales per cover".** It is blended (sum of net over sum of covers) over the services that record covers with their sales (`covers > 0 AND net_sales > 0`), the same predicate the median has always used (`performance.service.ts` `recordsPerCover`). `server_sales` stores a blank as 0 (`covers`/`net_sales` `DEFAULT 0 NOT NULL`, and both ingest routes write `?? 0`), so a coverless night's sales are left out rather than divided by another night's covers. /reports divides all sales by all covers (`table-analytics.service.ts:453`); POS checks carry their own covers, so the two pages' sources differ, not their idea. When the member's services do not all record covers, the card says *"Sales per cover counts the N of these M services that record covers with their sales"*. Rejected: blending over every service, which inflated the figure (a test pins 112 against the correct 72). Also rejected: the member's median of per-service ratios. It matches the benchmark's statistic, but over ≤6 services it is noise, and the card's other rates are blended.
- **M2. Self-only is refused on the wire.** In that state the gateway sends `median: null` and `band: null`, so no consumer can draw a member against themselves. A page built before this change then prints its old *"no other server here has enough attributed services"*, which is true in that state.
- **M3. `analytic.benchmark {state, services, servers, includesMember}`.** `state` is `computed`, `self-only`, `no-covers` or `unreadable`, and each has its own sentence. A failed read is never shown as "no covers" (ADR 0067). The window stays a literal `.limit(200)`. The web's `TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES` cites it, and the card prints it as `≤200` (ADR 0051 clause 2, `check_windowed_figures.py` W1).
- **M4. Unknown is not zero.** The average check is `null` when none of the member's services records a check. The wine share is `null` when they record no sales. Both used to answer 0, printed "$0" and "0%" (ADR 0051).
- **M5. The house's money.** The response carries `money {currency, country, readable}`, read from `restaurants` the way `team.service.ts` `listFormerStaff` reads it. Every money figure goes through `tm-format`'s house-currency formatters. Rates (average check, sales per cover, the median) are printed to the currency's minor units, and sales per shift in whole units. The share is printed as a percent in the house's locale. An unstated currency prints *"currency not recorded"*, and an unreadable one *"currency could not be read"*. A response from a gateway built before this change carries no `money`, and is printed as unreadable, never as dollars. These are sales, not pay, so ADR 0215's owner-only rule does not govern them. A currency code and a country are not money, and they go to whoever may read the card (a manager, or the member themselves).
- **M6. The member's window is stated.** The card's figures are over the member's last ≤6 services (`limit = 6`). It now says *"Over {name}'s last N logged services"* with the exact count it received.

### The founder's words on the method

Asked with AskUserQuestion and answered 2026-10-07 (recorded 12:54:27Z; the answer's own second was not taken):

- **Question:** *"#614 (team Performance card): its six build choices are waiting on you. (M1) a server's sales per cover counts only nights that recorded covers; (M2) when no other server has enough data, the card shows no comparison instead of comparing someone to themselves; (M3) the card says which of four states the comparison is in (computed, only you, no covers, could not be read), and a failed read never shows as 'no covers'; (M4) an unknown average check or wine share shows as unknown, not $0 or 0%; (M5) money prints in the house's own currency; (M6) the card says 'Over {name}'s last N logged services' with the real count. Keep all six?"*
- **Answer:** **"Keep all six (Recommended)"**. The option text was: *"Locks ADR 0294 as built. No code change; the PR goes to its re-head and audit."*
- **Rejected:** *"I want to change one"*. The option text was: *"Say which in a note. Any change is a code change in #614 and one more audit."*

The answer keeps the build as it is, and no code changed for it. The build has no minimum-peer floor: the state is `computed` whenever the window holds per-cover figures from any server but the member (`performance.service.ts` `servers.size === 1 && includesMember` is the only self-only test), so a median can be one colleague's figures. `performance.service.spec.ts` pins that case (*"computes the median when the only other server is someone else"*: `servers: 1`, `includesMember: false`), and the card then prints *"… by 1 server, none of them {name}'s"*. The question did not ask whether a floor should be added, so that stays open for the founder (the audit of f6b57edae raised it).

## Consequences

- The literal `$` is gone from the card. Its row, and the row of the deleted legacy `PerformancePanel.tsx` (the guard had been printing it as "FIXED since the baseline — lower these rows"), leave `money_currency_baseline.json`. ADR 0215 residual (f) is closed by this record. ADR 0215's own text still lists (f) as open: it is a gate-owned file, and the founder chose on 2026-10-04 ("Drop the line (Recommended)") to keep this PR off it. Correcting it in place is owed to a separate PR on the founder's word.
- The wire keeps the key `wineAttachPct` for the share, so a page on either side of the deploy reads it. The name is documented as a share of sales on both sides. Renaming the key is left for a change that can ship the two sides together.
- **Deploy skew, named.** A page built before this change calls `avgCheck.toLocaleString()`. Against the new gateway, for a member none of whose last six services records a check, that throws in render. /team has no error boundary of its own, so the nearest one (the house shell's, keyed by route, `HouseShell.tsx:290`; the app's, `App.tsx:167`, when the shell is off) puts its error screen in place of the whole /team page, not only the card. That was traced in code, not reproduced. A second, narrower case: when those services record checks but their net sales sum to 0, `wineAttachPct` arrives as `null` and the old page prints *"null%"*. Those are the two breaks; the other new keys are additive, and a self-only median arrives as the `null` the old page already handled. No production read was made to count such members; by the walk, the sim house has logged no sales at all.
- Revisit when `server_sales` can tell a blank from a zero (see the tech-debt entry). M1's predicate and M4's nulls are workarounds for that.

## Residuals

- **(a)** `server_sales` stores a blank figure as 0, so *Sales / shift* averages coverless or blank nights in, the average check counts the sales of a night typed with no checks, and the wine share reads 0% for a night whose wine was left blank. These are filed in `tech-debt.d/2026-10-04-fix-team-performance-units.md`, not fixed here: a fix needs nullable columns and a form that sends null.
- **(b)** `useTeamNextData.ts`'s `TEAM_SERVER_WINDOWS` declares two server-side windows (`BENCHMARK_SERVICES`, `TRAIL_ROWS`). The member's own read (`limit = 6`) is a third, and is not declared. The card states its exact count (M6), so no figure is windowed silently, but the register does not list it; its comment now says so.
- **(c)** The analytic `series` (per service, 0 for a coverless service) is still sent, and nothing prints it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | — | Created (fix lane `fmt2`, branch `fix/team-performance-units`) |
| 2026-10-07 | Aldemir | Kept M1–M6 as built: *"Keep all six (Recommended)"*, quoted under "The founder's words on the method"; *"I want to change one"* rejected. The method is Locked. Residuals (a)-(c) stay open; a minimum-peer floor was not asked |
| 2026-10-07 | Claude (fix lane `fmt2`) | Consequences, deploy skew: *"throws until the page is reloaded"* corrected to the whole-page error screen it causes (audit of f6b57edae, final note 1). Prose only |
