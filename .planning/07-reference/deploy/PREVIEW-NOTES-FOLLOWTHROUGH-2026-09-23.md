# Preview-notes followthrough — 2026-09-23

Branch: `feat/preview-notes-followthrough` off `origin/main` `ddc5e094b`.
Arrival flag not flipped. Get-started not redone.

## Deploy at the time of this work

Vercel **Production – restaurant-ai-automation-web** for `ddc5e094b` completed
(state `success`, 2026-09-23 02:34:58Z). API-gateway production deploy for the
same SHA also completed. Railway (`virtuous-delight`) was still in progress
when this note was written. GitHub `Deploy to Production` has been failing on
`provider_conversation_agent` health — that is the orchestrator check, not
Vercel.

`/get-started` and `/register` **will** change once that web deploy is the
live host: flag-off `/get-started` is now #455's first-proof book (you →
restaurant → menu → reading), not the old menu wizard; `/register` is
account-then-house. Skyleaf Arrival (`mudavym_design_arrival`) stays dark.

## Already on main before this branch (#454 / #419 / #434)

| Note | State on `ddc5e094b` |
|---|---|
| Calendar blank (no "— no reading") | Done. `SkyMark` returns null. Test in `CalendarNext.test.tsx`. |
| Connections internals stripped | Done. Register IV not drawn. |
| Profile Google grouping | Done. `groupByProvider` in `ConnectionsRegister`. |
| Orders → receipt sheet | Done. `ReceiptSheet` + `CanonicalDocumentPage`. |
| Settings live design | Done. `settings` in `LIVE_PAGES` → `SettingsNext`. |
| Wine library / cellar | Done. `cellar` + `menu` in `LIVE_PAGES` → `CellarNext`. First-sight "old" was before #434. |

## This branch

| Note | What changed |
|---|---|
| Communications error | The page always alarmed: `GET /reports/schedules` fails (table never migrated) and "Gmail inbound watch: NOT configured" is operator plumbing. Banner now names only the conversation book / threads / drafts. Watch line and schedules card removed from the house page. |
| Sidebar pins | Profile / Settings / Connections / Help fold into the lower-left account mark. Logo stays 24px. Tagline is "for restaurants". Avatar 28px. Shell flag not flipped. |
| Receipts formatted sheet | Selected receipt also mounts `CanonicalDocumentPage` embedded on the right (the existing typeset sheet). Review/seal stay below. |
| Inventory | Still `InventoryCommandPage` on both gate branches. No Mudavym inventory page exists. Not redesigned. |
| Promotions | Still ungated legacy `<Promotions />`. Sketch 113 never built. Not redesigned. |

## Tests

- `CommunicationsNext.test.tsx` — dead schedule/Gmail watch is not the page error
- `CalendarNext.test.tsx` — blank cell (already on main; kept)
- `Sidebar.account.test.tsx` — four items not pinned; open from account mark
- `ReceiptsNext.test.tsx` — formatted sheet beside the selected receipt
