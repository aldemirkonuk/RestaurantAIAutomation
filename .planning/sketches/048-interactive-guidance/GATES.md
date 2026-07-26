# Sketch 048 · Kill / success gates

## Kill criteria (do not ship if true)

- [ ] Auto multi-step spotlights fire on every page open
- [ ] Privacy / Services UI shares a primary view with product tours
- [ ] Wine Agent FAB is unhideable or uses pulse/glow spam
- [ ] `/get-started` is still import-only on a 10s skim
- [ ] Managers cannot answer: “Does Wine Agent have my email?” (correct: **no**)

## Success criteria

- [x] Find Get Started / Learn in sidebar without hunting
- [x] `/get-started` has Activate + Use the app
- [x] Services & permissions at `/settings?tab=services` (and `/services` redirect)
- [x] Tip strip is dismissible; Learn recovers tips
- [x] FAB navigates only to `/wineagent` after activation
- [x] Consent ≠ Teaching ≠ Agent entry

## Analytics events

`tip_shown|snoozed|dismissed`, `tip_take_tour`, `tour_started|step|completed|skipped`,
`guide_card_clicked`, `wine_agent_fab_clicked`, `services_visited`, `learn_opened`
