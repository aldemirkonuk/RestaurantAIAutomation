## Closing note for `v3.0-TECH-DEBT.md:5505` (~~Mobile still carries the Wine Agent FAB the web shell removed~~ — CLOSED on `fix/mobile-no-wine-agent-fab` — 2026-09-28 (filed 2026-09-22))

The legacy entry at `v3.0-TECH-DEBT.md:5505` is closed in place by its struck heading; this note, filed with it, lives here because that file is frozen (ADR 0240).

**Closed 2026-09-28** (ADR 0149 row 33, mobile half; ADR 0145 status bracket). `apps/mobile/src/guidance/WineAgentFab.tsx` is deleted, its mount in `app/_layout.tsx`, its export, the `show_wine_agent_fab` / `wine_agent_fab_unlocked` state, both setters and the Help-card show/hide toggle are gone; the analytics event is renamed `wine_agent_opened`. Help and `/wine-agent` stay as plain links to web `/sommelier`. Held by `apps/mobile/src/guidance/__tests__/noWineAgentFab.test.ts` and CLAIMS `MOBILE-WINE-AGENT-FAB-IS-DELETED`. Carried from preserved snapshot 254aa76ef. The original entry follows for the record.
