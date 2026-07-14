# Sketch Manifest

## Design Direction
Premium B2B SaaS onboarding for restaurant operators. The visual language is Stripe/Linear/Toast-inspired: glassmorphism card, wine-burgundy primary (#CD2D5B), Plus Jakarta Sans display font, generous spacing, and confident hierarchy. The goal is that a restaurant owner's first experience with WineOps AI feels trustworthy, modern, and effortless — not like a generic auth form.

## Reference Points
- Stripe Atlas onboarding (multi-section form with progress nav)
- Linear sign-up (clean path selector, clear CTA hierarchy)
- Toast POS (restaurant-native, trustworthy B2B feel)
- Vercel deploy wizard (progressive reveal, confident step indicators)

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | path-selector | How do we create a clear, premium first impression with unambiguous path hierarchy? | A mobile / C desktop — responsive | onboarding, registration, path-selector, first-impression |
| 002 | invite-code-entry | How should the 8-char invite code input feel intentional and trustworthy? | C — Clean Input + Trust Card | onboarding, invite-code, trust, validation |
| 003 | restaurant-details-form | How do we make the dense 10-field restaurant form feel manageable, not overwhelming? | C — Left-Rail Progress | onboarding, form, restaurant-setup, progressive-disclosure |
| 004 | full-flow-synthesis | Does the full registration flow feel cohesive and premium end-to-end? | synthesis | onboarding, full-flow, wired, synthesis |
| 006 | settings-layout | Single scroll vs. left rail vs. top tabs — which structure reduces cognitive load? | null | settings, layout, navigation, feature-flags |
| 007 | locations-chains | How do chains and locations nest visually without feeling bureaucratic? | null | locations, chains, crud, interactive |
| 008 | providers-page-layout | How should the overall page hierarchy feel — flat grid, type-organized, or split-panel sidebar? | A — Editorial Grid (refined) | providers, layout, toolbar, grid, filters |
| 009 | provider-card-design | How much should a card surface at rest — actions, portfolio info, or relationship status? | A — Action-First | providers, card, grid, actions, ux |
| 010 | provider-detail-modal | What's the right modal anatomy — centered sheet, right drawer, or bottom 2-col sheet? | A — Centered Sheet | providers, modal, detail, ux, interaction |
| 016 | communications-templates | Should the templates page be a browsable library, a split panel editor, or an activity-first feed? | null | communications, templates, email, sms, library, feed |
| 020 | storage-location-layout | What layout philosophy fits 2-person AND 50-person teams — card grid, list+detail, or dashboard-first? | null | storage, layout, grid, list-detail, dashboard |
| 021 | location-card-design | How much does a location card surface at rest — minimal, data-rich, or visual/ambient? | null | storage, card, minimal, data-rich, visual |
| 022 | mobile-cellar-view | How does a cellar staff member on mobile interact — quick scan hub, compact list, or location focus? | null | storage, mobile, cellar-staff, scan, qr |
| 023 | power-user-enterprise | How do power users manage 10–20+ locations — dense table, zone tree, or kanban columns? | null | storage, enterprise, bulk, table, tree, kanban |
| 024 | new-features-integration | How do new features (health, AI auto-locate, QR/quick-add) integrate without adding noise? | null | storage, ai, qr, health, auto-locate, new-features |
| 025 | modal-layout-structure | How should the modal divide space between location list, edit form, and wine assignment? | null | storage, modal, layout, wine-assignment, split-pane, tabs |
| 026 | wine-assignment-ux | How should wine assignment (view, search, add, remove) work inside the modal without crowding the form? | null | storage, modal, wine-assignment, drawer, inline, accordion, ux |
| 027 | honest-inventory | Can /inventory earn trust — cost-based valuation, ledger explainability, unified status? | C synthesis | inventory, trust, valuation, ledger, explain, status |
| 028 | living-cellar | Can /inventory become a spatial digital twin — a living cellar that reasons about itself? | null | inventory, cellar, spatial, digital-twin, lots, vintage, topology, bold-bet |
| 029 | cellar-copilot | How does agentic inventory intelligence feel — forecasting, ABC counts, trust scores? | null | inventory, forecasting, abc, cycle-count, copilot, ghost-inventory, safety-stock |
| 030 | inventory-honest-integration | How does Sketch 027 (Honest Inventory) integrate into the real /inventory page? | null | inventory, integration, trust, valuation, ledger, explain, status, production |
| 031 | inventory-cellar-integration | How does Sketch 028 (Living Cellar) integrate into the real /inventory page as a first-class view? | null | inventory, integration, living-cellar, spatial, view-mode, production |
| 032 | cellar-map-command | Can the cellar map be an all-in-one command surface — spatial zones, at-a-glance thresholds, and a rich bin sidebar (sales heatmap, orders, one-tap reorder)? | null | inventory, cellar, map, command, threshold, heatmap, reorder, sidebar, all-in-one, production |
| 033 | notification-preferences | How should managers tune alerts — balance per-category channel power against the plain-language "instant vs. batched" model? A matrix / B sentences / C split-rail | C × B synthesis (synthesis.html) — split-rail structure, plain-language rules | notifications, settings, preferences, batching, digest, quiet-hours, channels, defaults |
| 034 | teams-page | Should /teams be a dedicated page — editorial list vs. glass cards vs. split command? Simple yet premium. | null | teams, members, invites, roles, editorial, glass, split-pane, ui-skill-consultant |
