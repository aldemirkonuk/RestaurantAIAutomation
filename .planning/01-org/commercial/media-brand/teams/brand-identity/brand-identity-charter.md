---
type: charter
division: commercial
department: media-brand
team: brand-identity
status: exists
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[brand-identity-premortem]]"
  - "[[brand-identity-directive]]"
  - "[[brand-identity-loops]]"
  - "[[brand-identity-schedule]]"
  - "[[editorial-gate-charter]]"
  - "[[EXTERNAL_CONNECTIONS]]"
  - "[[commercial]]"
---

# Brand Identity (M1) — Charter

**Parent:** [[media-brand-charter|Media & Brand]] · Commercial.
**Evidence grade: `EXISTS`** — as a live, verified defect, not as a capability.

## Mandate

Own the name, the marks, and the voice guide that Growth's
[[editorial-gate-charter|Editorial Gate]] applies. Own the *definition* of the brand;
other units own its application.

**Founding assignment: finish the WineOps → Mudavym migration below the doc layer.** The
rename happened in the planning corpus and nowhere else. The product still introduces
itself as WineOps to its users, its vendors, the sites it crawls, the API partners reading
its docs, and the operating systems it is installed on. This is not a tidying task. Every
one of those audiences is a person the company was trying to look credible to.

## Why distinct from siblings

M1 owns the definition; Growth owns the application. That split is what stops "brand voice"
meaning whatever the person writing that day thinks it means, and it gives G3 something
external to enforce rather than an opinion to defend. Its failure mode is also unlike its
siblings': a wrong narrative loses a room in ninety seconds and can be rewritten; a
half-finished rename leaks quietly, permanently, into other people's logs and inboxes.

## The audit — verified 2026-08-24

Run on `feat/beverage-catalogue-wine-identity`. Exclusions, stated so the numbers are
reproducible: `md/`, `md_files/`, `.planning/`, all `*.md`, `pnpm-lock.yaml`, the generated
`apps/api-gateway/openapi.json`, and `dist/` build output.

### Two patterns, two very different numbers

| Pattern | Lines | Files | What it can see |
|---|---|---|---|
| Host / URL (`EXTERNAL_CONNECTIONS.md` scope) | — | — | 10 references. Correct *within its scope*, and blind to everything without a domain |
| Domain `wineops.ai` | **33** | **25** | Mail identity, links, API docs, crawler UA, fixtures |
| Literal name `WineOps` | **351** | **193** | Everything above, plus the product's actual identity |

Of the 351 name lines, roughly **86 are comments or file headers** and **265 are code or
rendered strings**. `@wineops/*` workspace-scope lines are excluded from both counts —
those are identifiers and belong to fork **CM-F5**, not here.

> **The correction that matters.** [[commercial]] §4.1 already corrected the host-scoped
> count of 10 to "33 lines across 26 tracked files" — but that 33 is the **domain** surface
> (this session reproduces 33 lines across 25 files), and the very examples that section
> cites as its argument, `apps/web/index.html` and `manifest.json`, are **not in it**,
> because they contain no domain. Both corrections were right about the blind spot and both
> understated the size of it. The name surface is roughly ten times the domain surface.

### Tier 1 — a human or a third-party machine sees this

The migration that matters. Verified line by line.

| Surface | Location | What is seen |
|---|---|---|
| Browser tab, and any SEO snapshot of the shell | `apps/web/index.html:7` | `WineOps AI - Restaurant Wine Management` |
| iOS web-app title | `apps/web/index.html:15` | `WineOps AI` |
| Shell meta description | `apps/web/index.html:8` | wine-only positioning; no legacy name, but scoped here as brand copy |
| PWA install name | `apps/web/public/manifest.json:2,3` | `WineOps AI` / `WineOps` |
| PWA description | `apps/web/public/manifest.json:4` | wine-only positioning |
| **Mobile app name on the home screen** | `apps/mobile/app.json:3` | `WineOps` |
| **Face ID system prompt** | `apps/mobile/app.json:20`, `apps/mobile/app/lock.tsx:31` | `Unlock WineOps with Face ID…` / `Unlock WineOps` |
| **Android notification channel** (visible in system Settings) | `apps/mobile/src/lib/push.ts:32` | `WineOps` |
| **Web push notification title** | `apps/web/public/sw.js:67` | `WineOps AI` |
| **iCal `PRODID`**, transmitted into every subscribed calendar client | `apps/api-gateway/src/calendar/calendar.service.ts:1204,1224,1251`; feed name `:1201,1221,1248` | `PRODID:-//WineOps//Restaurant Calendar//EN`, `WineOps Calendar` |
| **Account verification email** a new user receives | `apps/api-gateway/src/auth/auth.service.ts:710,735,757` | subject, `<h1>`, and `© … WineOps AI` footer |
| Password reset email | `apps/api-gateway/src/auth/auth.service.ts:1603` | `Reset your WineOps AI password` |
| Outbound mail `From:` | `apps/api-gateway/src/communications/gmail.service.ts:78` | `notifications@wineops.ai` |
| Message-ID domain on every sent mail | `apps/api-gateway/src/communications/gmail.service.ts:599` | `@wineops.ai` |
| Links inside vendor-facing email | `apps/api-gateway/src/communications/email-templates/vendor-action.template.ts:31,207` | `https://app.wineops.ai` |
| Email footer site + support address | `apps/api-gateway/src/communications/email-templates/template-config.ts:35,36` | `https://wineops.ai`, `support@wineops.ai` |
| Low-stock digest email title | `apps/api-gateway/src/communications/email-templates/low-stock-digest.template.ts:104` | `… — WineOps` |
| **Crawler User-Agent in vendors' server logs** | `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:17` | `WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price intelligence)` |
| **Public API docs contact, license, production server** | `apps/api-gateway/src/main.ts:127,128,130` | `WineOps Team`, `https://wineops.ai/license`, `https://api.wineops.ai` |
| In-product wordmark, web | `apps/web/src/components/layout/Sidebar.tsx:469,484`, `apps/web/src/components/layout/DashboardLayout.tsx:77` | `WineOps AI` |
| Sign-in and register pages | `apps/web/src/pages/Login.tsx:70`, `apps/web/src/pages/Register.tsx:1307,1328`, `apps/web/src/components/brand/AuthShell.tsx:64` | `WineOps AI`, `Join WineOps AI`, `© 2026 WineOps AI` |
| **Pre-login privacy page body copy** | `apps/web/src/pages/Privacy.tsx:23,31,43` | `What WineOps stores…`, three more in body text |
| Onboarding copy | `apps/web/src/pages/GetStarted.tsx:63,279,324,418`, `apps/mobile/app/get-started.tsx:152` | `How to use WineOps` and family |
| Mobile sign-in and settings | `apps/mobile/app/login.tsx:59`, `apps/mobile/app/lock.tsx:54`, `apps/mobile/app/settings.tsx:197` | `WineOps` |
| In-product support link | `apps/web/src/pages/Help.tsx:18`, `apps/web/src/pages/Profile.tsx:445` | `support@wineops.ai` |
| Push VAPID subject | `apps/api-gateway/src/notifications/notifications.service.ts:66` | `mailto:admin@wineops.ai` |
| Agent-sent dashboard links | `services/agent-orchestrator/agents/notification_agent.py:1623`, `services/agent-orchestrator/services/email_composer_service.py:652` | `https://app.wineops.ai` |
| Agent-sent Message-ID domain | `services/agent-orchestrator/agents/provider_conversation_agent.py:2604` | `@wineops.ai` |
| Agent push VAPID subject | `services/agent-orchestrator/services/push_notification_service.py:225` | `mailto:admin@wineops.ai` |

**The three the founder called out as third-party-visible are all confirmed verbatim:** the
outbound `From:` header, the crawler User-Agent that lands in other companies' access logs,
and the OpenAPI production server. Each is read by someone outside this company, and none
of them is read by us.

### Tier 2 — internal, low risk, bulk

Comments and file headers across `apps/api-gateway/src/analytics/**` (engine and insight
files carry `WineOps Analytics Engine` headers), test fixtures
(`apps/api-gateway/src/communications/tests/procurement-email.e2e.spec.ts:35`,
`apps/api-gateway/src/calendar/ical-feed.spec.ts:73`), demo scripts
(`services/agent-orchestrator/demo/demo_weekly_report.py:85,91`,
`demo_ordering_scenario.py:117`), seed and migration helpers
(`scripts/init_database_local.sql:118`, `scripts/fix_uuid_migration.sql:24`), the
label-studio harness (`docker/label-studio/docker-compose.yml:10,31`,
`scripts/start_label_studio.sh:31`, `scripts/test_label_studio.sh:36`), `env.example:31`,
`scripts/gmail-reauth.js:18`, `.gitignore:2`, and the archived
`Supabase_SQL_Files/*.sql` headers.

`apps/api-gateway/src/common/orchestrator/inbound-address.service.ts:27` and
`apps/api-gateway/src/communications/communications.controller.ts:1031` sit on the tier
boundary — the first is a comment, the second is a live fallback address string.

`scripts/render_system_atlas.py:109` already contains the pattern
`(r'wineops\.ai', 'wineops.ai', '⚠️ Legacy brand domain — pre-Mudavym')`. **The repo
already knows.** It has a detector for exactly one of the two patterns, which is precisely
how the name surface stayed invisible.

### Tier 3 — NOT this team's

Identifiers, not display strings. `package.json:2`, `@wineops/*` workspace scopes,
`apps/mobile/app.json:4` (`"slug": "wineops-ai"`), `docker-compose.yml` service and network
names, `.railway/railway.ts`, `vercel.json`. These belong to Engineering via fork
**CM-F5** and carry a live hazard documented in [[brand-identity-premortem]].

## Boundaries

Owns outright: the name, the wordmark and mark (`apps/web/src/components/brand/BrandMark.tsx`
is the current asset), the voice guide, the tier classification of any brand string, the
brand CI guard, and the reference shortlist.

## Explicit non-goals

- **Product interaction design** → [[design-charter|Product → Design]]. M1 owns the wordmark
  on `AuthShell.tsx`; Design owns the form beneath it.
- **Enforcing the voice on published copy** → [[editorial-gate-charter|Growth G3]].
- **Identifier renaming** → [[engineering-charter|Engineering]], fork CM-F5.
- **`SKILLS.md`'s stale brand line** → tracked as
  [OD-14](../../../../../decisions/OPEN-DECISIONS.md). M1 supplies the replacement wording;
  the decision about that file is not ours.
- **A marketing site**. There is no marketing site to brand — `apps/web` is the
  authenticated product ([PAGE_MAP.md](../../../../../foundation/PAGE_MAP.md)).

## Metrics it moves

**Primary: legacy-brand references remaining in shipped surfaces → 0**, reported as two
numbers (name, domain), plus a CI check so the class cannot recur. Baseline at founding:
name **351 / 193 files**, domain **33 / 25 files**, tier-1 rows as tabled above.

Reporting one number is itself a failure mode here, which is why the metric is defined as
two.

## Evidence today

`EXISTS`. Every row above was read from the working tree during this session. No live
deployment was fetched and no external site was visited, so this describes the source, not
production.
