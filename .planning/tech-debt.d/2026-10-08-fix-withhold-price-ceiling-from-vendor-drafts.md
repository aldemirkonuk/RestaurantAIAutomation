## A vendor-letter draft can carry the house's ceiling price — CLOSED on `fix/withhold-price-ceiling-from-vendor-drafts` — 2026-10-08

Closes the entry of the same title filed OPEN on `data/f106-reconcile-pending-drafts` (`tech-debt.d/2026-10-08-data-f106-reconcile-pending-drafts.md`, #679). The draft that was found was never sent. A read-only production count, the same day, found 0 sent or send-unconfirmed letters holding a ceiling distinct from their target. In 546 rows the ceiling equals the target (`procurement_agent.py:389`), so that figure is the price the house proposes.

**Fix.** It has two layers, both in `services/agent-orchestrator/core/house_only_figures.py`:
- **The model never sees the ceiling.** `vendor_safe_intent` removes `HOUSE_ONLY_INTENT_KEYS` (`max_acceptable_price`) before `RESPONSE_SYSTEM_PROMPT`'s `{intent_description}` is built (`provider_conversation_agent.py`, `_generate_response`). The agent's own accept test still reads the full intent.
- **A draft that states it anyway is dropped.** The model can still meet the figure in memories or history. `withheld_figures_in` finds the figure as 1199, 1,199, 1.199, 1 199 (no-break and thin spaces included), 1199.00 and 1.199,00. A separator counts as grouping only before exactly three digits, so "11,99" is not 1199. A hit replaces the draft with the fixed template, which says only the target, and sets `AuditEntry.withheld_figure_dropped`. A ceiling equal to the target is not withheld.

Stripping was chosen over passing the ceiling as a withheld instruction ("do not reveal …"), because a model can ignore an instruction. It cannot state a figure it was never given, unless it meets the figure elsewhere, which the second layer catches.

**Tests.** `tests/test_house_only_figures.py`: 17 tests. Mutations, each caught: the prompt gets the whole intent (1 fails); the output guard is off (1); no house-only key (11); a ceiling equal to the target is not skipped (1). Full orchestrator suite: 1729 passed, 55 skipped. ruff and black are clean.

**Not covered:** a figure in words ("eleven hundred"), or one the model works out ("ten percent over our target"). The other writers were checked: `email_composer_service` passes the intent *type* string, not the intent.
