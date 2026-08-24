---
type: schedule
division: product
department: partnerships-integrations
team: connector-platform-trust
status: partial
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[connector-platform-trust-charter]]"
  - "[[connector-platform-trust-loops]]"
  - "[[connector-platform-trust-directive]]"
  - "[[partnerships-integrations-schedule]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[engineering-charter]]"
---

# Connector Platform & Trust — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Ingress guard — a route in an ingress-classified module with no verification call, or no classification at all, **fails the build** | L1 |
| **Per scope change** | Consent review **as rendered**, not as source | L3 |
| **Per credential-storing PR** | Credential-path check — one path, or a documented exception with a named owner | L2 |
| **Weekly** | Inventory regeneration + reconciliation; confirm the guard is still wired | L1, `pi.verified_ingress_ratio` |
| **Bi-weekly** | Coordination with [[perimeter-ingress-integrity-charter]] — standing slot, not an escalation. Includes the metric-overlap check | L5 |
| **Monthly** | Credential lifecycle — paths in use, unencrypted count, stale connections | L2 |
| **Quarterly** | Connector deprecation review — dead credentials, unused connections | L2 |
| **Quarterly** | External surface — 80 env vars, third-party hosts, placeholder domains in production paths | L4 |

**Anti-sprawl, applied to ourselves.** A job producing no action for 3 consecutive runs is
downgraded or deleted. Named in advance:

- **The quarterly external-surface review** is the most likely to trip it. If
  `hosts.placeholder_in_prod_path` reads 0 for three quarters, it is **downgraded to a CI check
  and deleted as a scheduled job.** A quarterly review that always reads zero is exactly what
  the rule is for.
- **The weekly inventory reconciliation** should trend toward no-action once the guard is
  wired — that is success, not failure. When it does, it drops to monthly rather than being
  deleted, because it is the check that the check still exists.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet** — the repo has one project skill total
(`.agents/skills/railway-config/SKILL.md`, foundation §3.1). Per foundation §3.3 each names a
trigger, doneability criteria, and a real past instance.

| Skill | Trigger | Done when | Real past instance | Tier |
|---|---|---|---|---|
| `ingress-route-audit` | A route is added or changed in any ingress-classified module | Every route classified ingress / management / simulator / public-content; each ingress route's posture stated with `path:line`; unclassified routes fail | **Yes, twice over.** It produced this session's correction that *"0 of 32 verify"* (`product.md:783`) is false, and found `toast.service.ts:189` invoking its verifier only `if (signature && timestamp)` — a fail-open call site in front of a fail-closed helper | T2 |
| `connector-trust-contract` | A new connector is proposed, or an existing one changes auth | A written contract exists — data in, data out, auth model, verification, failure posture, deprecation path — co-signed with Security | **Yes, negatively.** `integrations/` has 2 providers and **no written contract for either**; `pos-hub` and `toast` have contradictory failure postures precisely because no contract governs them | T2 |
| `credential-path-check` | Any PR that stores a credential or token | The credential lands in the single approved path, or the exception is documented with a named owner | **Yes, imminent.** Square and Clover are both blocked on merchant tokens (`pos-provider.registry.ts:76, :88`) while `IntegrationProvider` is `"google" \| "microsoft"` (`integrations-oauth.constants.ts:1`) — the second path is about to be created, and this skill is what catches it | T2 |
| `consent-surface-review` | Any change to `integrations-oauth.constants.ts` scopes | The consent surface is reviewed **as rendered**; scope disclosure matches what is requested | **Yes.** `/authorize/:integrationId` has no inbound link (`PAGE_MAP.md:110`) **and** an untraceable route component (`PAGE_MAP.md:156`) — the consent screen is already unreachable and unanalysable, today | T2 |

**Honest note.** All four cite a real, current defect rather than a hypothetical — which is a
fair reflection of this team's grade (PARTIAL: real substrate, real sized gaps). The strongest
is `ingress-route-audit`; it has already produced two findings before the team formally exists.

**Deduplication flag, stated in advance.** `ingress-route-audit` overlaps
[[perimeter-ingress-integrity-charter]]'s mandate. The split we are committing to: **this skill
produces the classification and the contract; Security's equivalent measures enforcement.** If
they converge on the same output, **ours is deleted, not theirs.** Same rule as the metric
([[connector-platform-trust-directive]] Graph B).

## Deliberately not scheduled

- **A second signature-verification implementation.** [[perimeter-ingress-integrity-charter]]
  owns the control. Duplication is [[connector-platform-trust-premortem]] M2, and it is the
  most likely harm caused by this team simply existing.
- **CORS and rate-limiting review.** Named explicitly in SEC-2's mandate.
- **`JwtAuthGuard` coverage sweeps.** [[access-control-tenant-isolation-charter]]'s (SEC-1),
  under OD-19. We classify; they cover.
- **Hand-maintaining the ingress inventory.** It is generated. Scheduling its maintenance
  would be scheduling the failure ([[connector-platform-trust-premortem]] M3).
