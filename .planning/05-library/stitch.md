---
type: reference
name: Google Stitch
category: design-ui
url: https://stitch.withgoogle.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[pomelli]]"]
---

# Google Stitch

## What it is

**Partially verified, 2026-08-24.** `stitch.withgoogle.com` resolves and self-describes as
"Design with AI", but returned no extractable detail. Everything below the first line comes
from **secondary sources**, including Google's own developers blog announcement, and is
labelled as such.

- Confirmed by direct fetch: the product exists at `stitch.withgoogle.com`.
- **Reported (secondary):** generates responsive UI from text prompts, sketches, or
  screenshots; one-click **export to Figma** producing auto-layout, named layers and
  editable text; **export of front-end code** (HTML/CSS, with React reported);
  a free allowance reported at ~350 generations/month with a Google account; Figma export
  reported as unsupported in its image-referencing "Experimental Mode".

**Do not treat the numbers above as verified.** They are consistent across several
third-party write-ups and Google's announcement post, which is weaker evidence than a
primary product page, and generation allowances on Labs products change without notice.

## Why it might matter here specifically

The relevant surface is exploration, not production. `.planning/sketches/` already holds
~58 throwaway HTML sketches — the workflow this would plug into is *sketch faster*, not
*generate the app*. Product UI here is constrained by the UX-paths catalogue and by the
existing component set in `apps/web/src/components/ui/`; generated screens would need to be
re-expressed in those components regardless of what Stitch exports.

## What adopting it would cost

- Nothing to install; the cost is where generated output lands. HTML/CSS from a generator
  does not use `cn()`, Tailwind tokens, or the house components, so "export code" is a
  reference artefact, not a shortcut into `apps/web`.
- Google Labs products are experiments and can be withdrawn; no workflow should depend on it.
- Data: pasting product screenshots into a third-party generator is a disclosure decision,
  small but real.

## What decision it bears on

None open.

## Status

`candidate` — existence verified; **capabilities and quotas UNVERIFIED (secondary sources
only)**.
