---
type: schedule
division: product
department: product-vision
team: surface-portfolio
status: provisional
metrics: [surface.unowned_surface_count, surface.untraceable_route_components]
updated: 2026-08-24
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-agenda-board]]", "[[product-vision-schedule]]", "[[client-surfaces-charter]]", "[[ux-path-burn-down-charter]]"]
---

# Surface Portfolio — Schedule & Skills

## Recurring work

Every job here is **runnable today** — no blockers, no suspended rows. That is what makes
this team first in the department activation order, and it is also why an empty close-time
here has no excuse attached to it.

| Cadence | Job | Emits |
|---|---|---|
| **Monthly** | **Route portfolio regeneration + verdict diff.** Regenerate [[PAGE_MAP]] from `apps/web/src/App.tsx`, then diff against the verdict sheet. **The diff is the deliverable**; the regeneration alone is [[surface-portfolio-premortem]] M1. | `surface.unowned_surface_count` (decomposed into 5 buckets) |
| **Monthly** | **Route ↔ module reconciliation.** Cross-check 51 routes against 448 endpoints in 44 modules; report both orphan directions separately. | `surface.routes_without_owning_module`, `surface.modules_without_a_page` |
| **Monthly** | **Untraceable-component ask review.** Every one of the 13 has a named owner at [[client-surfaces-charter]] and a date, or it escalates. | `surface.untraceable_asks_open`, `surface.untraceable_asks_past_due` |
| **Monthly** | **Duplication watch.** Any new pair of routes rendering the same component. Today: 3 pairs. | `surface.live_duplications` |
| **Quarterly** | **Cold-entry re-check.** Every *intentionally-cold* verdict past its re-check date is re-decided. No permanent exemptions. | `surface.cold_rechecks_overdue` |
| **Quarterly** | **Mobile-gap review.** How many `apps/mobile` screens shipped since the gap was raised, and is it time to inventory them? | `surface.mobile_routes_shipped_since_gap_raised` |
| **On change** | **New-route intake.** A `<Route>` added to `App.tsx` without a verdict and a named owning module is a finding in the next close-time — this is how 24 orphans accumulated the first time. | — |

**Anti-sprawl rule:** a scheduled job producing no action for **3 consecutive runs** is
downgraded or deleted. Applied here with a sharp edge: if the monthly regeneration produces
no verdicts three times running, the failure is **the team, not the job**, and the
escalation named in [[surface-portfolio-directive]] fires rather than the job being quietly
retired. Deleting the measurement because the work stalled is the worst available outcome.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion. Per
foundation §3.3 each names a trigger, doneability criteria, a **real past instance**, and an
owner. The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`) — everything below is **proposed, not built**.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `route-portfolio-verdict` | T2 | Monthly, or when `apps/web/src/App.tsx` changes | Every route carries exactly one verdict and a named owning module; new routes since last run are listed by name; *unclassified* is reported, never absorbed | The 24 orphan routes and 13 untraceable components have sat unowned since the 2026-08-24 scan (foundation [[README]]:65). Nothing currently notices a new orphan being created |
| `route-map-regen` | T3 | Monthly, or on `App.tsx` change | Regenerates [[PAGE_MAP]] and emits the **diff** against the previous run, not just the new document | [[PAGE_MAP]] is already a generated grep-target (CLAUDE.md §2 lists it as regenerated rather than hand-edited); what is missing is the diff that makes a change visible |
| `route-module-reconcile` | T3 | Monthly | Two lists: pages with no module, modules with no page — each entry naming the counterpart evidence in [[ENDPOINTS]] | `/authorize/:integrationId` is both cold-entry ([[PAGE_MAP]]:110) and untraceable (:155) while its module (`integrations/`) has 5 well-guarded endpoints — a live example of capability with an orphaned surface |
| `duplicate-route-detect` | T3 | On `App.tsx` change | Any two routes resolving to the same component are reported with both paths | `/wine-agent` and `/wineagent` both render the same inline `PlaceholderPage` (`App.tsx:293-294`, `:349`) and shipped that way unnoticed |

**Deliberately not proposed:**

- **No automated route deletion.** Killing a page is a product verdict a human signs, with a
  catalogue cross-reference attached. Automating it would make
  [[surface-portfolio-directive]]'s cross-reference rule optional in practice.
- **No path-burn-down skill.** That is [[ux-path-burn-down-charter]]'s ledger, and a skill
  here would blur the one boundary this team most needs to keep sharp: whether a page should
  exist versus what happens on it.
