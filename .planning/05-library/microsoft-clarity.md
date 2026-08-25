---
type: reference
name: Microsoft Clarity
category: seo-analytics
url: https://clarity.microsoft.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[ga4]]"]
---

# Microsoft Clarity

## What it is

Verified 2026-08-24 against `clarity.microsoft.com`.

- **Free, with no traffic limit** — the site states both explicitly ("always free",
  "no limit on traffic").
- Provides **session recordings**, **heatmaps** (click / scroll / exit), AI summaries, an
  AI chat over the data, plus newer "AI visibility" and "brand agent" features.
- Self-described as **GDPR and CCPA ready**. Used on 2M+ sites per its own claim.

## Why it might matter here specifically

It is the closest external analogue to something this project is **already building
in-house**: the self-learning UX optimiser (`apps/api-gateway/src/ux-optimizer`), which is
dark, human-gated, and never auto-applies. Clarity's session recordings and heatmaps are
the observation layer that module currently lacks a source for.

That makes this the one SEO/analytics entry with a genuine *build-vs-buy* edge, and the
question is not "should we have heatmaps" but **"should the UX optimiser consume a
third-party recording tool or its own event stream"** — which is an architecture decision
nobody has recorded.

Also relevant against [[ga4]]: same slot, zero cost, and no traffic cap.

## What adopting it would cost

This is where "free" stops being the whole story:

- **Session recording on an authenticated product surface records whatever is on screen.**
  `apps/web` displays restaurant operational data, vendor pricing, invoices, and staff
  information. Recording it means shipping that to Microsoft unless masking is configured
  correctly and verified — not assumed. "GDPR-ready" describes the vendor's posture, not
  this deployment's compliance.
- Therefore it needs Compliance & Privacy sign-off, a processor entry, a DPA, and a
  privacy-policy update — and `apps/web/src/pages/Privacy.tsx` is already known-stale
  (OD-27).
- A third-party script on the product surface: bundle weight and a supply-chain surface.

## What decision it bears on

None open. Should not be adopted without Compliance & Privacy; the masking configuration is
the whole risk.

## Status

`candidate` — free and unlimited, verified. **The privacy exposure on an authenticated
surface is the gating concern, not the price.**
