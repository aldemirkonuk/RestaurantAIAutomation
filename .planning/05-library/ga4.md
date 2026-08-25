---
type: reference
name: Google Analytics 4 (Data API v1)
category: seo-analytics
url: https://developers.google.com/analytics/devguides/reporting/data/v1
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[google-search-console]]", "[[microsoft-clarity]]"]
---

# Google Analytics 4 — Data API v1

## What it is

Verified 2026-08-24 against the Data API v1 developer guide.

- Programmatic access to GA4 property report data — the same data as the Analytics UI, and
  it respects the property's reporting-identity setting (Blended / Observed / Device-based).
- Methods: `runReport`, `runPivotReport`, `runRealtimeReport`, `runFunnelReport`
  (documented as early preview). `getMetadata` enumerates available dimensions and metrics.
- Realtime covers events from seconds ago to roughly 30–60 minutes back.

**UNVERIFIED:** quota limits and any cost. The developer guide links a "Manage quota usage"
topic without stating figures; nothing here should assert a per-day token or request cap.

## Why it might matter here specifically

Verified: **no GA4 or analytics credential exists in `env.example` or
`services/agent-orchestrator/.env.example`.** There is no web-analytics instrumentation in
the repo at all — matching the claim at
`.planning/01-org/commercial/growth/growth-charter.md:168` that Sentry is the only telemetry
SDK present.

The important distinction, because these two get conflated: this project already has a
substantial **product** analytics engine (`apps/api-gateway/src/analytics`) that answers
questions about *restaurants' operations*. GA4 would answer questions about *visitors to
Mudavym's own site*. They share a word and nothing else. Adopting GA4 does not extend the
analytics engine and the analytics engine does not substitute for it.

## What adopting it would cost

- A GA4 property, a measurement tag in whatever the public marketing surface is (**not**
  necessarily `apps/web`, which is the authenticated product), and a service-account
  credential for the API.
- **Privacy work is not optional.** Adding GA4 means a cookie/consent gate, a privacy-policy
  update, and a processor entry — and note `apps/web/src/pages/Privacy.tsx` currently makes
  a cookie-behaviour claim under a stale brand name (already logged as OD-27). Shipping
  GA4 without fixing that would make the privacy page inaccurate as well as stale.
- Alternative worth weighing first: [[microsoft-clarity]] (free, unlimited traffic, GDPR/CCPA
  ready) or Ahrefs Web Analytics (cookieless by default) — different trade-offs, same slot.

## What decision it bears on

None open. Would fall to Growth + Compliance & Privacy jointly.

## Status

`candidate` — API verified; not instrumented anywhere; quotas UNVERIFIED; carries a
consent/privacy dependency.
