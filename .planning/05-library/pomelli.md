---
type: reference
name: Pomelli
category: design-ui
url: https://labs.google.com/pomelli
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[stitch]]"]
---

# Pomelli

## What it is

**Partially verified, 2026-08-24.** `pomelli.withgoogle.com` returned **HTTP 404** — that
host is wrong, and the corpus should stop using it. Secondary sources consistently give
the address as **`labs.google.com/pomelli`**, announced on Google's own blog at
`blog.google/innovation-and-ai/models-and-research/google-labs/pomelli/`.

**Reported (secondary sources, not a primary fetch):**

- A **Google Labs + DeepMind** experiment for small-business marketing.
- Analyses a business's **website and existing images** to build a "Business DNA" profile —
  tone of voice, colour palette, fonts, visual style — then generates editable branded
  campaign assets for social, web, and ads, downloadable for use elsewhere.
- **Public beta, English only**, reported available in the **US, Canada, Australia, and
  New Zealand**, free during beta.

## Why it might matter here specifically

Two honest caveats before the use case:

1. **The reported regional availability does not obviously include this project's market.**
   If the founder is operating outside US/CA/AU/NZ, the tool may simply be unavailable —
   that should be checked before any time is spent on it.
2. Its input is *a business's own website*. Mudavym's marketing surface would be the input;
   the restaurants' would not, unless this is being considered as something offered *to*
   customers, which is a different and much larger product question.

The plausible internal use is generating first-pass campaign assets for the Commercial
division's marketing surface without an agency — which is the gap
`.planning/01-org/commercial/media-brand/` describes.

## What adopting it would cost

- Zero technical integration; it is a web tool producing downloadable assets.
- Brand risk: generated "Business DNA" is inferred, not authored. Media & Brand owns the
  wordmark and voice; an inferred palette that contradicts it is worse than no asset.
- Labs beta — can change or be withdrawn.

## What decision it bears on

None open.

## Status

`candidate` — **URL corrected** (`pomelli.withgoogle.com` is 404; use `labs.google.com/pomelli`).
Capabilities and regional availability UNVERIFIED (secondary sources only).
