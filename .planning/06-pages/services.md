---
type: page
route: /services
slug: services
component: none (inline <Navigate> redirect)
audience: owner
tier: core
archetype: redirect # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[help]]", "[[settings]]"]
---

# /services — redirect → /settings?tab=services

## Surface — buttons → where they go

- **(no UI — automatic redirect)** → [[settings]] `/settings?tab=services`

## 1. Purpose
Compatibility route. "Services & permissions" (email, web, and privacy access grants)
lives as a Settings tab; this path exists so the old standalone URL keeps working.

## 1a. Features
none — redirect. Services & permissions live on [[settings]] §1a (services tab).

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list) — the surfaces that send users
to services (Help's "Manage services" button, `Help.tsx:154`; Privacy's controls list,
`Privacy.tsx:64-66`) navigate straight to `/settings?tab=services`, skipping this
route. Cold URL/bookmarks only.

## 3. Files
- Route: `apps/web/src/App.tsx:295` — `<Navigate to="/settings?tab=services" replace />`
- No component (PAGE_MAP "unresolved route components" — correct)

## 4. Endpoints
none from this route. The destination tab's calls belong to the `/settings` page doc.

## 5. Signals
none. (Arrivals via Help's button are counted by `trackGuidance('services_visited')`,
`Help.tsx:153` — but those bypass this route; see [[help]] §5.)

## 6. Tier cut
n/a — redirect. Consent/permissions gating matters to every tier equally.

## 7. Rebrand surface
none.

## 8. State & config
none.

## 9. Gaps
none beyond redirect-forever debt: nothing links here, so the route can be retired the
day analytics could prove zero cold hits — which is exactly the telemetry the app does
not have (§5 across the page corpus).

## 10. Maturity

**complete** — as a redirect, which is its entire claim.

`apps/web/src/App.tsx:295` is `<Navigate to="/settings?tab=services" replace />`;
`Settings.tsx:709,721` honours the `?tab=` param and opens the Services section. The
hop works.

Scope note: the **destination section is hollow** (settings.md §10 — the consent
toggles persist to `servicePermissions`, which is read only by the component that
writes it, and the telemetry they govern ships dark). That verdict belongs to
`/settings`, not to this line of routing.

Confirmed still true: nothing links here. Help's "Manage services" button
(`Help.tsx:154`) and Privacy's controls (`Privacy.tsx:64-66`) both navigate straight
to `/settings?tab=services`, skipping this route entirely.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| — | none | — | — | No component, no request |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| — | none | — |

### Writes

| Write | Downstream reaction |
|---|---|
| — | none |

Everything after the hop belongs to settings.md §11.

## 12. Design intent

**Should be:** an old URL that does not 404.

| State | Handled? | Evidence |
|---|---|---|
| Empty / Loading / Error | n/a | Synchronous `<Navigate>`; no data, nothing to fail |
| Permission-denied | Inherited | Sits inside the same `ProtectedRoute` + `DashboardLayout` block as `/settings` (`App.tsx:247-252`) |

**Where the UI misleads:** nowhere — there is no UI.

## 13. Roadmap

1. **Nothing to build here.** The only question is retirement, and §9 already states
   the blocker precisely: the route can go the day analytics prove zero cold hits,
   and that telemetry is exactly what the app does not have (`lib/uxSignals.ts:15`,
   dark). Deleting it today is a guess; keeping it costs one line.
2. The consent surface it points at needs work — see settings.md §13 item 5. That
   is where the value is, not here.
