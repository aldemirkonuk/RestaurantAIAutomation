# Sketch 049 · Mobile Guidance + Web Mobile Shell

**Design question:** Can WineOps teach ops jobs on Expo and phone browsers without blocking shifts, while keeping consent separate from coaching?

## Direction

| | |
|--|--|
| **Web** | Drawer shell below `md`, safe-area, PWA icons + SW |
| **Expo** | Tip strips + TourSheet + Get Started / Help / Services + Wine Agent FAB |
| **Shared** | User prefs keys `guidance` + `servicePermissions` |
| **Rejects** | Capacitor wrap; forced post-login gate; Agent = email consent |

## Smoke checklist

### Web (~390px)

- [ ] Hamburger opens sidebar drawer; backdrop / route change closes it
- [ ] Main content has no permanent 260px pad on phone
- [ ] Tip strip buttons ≥44px; Learn panel opens as bottom sheet
- [ ] Wine Agent FAB respects safe-area; does not cover tip actions permanently
- [ ] `/manifest.json` icons load; `theme-color` is `#722F37`
- [ ] Production build registers `/sw.js` (dev skips unless `VITE_FORCE_SW=1`)
- [ ] Get Started Use cards stack; touch targets usable

### Expo (iOS / Android simulator)

- [ ] After login → Today; soft “Finish setup” banner if menu not uploaded
- [ ] Tip strip on Today / Cellar / Supply; Take tour opens TourSheet
- [ ] Settings → Services toggles persist via preferences API
- [ ] Push toggle calls `registerPush` / `unregisterPush`
- [ ] Help → replay tours, reset tips, hide FAB
- [ ] Wine Agent FAB (after activation) opens web `/wineagent` when `EXPO_PUBLIC_WEB_URL` set
- [ ] Get Started Activate opens web import URL; Use cards navigate native tabs

## Kill criteria

- Auto multi-step tours on every tab open
- Privacy toggles hosted inside tip strips
- Unhideable / pulsing FAB
- Desktop sidebar permanently eating half a phone screen
