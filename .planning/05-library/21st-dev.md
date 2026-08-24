---
type: reference
name: 21st.dev
category: design-ui
url: https://21st.dev
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[shadcn-ui]]"]
---

# 21st.dev

## What it is

Verified 2026-08-24 against `21st.dev`.

A community registry of React UI components, marketing blocks, templates, and shadcn
themes — not a library you install. The site's own numbers: 12,000+ components/templates,
2,000+ marketing blocks, 2,100+ UI components, 700+ contributing creators.

**Delivery model:** you copy an "AI-ready prompt" into an agent (Cursor, Claude Code, v0,
Lovable) and the agent rebuilds the component in your codebase. Components follow
shadcn/ui conventions — React + Tailwind.

**Pricing:** browsing free; **2 free component copies per day**; paid membership for
unlimited copies and premium templates; "21st AI" is a separate paid add-on.

## Why it might matter here specifically

It sits directly downstream of [[shadcn-ui]] — same conventions, same stack as `apps/web`
(React + Tailwind + Radix). The plausible use is **marketing-surface blocks**, not product
UI: heroes, backgrounds, pricing sections. Product UI here is governed by the UX-paths
catalogue and existing house components, and dropping registry components into it would
fight the design system rather than serve it.

## What adopting it would cost

- The daily free cap makes it unusable as a bulk source without paying.
- Provenance: components come from ~700 individual creators. Licence and accessibility
  quality vary per component and must be checked per copy, not once.
- The copy-via-prompt model means the output is agent-generated code that still needs
  review — it is a starting point, not a vetted dependency.
- Real risk of aesthetic drift: a registry component looks like the registry, not like
  this product.

## What decision it bears on

None open.

## Status

`candidate` — verified; free tier is 2 copies/day. Not adopted.
