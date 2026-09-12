# OD-03 bake-off — scorecard

- Generated: `2026-08-28T10:39:04+00:00` by `scripts/bakeoff/score_candidates.py`
- Protocol: `scripts/bakeoff/README.md`
- Spec sheet: `.planning/00-index/cards.json` (sha256 `612679a05559e22d`, 102 cards, 100 units)
- Pre-registration: **ABSENT**

> ## ⚠ PARTIAL — this scorecard decides nothing
>
> One or more axes are `UNMEASURED` or `INVALID_NO_EVIDENCE`, so no total
> score exists. **OD-03 remains OPEN.** Do not cite this file as a result;
> cite it as the state of a run in progress.

**Overall status: PARTIAL**

## Candidates

| candidate | status | total | confirm gate | measured axes |
|---|---|---|---|---|
| `hermes-agent` | PARTIAL | — | UNMEASURED | 0/6 |
| `deepseek-harness` | PARTIAL | — | UNMEASURED | 0/6 |
| `reasoning-layer-on-baseagent` | PARTIAL | — | UNMEASURED | 0/6 |

### `hermes-agent`

- Run: — · date — · operator —
- Protocol review: — · — · —

| axis | status | value | direction | evidence |
|---|---|---|---|---|
| `capability_fit` | **UNMEASURED** | — | higher_is_better | — |
| `integration_surface` | **UNMEASURED** | — | lower_is_better | — |
| `nf_a_instrumentation` | **UNMEASURED** | — | higher_is_better | — |
| `confirm_gate` (gate) | **UNMEASURED** | — | must_be_true | — |
| `operational_maturity_licence` | **UNMEASURED** | — | higher_is_better | — |
| `cost_per_task` | **UNMEASURED** | — | lower_is_better | — |

**No total score. Why:**

- no results file for this candidate -- it has not been run
- axes not measured: capability_fit (UNMEASURED), integration_surface (UNMEASURED), nf_a_instrumentation (UNMEASURED), confirm_gate (UNMEASURED), operational_maturity_licence (UNMEASURED), cost_per_task (UNMEASURED) (D-1)
- no preregistration.json -- weights and bounds were never frozen (run --init-prereg, fill it in, freeze it BEFORE the runs)

### `deepseek-harness`

- Run: — · date — · operator —
- Protocol review: — · — · —

| axis | status | value | direction | evidence |
|---|---|---|---|---|
| `capability_fit` | **UNMEASURED** | — | higher_is_better | — |
| `integration_surface` | **UNMEASURED** | — | lower_is_better | — |
| `nf_a_instrumentation` | **UNMEASURED** | — | higher_is_better | — |
| `confirm_gate` (gate) | **UNMEASURED** | — | must_be_true | — |
| `operational_maturity_licence` | **UNMEASURED** | — | higher_is_better | — |
| `cost_per_task` | **UNMEASURED** | — | lower_is_better | — |

**No total score. Why:**

- no results file for this candidate -- it has not been run
- axes not measured: capability_fit (UNMEASURED), integration_surface (UNMEASURED), nf_a_instrumentation (UNMEASURED), confirm_gate (UNMEASURED), operational_maturity_licence (UNMEASURED), cost_per_task (UNMEASURED) (D-1)
- no preregistration.json -- weights and bounds were never frozen (run --init-prereg, fill it in, freeze it BEFORE the runs)

### `reasoning-layer-on-baseagent`

- Run: — · date — · operator —
- Protocol review: — · — · —

| axis | status | value | direction | evidence |
|---|---|---|---|---|
| `capability_fit` | **UNMEASURED** | — | higher_is_better | — |
| `integration_surface` | **UNMEASURED** | — | lower_is_better | — |
| `nf_a_instrumentation` | **UNMEASURED** | — | higher_is_better | — |
| `confirm_gate` (gate) | **UNMEASURED** | — | must_be_true | — |
| `operational_maturity_licence` | **UNMEASURED** | — | higher_is_better | — |
| `cost_per_task` | **UNMEASURED** | — | lower_is_better | — |

**No total score. Why:**

- no results file for this candidate -- it has not been run
- axes not measured: capability_fit (UNMEASURED), integration_surface (UNMEASURED), nf_a_instrumentation (UNMEASURED), confirm_gate (UNMEASURED), operational_maturity_licence (UNMEASURED), cost_per_task (UNMEASURED) (D-1)
- no preregistration.json -- weights and bounds were never frozen (run --init-prereg, fill it in, freeze it BEFORE the runs)

## What is still unmeasured, in one place

- `hermes-agent`: `capability_fit`, `integration_surface`, `nf_a_instrumentation`, `confirm_gate`, `operational_maturity_licence`, `cost_per_task`
- `deepseek-harness`: `capability_fit`, `integration_surface`, `nf_a_instrumentation`, `confirm_gate`, `operational_maturity_licence`, `cost_per_task`
- `reasoning-layer-on-baseagent`: `capability_fit`, `integration_surface`, `nf_a_instrumentation`, `confirm_gate`, `operational_maturity_licence`, `cost_per_task`

---

*Emitted by `scripts/bakeoff/score_candidates.py`. Axes default to `UNMEASURED` (ADR 0020); a value without evidence is downgraded to `INVALID_NO_EVIDENCE` (ADR 0017); no total exists while either is present. OD-03 is OPEN until this file reads COMPLETE.*
