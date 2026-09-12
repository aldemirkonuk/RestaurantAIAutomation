# Self-Learning UX Agent (in-product runtime)

> **Status:** Foundation shipped (dark). Backend loop is live behind a kill
> switch; live UI application is gated on human approval per change.
> **Code:** `apps/api-gateway/src/ux-optimizer/*`, `apps/web/src/lib/uxSignals.ts`,
> `apps/web/src/hooks/useUxOverrides.ts`, migration
> `supabase/migrations/20260720130000_ux_optimizer.sql`.

## What it is

An in-product agent that continuously improves the WineOps web app toward
state-of-the-art usability. It runs the loop:

```
observe → propose → (human approves) → serve gated override → measure → learn
```

1. **Observe** — the web reports real friction telemetry (rage clicks, dead
   clicks, abandons, slow time-to-interactive, task failures) to
   `POST /ux/signals`. No PII: a page key, an event type, an optional element
   key, and a value.
2. **Propose** — `POST /ux/proposals/:page` aggregates the friction summary and
   reasons over it against an explicit **SOTA usability rubric** (Hick, Fitts,
   Doherty, WCAG 2.2, latency budgets, reversibility, consistency). With an
   `ANTHROPIC_API_KEY` it uses `claude-haiku-4-5`; otherwise a deterministic
   heuristic generator produces the same proposal shape. **Proposals are never
   applied automatically.**
3. **Approve** — `POST /ux/proposals/:id/review` is the only path that can touch
   the live product. A human approves or rejects; approval writes a
   **rollout-gated override** (default 10%).
4. **Serve** — the web calls `GET /ux/overrides?page=&sessionId=` via
   `useUxOverrides(page)`. Overrides are bucketed deterministically by session,
   so an approved change reaches only its rollout percentage. Returns `[]`
   unless `UX_OPTIMIZER_ENABLED=true`.
5. **Measure & learn** — `evaluateOverride` compares friction before/after,
   writes the verdict to the append-only `ux_learnings` ledger, and
   **auto-reverts clear regressions** (safe direction only). The ledger is the
   agent's self-learning memory, re-read each cycle.

## Guardrails (why this is safe to ship)

Mirrors the procurement "never auto-send" ethos already in the product.

- **`AUTO_APPLY = false`** — a hard-coded constant. The agent cannot ship its
  own proposals; a human reviews every one.
- **Kill switch** — `UX_OPTIMIZER_ENABLED` defaults to `false`. The whole
  feature is dark until deliberately enabled; `GET /ux/overrides` returns `[]`.
- **Gradual rollout** — approved changes ship at `UX_OPTIMIZER_DEFAULT_ROLLOUT`
  (10%) and are promoted manually.
- **Reversible** — every override is `enabled=false`-able; `rollback` reverts and
  logs a learning. Regressions auto-revert.
- **Bounded surface** — the agent may only target a stable `target_key` the web
  already knows how to render, and only `kind ∈ {copy, default, surface,
  affordance, layout}`. It proposes copy/defaults/emphasis, **not arbitrary DOM
  edits**. Nothing destructive; never removes undo/confirm.
- **Grounded** — every proposal cites a number from the friction summary; no
  invented metrics.

## Data model (`20260720130000_ux_optimizer.sql`)

| Table | Role |
|-------|------|
| `ux_signals` | raw friction telemetry (page, event, target_key, value, session) |
| `ux_proposals` | agent-proposed changes — **proposed only** until reviewed |
| `ux_overrides` | approved, gated runtime overrides the web reads |
| `ux_learnings` | append-only ledger of hypotheses + measured outcomes |

## API surface (`/api/v1/ux/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/ux/signals` | ingest a friction signal (sendBeacon) |
| GET | `/ux/overrides?page=&restaurantId=&sessionId=` | gated overrides for the web |
| GET | `/ux/summary/:page` | aggregated friction |
| POST | `/ux/proposals/:page` | agent proposes improvements (no apply) |
| GET | `/ux/proposals?status=&page=` | review queue |
| POST | `/ux/proposals/:id/review` | approve (gated ship) / reject |
| POST | `/ux/proposals/:id/rollback` | revert a live change |
| GET | `/ux/learnings?page=` | self-learning ledger |

## Web integration

- `attachFrictionDetectors(page)` + `reportTti(page)` — auto-detect rage/dead
  clicks and slow first paint. **No-op unless `VITE_UX_OPTIMIZER=true`.**
- `useUxOverrides(page)` — components ask `override(targetKey)` for a live patch;
  they render exactly as today when none is live. Wiring detectors + reading
  overrides is one hook call per page.
- Mark elements the agent may target with `data-ux-key="..."` so hotspots and
  overrides bind to a stable key rather than a brittle CSS path.

## Rollout plan

- **Phase A (shipped):** schema, backend loop, guardrails, web client — dark.
- **Phase B:** turn on telemetry in staging (`VITE_UX_OPTIMIZER=true`), gather a
  week of signals, review the first agent proposals in a small admin panel.
- **Phase C:** wire `useUxOverrides` into 1–2 high-traffic pages
  (Recommendations, Inventory) reading `copy`/`emphasis` patches only; approve a
  first change at 10%; watch `ux_learnings`.
- **Phase D:** widen `kind` coverage and pages once the measure→learn loop has a
  track record; add a scheduled `evaluateOverride` sweep.

## Open decisions

- Admin review UI: a dedicated `/admin` tab vs a lightweight standalone page.
- Whether org-level (`restaurant_id = null`) proposals require a stricter
  approval than per-restaurant ones.
- Signal sampling rate + retention policy for `ux_signals` at scale.
