---
type: moc
title: Scenario Map
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[HOME]]"]
---

# Scenario Map — the ritual library

> The operational plane. Each scenario is a ritual walked end-to-end through the 11-section
> [[SCENARIO-CONTRACT]]. `S02` is written in full as the template; the rest are **proposed
> stubs** — real trigger + owning modules named, the 11 sections to be filled per contract.
> Roster: founder-approved 2026-08-24 (full library build). Add/cut/re-slice as the
> product learns which rituals matter.

## The five entities × their lifecycles

The founder named the axes: restaurant · POS · customer · vendor · food — each with a
happy path and its failure. Scenarios are grouped by the entity whose event triggers them.

| ID | Scenario | Class | Trigger owner | Status |
|---|---|---|---|---|
| **Guest / customer** ||||
| S01 | Guest dines and rates | happy | [[taste-fingerprint-charter|taste-fingerprint]] | proposed |
| S07 | Guest complaint mid-service | problem | [[service-floor-charter|service-floor]] | proposed |
| S12 | Guest builds food identity over visits | happy | [[guest-identity-consent-charter|guest-identity-consent]] | proposed |
| **Vendor** ||||
| **S02** | **Vendor delivery arrives** | happy | [[inbound-understanding-charter|inbound-understanding]] | **template ✅** |
| S03 | Vendor delivery is short / wrong / damaged | problem | [[inbound-understanding-charter|inbound-understanding]] | proposed |
| S08 | Vendor price drift over time | problem | [[procurement-vendor-network-charter|procurement-vendor-network]] | proposed |
| S13 | New vendor discovery & onboarding | happy | [[supply-discovery-charter|supply-discovery]] | proposed |
| **POS** ||||
| S04 | POS order flows to inventory | happy | [[pos-bridge-charter|pos-bridge]] | proposed |
| S09 | POS webhook drops / desyncs | problem | [[connector-platform-trust-charter|connector-platform-trust]] | proposed |
| S14 | Connecting a new POS provider | happy | [[pos-bridge-charter|pos-bridge]] | proposed |
| **Restaurant / staff** ||||
| S05 | Service runs; floor is checked | happy | [[service-floor-charter|service-floor]] | proposed |
| S10 | Stockout risk before a busy night | problem | [[inventory-ledger-charter|inventory-ledger]] | proposed |
| S15 | Owner opens the weekly insight digest | happy | [[analytics-engine-charter|analytics-engine]] | proposed |
| S16 | Staff misses a table window | problem | [[service-floor-charter|service-floor]] | proposed |
| **Food / catalogue** ||||
| S06 | New dish/menu item enters the system | happy | [[catalogue-identity-charter|catalogue-identity]] | proposed |
| S11 | Waste / spoilage logged | problem | [[inventory-ledger-charter|inventory-ledger]] | proposed |
| S17 | Same product, two identities (merge) | problem | [[catalogue-identity-charter|catalogue-identity]] | proposed |

## Coverage check (Dataview — live once scenarios carry frontmatter)

```dataview
TABLE class, status, tier, sim_harness
FROM "03-scenarios"
WHERE type = "scenario"
SORT id ASC
```

Every line unit should appear as a `modules:` owner in at least one scenario. A unit
owning zero scenarios is either infrastructure or a candidate for merge — that check is
the Decision Office's, once the library is filled.

## Open

- **OD-48** — subscription tiers. The entitlement axis runs *through* §10 of each
  scenario, not through pages. Names, price points, and the core/plus/pro cut are the
  founder's; every scenario's §10 is `undecided` until then.
- **Roster sign-off** — this 17-scenario cut is proposed. Which happen, in what order,
  and whether the five-entity grouping is the right spine.
