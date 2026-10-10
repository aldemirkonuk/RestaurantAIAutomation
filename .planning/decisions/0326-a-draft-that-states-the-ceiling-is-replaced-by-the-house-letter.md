# 0326 — A draft that states the house's ceiling is replaced by the house letter

- **Status:** Proposed. Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, quoted verbatim below. This is the coordinator's call, not the founder's pick. The founder can overrule any part of it. A lock is his.
- **Date:** 2026-10-10
- **Decider:** the coordinator, under the delegation below. Built on `fix/withhold-price-ceiling-from-vendor-drafts` (PR #680).
- **Keywords:** max_acceptable_price, price ceiling, house-only figure, vendor_safe_intent, withheld_figures_in, order_letter_without_ceiling, withheld_figure_dropped, draft_generated, decision log, Level 4, F-106, RESPONSE_SYSTEM_PROMPT, replace vs refuse
- **Links:** [[0266-an-orders-vendor-letter-is-staged-once]] (the one-letter door the replacement is staged through); `services/agent-orchestrator/core/house_only_figures.py`; `services/agent-orchestrator/tests/test_house_only_figures.py`; [`../tech-debt.d/2026-10-08-fix-withhold-price-ceiling-from-vendor-drafts.md`](../tech-debt.d/2026-10-08-fix-withhold-price-ceiling-from-vendor-drafts.md) (the fix, its tests and what it does not cover); PR #679 (the F-106 dry run that found the defect and filed an OPEN entry for it); the review comments on PR #680 (at f16882e, 600a1f3, 065868d, a1cd765, and the CI review at a0c2db3, PR comment 6087212540).

## Context

On 2026-10-08 the F-106 production dry run (#679) found a waiting vendor draft that told the vendor both the house's target and its maximum acceptable price. It was never sent. The cause: `ProviderConversationAgent._generate_response` filled `RESPONSE_SYSTEM_PROMPT`'s `{intent_description}` with the whole intent, `max_acceptable_price` included. #679 filed an OPEN entry asking for such a draft to be **refused at staging**.

PR #680 settles three choices in code. Each needs a record (CLAUDE.md §0.2), and the CI review at a0c2db3 asked for one because they were written only in the defect register.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"keep working until the restaurant analytics and other pages can serve to real retaurant with every possible scenario. Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research. Do not stop until then"*

Nothing here changes a feature the founder picked. The OPEN entry's "refuse at staging" was a defect-register proposal, not a founder ruling.

## Options considered

### Fork 1: how the ceiling is kept out of the draft

1. **Pass the ceiling with a "do not reveal" instruction.** Rejected. A model can ignore an instruction; the F-106 draft is evidence that the prompt alone does not hold.
2. **Strip the key from the intent before the prompt is built** (`vendor_safe_intent`). Chosen. A model cannot state a figure it was never given in the intent. It can still meet the figure in memories or message history, so fork 2 is needed as well.

### Fork 2: what happens to a draft that states the ceiling anyway

1. **Refuse it at staging** (the OPEN entry on #679). Rejected:
   - The order is left with no letter, and nothing tells the manager why.
   - The check is a figure match, not proof of a leak: a quantity or a date can equal the ceiling. The adversarial reviewer of PR #680 at a1cd765 measured about 1-3% of ordinary drafts matching this way, and the cent forms raise it (for quantities, 0.92% to 1.37%). That table was not reproduced by the gate's other reviewers or by the fixer. Refusing would leave that share of orders letterless.
2. **Replace it with the house letter** (`order_letter_without_ceiling`): a fixed inquiry built from the `wine_name`, `quantity` and `target_price` fields, without the house-only keys. It has no `target_price_per_bottle` fallback, so an intent with only that key gets no target line. Chosen. The replacement is built without the house-only keys, and it is staged exactly as a model draft is: all three `_generate_response` callers stage the result for approval (`session.status = "paused_for_approval"`, row status `PENDING_APPROVAL`), so a person sees it before any vendor does. Only the drafting caller (`provider_conversation_agent.py:894`) passes an intent that can hold the ceiling.
3. **Do nothing.** The prompt keeps carrying the ceiling, and the next model draft can state it.

### Fork 3: the Level-4 `draft_generated` decision-log entry for a replaced draft

On 2026-10-10, a grep of `.planning/decisions/` for "Level-4", "Level 4", "draft_generated" and "decision log" found no ADR governing Level-4 decision-log coverage, only unrelated uses. That is a dated observation, not a standing claim; an ADR that later rules on that coverage supersedes fork 3. On that evidence this was treated as a fork of its own.

1. **Skip the entry for a replaced draft** (the a0c2db3 code: an early `return`). Rejected. The log would go silent on exactly the branch where the guard fires.
2. **Log the model's draft as before.** Rejected. Its preview would copy the ceiling into `decision_log`.
3. **Log the staged letter, marked as replaced, with the matched key names only.** Chosen: `inputs.withheld_keys` lists key names (`["max_acceptable_price"]`), `output.replaced_by_order_letter` is `true`, and `output.draft_preview` is the staged letter. No value is logged.

## Decision

Strip the house-only key from the prompt's intent; when a draft still states its figure in a covered form, stage the house letter in its place, record `withheld_figure_dropped` in `constraint_flags.audit_trail`, and, under Level 4, write the `draft_generated` entry for the letter with key names only.

The reasoning that carried it: the replacement keeps the order moving and still goes through approval, while refusal turns every coincidental match into a stuck order with no visible reason.

## Consequences

- An order never loses its letter to this guard. A vendor who would have received a tailored draft receives the plainer house letter in about 1-3% of ordinary drafts (adversary's estimate). That estimate does not cover matches tied to the ceiling. The gateway's two writers (`procurement.service.ts:4201`, `communications.controller.ts:895`) set the ceiling to the target × 1.1, so a round target gives a whole-number ceiling. Measured on 2026-10-10 with `withheld_figures_in`: of the integer targets 8 to 120, the 12 multiples of 10 do (ceilings 11, 22, ... 132). For each of them, a draft that states that number (as a quantity of bottles, for example) is replaced. As a day of the month, this happens only for targets 10 and 20 ("October 11", "October 22"). A target of 1800 gives 1980, which matches "the 1980 vintage". When the order's quantity equals the ceiling, every draft that states the quantity is replaced, and the letter itself states the figure, as the quantity. The letter is staged as it is and is not checked again, so there is no loop: one model call, one letter, one Level-4 entry (`test_a_letter_that_itself_holds_the_figure_is_staged_once`). None of these leaks the ceiling, since the figure is the order's own quantity, vintage or date. The session gate's adversary at d58e635 (gate run 6) measured these slices on its own synthetic corpus: seed 680, with drafts carrying a quantity, a per-case count, a vintage from 1995 to 2023, a "by <month> <day>" date and the target. With quantities drawn uniformly from 1 to 100 (200 drafts per target, seed 680), 1.08% of the drafts for the multiples-of-10 targets were replaced: 5.0% at 10, 4.5% at 20, 1.5% at 60, 0.5% at 30 to 50 and 0% from 70 up. Across all integer targets 8 to 120 it was 0.11%. An exact enumeration of the same draft model on 2026-10-10 (every quantity 1-100, day 1-31, vintage, case size and month, checked with `withheld_figures_in` at e32deb2) gives the expected rates:
  - Targets 10 and 20: 4.19% (1 - 99/100 × 30/31). A quantity (1 in 100) or a delivery day (1 in 31) equals the ceiling, 11 or 22. This is structural.
  - Targets 30 to 90: 1.00%, from the quantity alone (ceilings 33 to 99 are past every day of the month). The sampled spread of 0% to 1.5% is sampling noise; quantities 77, 88 and 99 do match targets 70, 80 and 90.
  - Targets 100 to 120: 0%. The ceilings 110, 121 and 132 are above every quantity in the model. This is structural.
  - Across the twelve multiples of 10 that is 1.28% expected, against the 1.08% sampled. The non-multiples enumerated (11, 15, 37, 77) give 0%.
  With quantities from a set of 6 to 96, 0.05% were replaced overall, all at targets 10 (2.0%) and 20 (4.0%), through the day of the month. That corpus is the adversary's model of a draft, not production drafts. A draft that restates the vendor's own price is also replaced when that price equals the ceiling. Nothing leaks, since the vendor named the figure, but no rate was measured for that case.
- `withheld_figure_dropped` is stored in `constraint_flags.audit_trail` and, under Level 4, the decision log carries `withheld_keys`, but **no screen reads or shows either**. A manager approving the letter is not told it replaced a model draft.
- There is no flag to turn the replacement off without a revert.
- Revisit if: the measured replacement rate in production is materially above 3%; a screen starts showing staged drafts' audit trails (then show the drop there); or the founder rules that a matched draft should be refused or flagged instead.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-10-08 | PR #680 fixer | Strip and replace built; rationale written only in `tech-debt.d` |
| 2026-10-09 | Review of PR #680 at a1cd765 (PR comment 6086703354) | Measured the 1-3% replacement rate; noted `withheld_figure_dropped` is not shown; noted replace-vs-refuse has no ADR |
| 2026-10-10 | CI review of PR #680 at a0c2db3 (PR comment 6087212540) | Both choices were recorded in the defect register, not here; the early return skipped the Level-4 entry with no decision cited |
| 2026-10-10 | CI review of PR #680 at a048c12 (PR comment 6094034705) | The fix's defect-register entry depended on #679 merging first and cited #679's entry by a path not on `main`; this ADR's Links line had the same path |
| 2026-10-10 | Session review of PR #680 at d5804bc | The spend-ledger test could not see call order; the 1-3% rate left out matches tied to the ceiling; the speed-ratio range was narrower than measured |
| 2026-10-10 | Session review of PR #680 at d58e635 (gate run 6) | Overturned on prose: a stale mutation count, the speed-ratio data credited to the wrong round, and "target fields" broader than `target_price`; the adversary measured the tied-to-ceiling slices recorded under Consequences |
| 2026-10-10 | The coordinator, under the delegation | Created as Proposed; fork 3 decided and built (the entry is now written for a replaced draft, key names only) |
