# 0010 — Replace retired Gemini models; correct the spend table that hid the cost

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder) — model choice and scope both called by the founder
- **Keywords:** gemini, model retirement, gemini-2.0-flash, gemini-pro, spend, pricing, thinking tokens, neural footprint, email classification
- **Links:** [[0006-neural-footprint-architecture]], [[0008-nf-column-contract]], `services/agent-orchestrator/services/spend_logger.py`, `.planning/v3.0-TECH-DEBT.md`

## Context

Smoke-testing the P1 neural-footprint emitter surfaced two dead model ids in
`services/agent-orchestrator`. Both were verified against the live API on
2026-08-24, not inferred:

1. `config/settings.py:170` defaulted `GEMINI_MODEL` to `gemini-2.0-flash`.
   Google **shut that model down on 2026-06-01**; a real call returns
   `404 NOT_FOUND … no longer available`. Neither `.env` in the checkout sets
   `GEMINI_MODEL`, so the dead default was live. `EmailIntelAgent._classify_email`
   failed all 3 retries and dead-lettered every inbound message — the whole
   inbound-email classification path was down.

2. `agents/calendar_agent.py::_call_llm_for_dates` used the legacy
   `google.generativeai` SDK pinned to `gemini-pro` (also 404). It was worse than
   reported: it **never called `genai.configure()`**, so it had no API key either.
   Both failures landed in a broad `except Exception` that falls back to regex, so
   this path had silently been regex-only since it was written — no error ever
   surfaced.

Verifying the cost delta then exposed three defects in the spend ledger itself,
which mattered more than the model swap:

- **The pricing table was wrong, not merely incomplete.** `_RATES_PER_M` priced
  `gemini-2.5-flash` at `(0.075, 0.30)`. The real rate is **`(0.30, 2.50)`** —
  understating input 4x and output **8.3x** across every 2.5-flash call site
  (`vlm_extraction_service`, `wine_matcher`, `wine_field_parser`, `web_crawler`,
  the research cascade). A unit test asserted the wrong number, freezing the bug in.
- **Lite ids resolved to the full-flash row.** Lookup iterated the dict in
  insertion order using substring matching, and `"gemini-2.5-flash"` is a
  substring of `"gemini-2.5-flash-lite"`. *Corrected after review:* this was not
  a costly historical bug — under the old table both rows read `(0.075, 0.30)`,
  so the collision under-priced lite by ~25%, and no live call site passed a lite
  id at all. It matters because the **corrected** table separates them sharply
  (`0.10/0.40` vs `0.30/2.50`), so shipping the new rates without longest-match
  lookup would itself have introduced a 6.25x over-charge on lite output. The fix
  is a guard against a bug this change would have created, not a repair of one it
  found.
- **Thinking tokens were never counted.** All 18 Gemini call sites logged
  `candidates_token_count` as output. Google bills `thoughts_token_count` at the
  output rate but reports it in a separate field. Measured on the real
  `EmailIntelAgent` prompt: `gemini-2.5-flash` billed **598** output tokens while
  logging 113 (5.3x); `gemini-3.6-flash` billed 680 while logging 73 (9.3x).

The brief that opened this work stated `is_priced_model()` already guarded
unpriced models by writing NULL plus `context.cost_basis='unpriced_model'`.
**That function did not exist on any branch.** An unpriced model booked a false
`$0.000000`, which is indistinguishable from a genuinely free call.

## Options considered

Costs below are measured, not modelled: the real production prompt from
`_classify_email` run against three French vendor emails, priced with rates
verified the same day from `ai.google.dev/gemini-api/docs/pricing` (paid tier,
Standard). All candidates returned the correct category on all three.

1. **`gemini-3.5-flash-lite`** — $0.29/1k emails. Newest GA "lite"; Google bills
   it as their most cost-efficient GA model. No thinking tokens by default.
2. **`gemini-3.1-flash-lite`** — $0.19/1k. One generation older, so a shorter
   runway before this same retirement recurs.
3. **`gemini-2.5-flash-lite`** — $0.07/1k, cheapest by 3x. Rejected: it is the
   same 2.x generation that was just retired out from under us. Picking 2.x again
   repeats the exact failure being fixed.
4. **`gemini-3.6-flash`** — $2.79/1k, and it is what Google's own 404 message
   recommends. Rejected: ~10x the chosen option for no measured accuracy gain, and
   its thinking cannot be switched off (`thinking_level="low"` still burned 167
   thought tokens). Following the error message's advice blindly would have been
   the most expensive option on the list.
5. **`gemini-3.7-flash` with thinking disabled** — $0.49/1k now but **$0.99 from
   2027-01-01** when the promotional rate ends. Most capable; kept as the upgrade
   path if triage quality ever proves inadequate.
6. **Do nothing** — inbound email classification stays fully down.

## Decision

**`gemini-3.5-flash-lite` becomes the `GEMINI_MODEL` default**, and
`calendar_agent` moves onto the shared new-SDK client using the same setting.

The cost spread across the credible options is under $1/month at any plausible
volume, so price was *not* the deciding factor — **deprecation runway** was. Having
just been broken by a retirement, the newest GA lite model buys the longest window
before it happens again. Google's recommended `gemini-3.6-flash` was rejected
precisely because the 404 message optimises for capability, not for what a
three-category triage prompt actually needs.

`calendar_agent` was migrated rather than deleted: the regex fallback was never
the intent, it was the symptom. It now uses `client.aio.models.generate_content`,
preserving the original's async semantics.

**Accuracy is now evidenced** (added after the founder set a cost-efficiency and
accuracy bar; the original decision rested on cost and runway alone). A 39-case
labelled fixture plus a 15-case held-out set were built and swept across five
configurations — `tests/fixtures/email_classification_{eval,holdout}.jsonl` and
`scripts/eval_email_classification.py`.

The measurement changed the conclusion in a way the model comparison alone would
have missed. On the original prompt, no configuration exceeded **94.9%**, and
**every single error was a NOISE case** — two of them missed by all five models.
The bottleneck was the taxonomy, not the model: v1's NOISE definition
("newsletters, surveys, automated receipts, marketing with no specific offer")
omitted office closures, event invitations, greetings, recruitment, and
range marketing, so those fell through to OPERATIONAL or PROMO.

Rewriting the taxonomy as a stop-at-first-match order with NOISE as the explicit
default — a free change — beat every paid upgrade:

| Config | Original prompt | v2 taxonomy | $/1k emails |
|---|---|---|---|
| `gemini-2.5-flash-lite` | 87.2% | 92.3% | 0.075 |
| **`gemini-3.5-flash-lite`** | 92.3% | **100%** | **0.32** |
| `gemini-3.7-flash` | 92.3% | 100% | 0.70 |

The chosen model scored **54/54** across both sets. The 3x-cheaper
`gemini-2.5-flash-lite` reaches only 80% held-out, so its saving is not worth
taking; the 2.2x-dearer `gemini-3.7-flash` buys nothing. **The original model
choice stands unchanged** — the accuracy came from the prompt.

## Final shape (founder call, 2026-08-24)

The classification path is **two models and no more**: `gemini-3.5-flash-lite`
handles every email, and anything it returns below `EMAIL_INTEL_ESCALATION_THRESHOLD`
(0.70) is re-classified on **`claude-sonnet-5`**. Both are settings-driven.

Escalation is insurance, not routine: over the 54-case eval the primary model's
**minimum** confidence was 0.95, so the measured escalation rate is **0%** and
Sonnet — roughly 10x the primary's per-token price — adds nothing at current
quality. A failed escalation returns the primary verdict rather than raising, so
this path cannot become a new way for inbound mail to disappear. Both tiers log
spend separately (`task_type="email_classification"` and
`"email_classification_escalation"`).

Verified live, not just mocked: forcing the threshold to 1.01 escalated every
email and Sonnet classified both test cases correctly. That check exists because
`calendar_agent`'s fallback in this same ADR had been silently dead for months.

Two further dead model ids surfaced while wiring this and are fixed here:
`claude-sonnet-4-20250514` (the `research_cascade_sonnet_model` default) returns
**404** against the live API, and `Settings.claude_api_key` read only
`CLAUDE_API_KEY` while this deployment sets `ANTHROPIC_API_KEY` — so every boot
logged "Haiku calls will fail" while the SDK quietly fell back to its own env var.

## Consequences

- Inbound email classification works again; `calendar_agent` does real LLM date
  extraction for the first time (verified live: 3/3 dates with correct types).
- **`calendar_agent` is not wholly fixed.** Its regex fallback is handed the
  formatted *prompt template* rather than the conversation, and the template
  embeds today's date plus two literal example dates. Proven: a conversation
  containing no dates yields 3 fabricated `provider_important_dates` rows at
  confidence 0.6 labelled `source="llm_extraction"`. Pre-existing and below the
  0.7 gate for `calendar_events`, but restoring the LLM path makes the fallback
  rarer without making it correct. Filed as OD-63 (filed as OD-60; renumbered
  on the merge with `main`, which had independently allocated 58/59/60).
- Spend figures will **jump** — not because spend rose, but because it was being
  under-recorded. Expect roughly an order of magnitude on thinking-enabled models.
  Do not read this as a regression.
- `calendar_agent` now costs money where it previously cost nothing, because it
  previously did nothing.
- Unpriced models book NULL + `context.cost_basis='unpriced_model'` in
  `neural_footprint_event` instead of a false zero.
- **Not fixed, deliberately:** `api_spend.cost_usd` is `NOT NULL DEFAULT 0.0` in
  the schema, so it still takes the false `0.0` for unpriced models. Correcting it
  needs a migration and is filed as tech debt rather than smuggled into this diff.
- **Rate rows removed:** `gemini-2.0-flash` and `gemini-pro` were dropped from
  `_RATES_PER_M` (Google no longer publishes rates for shut-down models). The 24
  live sites still passing those ids therefore book `$0.00` in `api_spend` and
  NULL in NF. Harmless today — each logs only *after* a successful response and
  both models 404 — but it is a behaviour change, recorded here rather than left
  for someone to discover.
- **The Anthropic rows turned out to carry the same bug** (checked after the fact
  at the founder's request, closing most of OD-62 — filed as OD-59, renumbered
  on the merge with `main`). `claude-haiku` was priced
  `(0.80, 4.00)` — Claude Haiku **3.5**'s retired rate — against the
  `claude-haiku-4-5-20251001` this repo actually calls, whose published rate is
  `1.00 / 5.00`. That under-recorded 20% across **11 call sites**, the
  orchestrator's most-used model. Corrected. `claude-sonnet` `(3.00, 15.00)`
  verified correct. This is the third instance of one failure mode — a superseded
  model's price inherited by its successor — which is the argument for a
  verification-date discipline on the table rather than three separate fixes.
- **Not fixed, deliberately:** the `gpt-4-turbo` row in
  `_RATES_PER_M` is unverified. This operation was scoped to
  Gemini; guessing at Anthropic rates here would repeat the mistake being corrected.
- **Still outstanding:** 27 further references to retired models (`gemini-2.0-flash`,
  `gemini-pro`) across **11 other live non-test files** — see OD-57 for the
  file:line list. 24 are dead calls; 3 (`training_data_store.py:45,102,147`) are
  `model_version` metadata defaults that mislabel training rows rather than 404.
  This ADR fixes the two that were reported, not the whole surface.
- **A 99.9% accuracy criterion is not currently evidenceable, and probably not
  definable.** 54/54 with zero observed errors supports "≥94.4% at 95%
  confidence" (rule of three); evidencing 99.9% needs ~3,000 labelled emails
  classified without a single error. Beyond sample size, the OPERATIONAL /
  PROMO / NOISE boundary is genuinely ambiguous in places — a paid tasting
  invitation, an office closure that affects order processing — so the ceiling
  is set by label agreement, not by the model. The honest target is a stated
  confidence bound on a growing labelled set, not a nine-nines figure. Next
  increment: ~300 labelled emails would support a ≥99% claim.
- **Revisit trigger:** `gemini-3.7-flash` and `gemini-3.6-flash` **only** carry
  promotional rates that double on 2027-01-01 (0.75/3.75 → 1.50/7.50); re-verify
  those two rows before that date. *Corrected after review:* the chosen default
  `gemini-3.5-flash-lite` is flat with no published end date, so nothing about
  this decision expires in January. Also revisit if classification accuracy
  complaints appear, or when a labeled email corpus exists to benchmark against.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Model choice + "fix all three" scope decided |
| 2026-08-24 | Claude | Implemented; both paths verified live against the real API |
| 2026-08-24 | Review agent (adversarial audit) | **1 blocker + 3 doc corrections.** Blocker: the unpriced guard keyed on LLM-table membership rather than provider, so Serper's flat configured per-query fee (5 live sites) was nulled in NF and mislabelled `unpriced_model` — reintroducing this ADR's own target defect on another axis. Fixed by gating on `_TOKEN_PRICED_PROVIDERS` + 2 regression tests. Corrected overstatements: the lite/flash claim, the "28 across 12" count (really 27 across 11), and the promo caution wrongly generalised to all 3.x. Independently re-verified all 8 Gemini rates against Google's published page — all match. |
