---
type: fact
unit: agent-fleet
source: scripts/agents/run_card.py (2026-08-28)
confidence: measured
last_verified: 2026-08-28
---

# Fleet census 2026-08-28: 18/24 can start by default

On disk 24 · subclass BaseAgent 23 · registered 23 · OPTIONAL gated off 5 (ghost_inventory_agent, negotiation_playbook_agent, auto_pilot_agent, compliance_agent, shrinkage_detective_agent) · unregistered recurring_order_agent · dead subscribed topics —. The gate is the registry (AgentTier.OPTIONAL + is_enabled default-off), not a body heuristic — corrected 2026-08-28 after the first census measured the wrong gate and published 23 where the default-boot count matches the charter's ≈18.
