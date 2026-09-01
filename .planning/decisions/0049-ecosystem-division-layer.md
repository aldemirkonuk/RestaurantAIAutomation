# 0049 — The ecosystem is layered into eight divisions

- **Status:** Locked
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder), 2026-09-01, in-session via AskUserQuestion
- **Keywords:** ecosystem, divisions, taxonomy, POS, restaurant, vendor, customer, sommelier, intelligence, platform, agent fleet, ECOSYSTEM-PLAN
- **Links:** [ECOSYSTEM-PLAN.md §3a](../04-specs/ECOSYSTEM-PLAN.md), [[0001-mudavym-single-entity]], [[0007-org-structure]], [[0039-activation-plan-of-record]]

## Context

The founder asked for the ecosystem to be "layered in divisions" — Restaurant,
Customer, Vendor, and POS named as musts, plus Sommelier — with the codebase checked
for any further divisions the taxonomy needs. The ecosystem plan of record
(`.planning/04-specs/ECOSYSTEM-PLAN.md`, PR #159, 2026-08-28) already existed and is
detailed, but is organized as **four segments** (POS / Restaurant ops /
Sales-analytics / Customer): Vendor had no division of its own (buried inside the
buy-side loop) and Sommelier appeared nowhere, despite `sommelier_agent.py`, the
`wines` gateway module, and the sommelier/wine-agent pages all existing on main.

A survey of `origin/main` (`apps/api-gateway/src/*`, `services/*`,
`services/agent-orchestrator/agents/*`, `.planning/06-pages/*`) surfaced three areas
that fit none of the five named divisions: the analytics/intelligence engine, the
platform layer (auth, team, orgs, settings — where the auth-by-omission fault lives),
and the Python agent fleet (where the two-runtime split lives).

## Options considered

1. **Stop — the plan is enough.** The founder's own standing rule ("if there is a
   plan already, then just stop"). Rejected because the plan lacked exactly the
   division taxonomy being asked for — this was the "plan exists but without the
   details" branch of the same instruction.
2. **Restructure the whole plan around divisions.** Divisions become the top-level
   chapters. Rejected: the segment frame carries the evidence and the founder-locked
   E1-after-E0 sequencing; re-anchoring all of it buys nothing the lens doesn't.
3. **Five divisions only.** Fold analytics into Restaurant and treat platform and
   agents as unnamed infrastructure. Rejected by the founder: all three
   codebase-derived candidates were promoted to divisions.
4. **Amend with an eight-division layer.** ✅ Chosen.

## Decision

The Mudavym ecosystem is layered into **eight divisions**: the five founder-named
musts — **Restaurant, Customer, Vendor, POS, Sommelier** — plus three the codebase
demanded — **Intelligence/Analytics, Platform/Admin, Agent fleet/runtime**. The layer
is recorded as **§3a of ECOSYSTEM-PLAN.md**, an *amendment*: the four-segment frame,
the 10-hop spine, and the locked phase ordering stand unchanged, and each division row
maps onto them. Tie-break rule for module assignment: primary consumer wins;
genuinely cross-cutting infrastructure sits in Platform/Admin.

## Consequences

- Vendor and Sommelier are now named surfaces of the ecosystem, not implicit parts of
  other segments — future scoping (agendas, phases, page work) can reference a
  division without re-deriving what it owns.
- The two carve-outs (Vendor out of Restaurant ops' buy-side; Sommelier out of
  Sales/analytics) change *naming only*, not ownership of the underlying gaps — every
  §3 verdict keeps its original segment anchor.
- No `OPEN-DECISIONS.md` row is added (the decision is closed at birth; adding a
  register row re-anchors citations per ADR 0025).
