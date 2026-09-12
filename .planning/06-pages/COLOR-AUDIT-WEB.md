# COLOR-AUDIT-WEB — every colour `apps/web` currently uses

> **Scope:** `apps/web` only (mobile, `packages/ui` and the email service are a separate audit).
> **Method:** git-tracked files only, `apps/web/**`. Static scan of hex / `rgb()` / `rgba()` /
> `hsl()` literals, Tailwind colour utilities (including `hover:`/`dark:`/`data-[…]:` variants and
> arbitrary `bg-[#…]` values), the Tailwind config, `index.html`, the PWA manifest, and pixel
> analysis of the four PNG icons.
> **Nothing was changed.** This is a read-only audit against ADR
> [[0042-iznik-seal-and-warm-charcoal]].
> **Date:** 2026-08-29 · branch `feat/p1-readout`

---

## 0. Headline numbers

| Measure | Count |
|---|---:|
| Distinct colour **values** found (hex) | **168** |
| Hex literal **occurrences** | **803** (680 in `src/`, 120 in `tailwind.config.js`, 2 in `manifest.json`, 1 in `index.html`) |
| Distinct `rgb()` / `rgba()` literals | **30** (53 occurrences; a further 19 sites are `hsl(var(--token))` indirection) |
| Tailwind colour-utility occurrences | **16,137** across **279** files |
| — of which use the brand scale (`wine-*` / `brand-*`) | **1,741** (10.8%) |
| — of which use a **non-brand** colour family | **14,396** (89.2%) |
| **Total colour decision sites** | **16,993 across 297 files** |
| Distinct burgundies in use (should be 1) | **12** |
| Colour assertions in tests / e2e that would break | **0** |

The single most important number: **89% of colour decisions in this app are not expressed in the
brand scale.** Re-pointing `wine`/`brand` in `tailwind.config.js` moves 1,741 of 16,137 utilities
and leaves the other 14,396 exactly where they are.

---

## 1. Complete colour inventory

Sorted by occurrence count descending. "Files" = distinct files the value appears in.
Values that exactly match a stock Tailwind v3 swatch are labelled as such — this matters, because
`tailwind.config.js` **overrides** `gray`, `slate`, `red`, `blue` and `yellow`, so a hardcoded
`#6B7280` and a `text-gray-500` class in the same component render **different greys**
(`#6B7280` cool vs `#7A6F68` warm). See §4.2.

*Paths in this table are relative to `apps/web/`; every other section uses the full repo path.*

| Value | Role / what it is | Representative site | Files | Count |
|---|---|---|---:|---:|
| `#9E4249` | **Brand burgundy** — `wine/brand/red/danger-600`, theme-color, seal mark, table-export header | `src/components/brand/BrandMark.tsx:28` | 30 | 92 |
| `#1F2937` | stock Tailwind `gray-800` | `src/components/documents/GmailTemplateBuilder.tsx:224` | 12 | 48 |
| `#6B7280` | stock Tailwind `gray-500` | `src/components/documents/GmailTemplateBuilder.tsx:112` | 25 | 38 |
| `#FFFFFF` | Surface / on-brand text | `src/components/documents/GmailTemplateBuilder.tsx:181` | 11 | 25 |
| `#10B981` | stock Tailwind `emerald-500` | `src/components/documents/SavedTemplates.tsx:367` | 14 | 22 |
| `#F59E0B` | stock Tailwind `amber-500` | `src/components/documents/GmailTemplateBuilder.tsx:247` | 13 | 22 |
| `#3B82F6` | stock Tailwind `blue-500` | `src/components/documents/SavedTemplates.tsx:365` | 13 | 21 |
| `#8B5CF6` | stock Tailwind `violet-500` | `src/components/documents/GmailTemplateBuilder.tsx:247` | 14 | 19 |
| `#B85055` | Brand burgundy light — `wine/brand-500` | `src/components/onboarding/MenuCsvUpload.tsx:341` | 8 | 17 |
| `#EC4899` | stock Tailwind `pink-500` | `src/components/documents/GmailTemplateBuilder.tsx:247` | 14 | 17 |
| `#991B1B` | stock Tailwind `red-800` | `src/components/documents/GmailTemplateBuilder.tsx:107` | 5 | 15 |
| `#F3F4F6` | stock Tailwind `gray-100` | `src/components/documents/GmailTemplateBuilder.tsx:495` | 9 | 14 |
| `#FFF` | Surface / SVG stroke (short form of `#FFFFFF`) | `src/components/brand/BrandMark.tsx:34` | 7 | 14 |
| `#6366F1` | stock Tailwind `indigo-500` | `src/components/communications/ReportScheduler.tsx:207` | 10 | 13 |
| `#EF4444` | stock Tailwind `red-500` | `src/components/documents/GmailTemplateBuilder.tsx:255` | 7 | 13 |
| `#BE123C` | stock Tailwind `rose-700` | `src/components/inventory/StorageLocationManager.tsx:64` | 7 | 12 |
| `#FBBF24` | stock Tailwind `amber-400` | `src/components/documents/GmailTemplateBuilder.tsx:247` | 7 | 12 |
| `#E5E7EB` | stock Tailwind `gray-200` | `src/components/documents/GmailTemplateBuilder.tsx:281` | 6 | 10 |
| `#374151` | stock Tailwind `gray-700` | `src/components/documents/GmailTemplateBuilder.tsx:112` | 5 | 9 |
| `#F9FAFB` | stock Tailwind `gray-50` | `src/components/documents/GmailTemplateBuilder.tsx:112` | 9 | 9 |
| `#9B1D3A` | Rogue burgundy — template-library chip | `src/components/documents/TemplateLibrary.tsx:436` | 1 | 8 |
| `#9CA3AF` | stock Tailwind `gray-400` | `src/components/emails/QuickGmailModal.tsx:152` | 5 | 8 |
| `#DC2626` | stock Tailwind `red-600` | `src/components/documents/GmailTemplateBuilder.tsx:255` | 3 | 8 |
| `#D97706` | stock Tailwind `amber-600` | `src/data/userTemplateCategories.ts:132` | 5 | 7 |
| `#F0E0E3` | Rogue burgundy tint — provider card wash | `src/pages/Providers.tsx:892` | 1 | 7 |
| `#FAF7F5` | Page ground (warm paper) — `slate/gray-50`, `surface.secondary` | `src/components/brand/AuthShell.tsx:29` | 5 | 7 |
| `#14B8A6` | stock Tailwind `teal-500` | `src/components/inventory/StorageLocationManager.tsx:71` | 6 | 6 |
| `#D07072` | Brand 400 — heatmap + config | `src/components/reports/molecules/BusyHoursHeatmap.tsx:81` | 3 | 6 |
| `#E5A9A8` | Brand 300 — heatmap + config | `src/components/reports/molecules/BusyHoursHeatmap.tsx:81` | 3 | 6 |
| `#F0FDF4` | stock Tailwind `green-50` | `src/components/documents/GmailTemplateBuilder.tsx:109` | 6 | 6 |
| `#F3D4D2` | Brand 200 — heatmap + config | `src/components/reports/molecules/BusyHoursHeatmap.tsx:81` | 3 | 6 |
| `#F472B6` | stock Tailwind `pink-400` | `src/components/reports/molecules/ChannelDonutChart.tsx:12` | 4 | 6 |
| `#FAEDEC` | Brand 100 — heatmap + config | `src/components/reports/molecules/BusyHoursHeatmap.tsx:81` | 3 | 6 |
| `#FDF7F6` | Brand 50 — heatmap floor + config | `src/components/reports/molecules/BusyHoursHeatmap.tsx:81` | 3 | 6 |
| `#111827` | stock Tailwind `gray-900` | `src/data/emailTemplateCategories.ts:59` | 2 | 5 |
| `#22C55E` | stock Tailwind `green-500` | `src/components/scanner/CameraCapture.tsx:199` | 3 | 5 |
| `#2563EB` | stock Tailwind `blue-600` | `src/components/documents/GmailTemplateBuilder.tsx:108` | 4 | 5 |
| `#7C2D12` | stock Tailwind `orange-900` | `src/components/emails/QuickGmailModal.tsx:128` | 3 | 5 |
| `#EFF6FF` | stock Tailwind `blue-50` | `src/components/documents/GmailTemplateBuilder.tsx:108` | 5 | 5 |
| `#2F2F2F` | Sommelier dark chrome | `src/pages/SommelierAI.tsx:480` | 1 | 4 |
| `#522327` | Brand burgundy 900 (config only) | `tailwind.config.js:34` | 1 | 4 |
| `#682C31` | Brand burgundy 800 (config only) | `tailwind.config.js:33` | 1 | 4 |
| `#82363C` | Brand burgundy 700 (config only) | `tailwind.config.js:32` | 1 | 4 |
| `#A855F7` | stock Tailwind `purple-500` | `src/components/reports/molecules/WineDistributionChart.stories.tsx:27` | 2 | 4 |
| `#C9C1BC` | Range-slider track | `src/components/ui/RangeSlider.tsx:87` | 1 | 4 |
| `#CA8A04` | stock Tailwind `yellow-600` | `src/data/wineData.ts:220` | 2 | 4 |
| `#EA580C` | stock Tailwind `orange-600` | `src/components/documents/GmailTemplateBuilder.tsx:110` | 3 | 4 |
| `#F1F3F5` | Studio table zebra | `src/pages/studio/WineRecordsTable.tsx:99` | 3 | 4 |
| `#F5F3FF` | stock Tailwind `violet-50` | `src/components/documents/SavedTemplates.tsx:369` | 4 | 4 |
| `#FACC15` | stock Tailwind `yellow-400` | `src/components/reports/molecules/WineDistributionChart.stories.tsx:25` | 2 | 4 |
| `#FCD34D` | stock Tailwind `amber-300` | `src/pages/distributors/command/DistributorMap.tsx:44` | 3 | 4 |
| `#FEF3C7` | stock Tailwind `amber-100` | `src/pages/Dashboard.tsx:447` | 2 | 4 |
| `#059669` | stock Tailwind `emerald-600` | `src/data/userTemplateCategories.ts:136` | 2 | 3 |
| `#06B6D4` | stock Tailwind `cyan-500` | `src/components/layout/Header.tsx:82` | 3 | 3 |
| `#0B0B0B` | Dark-mode surface override (`.dark .bg-white`) | `src/styles/globals.css:156` | 1 | 3 |
| `#16A34A` | stock Tailwind `green-600` | `src/components/documents/GmailTemplateBuilder.tsx:109` | 3 | 3 |
| `#4285F4` | Google brand blue | `src/components/auth/GoogleSignInButton.tsx:38` | 2 | 3 |
| `#4F46E5` | stock Tailwind `indigo-600` | `src/components/layout/Header.tsx:76` | 3 | 3 |
| `#7C1D3C` | Rogue burgundy deep — calendar event | `src/pages/calendar/CalendarPage.tsx:456` | 3 | 3 |
| `#7C3AED` | stock Tailwind `violet-600` | `src/components/documents/GmailTemplateBuilder.tsx:111` | 3 | 3 |
| `#B8323A` | Rogue burgundy — tour help button | `src/guidance/components/TourHelpButton.tsx:13` | 1 | 3 |
| `#D1D5DB` | stock Tailwind `gray-300` | `src/data/emailTemplateCategories.ts:300` | 3 | 3 |
| `#DB2777` | stock Tailwind `pink-600` | `src/data/userTemplateCategories.ts:133` | 2 | 3 |
| `#DBEAFE` | stock Tailwind `blue-100` | `src/components/documents/GmailTemplateBuilder.tsx:505` | 2 | 3 |
| `#EA4335` | Google brand red | `src/components/auth/GoogleSignInButton.tsx:34` | 2 | 3 |
| `#EAB308` | stock Tailwind `yellow-500` | `src/components/scanner/CameraCapture.tsx:199` | 2 | 3 |
| `#F3EEEB` | Warm neutral 100 | `tailwind.config.js:117` | 1 | 3 |
| `#F43F5E` | stock Tailwind `rose-500` | `src/components/providers/SendMessageSlideOver.tsx:98` | 3 | 3 |
| `#F97316` | stock Tailwind `orange-500` | `src/components/scanner/CameraCapture.tsx:199` | 2 | 3 |
| `#121110` | Warm neutral 950 | `tailwind.config.js:134` | 1 | 2 |
| `#166534` | stock Tailwind `green-800` | `src/components/documents/GmailTemplateBuilder.tsx:109` | 2 | 2 |
| `#1C1A18` | Warm neutral 900 | `tailwind.config.js:133` | 1 | 2 |
| `#212121` | Tour tooltip dark | `src/guidance/components/TourHelpButton.tsx:15` | 2 | 2 |
| `#23367B` | info-900 | `tailwind.config.js:61` | 1 | 2 |
| `#243C9B` | info-800 | `tailwind.config.js:60` | 1 | 2 |
| `#2646C0` | info-700 | `tailwind.config.js:59` | 1 | 2 |
| `#2C2926` | Warm neutral 800 | `tailwind.config.js:132` | 1 | 2 |
| `#2F1518` | Brand burgundy 950 (config only) | `tailwind.config.js:35` | 1 | 2 |
| `#2F58E0` | **`--info` blue 600** (config `info`/`blue`) | `tailwind.config.js:58` | 1 | 2 |
| `#34A853` | Google brand green | `src/components/auth/GoogleSignInButton.tsx:46` | 2 | 2 |
| `#433E3A` | Warm neutral 700 | `tailwind.config.js:131` | 1 | 2 |
| `#4778F5` | info-500 | `tailwind.config.js:57` | 1 | 2 |
| `#5C534D` | Warm neutral 600 | `tailwind.config.js:130` | 1 | 2 |
| `#6F9EFF` | info-400 | `tailwind.config.js:56` | 1 | 2 |
| `#713F12` | stock Tailwind `yellow-900` | `tailwind.config.js:74` | 1 | 2 |
| `#7A6F68` | Warm neutral 500 (config `gray`/`slate`) | `tailwind.config.js:129` | 1 | 2 |
| `#854D0E` | stock Tailwind `yellow-800` | `tailwind.config.js:73` | 1 | 2 |
| `#9333EA` | stock Tailwind `purple-600` | `src/pages/Dashboard.tsx:863` | 2 | 2 |
| `#9EC2FF` | info-300 | `tailwind.config.js:55` | 1 | 2 |
| `#A16207` | stock Tailwind `yellow-700` | `tailwind.config.js:72` | 1 | 2 |
| `#A3968E` | Warm neutral 400 | `tailwind.config.js:128` | 1 | 2 |
| `#C6DBFF` | info-200 | `tailwind.config.js:54` | 1 | 2 |
| `#CFC3BC` | Warm neutral 300 | `tailwind.config.js:127` | 1 | 2 |
| `#D1FAE5` | stock Tailwind `emerald-100` | `src/pages/Dashboard.tsx:445` | 1 | 2 |
| `#DCFCE7` | stock Tailwind `green-100` | `src/components/documents/GmailTemplateBuilder.tsx:506` | 2 | 2 |
| `#DFEBFF` | info-100 | `tailwind.config.js:53` | 1 | 2 |
| `#E4DBD6` | Warm neutral 200 | `tailwind.config.js:126` | 1 | 2 |
| `#EBEBED` | Provider row divider | `src/pages/Providers.tsx:989` | 1 | 2 |
| `#F0F6FF` | info-50 | `tailwind.config.js:52` | 1 | 2 |
| `#F4F5F7` | Template-library ground | `src/components/documents/TemplateLibrary.tsx:418` | 1 | 2 |
| `#F87171` | stock Tailwind `red-400` | `src/components/documents/GmailTemplateBuilder.tsx:255` | 1 | 2 |
| `#F9D0DA` | Template chip border | `src/components/documents/TemplateLibrary.tsx:444` | 1 | 2 |
| `#FBBC05` | Google brand yellow | `src/components/auth/GoogleSignInButton.tsx:42` | 2 | 2 |
| `#FCA5A5` | stock Tailwind `red-300` | `src/components/documents/GmailTemplateBuilder.tsx:255` | 1 | 2 |
| `#FDE68A` | stock Tailwind `amber-200` | `tailwind.config.js:67` | 1 | 2 |
| `#FDF1F4` | Template chip wash | `src/components/documents/TemplateLibrary.tsx:436` | 1 | 2 |
| `#FDF4F5` | Calendar wine event wash | `src/pages/calendar/EventModal.tsx:125` | 2 | 2 |
| `#FEFCE8` | stock Tailwind `yellow-50` | `src/pages/calendar/EventModal.tsx:128` | 2 | 2 |
| `#FFD700` | Gold — company-class tier | `src/types/companyClass.ts:270` | 1 | 2 |
| `#FFFBEB` | stock Tailwind `amber-50` | `tailwind.config.js:65` | 1 | 2 |
| `#065F46` | stock Tailwind `emerald-800` | `src/components/documents/SavedTemplates.tsx:367` | 1 | 1 |
| `#0891B2` | stock Tailwind `cyan-600` | `src/data/userTemplateCategories.ts:138` | 1 | 1 |
| `#0D9488` | stock Tailwind `teal-600` | `src/data/userTemplateCategories.ts:134` | 1 | 1 |
| `#111` | Print stylesheet ink | `src/pages/team/command/ManagerShiftDesk.tsx:269` | 1 | 1 |
| `#111111` | Dark-mode surface | `src/styles/globals.css:164` | 1 | 1 |
| `#14532D` | stock Tailwind `green-900` | `tailwind.config.js:160` | 1 | 1 |
| `#15803D` | stock Tailwind `green-700` | `tailwind.config.js:158` | 1 | 1 |
| `#171717` | Sommelier dark ground · stock `neutral-900` | `src/pages/SommelierAI.tsx:404` | 1 | 1 |
| `#1A1A1A` | Dark-mode surface | `src/styles/globals.css:168` | 1 | 1 |
| `#1D4ED8` | stock Tailwind `blue-700` | `src/components/documents/SavedTemplates.tsx:365` | 1 | 1 |
| `#1E40AF` | stock Tailwind `blue-800` | `src/components/documents/GmailTemplateBuilder.tsx:108` | 1 | 1 |
| `#1F1F1F` | Dark-mode border | `src/styles/globals.css:185` | 1 | 1 |
| `#3C4043` | Google button text | `src/components/auth/GoogleSignInButton.tsx:177` | 1 | 1 |
| `#4ADE80` | stock Tailwind `green-400` | `tailwind.config.js:155` | 1 | 1 |
| `#5B21B6` | stock Tailwind `violet-800` | `src/components/documents/SavedTemplates.tsx:369` | 1 | 1 |
| `#65A30D` | stock Tailwind `lime-600` | `src/types/companyClass.ts:318` | 1 | 1 |
| `#666` | Print stylesheet meta | `src/pages/team/command/ManagerShiftDesk.tsx:270` | 1 | 1 |
| `#6B21A8` | stock Tailwind `purple-800` | `src/components/documents/GmailTemplateBuilder.tsx:111` | 1 | 1 |
| `#78350F` | stock Tailwind `amber-900` | `src/types/companyClass.ts:306` | 1 | 1 |
| `#7C3339` | Rogue burgundy dark — `WINE_DARK` map pin | `src/pages/distributors/command/DistributorMap.tsx:40` | 1 | 1 |
| `#86EFAC` | stock Tailwind `green-300` | `tailwind.config.js:154` | 1 | 1 |
| `#8A817C` | Map pin neutral | `src/pages/distributors/command/DistributorMap.tsx:41` | 1 | 1 |
| `#8B6363` | Rogue muted burgundy — integration authorize | `src/pages/AuthorizeIntegration.tsx:227` | 1 | 1 |
| `#96404E` | Rogue burgundy — guidance strip | `src/guidance/components/GuidanceStrip.tsx:47` | 1 | 1 |
| `#A78BFA` | stock Tailwind `violet-400` | `src/components/reports/molecules/ChannelDonutChart.tsx:14` | 1 | 1 |
| `#B45309` | stock Tailwind `amber-700` | `src/pages/distributors/command/DistributorMap.tsx:43` | 1 | 1 |
| `#B91C1C` | stock Tailwind `red-700` | `src/components/documents/GmailTemplateBuilder.tsx:107` | 1 | 1 |
| `#BBF7D0` | stock Tailwind `green-200` | `tailwind.config.js:153` | 1 | 1 |
| `#C2410C` | stock Tailwind `orange-700` | `src/components/documents/GmailTemplateBuilder.tsx:110` | 1 | 1 |
| `#CBD5F5` | Dark-mode muted text (cool) | `src/styles/globals.css:179` | 1 | 1 |
| `#DADCE0` | Google button border | `src/components/auth/GoogleSignInButton.tsx:177` | 1 | 1 |
| `#DCF8C6` | WhatsApp bubble green (SMS preview) | `src/components/documents/SavedSMSTemplates.tsx:432` | 1 | 1 |
| `#E05C7E` | Funnel series 2 | `src/components/reports/molecules/OrderFunnelChart.tsx:17` | 1 | 1 |
| `#E0E2E6` | Provider row divider | `src/pages/Providers.tsx:992` | 1 | 1 |
| `#E0E7FF` | stock Tailwind `indigo-100` | `src/pages/Dashboard.tsx:859` | 1 | 1 |
| `#E11D48` | stock Tailwind `rose-600` | `src/pages/Dashboard.tsx:456` | 1 | 1 |
| `#E56B70` | Heatmap ramp step 5 | `src/components/reports/molecules/BusyHoursHeatmap.tsx:35` | 1 | 1 |
| `#E8C8CC` | Provider card wash | `src/pages/Providers.tsx:893` | 1 | 1 |
| `#EBE4E0` | Warm neutral 150 | `tailwind.config.js:125` | 1 | 1 |
| `#EDE7E3` | Range-slider rail | `src/components/ui/RangeSlider.tsx:30` | 1 | 1 |
| `#F1F3F4` | Google button hover | `src/components/auth/GoogleSignInButton.tsx:177` | 1 | 1 |
| `#F2A3A5` | Heatmap ramp step 4 | `src/components/reports/molecules/BusyHoursHeatmap.tsx:34` | 1 | 1 |
| `#F3E8FF` | stock Tailwind `purple-100` | `src/pages/Dashboard.tsx:855` | 1 | 1 |
| `#F7F8F9` | Studio ground | `src/pages/studio/StudioLayout.tsx:29` | 1 | 1 |
| `#F8F9FA` | Google button ground | `src/components/auth/GoogleSignInButton.tsx:177` | 1 | 1 |
| `#F9CDCD` | Heatmap ramp step 3 | `src/components/reports/molecules/BusyHoursHeatmap.tsx:33` | 1 | 1 |
| `#FAF5FF` | stock Tailwind `purple-50` | `src/components/documents/GmailTemplateBuilder.tsx:111` | 1 | 1 |
| `#FAFAFA` | stock Tailwind `zinc-50/neutral-50` | `src/lib/tableExport.ts:90` | 1 | 1 |
| `#FB7185` | stock Tailwind `rose-400` | `src/types/companyClass.ts:282` | 1 | 1 |
| `#FBB6CE` | Funnel series 5 | `src/components/reports/molecules/OrderFunnelChart.tsx:20` | 1 | 1 |
| `#FCE7F3` | stock Tailwind `pink-100` | `src/pages/Dashboard.tsx:857` | 1 | 1 |
| `#FDE8E8` | Heatmap ramp step 2 | `src/components/reports/molecules/BusyHoursHeatmap.tsx:32` | 1 | 1 |
| `#FDFCFB` | Warm neutral 25 | `tailwind.config.js:122` | 1 | 1 |
| `#FEE2E2` | stock Tailwind `red-100` | `src/data/emailTemplateCategories.ts:495` | 1 | 1 |
| `#FEF2F2` | stock Tailwind `red-50` | `src/components/documents/GmailTemplateBuilder.tsx:107` | 1 | 1 |
| `#FEF5F5` | Heatmap ramp step 1 | `src/components/reports/molecules/BusyHoursHeatmap.tsx:31` | 1 | 1 |
| `#FFE4E6` | stock Tailwind `rose-100` | `src/pages/Dashboard.tsx:447` | 1 | 1 |
| `#FFF7ED` | stock Tailwind `orange-50` | `src/components/documents/GmailTemplateBuilder.tsx:110` | 1 | 1 |

### 1b. Non-hex colour values

**`rgb()` / `rgba()` literals — 30 distinct, 53 occurrences.** All but four are black or brand-alpha shadows.

| Value | Role | Site | Count |
|---|---|---|---:|
| `rgb(0 0 0 / 0.04 … 0.15)` (10 variants) | The whole `boxShadow` scale | `apps/web/tailwind.config.js:245-255` | 24 |
| `rgba(0,0,0,.06 … .22)` (9 variants) | Ad-hoc inline shadows | `apps/web/src/pages/calendar/EventModal.tsx:1455` | 14 |
| `rgba(158,66,73,0.07 / 0.10 / .22 / 0.3 / 0.18 / 0.55)` | **Brand `#9E4249` at alpha** — auth radial wash, slider thumb ring, register CTA glow | `apps/web/src/components/brand/AuthShell.tsx:33`, `:55`, `:80` | 9 |
| `rgb(59 130 246 / 0.15)` | `shadow-ring` — stock Tailwind `blue-500`, **not** the app's blue | `apps/web/tailwind.config.js:256` | 1 |
| `rgb(219 234 254)`, `rgb(147 197 253)`, `rgb(96 165 250)` | Canvas grid — stock `blue-100/300/400` | `apps/web/src/components/reports/DashboardCanvas.tsx:164-170` | 3 |
| `rgba(124,29,47,0.06)` | Rogue burgundy alpha | `apps/web/src/pages/Providers.tsx:892` | 2 |
| `rgba(37,99,235,.25)`, `rgba(15,23,42,0.55)` | Map user-pin halo; tour scrim | `apps/web/src/pages/distributors/command/DistributorMap.tsx:164`, `apps/web/src/guidance/tours/TourEngine.tsx:93` | 2 |

**CSS named colours.** Only three appear as true CSS values: `white` (`background: white !important`,
`apps/web/src/styles/globals.css:350`, `:405`), `transparent` (scrollbar track, `:568`, `:577`) and
`currentColor` (8 SVG `fill`/`stroke` sites). There are **no** `zinc`, `neutral`, `stone` or
`fuchsia` utilities anywhere in `apps/web` — that half of the stock palette is unused.

**shadcn HSL tokens — `apps/web/src/styles/globals.css:11-87`.** 22 tokens defined as bare HSL
triplets, invisible to any hex grep. Resolved:

| Token | Light | → hex | Dark | → hex |
|---|---|---|---|---|
| `--background` | `30 20% 97.5%` | `#FAF9F7` | `0 0% 3%` | `#080808` |
| `--foreground` | `25 12% 10%` | `#1D1916` | `210 40% 96%` | `#F1F5F9` |
| `--card` / `--popover` | `0 0% 100%` | `#FFFFFF` | `0 0% 6%` | `#0F0F0F` |
| `--primary` / `--ring` | `355 41% 44%` | **`#9E424A`** | `355 41% 50%` | `#B44B54` |
| `--destructive` | `355 41% 44%` | **`#9E424A`** | `0 63% 31%` | `#811D1D` |
| `--secondary` / `--accent` | `30 18% 95%` | `#F5F2F0` | `0 0% 12%` | `#1F1F1F` |
| `--muted` | `30 16% 94%` | `#F2F0ED` | `0 0% 12%` | `#1F1F1F` |
| `--muted-foreground` | `25 8% 42%` | `#746A63` | `215 20% 65%` | `#94A3B8` |
| `--border` / `--input` | `30 12% 88%` | `#E4E0DD` | `0 0% 16%` | `#292929` |
| `--ring` (dark) | — | — | `210 40% 90%` | `#DBE6F0` |

Two defects fall straight out of this table and are carried into §4.

---

## 2. Tailwind-class inventory — the invisible 89%

Every colour family in use, with occurrence counts and the files that lean on it hardest.
`tailwind.config.js` **redefines** the families marked ⚠️ — those classes do **not** render stock
Tailwind values.

| Family | Occurrences | Files | Resolves to | De-facto role | Top files |
|---|---:|---:|---|---|---|
| ⚠️ `gray-*` | **7,740** | 251 | warm neutral `#FAF7F5 … #121110` | body text, borders, sunk surfaces | `pages/WineLibrary.tsx` (208), `pages/Dashboard.tsx` (190), `components/providers/EditProviderModal.tsx` (180) |
| `wine-*` | 1,732 | 145 | `#FDF7F6 … #2F1518` | **brand** | `pages/WineLibrary.tsx` (84), `components/orders/CommsThreadDrawer.tsx` (70), `pages/calendar/EventModal.tsx` (70) |
| `amber-*` | **893** | 122 | stock Tailwind amber | **warn** (`bg-amber-50` 126×, `bg-amber-100` 87×) | `components/providers/EditProviderModal.tsx` (105), `components/providers/SendMessageSlideOver.tsx` (58) |
| ⚠️ `blue-*` | **760** | 97 | `#F0F6FF … #23367B`, 600 = **`#2F58E0`** | **info** / links / "recurring" | `pages/Calendar.tsx` (61), `pages/Orders.tsx` (51), `components/documents/GmailTemplateBuilder.tsx` (49) |
| `emerald-*` | **709** | 111 | stock Tailwind emerald | **ok / success** | `components/documents/SavedSMSTemplates.tsx` (41), `components/documents/SMSTemplateBuilder.tsx` (36) |
| `rose-*` | **468** | 96 | stock Tailwind rose | **risk / error** — the app's *real* error colour | `pages/Notifications.tsx` (30), `components/wines/DevManualWineEntry.tsx` (27) |
| ⚠️ `red-*` | 376 | 80 | **identical to `wine-*`** | ambiguous — brand *or* error, see §4.1 | `pages/Register.tsx` (27), `pages/Providers.tsx` (26), `pages/Orders.tsx` (22) |
| ⚠️ `slate-*` | 355 | 28 | same warm neutral as `gray-*` | legacy alias of `gray-*` | `pages/AdminPanel.tsx` (79), `components/communications/ReportScheduler.tsx` (66), `styles/globals.css` (53) |
| `purple-*` | 313 | 62 | stock Tailwind purple | **AI / autonomous** → `--calm` | `components/reports/ReportGenerator.tsx` (40), `pages/Inventory.tsx` (30) |
| `indigo-*` | 286 | 52 | stock Tailwind indigo | **AI / autonomous** → `--calm` | `components/wines/MenuScannerTab.tsx` (23), `pages/Notifications.tsx` (21) |
| `green-*` | 138 | 34 | stock Tailwind green | ok (duplicate of `emerald-*`) | `pages/Register.tsx` (25), `components/providers/EditProviderModal.tsx` (14) |
| `pink-*` | 65 | 24 | stock Tailwind pink | chart series, category chips | `pages/Dashboard.tsx` (7), `types/companyClass.ts` (6) |
| `violet-*` | 59 | 14 | stock Tailwind violet | AI / autonomous → `--calm` | `pages/Providers.tsx` (13), `components/providers/EditProviderModal.tsx` (10) |
| ⚠️ `yellow-*` | 50 | 21 | same scale as `warning-*` | warn (duplicate of `amber-*`) | `pages/Orders.tsx` (5), `pages/Calendar.tsx` (4) |
| `orange-*` | 43 | 17 | stock Tailwind orange | warn (third duplicate) | `components/providers/EditProviderModal.tsx` (11) |
| `cyan-*` | **42** | 10 | stock Tailwind cyan | seating density, notification kind | `components/reports/organisms/SeatingDensityPanel.tsx` (20) |
| `teal-*` | **40** | 16 | stock Tailwind teal | provider category, storage bins | `components/providers/EditProviderModal.tsx` (10) |
| `danger-*` | 15 | 4 | identical to `wine-*` | error | `styles/globals.css` (8) |
| `success-*` | 13 | 3 | stock Tailwind green scale | ok | `styles/globals.css` (8) |
| `brand-*` | 9 | 2 | identical to `wine-*` | brand (alias, barely used) | `styles/globals.css` (7) |
| `sky-*` | **9** | 4 | stock Tailwind sky | info variant | `components/orders/DraftEmailApprovalPanel.tsx` (3) |
| `warning-*` | 8 | 3 | same scale as `yellow-*` | warn | `styles/globals.css` (5) |
| `info-*` | 4 | 1 | same scale as `blue-*` | info | `styles/globals.css` (4) |
| `lime-*` | 2 | 1 | stock Tailwind lime | company-class tier | `types/companyClass.ts` (2) |
| **Bare utilities** | **2,008** | — | — | — | — |
| — `bg-white` / `text-white` / `border-white` etc. | 1,680 | 231 | `#FFFFFF` | card & on-brand surfaces | everywhere |
| — `bg-black` / `text-black` / `border-black` | 117 | — | `#000000` | dark-mode ground, scrims | `styles/globals.css:108` |
| — `*-transparent` / `*-current` | 195 | — | — | — | — |
| — `*-{background,foreground,border,input}` (shadcn) | 6 | — | `hsl(var(…))` | shadcn primitives — barely adopted | — |
| — `shadow-card` (non-colour, listed for completeness) | 10 | — | — | — | — |

**Arbitrary-value classes — 110 occurrences.** These bypass the token layer entirely.
`text-[#9E4249]` (18), `border-[#9E4249]` (16), `bg-[#9E4249]` (15), `ring-[#9E4249]` (10),
`text-[#B85055]` (7), `bg-[#B85055]` (6), `text-[#9b1d3a]` (4), `bg-[#FAF7F5]` (4),
`bg-[#F1F3F5]` (4), `bg-[#2f2f2f]` (4), plus 22 singletons.

**One dead class:** `border-gray-150` (`apps/web/src/components/reports/InlineBlockConfig.tsx:159`, `:193`, `:229`) —
the config defines `slate.150` but **not** `gray.150`, so those three borders render nothing today.

---

## 3. Migration table — old value → new token → new value

### 3.1 The brand ramp (clean swap)

`wine`, `brand`, `red` and `danger` are **four aliases of one identical 11-step scale** in
`apps/web/tailwind.config.js:24-49, 77-88, 163-174`. Only `wine`/`brand` should follow the seal.

| Old | New token | New value | Note |
|---|---|---|---|
| `#FDF7F6` (50) | `--seal-50` | `#F1F7F8` | |
| `#FAEDEC` (100) | `--seal-100` | `#E0EFF1` | |
| `#F3D4D2` (200) | `--seal-200` | `#BEDDE2` | |
| `#E5A9A8` (300) | `--seal-300` | `#8FC4CD` | |
| `#D07072` (400) | `--seal-400` | `#5FB0BC` | also the dark-surface primary |
| **`#9E4249` (600)** | **`--seal-500`** | **`#1A5E6B`** | 92 literal sites + 1,741 utilities |
| `#B85055` (500) | `--seal-400`…`500` | `#5FB0BC` / `#1A5E6B` | **collision — see below** |
| `#82363C` (700) | `--seal-600` | `#14515C` | |
| `#682C31` (800) | `--seal-700` | `#10424C` | |
| `#522327` (900) | `--seal-800` | `#0C343C` | |
| `#2F1518` (950) | **no equivalent** | *propose* `#051A1E` | the seal ramp stops at 900 `#08262C`; `wine-950` is unused in `src/` (config-only), so **retiring it is cleaner than inventing a 950** |

**The 500/600 collision is real and must be decided, not guessed.** Today the app's *primary* is
`wine-600` `#9E4249` (544 uses) and `wine-500` `#B85055` (326 uses) is its lighter sibling. The new
palette calls `#1A5E6B` "500". A literal name-preserving swap would make `wine-500` → `#1A5E6B` and
`wine-600` → `#14515C`, i.e. **870 utilities would shift one step darker than intended**.
Recommendation: **re-index the scale so `wine-600` → `#1A5E6B`** (preserving the visual weight of
the 544 most common uses) and let `wine-500` take `#5FB0BC`. That keeps `bg-wine-600` as "the brand
button" and does not require touching a single component.

### 3.2 Neutrals — the largest block, and not 1:1

`gray` and `slate` are the same 11-step warm scale (`apps/web/tailwind.config.js:121-148`),
8,095 utilities across 251 files. The new palette offers 7 light slots for 11 shades.

| Old class | Old value | New token | New value | Confidence |
|---|---|---|---|---|
| `gray-50` (700×) | `#FAF7F5` | `--paper-0` | `#FAF7F1` | clean |
| `gray-100` (924×) | `#F3EEEB` | `--paper-1` | `#F3EFE6` | clean |
| `gray-200` (**1,158×**) | `#E4DBD6` | `--line` | `#E3DBCB` | clean |
| `gray-300` (433×) | `#CFC3BC` | `--line-strong` | `#D2C7B2` | clean |
| `gray-400` (**1,014×**) | `#A3968E` | **no equivalent** | *propose* `--ink-4 #9A9082` | **gap** — this is the placeholder/disabled/icon-dim tier and sits between `--line-strong` and `--ink-3`. ADR 0042 *does* define an `--ink-4` (`#665D50` light) but it is **darker** than `--ink-3`, so it cannot serve here. Needs a new token. |
| `gray-500` (1,110×) | `#7A6F68` | `--ink-3` | `#7C7365` | clean |
| `gray-600` (662×) | `#5C534D` | `--ink-2` | `#4F473C` | **merge** — 600 and 700 collapse onto one token |
| `gray-700` (690×) | `#433E3A` | `--ink-2` | `#4F473C` | **merge** (see above) — or give 600 the proposed `--ink-4 #665D50` from ADR 0042 and keep 700 → `--ink-2` |
| `gray-800` (162×) | `#2C2926` | **no equivalent** | *propose* `#2E2820` | **gap** — between `--ink-2` and `--ink-1` |
| `gray-900` (870×) | `#1C1A18` | `--ink-1` | `#211C16` | clean |
| `gray-950` (11×) | `#121110` | dark `--paper-0` | `#15130F` | clean |
| `slate-25` (0×) | `#FDFCFB` | — | — | unused; retire |
| `slate-150` (0×) / `gray-150` (3×, dead) | `#EBE4E0` | — | — | retire; fix the three dead classes |
| `surface.primary` / `.elevated` | `#FFFFFF` | `--surface` | `#FFFFFF` | clean |
| `surface.secondary` | `#FAF7F5` | `--paper-0` | `#FAF7F1` | clean |
| `surface.tertiary` | `#F3EEEB` | `--paper-1` | `#F3EFE6` | clean |

**Net: 11 old shades → 8 new tokens + 2 tokens that must be invented.** Do not pretend this is a
find-and-replace.

### 3.3 Semantics

| Old family / value | Occurrences | New token | New value | Note |
|---|---:|---|---|---|
| `emerald-600/500` + `green-600` + `success-600` (`#16A34A`, `#10B981`, `#22C55E`) | ~880 | `--ok` | `#17795E` | three families, one meaning — consolidate |
| `emerald-50` (88) / `emerald-100` (101) / `green-50` / `green-100` | ~250 | `--ok-bg` | `#E9F5F1` | **two tint tiers → one token.** The palette gives one `bg`; the code uses 50 as a wash and 100 as a chip. Propose adding `--ok-bg-strong` rather than flattening. |
| `amber-500/600` + `yellow-500/600` + `warning-*` + `orange-600` (`#F59E0B`, `#D97706`, `#EAB308`, `#CA8A04`) | ~330 | `--warn` | `#A5670A` | four families, one meaning |
| `amber-50` (126) / `amber-100` (87) / `yellow-50` | ~230 | `--warn-bg` | `#FBF1DF` | same two-tier problem |
| `rose-500/600/700` (`#F43F5E`, `#E11D48`, `#BE123C`) | ~120 | `--risk` | `#B3261E` | rose is the *actual* error colour today |
| `rose-50` (63) / `rose-100` (39) | 102 | `--risk-bg` | `#FBEAE8` | same two-tier problem |
| `red-*` / `danger-*` (= `#9E4249` family) | 391 | `--risk` **or** `--seal` | `#B3261E` **or** `#1A5E6B` | **cannot be mapped mechanically** — see §4.1 |
| `blue-*` / `info-*` 600 (`#2F58E0`) | 764 | `--info` | `#2F58E0` | **under review** — see §4.3 |
| `blue-50/100` (`#F0F6FF`, `#DFEBFF`) | ~200 | `--info-bg` | `#EAF0FE` | follows whatever `--info` becomes |
| `purple-*` + `indigo-*` + `violet-*` | 658 | `--calm` | `#6B5F8A` | AI/autonomous surfaces — verified by usage, see §4.4 |
| `purple-50/100`, `indigo-50/100`, `violet-50` | ~180 | `--calm-bg` | `#F0EDF6` | |
| `cyan-*` + `teal-*` + `sky-*` | 91 | **no equivalent** | — | **hue collision with the seal** — see §4.5 |
| `pink-*` + `lime-*` | 67 | **no equivalent** | — | chart series + company-class tiers; see §4.6 |

### 3.4 Chrome and metadata

| Where | Old | New | Note |
|---|---|---|---|
| `apps/web/index.html:12` `<meta name="theme-color">` | `#9E4249` | `#1A5E6B` | one-line change |
| `apps/web/public/manifest.json:9` `theme_color` | `#9E4249` | `#1A5E6B` | |
| `apps/web/public/manifest.json:8` `background_color` | `#ffffff` | `#FAF7F1` | should match `--paper-0`, not pure white |
| `apps/web/public/{logo,icon-192,icon-512,badge}.png` | **`#722F37`** (95% of opaque pixels) + `#FFFFFF` | `#1A5E6B` + `#FFFFFF` | **binary — must be regenerated, see §4.7** |
| `apps/web/src/components/brand/BrandMark.tsx:28` `<circle fill>` | `#9E4249` | `#1A5E6B` | the in-code seal; currently *disagrees with the PNG icons* |
| `apps/web/src/styles/globals.css:25,41,47` `--primary`/`--destructive`/`--ring` | `355 41% 44%` | `190 61% 26%` (`#1A5E6B`) | and `--destructive` must **split off** — see §4.1 |
| `apps/web/src/styles/globals.css:57-83` `.dark` block | cool/neutral (`#080808`, `#F1F5F9`, `#94A3B8`, `#DBE6F0`) | Warm Charcoal (`#15130F`, `#EFE7D9`, `#8E8576`) | **whole block is the wrong temperature — see §4.8** |
| `apps/web/src/styles/globals.css:108` `.dark body` | `bg-black` (`#000000`) | `--paper-0` `#15130F` | |
| `apps/web/src/styles/globals.css:156,160,164,168,185` dark overrides | `#0b0b0b`, `#111111`, `#1a1a1a`, `#1f1f1f` | `#1D1813`, `#262019`, `#302921` | five `!important` overrides that bypass the token layer |

---

## 4. Hard cases — the things a token swap will get wrong

### 4.1 One colour, two meanings: brand **is** error

`tailwind.config.js` gives `wine`, `brand`, `red` and `danger` **byte-identical scales**
(`:24-49`, `:77-88`, `:163-174`), and `globals.css:41` sets `--destructive` to the same HSL as
`--primary`. Today `bg-red-600`, `bg-danger-600`, `bg-brand-600` and `bg-wine-600` all render
`#9E4249`. A burgundy brand made that survivable. **A blue-green brand does not** — after the swap,
`text-red-600` would render a teal error message.

- **391 utility sites** (`red-*` 376 + `danger-*` 15) across **81 files** must each be classified as
  *brand* or *error* before anything is swapped. This is manual triage, not codemod work.
- Spot-check shows both intents present: `apps/web/src/pages/Register.tsx:*` uses `red-*` for form
  validation errors (→ `--risk`), while `apps/web/src/pages/Orders.tsx:1903` uses `bg-wine-100` as
  the *non*-recurring brand chip (→ `--seal`).
- Meanwhile `rose-*` (468 sites, 96 files) is *already* doing the error job
  (`apps/web/src/App.tsx:322` `error: 'border-rose-200 bg-rose-50'`,
  `apps/web/src/components/ErrorBoundary.tsx:197-198`,
  `apps/web/src/pages/DevSandbox.tsx:70` `danger: 'bg-rose-100 … text-rose-700'`).
  **The app has two error colours and one of them is the brand.**

**Recommendation:** delete the `red` and `danger` aliases from the config outright, point every
error site at `rose-*` → `--risk`, and let `wine`/`brand` become the seal. That converts 391
ambiguous sites into 391 explicit ones.

### 4.2 Two greys named the same thing

`tailwind.config.js:136-148` overrides `gray` to a **warm** scale, but **144** hardcoded literals in
`src/` are the **cool stock Tailwind** greys. The two sit side by side:

| Stock literal | Count | Files | Config class of the same name | Δ |
|---|---:|---:|---|---|
| `#1F2937` (`gray-800`) | 48 | 12 | `gray-800` = `#2C2926` | cool vs warm |
| `#6B7280` (`gray-500`) | 38 | 25 | `gray-500` = `#7A6F68` | cool vs warm |
| `#F3F4F6` (`gray-100`) | 14 | 9 | `gray-100` = `#F3EEEB` | |
| `#E5E7EB` (`gray-200`) | 10 | 6 | `gray-200` = `#E4DBD6` | |
| `#374151` (`gray-700`) | 9 | 5 | `gray-700` = `#433E3A` | |
| `#F9FAFB` (`gray-50`) | 9 | 9 | `gray-50` = `#FAF7F5` | |
| `#9CA3AF` (`gray-400`) | 8 | 5 | `gray-400` = `#A3968E` | |
| `#111827` (`gray-900`) | 5 | 2 | `gray-900` = `#1C1A18` | |
| `#D1D5DB` (`gray-300`) | 3 | 3 | `gray-300` = `#CFC3BC` | |

`apps/web/src/components/inventory/StorageLocationManager.tsx` alone hardcodes
`color: '#1f2937'` at seven separate lines (`:610`, `:638`, `:668`, `:739`, `:752`, `:787`, `:948`)
as a Safari autofill workaround — a pattern repeated across
`apps/web/src/styles/globals.css:347-433`. **These 144 literals will not move when the config moves**,
and after the neutral swap they will be visibly cooler than everything around them.

### 4.3 `--info` blue vs the seal — the audit found the adjacency you predicted

`tailwind.config.js:58` defines `info-600` / `blue-600` as **exactly `#2F58E0`** — the same value
the ADR flags as under review.

- **46 files use `wine-*` and `blue-*` together.**
- Two lines put them in **direct semantic opposition**, which is the strongest possible evidence
  that they are read as a contrasting pair:
  - `apps/web/src/pages/orders/CreateOrderModal.tsx:137` — `isCreatingRecurring ? 'bg-blue-600' : 'bg-wine-600'`
  - `apps/web/src/pages/Orders.tsx:1903` — `order.isRecurring ? 'bg-blue-100' : 'bg-wine-100'`

  Here blue does not mean "informational" at all — it means "**not** the default kind of order",
  and it is legible *only* because it contrasts with burgundy. Swap burgundy for `#1A5E6B` and these
  two chips become a blue-vs-blue-green pair that will not survive a glance.
- `apps/web/src/components/layout/Header.tsx:76,82` places `#4F46E5` (indigo) and `#06B6D4` (cyan)
  in the same component — the cyan is already within ~15° of the new seal hue.

**Recommendation:** retire `--info` as a colour. Both sites above are *category* distinctions, not
informational ones, and both should become ink + a form difference (outline vs fill, or an icon).
That removes the competition instead of re-tuning it. If the blue must stay, it has to move well
past `#2F58E0` toward violet to keep 764 sites distinguishable from the seal.

### 4.4 `--calm` is already implemented, under three names

The ADR says `--calm` must be re-judged against the seal. The audit says the role **already exists
in the code** and is spread across `purple` (313), `indigo` (286) and `violet` (59) — 658 sites in
89 files — and it consistently marks machine-originated work:

- `apps/web/src/components/wines/WineValidationModal.tsx:93,97` — `'AI Label Detection'` →
  `bg-purple-100 text-purple-700`; `'Menu Scan'` → `bg-indigo-100 text-indigo-700`
- `apps/web/src/components/orders/ActiveConversationsPanel.tsx:103` — `text-indigo-400` on
  *"All AI emails have been reviewed"*
- `apps/web/src/pages/InsightCatalog.tsx:398`, `apps/web/src/pages/Notifications.tsx:1409` — `Sparkles`/`Zap` glyphs

**Good news for the ADR's open question:** `#6B5F8A` at 257° is 67° from the seal at 190°, which is
a wider separation than it had from the old burgundy at 355° (98°) but far from adjacent. The real
risk is not seal-vs-calm; it is **calm-vs-info**, since `#6B5F8A` (257°) and `#2F58E0` (226°) are
only 31° apart. Retiring `--info` (§4.3) resolves both problems at once.

### 4.5 Cyan / teal / sky collide with the new seal

91 occurrences across 24 files use `cyan-*`, `teal-*` or `sky-*` — hues 187°–199°, i.e. **the seal's
own hue band** (`#1A5E6B` is 190°). Today they read as "some other accent" because the brand is at
355°. After the swap they will read as *the brand*, applied to things that are not the brand:

- `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx` — 20 cyan sites; `:349`
  `bg-cyan-600 text-white` is a **selected filter chip**, visually identical to a brand button
- `apps/web/src/components/inventory/StorageLocationManager.tsx:71` — `#14B8A6` (teal-500) is a
  user-pickable **storage-bin colour**; a user can now pick "the brand colour" for a shelf
- `apps/web/src/data/userTemplateCategories.ts:134,138` — `#0D9488` (teal-600) and `#0891B2`
  (cyan-600) are offered in a **user-facing colour picker** labelled "Teal" and "Cyan"

These need re-hueing away from the seal, or the seal needs to be reserved and the picker options
regenerated. No mapping exists in the locked palette; this is a design call.

### 4.6 Chart series arrays — four different mechanisms, none token-aware

The app uses **no charting library** (`recharts` is in `package.json:56` but is imported **zero**
times in `apps/web/src`); every chart is hand-rolled SVG or flex bars. Series colours are therefore
hardcoded in four incompatible shapes:

1. **Hex maps** — `apps/web/src/components/reports/molecules/ChannelDonutChart.tsx:10-14`
   `{'Dine-in': '#9E4249', 'Bar': '#f472b6', 'Takeout': '#fbbf24', 'Delivery': '#a78bfa'}`
2. **Hex ramps** — `apps/web/src/components/reports/molecules/BusyHoursHeatmap.tsx:29-36` (a
   6-step burgundy heat ramp `#FEF5F5 → #9E4249`) and `:81` (a *second*, different 6-step legend
   ramp `#FDF7F6 → #9E4249`). **The heatmap and its own legend do not use the same ramp.**
3. **Hex-in-object series** — `apps/web/src/components/reports/molecules/OrderFunnelChart.tsx:16-20`
   (`#9E4249`, `#e05c7e`, `#ec4899`, `#f472b6`, `#fbb6ce` — a 5-step brand→pink gradient)
4. **Tailwind family *names* passed as strings** —
   `apps/web/src/components/reports/molecules/WineDistributionChart.tsx:49`
   `colors={['rose','amber','yellow','pink','violet']}` and
   `apps/web/src/components/reports/molecules/RevenueChart.tsx:62` `colors={['rose']}`.
   **These are invisible to a hex grep *and* to a class grep.**

Plus semantic series that encode wine type and must stay mutually distinguishable:
`apps/web/src/components/reports/atoms/WineTypeBar.tsx:33-37` and
`apps/web/src/components/reports/molecules/OrdersByTypeChart.tsx:64-68,118-122` both use
`bg-rose-600` (Red), `bg-amber-400` (White), `bg-purple-500` (Dessert) — where **`bg-rose-600` means
"red wine", not "error"**, and `bg-amber-400` means "white wine", not "warning". A semantic-token
codemod that rewrites `rose-600 → --risk` will silently relabel the wine chart.

Other palette arrays a token swap will miss entirely:

| Location | Shape | Contents |
|---|---|---|
| `apps/web/src/components/inventory/StorageLocationManager.tsx:64-71` | 8-hex picker | `#be123c #f59e0b #10b981 #3b82f6 #8b5cf6 #ec4899 #6366f1 #14b8a6` |
| `apps/web/src/data/userTemplateCategories.ts:128-139` | 12-hex named picker | Wine Red `#991B1B`, Blue, Green, Purple, Amber, Pink, Teal, Indigo, Emerald, Orange, Cyan, Gray |
| `apps/web/src/types/companyClass.ts:172-466` | 25 per-class hexes | incl. `#FFD700` gold, `#78350F`, `#65A30D` |
| `apps/web/src/components/documents/GmailTemplateBuilder.tsx:107-112` | 6 named email themes | "Wine Theme" primary is **`#991B1B`**, not the brand |
| `apps/web/src/pages/distributors/command/DistributorMap.tsx:39-44` | 6 map-pin constants | `WINE #9E4249`, `WINE_DARK #7C3339`, `SLATE #8A817C`, `CUSTOM #D97706` … |
| `apps/web/src/data/emailTemplateCategories.ts` | 39 hexes across 6 templates | incl. `color: '#7C2D12', // wine color` at `:388` — an **orange-900** commented as wine |

### 4.7 Colour baked into binaries

The four PNGs in `apps/web/public/` are **95% a single burgundy that appears nowhere in the source**:

| File | Size | Dominant | Share | Second |
|---|---|---|---:|---|
| `apps/web/public/logo.png` (favicon, maskable icon) | 192×192 | **`#722F37`** | 95.3% | `#FFFFFF` 4.7% |
| `apps/web/public/icon-192.png` (apple-touch-icon) | 192×192 | **`#722F37`** | 95.3% | `#FFFFFF` 4.7% |
| `apps/web/public/icon-512.png` | 512×512 | **`#722F37`** | 95.2% | `#FFFFFF` 4.8% |
| `apps/web/public/badge.png` (notification badge) | 96×96 | **`#722F37`** | 95.5% | `#FFFFFF` 4.5% |

`#722F37` is the **twelfth burgundy** (§4.12), distinct from `#9E4249` (the meta `theme-color` sitting three lines
away in `apps/web/index.html:5` and `:12`) and from `#9E4249` in
`apps/web/src/components/brand/BrandMark.tsx:28`. The favicon and the in-app mark **already disagree
today**. All four must be regenerated at `#1A5E6B`; there is no source vector in the repo
(`git ls-files` finds **zero** `.svg` files under `apps/web`), so the mark has to be re-authored, not
recoloured. `BrandMark.tsx` is the only vector form of the seal that exists.

### 4.8 Dark mode is the wrong temperature end-to-end

ADR 0042 makes Warm Charcoal a first-class ground. The current dark theme is the opposite:

| Token | Current | Reads as | Target |
|---|---|---|---|
| `.dark body` (`globals.css:108`) | `bg-black` `#000000` | pure black | `#15130F` |
| `--background` (`:57`) | `#080808` | near-black, neutral | `#15130F` |
| `--card` / `--popover` (`:60,63`) | `#0F0F0F` | neutral | `#1D1813` |
| `--foreground` (`:58`) | `#F1F5F9` | **stock `slate-100`, cool** | `#EFE7D9` (warm) |
| `--muted-foreground` (`:73`) | `#94A3B8` | **stock `slate-400`, cool blue-grey** | `#8E8576` |
| `--ring` (`:83`) | `#DBE6F0` | **blue-tinted** | `#5FB0BC` |
| `--destructive` (`:78`) | `#811D1D` | breaks from the light `--destructive` | `#B3261E` |
| `.dark .bg-white` etc. (`:155-185`) | `#0b0b0b`, `#111111`, `#1a1a1a`, `#1f1f1f` — 5 `!important` overrides | neutral greys bypassing tokens | `#1D1813` / `#262019` / `#302921` |

The dark half is not a re-tint; it is a rewrite. It is also **only 22 tokens + 5 overrides**, so it
is cheap in file count and expensive in judgement.

### 4.9 `--primary` is off by one from the brand

`globals.css:25` `--primary: 355 41% 44%` resolves to **`#9E424A`**, but the brand is **`#9E4249`**
(`tailwind.config.js:31`). One digit apart in blue. Every shadcn-derived surface
(`bg-primary`, `ring-ring`, `border-input`) is therefore a *slightly* different brand colour from
every `bg-wine-600`. Fix this during the migration rather than porting the error: `#1A5E6B` is
`hsl(190 61% 26%)`.

### 4.10 Third-party colours that must **not** be migrated

`apps/web/src/components/auth/GoogleSignInButton.tsx:34-46,177` hardcodes Google's brand marks —
`#EA4335`, `#4285F4`, `#FBBC05`, `#34A853`, plus `#F8F9FA` / `#F1F3F4` / `#DADCE0` / `#3C4043` for
Google's own button chrome. These are contractually fixed by Google's branding guidelines. Likewise
`#DCF8C6` (`apps/web/src/components/documents/SavedSMSTemplates.tsx:432`) is the WhatsApp bubble
green in an SMS preview. **11 literals across 2 files must be excluded from any codemod.**

### 4.11 Email/print HTML — outside the CSS cascade

Five generators emit standalone HTML with inline styles, where no Tailwind class and no CSS variable
reaches. Every colour is a literal and every one must be changed by hand:

| File | What it emits | Brand colour used |
|---|---|---|
| `apps/web/src/lib/email-scheduler.ts:207-228` | Test email | `linear-gradient(135deg, #7c2d12 0%, #991b1b 100%)` — **neither is the brand** |
| `apps/web/src/lib/tableExport.ts:84-90` | Print/PDF table export | `th { background: #9E4249 }` — correct brand |
| `apps/web/src/pages/team/command/ManagerShiftDesk.tsx:269-273` | Printed shift schedule | `#111`, `#666`, `#e5e7eb`, `#f9fafb`, `#6b7280` — all stock cool greys |
| `apps/web/src/data/emailTemplateCategories.ts` | 6 email templates, 39 literals | `#7C2D12` commented `// wine color` |
| `apps/web/src/components/documents/GmailTemplateBuilder.tsx` | Live email builder + SVG thumbnail, 48 literals | `#991B1B` as the default header/primary |

Note the pattern: **three separate "wine" colours in the email layer** (`#991B1B`, `#7C2D12`,
`#9E4249`), none of which agree.

### 4.12 Burgundy census — twelve values claiming to be one brand

Every one of these is asserted somewhere in `apps/web` to be *the* brand colour or a direct
brand state. Only the first is correct.

| Value | Where it claims to be the brand | Count |
|---|---|---:|
| **`#9E4249`** | `tailwind.config.js:31` (`wine/brand/red/danger-600`), `index.html:12` theme-color, `manifest.json:9`, `src/components/brand/BrandMark.tsx:28`, `src/lib/tableExport.ts:88` | 92 |
| `#B85055` | `wine-500`; used directly as brand in `src/components/onboarding/MenuCsvUpload.tsx:341` | 17 |
| `#991B1B` | `src/components/documents/GmailTemplateBuilder.tsx:107` — the *"Wine Theme"* email primary (stock `red-800`) | 15 |
| `#9B1D3A` | `src/components/documents/TemplateLibrary.tsx:436` — active-nav text | 8 |
| `#7C2D12` | `src/data/emailTemplateCategories.ts:388` — literally commented `// wine color` (stock `orange-900`) | 5 |
| `#B8323A` | `src/guidance/components/TourHelpButton.tsx:13` — hover + focus ring, **two lines below** a `wine-600` ring in the same object | 3 |
| `#7C1D3C` | `src/pages/calendar/CalendarPage.tsx:456` — the hover state of a `#9E4249` button (the ramp's own `wine-700` is `#82363C`) | 3 |
| `#96404E` | `src/guidance/components/GuidanceStrip.tsx:47` — strip border + shadow | 1 |
| `#8B6363` | `src/pages/AuthorizeIntegration.tsx:227` — error text beside a `bg-wine-500/80` dot | 1 |
| `#7C3339` | `src/pages/distributors/command/DistributorMap.tsx:40` — `WINE_DARK` map pin | 1 |
| `#9E424A` | `src/styles/globals.css:25` — `--primary` / `--destructive` / `--ring`, one digit off the brand (§4.9) | 3 tokens |
| **`#722F37`** | `public/{logo,icon-192,icon-512,badge}.png` — 95% of every icon's pixels; **exists only as pixels, in no source file** | 4 files |

The re-skin is the moment to collapse these to one token. If they are ported one-for-one into teal,
the app ships twelve teals.

---

## 5. Blast radius

### 5.1 How many files change

| Stage | Files touched | Sites | Character of the work |
|---|---:|---:|---|
| `tailwind.config.js` + `globals.css` + `index.html` + `manifest.json` | **4** | 191 values | mechanical, one session |
| PNG icon regeneration (`public/*.png`) | **4** | — | needs a re-authored mark; no `.svg` source exists |
| Files using the **brand** family (`wine`/`brand`/`red`/`danger`/`primary`) | **190** | 2,132 | mostly free if the config is re-pointed; **391 `red`/`danger` sites need manual brand-vs-error triage** (§4.1) |
| Files using **neutrals** (`gray` / `slate` / `white`) | **274** | 9,775 | free via config for the classes; **144 hardcoded cool-grey literals are not** (§4.2) |
| Files using **semantic** families (`emerald`/`green`/`success`/`amber`/`yellow`/`warning`/`orange`/`rose`) | **172** | 2,322 | consolidation work — 3 families → `--ok`, 4 → `--warn`, 1 → `--risk` |
| Files using **`blue`/`info`/`sky`/`cyan`** | **102** | 815 | blocked on the `--info` decision (§4.3) |
| Files using **`purple`/`indigo`/`violet`/`pink`/`teal`/`lime`** | **89** | 765 | `--calm` consolidation + the seal-hue collision (§4.5) |
| Files with **hardcoded hex/rgba** in `src/` | **86** | 714 | genuinely per-file manual work |
| **Union — every file with at least one colour decision** | **297** | **16,993** | |
| Tests / e2e specs that assert on colour | **0** | 0 | **nothing in the test suite breaks on colour** |

### 5.2 The five files that change most

| # | File | Colour sites | Why it is the worst |
|---|---|---:|---|
| 1 | `apps/web/src/components/providers/EditProviderModal.tsx` | **435** | 105 `amber-*`, 14 `green-*`, 11 `orange-*`, 10 `teal-*`, 10 `violet-*` — five semantic families in one modal, plus 180 `gray-*` |
| 2 | `apps/web/src/pages/Notifications.tsx` | **424** | 30 `rose-*`, 21 `indigo-*`, 6 `cyan-*`, 6 `orange-*` — notification *kinds* are encoded as hues, so every one is a semantic decision, not a style |
| 3 | `apps/web/src/pages/Orders.tsx` | **411** | 51 `blue-*` incl. the `bg-blue-100 : bg-wine-100` recurring/one-off pair at `:1903` (§4.3); 22 `red-*` needing brand-vs-error triage |
| 4 | `apps/web/src/components/documents/GmailTemplateBuilder.tsx` | **403** | **48 hardcoded hexes** — the most in the app — including six named email palettes and an inline SVG thumbnail (§4.11); none of it reachable by a class codemod |
| 5 | `apps/web/src/pages/Dashboard.tsx` | **384** | 20 hardcoded hexes + 190 `gray-*` + purple/pink/indigo insight chips; the app's most-seen screen, so it is also the one that must look right first |

Runners-up, all >300: `apps/web/src/pages/WineLibrary.tsx` (370),
`apps/web/src/pages/Inventory.tsx` (360), `apps/web/src/pages/calendar/EventModal.tsx` (358, incl.
37 hexes), `apps/web/src/components/orders/CommsThreadDrawer.tsx` (307),
`apps/web/src/pages/Providers.tsx` (300, incl. 13 hexes and 5 rgba).

### 5.3 Honest read on effort

- **Cheap (1 session):** config, `globals.css` tokens, `index.html`, `manifest.json`. 4 files,
  and it moves ~10% of the app.
- **Cheap but blocking:** the `--info` decision (§4.3) and the `red`/`danger` split (§4.1). Neither
  is expensive to *do*; both are expensive to get wrong, and 1,155 sites wait on them.
- **Expensive and unavoidable:** the 714 hardcoded literals in 86 files, the 91 seal-hue
  collisions, the four chart-colour mechanisms in §4.6, and the icon re-authoring in §4.7. None of
  these move when the token layer moves.
- **Not verified in this audit:** whether `packages/ui` (which `tailwind.config.js:10` pulls into the
  same CSS bundle) introduces further values — that is the other agent's scope, but the two audits
  must be reconciled before any codemod runs, because both apps share this config's output.

---

## 6. Note on `--info` (requested)

`--info #2F58E0` is **under review** in ADR 0042 because a blue "informational" now competes with a
blue-green brand seal. This audit found the competition already exists in code and is
**load-bearing**, not decorative:

- `tailwind.config.js:58` sets `info-600` = `blue-600` = **exactly `#2F58E0`**, so the ADR's
  under-review value is not hypothetical — it is what 764 utility sites already render.
- 46 files use `wine-*` and `blue-*` together.
- Two sites use them as a **contrasting pair to distinguish order kinds**
  (`apps/web/src/pages/orders/CreateOrderModal.tsx:137`,
  `apps/web/src/pages/Orders.tsx:1903`). Blue there means "recurring", not "information". Those two
  chips are the clearest evidence that the blue is doing categorical work the seal will swallow.
- Separately, `--calm #6B5F8A` (257°) is only **31° from `--info` #2F58E0** (226°), while it is
  **67° from the seal** (190°). On the evidence, the seal-vs-calm worry in the ADR is the *lesser*
  risk; **info-vs-calm is the tighter pair**, and retiring `--info` in favour of ink + form
  (outline/fill, icon) resolves both at once.

---

*Audit produced 2026-08-29 on branch `feat/p1-readout`. Read-only: no source file was modified.
Counts are reproducible by static scan of git-tracked files under `apps/web/`.*
