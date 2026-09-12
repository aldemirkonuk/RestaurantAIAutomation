# COLOR-AUDIT-PLATFORM — everything outside `apps/web`

> Companion to the `apps/web` audit (sibling pass). **Scope:** `apps/mobile`,
> `packages/ui`, `packages/database`, transactional email in `apps/api-gateway`,
> `services/*`, and all non-web assets. Target palette: ADR
> [[0042-iznik-seal-and-warm-charcoal]].
>
> **Status:** audit only. No source file was modified. Counts are from the working
> tree on `feat/p1-readout`, 2026-08-29.

---

## 0. Headline

**There are ten distinct "brand primary" values across the non-web surfaces, and no
two surfaces share a source.** The İznik migration is therefore not one rename; it is
ten independent renames plus one raster redraw plus one data migration.

| # | Value | Where it is the brand | Live? |
|---|---|---|---|
| 1 | `#9E4249` | `packages/ui/tailwind.config.js:48` (`wine.600`) | **dead config** (§2.3) |
| 2 | `#B85055` | `packages/ui/tailwind.config.js:47` (`wine.500`) | dead config |
| 3 | `hsl(346 77% 49%)` ≈ `#DE1D4E` | `packages/ui/src/styles/globals.css:13,25,36,48` | **dead CSS** (§2.3) |
| 4 | `#AC204A` | `apps/mobile/src/design/tokens.ts:29` (`color.wine`, 31 refs) | live |
| 5 | `#7C1D3C` | mobile `wineStrong` + `app.json:13,27,44` | live |
| 6 | `#450A1E` | mobile `wineDeep` | live |
| 7 | `#6B1B3D` | mobile PNG icon/splash/favicon — **99% of every pixel** | live, raster |
| 8 | `#7c2d12` | `template-config.ts:10` — every transactional email; also the DB default | live |
| 9 | `#722F37` (+`#4A1A1F`, `#5a2530`) | `email-templates-legacy.ts:154,161` | live |
| 10 | `#8B2635` (+`#5a1a23`) | `services/.../email_client.py`, report demos | live |

Two consequences worth stating before the tables:

- **`#7c2d12` is not burgundy.** It is Tailwind `orange-900` — rgb(124,45,18), a brown.
  It is commented `// Wine/burgundy - main brand color` and it is the colour on every
  password-reset, verify-email, low-stock, vendor and weekly-report email the platform
  has ever sent. Whatever İznik costs, it is a strict improvement here.
- **The mobile splash already has a visible seam.** `app.json:13` paints the splash
  ground `#7C1D3C`; `splash.png` is 98% `#6B1B3D`. With `resizeMode: "contain"` those
  two burgundies sit side by side on every cold launch today.

---

## 1. `apps/mobile` — inventory

React Native, Expo Router, Skia for gradients. **57 `.ts`/`.tsx` files; 36 touch colour.**

The good news first: mobile is the *best*-tokenised surface in the repo. **223 of 237
colour references (94%) go through `color.*` in one file.**

### 1.1 The token file — `apps/mobile/src/design/tokens.ts`

24 literals, all here. Usage counts are repo-wide `color.<name>` references.

| Token | Value | Role | Uses |
|---|---|---|---|
| `wine` | `#AC204A` | the one accent — CTAs, active tab, progress | **31** |
| `surface` | `#FFFFFF` | card / sheet / header ground | 26 |
| `inkQuaternary` | `#9CA3AF` | placeholder, disabled, meta | 19 |
| `hairline` | `#ECEEF0` | every divider and card border | 17 |
| `wineStrong` | `#7C1D3C` | pressed accent, hero headers | 16 |
| `ink` | `#111827` | primary text | 14 |
| `fill` | `#F3F4F6` | chip / input ground | 12 |
| `wineTintStrong` | `#FCE7EB` | selected row, Skia gradient stop | 10 |
| `surfaceSecondary` | `#F7F8F9` | **screen ground** (`_layout.tsx:102`) | 10 |
| `inkSecondary` | `#4B5563` | secondary text | 10 |
| `wineTint` | `#FDF2F4` | subtle accent wash | 9 |
| `warning` | `#D97706` | state | 8 |
| `danger` | `#DC2626` | state | 8 |
| `success` | `#059669` | state | 6 |
| `dangerTint` | `#FEF2F2` | state bg | 6 |
| `inkTertiary` | `#6B7280` | tertiary text | 5 |
| `fillStrong` | `#E5E7EB` | filled chip / track | 5 |
| `warningTint` | `#FFFBEB` | state bg | 4 |
| `successTint` | `#ECFDF5` | state bg | 3 |
| `wineDeep` | `#450A1E` | deepest accent | 2 |
| `onWine` | `#FFFFFF` | text on accent | 2 |
| `surfaceTertiary` | `#F1F3F5` | — | **0 (dead token, delete)** |
| shadow ×2 | `#1F2937` | `tokens.ts:92,99` shadowColor | 2 |

### 1.2 The 14 literals that escaped the token file

These are the find-and-replace targets. **Eight of them are `#fff`/`#FFFFFF` on an
accent ground** — pure `onWine` in disguise, and they will all break in dark mode.

| `file:line` | Literal | Role | Note |
|---|---|---|---|
| `src/components/today/FeedZero.tsx:65` | `#FDF2F4F2`, `#FCE7EBE6`, `#FDF2F400` | Skia radial gradient, empty-feed hero | **8-digit RGBA** — alpha baked into the hex |
| `src/components/cellar/Sparkline.tsx:78` | `#FDF2F400` | Skia linear gradient tail | 8-digit; pairs with `color.wineTintStrong` |
| `app/(tabs)/cellar/receive/[orderId].tsx:326` | `#111827CC` | scrim pill over camera | 8-digit; = `ink` @ 80% |
| `app/(tabs)/cellar/receive/[orderId].tsx:438` | `#FDA4AF` | price-mismatch input border | **not in the token set at all** — a rose-300 |
| `app/wine-agent.tsx:57,80` | `#fff` | text on `wineStrong` | should be `color.onWine` |
| `src/guidance/WineAgentFab.tsx:68` | `#fff` | FAB glyph on `wine` | should be `color.onWine` |
| `src/guidance/TourSheet.tsx:73` | `#fff` | text on accent | should be `color.onWine` |
| `src/guidance/TipStrip.tsx:44` | `#fff` | text on accent | should be `color.onWine` |
| `app/help.tsx:59` | `#fff` | text on `wineStrong` | should be `color.onWine` |
| `app/get-started.tsx:140` | `#fff` | text on `wineStrong` | should be `color.onWine` |
| `src/components/cellar/CapsuleSweep.tsx:67` | `#FFFFFF` | sweep highlight | Skia |
| `src/guidance/TourSheet.tsx:24` | `rgba(15,23,42,0.45)` | modal scrim | only `rgba()` in the app; slate-900, off-palette |

### 1.3 Native config — `apps/mobile/app.json`

| Line | Key | Value | Rebuild needed |
|---|---|---|---|
| 8 | `userInterfaceStyle` | `"light"` | **yes** — hard-locks the app out of Warm Charcoal |
| 13 | `splash.backgroundColor` | `#7C1D3C` | yes (native splash) |
| 27 | `android.adaptiveIcon.backgroundColor` | `#7C1D3C` | yes |
| 44 | `plugins.expo-notifications.color` | `#7C1D3C` | yes — Android notification tint |
| 98 (`app/_layout.tsx`) | `<StatusBar style="dark" />` | hardcoded | code, but light-only assumption |

**Mobile ships no dark mode today.** `userInterfaceStyle: "light"` plus a hardcoded
`StatusBar style="dark"` plus a token file with a single ground means the Warm-Charcoal
half of ADR 0042 is a *feature build* on mobile, not a re-skin. See §5.

---

## 2. `packages/ui` (`@wineops/ui`) — inventory

20 source files; 10 carry colour. **50 hex literals (all in `tailwind.config.js`) plus
109 Tailwind colour-class usages across 9 components.**

### 2.1 The scales in `packages/ui/tailwind.config.js`

| Scale | Lines | Values | Consumed by |
|---|---|---|---|
| `wine` 50–900 | 41–52 | `#FDF7F6 #FAEDEC #F3D4D2 #E5A9A8 #D07072 #B85055 #9E4249 #82363C #682C31 #522327` | 20 class uses |
| `gray` 50–900 (warm) | 54–65 | `#FAF7F5 #F3EEEB #E4DBD6 #CFC3BC #A3968E #7A6F68 #5C534D #433E3A #2C2926 #1C1A18` | 21 class uses |
| `blue` 50–900 | 66–77 | `#F0F6FF … #2F58E0 (600) … #23367B` | 0 direct uses |
| `yellow` 50–900 | 78–89 | `#FFFBEB … #EAB308 (500) … #713F12` | 6 class uses |
| `wine-green` 50–900 | 90–101 | `#f0fdf4 … #22c55e (500) … #14532d` | 8 class uses |
| glass gradients | 103–106 | `rgba(255,255,255,.9/.6)`, `rgba(30,30,30,.9/.6)` | 0 |

Note `blue.600` is already exactly `#2F58E0`, the locked `--info`. That scale is the
one thing here that survives the migration untouched.

### 2.2 Chart colour — the specific risk called out in the brief

`packages/ui` has **no series palette of its own.** It re-exports Tremor
(`charts/index.tsx:4-16` — `AreaChart`, `BarChart`, `DonutChart`, `LineChart`,
`BarList`) without a `colors=` prop anywhere, so **every chart renders in Tremor's
stock blue/cyan/indigo ramp**, which is neither burgundy today nor İznik tomorrow.

The only brand touch on a chart is `stat-card.tsx:68` — `decorationColor="wine"`.
Tremor resolves `decorationColor` against **its own** colour list, not the workspace
Tailwind config; `"wine"` is not a Tremor colour, so that decoration bar is almost
certainly rendering as nothing. **Worth a screenshot before anyone "migrates" it.**

Semantic chart colour is hardcoded as directional logic, not a palette:
`stat-card.tsx:45,47` → `text-wine-green-600` / `text-red-600`. `red-*` is stock
Tailwind and is **not** in this config at all — 13 `red-*` class uses across
`button.tsx`, `badge.tsx`, `toast.tsx`, `input.tsx` resolve against whatever the
consuming app defines.

### 2.3 Two dead colour sources that will fake a successful migration

Both matter more than their line counts suggest.

1. **`packages/ui/tailwind.config.js` is never executed.** The package builds with
   `tsup src/index.tsx` (`package.json:18`) — no CSS step, no `postcss.config`, and
   `dist/` contains `index.js/.mjs/.d.ts` but **no `index.css`**, despite
   `exports["./styles"]` pointing at `./dist/index.css`.
2. **`packages/ui/src/styles/globals.css` is imported by nothing** — the full shadcn
   HSL token block at `:13,25,36,48` (`--primary`/`--ring` = `346 77% 49%`) is inert.

The classes in `packages/ui`'s components are resolved by **`apps/web/tailwind.config.js`**,
which scans `../../packages/ui/src/**/*.{ts,tsx}` (line 10) precisely to keep them.

> **Cross-agent coupling:** editing the `wine` scale in `packages/ui/tailwind.config.js`
> changes **zero rendered pixels**. The 109 class usages in `packages/ui` migrate if and
> only if the sibling `apps/web` pass renames the scale in `apps/web/tailwind.config.js`.
> Either delete the dead config and the dead CSS, or wire them up — but do not let
> anyone tick "packages/ui migrated" on the strength of editing them.

---

## 3. `packages/database` and other `packages/*`

Only two packages exist. **`packages/database` carries no presentation** — zero hex,
zero classes. It does carry colour *as data* in four type declarations
(`src/types/database.types.ts:107`, `src/types/calendar.types.ts:162,177,198`, all
`color?: string`), which is the type-side of the DB-persisted colours in §6.2.

---

## 4. Transactional email — inventory

The largest and most exposed surface. **286 hex occurrences across 23 non-test files**,
in **three parallel and mutually inconsistent template systems**, all live.

### 4.1 System A — `email-templates/` (17 files, current)

Single source: `template-config.ts:9-29`.

| Config key | Line | Value | Notes |
|---|---|---|---|
| `primary` | 10 | `#7c2d12` | header band + every CTA button; Tailwind `orange-900` |
| `primaryDark` | 11 | `#991b1b` | hover; unrelated hue to `primary` |
| `secondary` / `warning` | 12,15 | `#f59e0b` | duplicate keys, same value |
| `success` | 13 | `#10b981` | |
| `danger` | 14 | `#dc2626` | |
| `info` | 16 | `#3b82f6` | |
| `gray.50…900` | 18–27 | `#f9fafb #f3f4f6 #e5e7eb #d1d5db #9ca3af #6b7280 #4b5563 #374151 #1f2937 #111827` | cold Tailwind slate |

Consumed by `base-template.ts` at `:70` (body bg `gray100`), `:83`, `:86` (`#ffffff`
card), `:90` (header `headerBg`), `:111` (CTA), `:125-129` (footer). `alertBox` at
`:197-202` hardcodes four bg/text pairs *outside* the config:
`#fef3c7`/`#92400e`, `#fef2f2`/`#991b1b`, `#ecfdf5`/`#065f46`, `#eff6ff`/`#1e40af`.

Per-template literal counts (all bypass the config):

| Template | Hex | Audience | Notable |
|---|---|---|---|
| `onboarding.template.ts` | **33** | customer | `:37,41,102,115` `#7c2d12`; `:37` `#fdf4ff`; step chips `#10b981 #3b82f6 #f59e0b` at `:56,75,94` |
| `password-reset.template.ts` | 8 | customer | `:33,43` `#7c2d12` |
| `order-notification.template.ts` | 7 | **vendor** | `:154-160` status chips |
| `vendor-action.template.ts` | 6 | **vendor + manager** | 6× `#ffffff` on `colors.primary` |
| `weekly-report.template.ts` | 5 | operator | `:60` ok, `:71,130` risk |
| `payment-due.template.ts` | 5 | **vendor** | `:35` three-way severity |
| `event-prep.template.ts` | 5 | operator | |
| `custom-reminder.template.ts` | 5 | operator | `:41-44` severity |
| `inventory-audit.template.ts` | 4 | operator | |
| `daily-summary.template.ts` | 4 | operator | |
| `low-stock-alert.template.ts` | 3 | operator | |
| `delivery-eta.template.ts` | 3 | **vendor** | |
| `recurring-order.template.ts` | 2 | **vendor** | |
| `low-stock-digest.template.ts` | 1 | operator | |

### 4.2 System B — `email-templates-legacy.ts` (84 hex, still live)

Re-exported through `email-templates/index.ts:44-52`, so it is **not** dead. Its four
exported templates — `orderInquiryTemplate`, `counterOfferTemplate`,
`orderConfirmationTemplate`, `deliveryReminderTemplate` — are all **vendor-facing**.

`baseLayout` at `:152-172` is a second, incompatible brand:
- `:154` header `linear-gradient(135deg, #722F37 0%, #4A1A1F 100%)`
- `:160,161` button `#722F37`, hover `#5a2530`
- `:152` page `#f5f5f5`; `:158` footer `#f9fafb` / `#e5e7eb`
- badges `:163-166`: `#fee2e2`/`#dc2626`, `#fef3c7`/`#d97706`, `#dbeafe`/`#2563eb`, `#d1fae5`/`#059669`
- table `:169-172`: `#f9fafb`, `#6b7280`, `#111827`, `#374151`, `#f3f4f6`

### 4.3 System C — inline HTML in services

| `file:line` | Hex | Email |
|---|---|---|
| `auth.service.ts:736-761` | 14 | **Verify your WineOps AI account** — `:738` header `#7c2d12`, `:747` CTA `#7c2d12` |
| `auth.service.ts:1605` | — | **Reset your WineOps AI password** |
| `communications.service.ts:258` `generateWeeklyReportHtml` | 54 | weekly report; 12× `#e5e7eb` table rules, `#991b1b`, `#1e40af`, `#0c4a6e`, `#0369a1`, `#166534`, `#15803d` |
| `communications.controller.ts:265` | 2 | manager test email — `#7c2d12`, `#666` |
| `communications.controller.ts:313` | 2 | ad-hoc test email — `#7c2d12`, `#666` |
| `procurement.service.ts:1735` | 0 | paragraph wrapper only — no colour |

### 4.4 Python email — `services/agent-orchestrator` (172 hex, non-venv)

| File | Hex | Live? |
|---|---|---|
| `services/email_client.py` | 18 | **live** — `notification_agent.py` calls `send_template_email` 8× (`:557,659,726,796,857,920,954,986`). Templates at `:353+`; `#8B2635` at `:357,360,380,383,408`; bootstrap semantics `#28a745 #dc3545 #ffc107 #17a2b8` |
| `services/email_composer_service.py` | 28 | **live, vendor-facing** — `compose_vendor_email` → `send_via_gateway`. `_wrap_html` `:640-670` (`#ffffff`, `#1f2937`, `#9ca3af`); `_build_manager_review_html` `:673-720` (`#7c2d12` at `:686`, action buttons `#10b981 #3b82f6 #dc2626 #4b5563` at `:702-711`) |
| `agents/reporting_agent.py` | 7 | **live** — WeasyPrint **PDF** CSS at `:683-689`: `#333`, `#1a1a2e` headings + table header, `#e0e0e0` rules, `#666`, `#f9f9f9` zebra. `#1a1a2e` is an eleventh brand-ish value |
| `demo/weekly_report_preview.html` | 59 | demo artefact |
| `demo/demo_weekly_report.py` | 57 | demo |
| 2 test files | 3 | fixtures |

No Slack or Discord payloads exist anywhere in `services/` or `apps/api-gateway` —
every `attachments=` hit is a file attachment, not a coloured message attachment.

---

## 5. Assets

### 5.1 SVG — nothing to migrate

**Zero first-party `.svg` files exist outside `apps/web`.** All 26 matches are vendored
inside `services/agent-orchestrator/venv/` (Playwright and Matplotlib). No hardcoded
fills to change.

### 5.2 Raster — four PNGs, and they are the hard part

`apps/mobile/assets/`, measured pixel-by-pixel:

| File | Size | Dominant | Share |
|---|---|---|---|
| `icon.png` | 1024×1024 | `#6B1B3D` | **99.0%** (`#FFFFFF` 0.9%) |
| `adaptive-icon.png` | 1024×1024 | `#6B1B3D` | **99.0%** |
| `splash.png` | 2048×2732 | `#6B1B3D` | **98.0%** (`#FFFFFF` 1.9%) |
| `favicon.png` | 32×32 | `#6B1B3D` | **100%** |

These are flat burgundy fields with a white mark. They are the *most* visible brand
surface the platform has (home screen, app switcher, cold launch) and the *only* one
that cannot be touched by any code change. See §7.

---

## 6. Migration table

### 6.1 Mobile tokens → İznik (`apps/mobile/src/design/tokens.ts`)

| Old | Value | New token | New value | Confidence |
|---|---|---|---|---|
| `surface` | `#FFFFFF` | `--surface` | `#FFFFFF` | exact |
| `surfaceSecondary` | `#F7F8F9` | `--paper-0` | `#FAF7F1` | clean (this is the screen ground) |
| `surfaceTertiary` | `#F1F3F5` | — | — | **0 uses — delete** |
| `ink` | `#111827` | `--ink-1` | `#211C16` | clean |
| `inkSecondary` | `#4B5563` | `--ink-2` | `#4F473C` | clean |
| `inkTertiary` | `#6B7280` | `--ink-3` | `#7C7365` | clean |
| `inkQuaternary` | `#9CA3AF` | *(none)* | **see below** | **no equivalent** |
| `hairline` | `#ECEEF0` | `--line` | `#E3DBCB` | clean |
| `fill` | `#F3F4F6` | `--paper-1` | `#F3EFE6` | clean |
| `fillStrong` | `#E5E7EB` | `--paper-2` | `#EAE4D8` | **see note on `--paper-2`** |
| `wine` | `#AC204A` | seal-500 | `#1A5E6B` | exact |
| `wineStrong` | `#7C1D3C` | seal-600 | `#14515C` | clean |
| `wineDeep` | `#450A1E` | seal-800 | `#0C343C` | clean |
| `wineTint` | `#FDF2F4` | seal-50 | `#F1F7F8` | clean |
| `wineTintStrong` | `#FCE7EB` | seal-100 | `#E0EFF1` | clean |
| `success` | `#059669` | ok | `#17795E` | exact |
| `successTint` | `#ECFDF5` | ok-bg | `#E9F5F1` | exact |
| `warning` | `#D97706` | warn | `#A5670A` | exact |
| `warningTint` | `#FFFBEB` | warn-bg | `#FBF1DF` | exact |
| `danger` | `#DC2626` | risk | `#B3261E` | exact |
| `dangerTint` | `#FEF2F2` | risk-bg | `#FBEAE8` | exact |
| `onWine` | `#FFFFFF` | `--on-seal` | `#FFFFFF` | rename only |
| `shadow.*.shadowColor` | `#1F2937` | `--ink-1` | `#211C16` | clean |

**`inkQuaternary` `#9CA3AF` has no clean equivalent — proposed resolution: delete it and
promote all 19 uses to `--ink-3`.** Reasoning: ADR 0042 *does* define an `--ink-4`
(`#665D50` light), but that is a step **darker** than `--ink-3` `#7C7365`, so the ramp
has no fourth *lighter* step to receive it. Inventing one would mean a value under
`#7C7365` on `#FAF7F1`, which is already only **4.37:1** — below AA. Mobile's current
`#9CA3AF` on white measures **2.54:1**, so it fails AA today for the placeholder,
disabled and meta text it carries. Folding it into `--ink-3` takes those 19 sites to
**4.67:1** on `--surface`, which passes AA for normal text. This is a legibility fix
disguised as a rename; take it rather than preserve a fourth step.

**Two gaps between the brief and ADR 0042 — please confirm before anyone writes code.**
The brief's light list omits `--paper-2` and `--ink-4`, both of which ADR 0042's token
table *does* define (`#EAE4D8`, `#665D50`); and the brief's dark list omits
`--line-strong` and `--ink-4`. `fillStrong` above is mapped to `--paper-2 #EAE4D8` on
the ADR's authority. If the brief's shorter list is the real one, `fillStrong` has no
target and 5 uses need a decision.

### 6.2 Mobile literals and native config

| Old | New | Method |
|---|---|---|
| `#FDF2F4F2` / `#FCE7EBE6` / `#FDF2F400` (`FeedZero.tsx:65`) | `#F1F7F8F2` / `#E0EFF1E6` / `#F1F7F800` | manual — **alpha is baked into the hex**; no token substitution produces these |
| `#FDF2F400` (`Sparkline.tsx:78`) | `#F1F7F800` | manual, same reason |
| `#111827CC` (`[orderId].tsx:326`) | `#211C16CC` | manual |
| `#FDA4AF` (`[orderId].tsx:438`) | risk `#B3261E` — or `--line-strong` | **judgement** — it is a *warning* border on a price mismatch; a rose-300 reads as neither |
| 8× `#fff`/`#FFFFFF` on accent | `color.onSeal` | mechanical |
| `rgba(15,23,42,0.45)` (`TourSheet.tsx:24`) | `rgba(33,28,22,0.45)` (ink-1) | mechanical |
| `app.json:13,27,44` `#7C1D3C` | `#1A5E6B` | **native rebuild** (§7) |
| `app.json:8` `"light"` | `"automatic"` | **feature work**, not a rename |

### 6.3 Email — `template-config.ts` and the three systems

| Old | New | Notes |
|---|---|---|
| `primary #7c2d12` | seal-500 `#1A5E6B` | white-on-seal = **7.35:1**, still AAA-for-large / AA-normal (from 9.37:1) |
| `primaryDark #991b1b` | seal-600 `#14515C` | white-on-seal-600 = **8.89:1** |
| `secondary`/`warning #f59e0b` | warn `#A5670A` | collapse the duplicate key |
| `success #10b981` | ok `#17795E` | |
| `danger #dc2626` | risk `#B3261E` | |
| `info #3b82f6` | **contested** | see below |
| `gray.50 #f9fafb` | `--paper-0 #FAF7F1` | |
| `gray.100 #f3f4f6` | `--paper-1 #F3EFE6` | body ground on every email |
| `gray.200 #e5e7eb` | `--line #E3DBCB` | |
| `gray.300 #d1d5db` | `--line-strong #D2C7B2` | |
| `gray.400 #9ca3af` | `--ink-3 #7C7365` | copyright line — **2.43:1 today**, → 4.67:1 |
| `gray.500 #6b7280` | `--ink-3 #7C7365` | footer; 4.83 → 4.67:1, still AA |
| `gray.600 #4b5563` | `--ink-2 #4F473C` | |
| `gray.700 #374151` | `--ink-2 #4F473C` | 25 uses — the most common ink in email |
| `gray.800 #1f2937` | `--ink-1 #211C16` | |
| `gray.900 #111827` | `--ink-1 #211C16` | |
| `alertBox` warn `#fef3c7`/`#92400e` | `#FBF1DF` / `#A5670A` | `base-template.ts:198` |
| `alertBox` danger `#fef2f2`/`#991b1b` | `#FBEAE8` / `#B3261E` | `:199` |
| `alertBox` success `#ecfdf5`/`#065f46` | `#E9F5F1` / `#17795E` | `:200` |
| `alertBox` info `#eff6ff`/`#1e40af` | `#EAF0FE` / `#2F58E0` | `:201`, contested |
| legacy gradient `#722F37 → #4A1A1F` | `#1A5E6B → #0C343C` | `email-templates-legacy.ts:154` |
| legacy hover `#5a2530` | `#14515C` | `:161` |
| legacy page `#f5f5f5` | `--paper-1 #F3EFE6` | `:152` |
| legacy badges `#fee2e2/#dc2626`, `#fef3c7/#d97706`, `#dbeafe/#2563eb`, `#d1fae5/#059669` | risk / warn / info / ok pairs | `:163-166` |
| python `#8B2635` | `#1A5E6B` | `email_client.py:357,360,380,383,408` |
| python `#5a1a23` | `#0C343C` | `weekly_report_preview.html:11` |
| bootstrap `#28a745 #dc3545 #ffc107 #17a2b8 #007bff` | ok / risk / warn / info / info | python demos + `email_client.py` |
| PDF `#1a1a2e` | `--ink-1 #211C16` | `reporting_agent.py:684,687` |
| PDF `#e0e0e0` / `#f9f9f9` / `#333` / `#666` | `--line` / `--paper-1` / `--ink-1` / `--ink-3` | `:683-689` |

**`--info` — no clean equivalent, and it is the one open fork here.** ADR 0042 already
flags that "a blue seal and a blue *informational* are now competing for the same
reading". This audit adds the volume: `#eff6ff` appears **12 times** and `#3b82f6`/
`#2563eb`/`#dbeafe` a further 11 across the email surface, and the İznik seal is itself
a blue-teal that will sit adjacent to them in the same message. **Proposed resolution:
retire `--info` as a colour in email specifically** — render informational callouts as
`--ink-2` text on `--paper-1` with an `--line-strong` left rule, no hue. Reasoning: an
email cannot rely on a hover or a tooltip to disambiguate two blues, the info role in
these templates is never an action, and dropping it leaves the seal as the only blue in
the inbox. Keep `#2F58E0` in-product if the sibling `apps/web` pass finds it survives
there — the surfaces can differ, because the collision is worse in email.

**`--calm` `#6B5F8A` is unreferenced anywhere outside `apps/web`.** ADR 0042 flags it as
at-risk; from this side of the audit there is nothing to migrate, so it will not block.

### 6.4 `packages/ui`

| Old scale | New | Note |
|---|---|---|
| `wine` 50–900 | seal 50–900, direct positional map | `#9E4249` (600) → `#14515C`; `#B85055` (500) → `#1A5E6B` |
| `gray` 50–900 (warm) | `--paper-0/1/2`, `--line`, `--line-strong`, `--ink-3/2/1` | **10 → 8 mismatch**; `gray.300 #CFC3BC` and `gray.400 #A3968E` both land near `--line-strong`/`--ink-3` and need a call |
| `blue` 50–900 | unchanged (600 is already `#2F58E0`) | or delete with `--info`, per §6.3 |
| `yellow` 50–900 | warn ramp anchored on `#A5670A` / `#FBF1DF` | current 500 `#EAB308` is far brighter than `--warn` |
| `wine-green` 50–900 | ok ramp anchored on `#17795E` / `#E9F5F1` | current 500 `#22c55e` is far brighter than `--ok` |
| `globals.css --primary 346 77% 49%` | `194 61% 26%` | **dead file** — delete instead |
| Tremor default series ramp | **no mapping exists** | §7 |

---

## 7. What cannot be migrated by find-and-replace

**1. Raster assets — four PNGs, redraw only.** `icon.png`, `adaptive-icon.png`,
`splash.png` and `favicon.png` are 98–100% `#6B1B3D`. No token, no build flag and no
sed touches them; someone has to re-export them from a source file. Two aggravations:
the source file for the mark is not in this repo (no `.svg`, no `.ai`, no `.fig`
reference anywhere outside `apps/web`), and `#6B1B3D` matches **none** of the nine
other brand values, so there is no "and while we're here" that fixes it. Until they are
redrawn the home-screen icon stays burgundy no matter how complete the code migration is.

**2. Native splash, adaptive icon and notification tint require a rebuild.**
`app.json:13,27,44` are consumed by `expo prebuild` and baked into the native shells —
`colors.xml` / `Info.plist` on Android and iOS. Changing the JSON is necessary and not
sufficient; it needs an EAS build and a store release before a single user sees İznik on
launch. This is the longest lead-time item in the whole migration and it is worth
starting first.

**3. Email must ship literal hex forever.** Outlook (Word rendering engine),
Gmail's clipper and most webmail strip `<style>` blocks, and none of them resolve CSS
custom properties. Every one of the **286** hex occurrences in the email surface has to
remain a literal in the sent HTML. The most that can be done is to funnel them through
`EMAIL_CONFIG` at *build* time so there is one place to edit — and today
`template-config.ts` covers only a fraction: the 17 `email-templates/*.ts` files carry
**93 literals that bypass it**, `email-templates-legacy.ts` has its own 84, and
`auth.service.ts` / `communications.service.ts` / `communications.controller.ts` a
further 74. **Consolidating these into one config is the actual migration work;** the
recolour is trivial once it exists. Note also that `alertBox`
(`base-template.ts:197-202`) hardcodes eight values *inside* the shared helper, which is
the single highest-leverage fix in the file.

**4. Chart series arrays.** `packages/ui` never passes `colors=` to any Tremor chart
(`charts/index.tsx:4-16`), so every chart draws from Tremor's built-in ramp. There is no
array to rename — the migration here is *adding* a series palette that does not exist,
derived from the seal ramp, and threading it through five re-exported chart components.
`stat-card.tsx:68`'s `decorationColor="wine"` is worse than un-migrated: `"wine"` is not
a Tremor colour name, so it likely renders nothing today and will keep rendering nothing
after any rename. Verify on screen before touching it.

**5. Database-persisted colour — a data migration, not a code change.** Three columns
hold hex that no code edit reaches:

| Table | Column | Default | Source |
|---|---|---|---|
| `calendar_event_types` | `color text NOT NULL` | `'#6b7280'` | `supabase/migrations/20260805000000_baseline_from_production.sql:2330` |
| `restaurant_branding` | `primary_color varchar(7)` | `'#7c2d12'` | same file `:5040` |
| `storage_locations` | `color_code varchar(7)` | *(null)* | same file `:5504` |

Plus the eight seeded event-type colours in `calendar.service.ts:801-853` —
`#3b82f6` delivery, `#10b981` order, `#8b5cf6` meeting, `#f59e0b` inventory count,
`#ef4444` tasting, `#6b7280` reminder, `#ec4899` holiday, `#14b8a6` custom. **This is a
categorical series palette in everything but name**, it is written into rows at seed
time, and existing tenants keep the old values after any code change. `#8b5cf6`
(violet) and `#14b8a6` (teal) are the two to watch: teal will collide directly with the
İznik seal, and violet is the same hue family as the at-risk `--calm`.

`restaurant_branding.primary_color` is the sharpest one — `base-template.ts:41` prefers
it over `colors.primary`, so **any tenant row already holding `#7c2d12` will keep
sending brown-headed email after the code ships İznik.** That needs an `UPDATE`, and a
decision about whether tenants who deliberately customised should be left alone.

**6. `packages/ui`'s own Tailwind config and CSS are inert** (§2.3) — editing them
migrates nothing. Not a find-and-replace limitation so much as a find-and-replace *trap*.

---

## 8. Web ↔ mobile drift pairs

Every row below is a colour that exists **twice, in two files, with no shared source**.
After the migration these are the pairs that go out of sync on the first one-sided edit.
`packages/ui` cannot be the shared source for any of them: mobile does not depend on it
(`apps/mobile/package.json` has no `@wineops/*` dependency at all) and could not consume
its Tailwind classes if it did.

| Value | Mobile | Web | Risk |
|---|---|---|---|
| **brand primary** | `#AC204A` (`tokens.ts:29`) | `#9E4249` (90 occurrences) | **already drifted** — the two apps do not share a brand colour *today*. Migrating both to `#1A5E6B` accidentally repairs it; nothing keeps it repaired |
| `#7C1D3C` | `tokens.ts:30` + `app.json:13,27,44` | `calendar/EventModal.tsx:1427`, `MeetingMemoPrompt.tsx:249`, `CalendarPage.tsx:456` | **highest-risk pair** — three web calendar files hold mobile's `wineStrong` literal with no comment saying why |
| `#7c2d12` | — | `emails/QuickGmailModal.tsx:128,138,188`, `lib/email-scheduler.ts:209`, `data/emailTemplateCategories.ts:388` | web **previews** email using the api-gateway's brand literal; change the server and the preview lies |
| `#F7F8F9` | `surfaceSecondary` | `studio/StudioLayout.tsx:29` | page ground, duplicated |
| `#F1F3F5` | `surfaceTertiary` (0 uses) | `studio/QueueTable.tsx:20`, `ContributorTable.tsx:84`, `WineRecordsTable.tsx:99,106` | web still uses a token mobile abandoned |
| `#111827` | `ink` | 5 occurrences | |
| `#6B7280` | `inkTertiary` | 38 occurrences | |
| `#9CA3AF` | `inkQuaternary` | 8 occurrences | if mobile folds this into `--ink-3` (§6.1) and web does not, the two diverge |
| `#F3F4F6` | `fill` | 14 | |
| `#E5E7EB` | `fillStrong` | 10 | |
| `#1F2937` | `shadow` | 48 | |
| `#059669` / `#D97706` / `#DC2626` | semantics | 3 / 7 / 8 | three-way with email's `#10b981` / `#f59e0b` / `#dc2626` |
| `#FFFBEB` / `#FEF2F2` | tints | 2 / 1 | |

Four of these — `#ECEEF0`, `#4B5563`, `#FDF2F4`, `#FCE7EB` — appear **only** in mobile
and are the safe ones.

**Recommendation, offered not assumed:** the durable fix is a
`packages/tokens` workspace package emitting the same values in three forms (a TS object
for React Native, CSS custom properties for web, and a plain hex map for the email
builder), with a CI guard that fails on any hex literal outside it. Per the repo's
"solve it once = add a guard" rule that guard is what makes the migration stick — a
one-time recolour across five surfaces with ten sources will drift again inside a month.
Whether to build it, and whether it belongs before or after the recolour, is a founder
call and is **not** decided here.

---

## 9. Blast radius

| Surface | Files with colour | Colour occurrences | Rebuild? | Notes |
|---|---|---|---|---|
| `apps/mobile` | **36** of 57 | 223 token refs + 14 literals + 1 rgba + 3 config = **241** | **yes — EAS + store** | 94% funnels through one file |
| `packages/ui` | **10** of 20 | 50 hex (inert) + 109 classes = **159** | no | classes resolve in `apps/web` |
| `packages/database` | 0 | 0 (4 `color?: string` types) | no | nothing to do |
| Email (`apps/api-gateway`) | **23** | **286** hex | no | 3 parallel systems |
| Email (`services/*` python) | **5** live + 2 test | **172** hex | no | incl. WeasyPrint PDF |
| Assets | **4** PNGs | 4 files, 100% coverage | **yes** | redraw required |
| Database | 3 columns + 8 seeds | — | **data migration** | affects existing tenants |
| **Total** | **81 files** | **~862 sites** | | |

### The five files that change most

| Rank | File | Sites | Why it dominates |
|---|---|---|---|
| 1 | `apps/api-gateway/src/communications/email-templates-legacy.ts` | **84** | second brand system; `baseLayout:152-172` alone carries 21 |
| 2 | `apps/api-gateway/src/communications/communications.service.ts` | **54** | `generateWeeklyReportHtml:258` is one giant inline-styled string |
| 3 | `services/agent-orchestrator/demo/weekly_report_preview.html` | **59** | demo artefact — **verify it is still wanted before spending effort** |
| 4 | `services/agent-orchestrator/demo/demo_weekly_report.py` | **57** | same, and it duplicates #3 nearly line for line |
| 5 | `apps/api-gateway/src/communications/email-templates/onboarding.template.ts` | **33** | ignores `EMAIL_CONFIG` entirely; 4× `#7c2d12` + its own step-chip palette |

Excluding the two demo artefacts, the next-largest are
`apps/mobile/src/design/tokens.ts` (**24**, and by far the highest leverage — 24 edits
move 223 call sites) and
`services/agent-orchestrator/services/email_composer_service.py` (**28**, vendor-facing).

### Suggested order, on cost and lead time

1. **Redraw the four PNGs and change `app.json`** — longest lead time (store review),
   and independent of every code change.
2. **`apps/mobile/src/design/tokens.ts` + the 14 escaped literals** — smallest edit,
   largest visible result, one file plus 12 sites.
3. **Consolidate email onto one config, then recolour** — 286 sites but only ~30 real
   decisions; the consolidation is the work, the recolour is a byproduct.
4. **Python email + PDF** — 172 sites, self-contained, no shared dependency.
5. **`packages/ui`** — blocked on the sibling `apps/web` pass; decide first whether to
   delete the dead config and CSS or wire them up.
6. **Database migration** — last, once the target values are final and proven on screen.

---

## 10. Open questions for the founder

These are genuinely undecided and are **not** defaulted anywhere above.

1. **`--info`.** Retire it in email (proposed, §6.3) or keep `#2F58E0`? ADR 0042 raised
   the collision; this audit sizes it at 23 sites.
2. **`--paper-2` / `--ink-4`.** The brief's palette and ADR 0042's token table disagree.
   Which list is canonical? 5 mobile sites depend on the answer.
3. **`inkQuaternary`.** Fold 19 sites into `--ink-3` and gain AA (proposed), or keep a
   fourth step and stay below it?
4. **The two demo artefacts** (`weekly_report_preview.html`, `demo_weekly_report.py`,
   116 sites between them). Migrate, or delete? They are 40% of the python blast radius
   and they duplicate each other.
5. **`restaurant_branding.primary_color`.** Bulk-update every tenant row still holding
   the `#7c2d12` default, or leave customised tenants alone and update only exact matches?
6. **Calendar event-type colours** (8 seeded, DB-persisted). These are a categorical
   series palette that predates any palette decision; `#14b8a6` will collide with the
   seal. Re-derive from the seal ramp, or keep them deliberately off-brand as *data*?

---

## 11. Method and limits

- Counts are `grep -oE '#[0-9a-fA-F]{3,8}\b'` over the working tree, excluding
  `node_modules/` and `services/agent-orchestrator/venv/`.
- PNG dominant colours are exact per-pixel counts (Pillow), not sampled.
- Contrast ratios are WCAG 2.1 relative luminance, computed not estimated.
- **Excluded deliberately:** `apps/web` (sibling agent's scope). §8 cites web
  `file:line` only as the far end of a duplicate pair — no web colour was inventoried.
- **False positives removed:** `apps/api-gateway/src/analytics/advanced-analytics.service.ts`
  showed 11 "hex" matches that are insight-type IDs in comments (`#124`, `#301`), not
  colours. Excluded from all totals.
- **Not verified:** whether `decorationColor="wine"` (`stat-card.tsx:68`) renders at all
  today. The static evidence says it cannot resolve, but I did not run the app to
  confirm — flagged in §7.4 rather than asserted.
- **Not verified:** which of the 17 `email-templates/*.ts` are actually reachable in
  production. Audience labels in §4.1 come from template names and payload shapes, not
  from send logs.

