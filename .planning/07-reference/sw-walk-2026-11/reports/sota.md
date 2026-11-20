# Reports and analytics: state of the art, 2025–2026 (short)

Scope: what restaurant and operations analytics products and dashboard tools do now, and what /reports should take from them. The sources are mostly vendor pages, so read the claims as vendor claims.

## Restaurant products

- **Toast IQ.** Toast's assistant answers operators' questions in plain language. Toast reports over 125,000 locations using it in Q1 2026. Sales and revenue questions are 47% of what operators ask, and labor is 13%. The reporting reads Toast data only.
  - Takeaway: the question-first entry (AskTheBook) is the right bet. The sales register should be the strongest one.
  - Source: Toast trends coverage ([pulse.bot](https://www.pulse.bot/hotels/news/margin-protection-emerges-as-top-use-case-for-toast-iq-968af2ae-da21-473b-9358-4b17b641dbe7/), [Restaurant Technology News](https://restauranttechnologynews.com/2025/12/toast-signals-next-phase-of-restaurant-technology-competition-with-expanded-focus-on-ai-driven-operations/)).
- **Restaurant365 AI dashboards.** These are dashboards you build yourself, with AI-generated trends and **what-if scenarios** ([restaurant365.com](https://www.restaurant365.com/inventory/intelligence/)). Reviewers rank Toast's dashboards slightly ahead and R365's reporting deeper ([G2](https://g2.com/compare/restaurant365-vs-toast)).
  - Takeaway: the goals desk's scenario request (`useGoalsDesk.ts:331`) is on trend.
- **MarginEdge.** It produces a **daily P&L and a prime-cost view** from POS sales and labor plus invoices ([Toast support: MarginEdge integration](https://support.toasttab.com/en/article/Get-Started-With-the-MarginEdge-Integration)).
  - Takeaway: the ledger cutting should read daily and in the house's day (G7), and it cannot be capped at 1000 orders (G6).

## Dashboard patterns

- **Full-screen panel view (Grafana).** Any panel opens in a view mode with a side panel to adjust it. Changes made there do not touch the saved dashboard, and no edit right is needed ([Grafana panel overview, v13.3](https://grafana.com/docs/grafana/v13.3/visualizations/panels-visualizations/panel-overview/)).
  - Takeaway for G4: add a "Lay it out flat" view per cutting, a full-width route or overlay that does not change the sheet, with the window and graph controls inside it.
- **Two layout modes (Grafana dynamic dashboards, GA April 2026).**
  - *Auto grid*: set a minimum column width and a maximum number of columns, and panels reflow to the screen.
  - *Custom*: place each panel by hand on a drag grid.
  - Source: [Grafana what's new](https://grafana.com/whats-new/2026-04-08-dynamic-dashboards-is-now-generally-available/).
  - Takeaway for G1: phones should get auto-flow (a single column in sheet order) and should not write coordinates. Only the wide ruling should be hand-placed.
- **react-grid-layout responsive contract.** `layouts` is keyed by breakpoint, and `onLayoutChange(current, allLayouts)` hands back every breakpoint so each can be saved separately ([RGL README mirror](https://github.com/revskill10/react-grid-layout)).
  - Takeaway for G1: either persist `allLayouts` per breakpoint, or keep arranging off below `md` and only ever save `lg`.

## What best-in-class does that /reports does not yet

1. A full-screen or expanded chart (G4).
2. A layout per screen size, or auto-flow on phones (G1).
3. Saves that confirm only after they land (G3).
4. Period comparison: this week against last week and the same week last year (G19).
5. Money in the house's currency (G5).

## Limits of this research

One quick search per area was run. It found nothing usable on Tenzo's or Metabase's current dashboard docs, and no product was tried hands-on.
