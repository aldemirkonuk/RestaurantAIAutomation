---
type: schedule
division: product
department: product-vision
status: provisional
metrics: [surface.unowned_surface_count, askai.entry_point_count, inbound.false_accept_count]
updated: 2026-08-24
links: ["[[product-vision-charter]]", "[[product-vision-loops]]", "[[product-vision-agenda-board]]", "[[decision-office-charter]]", "[[surface-portfolio-schedule]]", "[[inbound-understanding-schedule]]", "[[ask-ai-schedule]]", "[[service-floor-schedule]]", "[[supply-discovery-schedule]]"]
---

# Product & Vision — Schedule & Skills

## Recurring work

| Cadence | Job | Owner | Emits |
|---|---|---|---|
| **Daily** | **Open-decision queue digest** — what is blocking whom, and for how long. Assigned to this department by name (foundation [[README]] §6). Runs as a job, not a team ([[decision-office-charter]] owns the register itself). | Department | — |
| Weekly | **Ask AI entry-point drift check** — grep for new AI entry surfaces outside the one action schema. Today: 4 divergent (`AICommandPalette.tsx:191`, `Reports.tsx:959`, `WineAgentFab.tsx`, `SommelierAI.tsx`) + 2 placeholder routes. A 5th appearing is the signal in [[ask-ai-premortem]]. | [[ask-ai-charter]] | `askai.entry_point_count` |
| Weekly | **False-accept audit sweep** — sample accepted inbound proposals whose downstream record was later corrected. This is the number that keeps acceptance honest. | [[inbound-understanding-charter]] | `inbound.false_accept_count`, `nf_a.outcome` |
| Monthly | **Route portfolio regeneration + verdict diff** — regenerate [[PAGE_MAP]], then diff against the verdict sheet. The **diff** is the deliverable; the regeneration alone is [[product-vision-premortem]] M4. | [[surface-portfolio-charter]] | `surface.unowned_surface_count` |
| Monthly | **POS input audit** — per provider in `pos-provider.registry.ts`, does it emit `table_id`, `server_name`, and a kitchen-ready signal? Two counters, both currently 0. | [[service-floor-charter]] | `floor.providers_emitting_*` |
| Monthly | **Supply freshness sweep** — price age p50 across matched SKUs, plus denominator size. Blocked until a needed-SKU list exists. | [[supply-discovery-charter]] | `supply.price_freshness_p50_days` |
| Monthly | **Agenda sync** — full vs board agendas drifted? Anything untouched in 60 days is either finished or fiction (foundation §3.3, §6). | Department | — |
| Quarterly | **Settled-decision integrity check** — has anything crept toward superseding [[AGENT_NATIVE_UI_DECISION]] §3 or the A15 dish-identity deferral without an ADR? | Department | — |

**Anti-sprawl rule:** a scheduled job that produces no action for **3 consecutive runs** is
downgraded or deleted. The two most likely candidates here are the monthly supply freshness
sweep (blocked on a denominator) and the monthly POS input audit (blocked on a provider) —
both should be *suspended with a named unblocker* rather than run empty, which is itself
the honest form of the downgrade.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion. Per foundation §3.3, every skill must name its trigger, its doneability criteria,
a **real past instance** where it would have helped, and its owning department — no
speculative skills.

> **State today:** the repo has exactly **one** project skill
> (`.agents/skills/railway-config/SKILL.md`, foundation [[README]] §3.1). Everything below
> is **proposed, not built**, and each entry names the past instance that justifies it.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `route-portfolio-verdict` | T2 | [[PAGE_MAP]] regenerated, or a new `<Route>` added to `apps/web/src/App.tsx` | Every route has a verdict (keep/merge/kill/reachable/intentionally-cold) and a named owning module | The 24 orphan routes and 13 untraceable components have existed since the 2026-08-24 scan with no owner ([[PAGE_MAP]]:104-132, :151-167) |
| `action-allowlist-review` | T2 | Any diff touching the Ask AI allowlist file or a new AI entry surface | Diff has a typed schema, a refusal test, and an audit row; otherwise it fails | `/wine-agent` and `/wineagent` shipped as two duplicate placeholders (`App.tsx:293-294`) — divergence already happened once with no gate |
| `inbound-gate-conformance` | T3 | A confidence constant or approval component is added under `procurement/documents/` or `communications/` | Every gate reads the shared contract; a second threshold constant fails the check | Three inbound modules already ship independently (`document-extractor.service.ts`, `gmail-watch.service.ts`, `recurring-orders.controller.ts`) with no shared standard |
| `pos-input-audit` | T3 | Monthly, or when `pos-provider.registry.ts` changes | A table of provider → fields emitted, with `table_id`/`server_name`/kitchen-ready explicitly marked | `server_name`, `covers`, `table_id`, `total` were found 0-of-47 only because someone grepped the migration by hand |
| `open-decision-digest` | T2 | Daily | Every open decision has an owner, an age, and a named unblocker; ones without are listed first | `teams/product.md` §6 filed five forks under IDs already in use (OD-20…OD-23) — the register drifted because nothing read it daily |

**Deliberately not proposed:** a `sketch-to-spec` or `ux-path-burn-down` skill — those
belong to [[design-charter]]'s teams, not here. And no skill that automates route deletion:
killing a page is a product verdict a human signs, which is the whole point of
[[surface-portfolio-charter]].
