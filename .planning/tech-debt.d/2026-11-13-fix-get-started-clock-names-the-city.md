# fix/get-started-clock-names-the-city (r32 onboarding, 2026-11-13)

The first form named the house's clock by its IANA id. Every owner read
"Clock · Europe/Istanbul (from the country)". An owner whose browser clock
is not the place's (a US house set up from abroad) chose from up to ten raw
ids such as "America/Kentucky/Monticello". The clock is now named as
"Istanbul · Türkiye Standard Time, UTC+3" (`lib/zoneLabel.ts`, from Intl's
long generic name and the zone's offset today). The value sent is still the
IANA name.

Left open:

- Settings › Time zone still lists raw ids. It is on another chain.
- The words come from the browser's Intl (CLDR), so an older browser may
  name a clock differently. A zone with no city, or one Intl does not know,
  is shown as its id.
- Not seen in a browser.
