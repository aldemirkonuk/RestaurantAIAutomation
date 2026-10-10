## Gateway money sentences still written en-US or with a bare "$" — OPEN — 2026-10-10

Filed by `fix/sim-w62-money-last` (F-888). That branch closed the F-887 tail: `invoice-confirmed.producer.ts` and `market-price.producer.ts` read `readHouseMoney` and pass its locale to `money()` and `percent()`; `team/own-wage-notice.ts` formats through `money(value, currency, locale)` (a lira house reads `₺1.234,50`, was `1234.50 TRY`); goal-reached and ceiling-held count and percent figures go through `count()` / `percentFigure()` in `producer-copy.ts`, no longer a hard-coded en-US.

A sweep of `apps/api-gateway/src` (non-spec) for money written with `toFixed`, a literal `$`, or an `"en-US"` formatter still finds these. Not fixed on that branch (15-file cap, and each is its own surface):

- `commodity/cadence-value.ts:758` — `saved about ${money.toFixed(2)} ${v.currency}`, ungrouped, code after the figure; its `pct` (`:751`) is `toFixed(1)%`.
- `procurement/procurement.service.ts:1241` — the refusal names totals as `toFixed(2) CODE`; `:3869` prints a literal `$` whatever the house's money.
- `procurement/agreed-price.ts:75` — `Intl.NumberFormat("en-US", { useGrouping: false })`.
- `notifications/notifications.service.ts:336`, `:503` — push bodies with a literal `$…/bottle`.
- `common/orchestrator/inbound-responder.service.ts:817` — the vendor-facing target price is a literal `$`.
- `communications/sms.service.ts:199`, `communications/communications.service.ts:345`, `communications/email-templates-legacy.ts:196`, `communications/email-templates/template-config.ts:210` — literal `$` or en-US in outbound messages.
- `reports/exports/report-export-render.ts:227-235` — export figures grouped en-US.

Not money of the house, so left alone: `common/model-client/model-client.service.ts:748`, `:807` (model spend, in USD); `seo/vendor-head.ts:114` (public page markup).
