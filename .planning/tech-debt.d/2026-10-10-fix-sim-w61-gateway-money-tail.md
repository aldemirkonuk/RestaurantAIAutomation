## Quiet hours on a house with no time zone: the rule a push keeps — CLOSED — 2026-10-10

Filed by `fix/sim-w61-gateway-money-tail` (F-887) so the rule F-868 chose (`fix/sim-w60-team-auth`, 2f6388d62) is on record outside its commit body.

A person's quiet-hours window is read on the house's clock: the house's own `restaurants.timezone`; else its country's only zone (`houseFrame`, `common/house-frame.ts`), so a TR house reads Istanbul; else UTC (`push-hold.ts:61`). A window someone set always holds. Only when the house row cannot be read are quiet hours not judged, and `pushHolds` warns (`notifications/push-hold.ts`); the Push switch is still read. Settings says the same (`NotifySection.tsx`). Why UTC and not "no quiet hours": a US house (29 zones, none recorded) let a 03:00 push through a 22:00-08:00 window; a late push is cheaper than a woken person.

## Gateway money still grouped en-US in two producers and the wage notice — ~~OPEN~~ CLOSED by `fix/sim-w62-money-last` (F-888, see `2026-10-10-fix-sim-w62-money-last.md`) — 2026-10-10

F-887 moved goal-reached, ceiling-held and sale-record to `readHouseMoney` and `money(value, currency, locale)`. Still en-US: `invoice-confirmed.producer.ts` and `market-price.producer.ts` call `money()` with no locale, and `team/own-wage-notice.ts` prints `1234.50 TRY` with no grouping at all. Same fix: read `readHouseMoney` and pass its `locale`. `team/schedule.service.ts` is not in this list: it sends `{ currency, country }` and the page formats with the house locale (`tm-format.ts`).
