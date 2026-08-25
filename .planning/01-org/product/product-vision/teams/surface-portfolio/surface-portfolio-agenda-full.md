---
type: agenda-full
division: product
department: product-vision
team: surface-portfolio
status: provisional
metrics: [surface.unowned_surface_count, surface.untraceable_route_components, surface.routes_without_owning_module]
updated: 2026-08-24
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-premortem]]", "[[surface-portfolio-agenda-board]]", "[[surface-portfolio-directive]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-schedule]]", "[[product-vision-agenda-full]]", "[[ux-path-burn-down-charter]]", "[[client-surfaces-charter]]", "[[ask-ai-charter]]", "[[supply-discovery-charter]]", "[[PAGE_MAP]]", "[[ENDPOINTS]]"]
---

# Surface Portfolio — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

**A verdict per route, for all 51.** Each route gets exactly one of: *keep* · *merge* ·
*kill* · *make-reachable* · *intentionally-cold* — plus a named owning module, and for
*intentionally-cold*, a one-line reason and a re-check date.

The first three verdicts are due in the first close-time because they are decidable now, by
one person, with nobody's permission:

| Duplication | Evidence | The call |
|---|---|---|
| `/wine-agent` **and** `/wineagent` | Both render the same inline placeholder — `apps/web/src/App.tsx:293-294`; `PlaceholderPage` at `:349` | Which slug survives; the other redirects or dies. Coordinate with [[ask-ai-charter]], which owns what eventually lives there |
| `/inventory` vs `/inventory-legacy` | [[PAGE_MAP]]:25-26 | Legacy retention window and its end date |
| `/calendar` vs `/calendar-classic` | [[PAGE_MAP]]:20-21 | Same shape as above |

Then the enumerated backlog:

- **24 routes with no inbound in-app link** ([[PAGE_MAP]]:104-132)
- **13 untraceable route components** ([[PAGE_MAP]]:151-167)
- ⚠️ **11 routes appear on both lists** — so this is **26 distinct routes**, not 37. That
  overlap is not stated in [[PAGE_MAP]] and is a correction to carry back.
- **Route ↔ module reconciliation** against 448 endpoints in 44 modules ([[ENDPOINTS]])

## How

**Verdict first, count second.** The count is a by-product. A team that reports the count
is a team that regenerates a document ([[surface-portfolio-premortem]] M1).

- **Classify all 51 before optimizing any.** A partial sheet invites cherry-picking the easy
  verdicts, which is how the number moves without the product changing.
- **Decompose every report** into killed / merged / made-reachable /
  newly-declared-intentionally-cold / still-unowned. A drop driven entirely by
  reclassification is then visible on sight (M2).
- **Every kill carries a path cross-reference.** Which `UX_PATHS_CATALOG.md` rows target this
  route, and are they deferred, shipped, or dead? A deferred path is **not** an automatic
  veto — deferred paths on an unreachable route are themselves deletion candidates, and
  saying so is this team's job. Kills touching live paths are joint decisions with
  [[ux-path-burn-down-charter]].
- **The 13 untraceable routes become a dated, named ask** to [[client-surfaces-charter]],
  not a standing observation. Until they resolve, the 39-edge navigation graph is a floor,
  not a count — navigation *out* of those pages is unrepresented.
- **Cold ≠ wrong.** `/v/:slug` (crawlable vendor portal), `/invite/:code` (emailed deep
  link), `/login`, `/register` are correctly cold. Declaring them so is a verdict with a
  reason and a re-check date, not an exemption.
- **Reconcile against modules, both directions.** A page with no module and a module with no
  page are different findings with different owners; neither is visible from the route list
  alone.

## Why now

- **This is the department's only measured metric**, and the only team with an enumerated
  backlog. First in the activation order for exactly that reason
  ([[product-vision-agenda-full]]).
- **The finding was assigned by name and has had no owner since the scan** — foundation
  [[README]]:65: *"24 routes have no inbound in-app link and 13 route components could not be
  traced… a page nobody can navigate to is either dead or undiscoverable."*
- **Two duplications are pure waste today.** `/wine-agent` and `/wineagent` are literally the
  same placeholder at two URLs. Nothing is learned by leaving them, and the cost of deciding
  is an hour.
- **Other teams are blocked on route verdicts they cannot make.**
  [[supply-discovery-charter]]'s comparison surfaces (`/distributors`, `/vendor-prices`) are
  both cold-entry ([[PAGE_MAP]]:116,130) — a perfect supply graph behind an unreachable page
  is wasted work.
- **[[ask-ai-charter]] needs to know where Ask AI lives.** Two placeholder routes plus
  `/sommelier` (`apps/web/src/App.tsx:292`) is a portfolio question before it is a design
  question.

## Next steps

- [ ] Route verdict sheet v1 — all 51 routes classified, each with a named owning module ·
      [[surface-portfolio-loops]]
- [ ] Decide the three live duplications; issue kill/merge verdicts to
      [[client-surfaces-charter]]
- [ ] Publish the decomposed metric (5 buckets), not a single number ·
      [[surface-portfolio-agenda-board]]
- [ ] File the 13 untraceable route components as a dated ask ·
      [[client-surfaces-charter]]
- [ ] Carry the 11-route overlap correction back into [[PAGE_MAP]] — 26 distinct routes,
      not 37
- [ ] Reconcile 51 routes ↔ 44 modules / 448 endpoints; list both orphan directions ·
      [[ENDPOINTS]]
- [ ] Cross-reference every kill candidate against `UX_PATHS_CATALOG.md` ·
      [[ux-path-burn-down-charter]]
- [ ] Commit to a **target number** for `surface.unowned_surface_count` — not zero, and
      publicly stated
- [ ] Raise the mobile-inventory fork: `apps/mobile` has no route map at all

## Questions for the founder

1. **Does this team have kill authority, or propose-only?** If a verdict of *kill* must be
   ratified elsewhere every time, the count will not move and
   [[surface-portfolio-premortem]] M1 is the forecast. Kill authority with a mandatory
   catalogue cross-reference is the proposed middle.
2. **What is the target for `surface.unowned_surface_count`?** Zero is wrong — some cold
   entries are correct. The team should commit to a number publicly; the founder should say
   whether that commitment is the team's to make.
3. **`/wine-agent` vs `/wineagent` — which slug?** Trivial in isolation, but
   [[ask-ai-charter]] will eventually ship something there, and picking now avoids a second
   migration.
4. **Legacy retention windows.** `/inventory-legacy` and `/calendar-classic` exist as
   fallbacks. Is there a date at which they are deleted, or do they live until someone
   complains? An undated fallback is a permanent route.
5. **Does mobile need a portfolio?** [[PAGE_MAP]] is web-only. `apps/mobile` is accumulating
   surface with no inventory. Own it here, or at [[client-surfaces-charter]]?
