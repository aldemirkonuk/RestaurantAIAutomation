---
phase: 36
reviewers: [ollama, gemini-task, gpt-task]
reviewers_failed: [claude]
reviewers_missing: [gemini-cli, codex, opencode, qwen, cursor-cli, coderabbit, lm_studio, llama_cpp]
reviewed_at: 2026-07-27T19:56:00.000Z
plans_reviewed:
  - 36-01-PLAN.md
  - 36-02-PLAN.md
  - 36-03-PLAN.md
notes: >
  --all requested. Claude CLI returned 401 (OAuth token expired).
  gemini/codex/opencode/qwen/cursor CLIs not installed.
  Gemini + GPT reviews via Cursor Task peer models (independent model families).
  Ollama local llama3.1:8b completed.
---

# Cross-AI Plan Review — Phase 36

## Ollama Review

*(local `llama3.1:8b` via OpenAI-compatible API)*

Based on the provided plan, I will offer a review with the requested sections.

**Summary**

The plan covers two tasks related to building foundation functionality for a synthetic tenant and establishing a testing framework. The main goals include creating documentation and annotations for the testing environment, implementing unit/integration tests on push, and annotating nightly E2E runs without forking Phase 25. The plan also addresses threat modeling and security considerations.

**Strengths**

* Comprehensive approach to foundational functionality
* Clear goals and objectives for each task
* Recognition of potential threats and mitigation plans
* Focus on security and documentation

**Concerns**

* High-severity gate: If edits set `PYTEST_RUNNING` in `e2e-prod.yml`, it could allow disabling Sentry, which is a significant risk. (HIGH)
* Limited scope on handling unit/integration test failures or incomplete teardown orphans in the threat model for T-36-03-03. (MEDIUM)
* The plan relies heavily on GitHub secret management and assumes that secrets are only accessed through `${{ secrets.* }}` variables, which might not be enough to prevent CI secret exfiltration. (MEDIUM)

**Suggestions**

* Consider adding more details about how the unit/integration tests will handle failures or edge cases to avoid incomplete teardowns.
* Enhance the scope of threat modeling to address all possible scenarios for T-36-03-03, including ensuring that Sentry is always enabled and using the required environment variables.
* Develop a better strategy for CI secret management beyond relying on GitHub secrets, such as encrypting sensitive data or using environment variable substitution.

**Risk Assessment**

Overall risk level: **MEDIUM**

Justification: The main risks identified involve high-severity gates related to disabling Sentry and potential security concerns with CI secret exfiltration. These issues need careful consideration and mitigation before moving forward with implementation.

---

## Gemini Review

*(via Cursor Task · model `gemini-3.1-pro` — CLI unavailable)*

# Phase 36 Implementation Plan Review

## 1. Summary
The Phase 36 implementation plans (36-01, 36-02, 36-03) provide a highly disciplined, documentation-first foundation for the Testing Campaign. By establishing a canonical functionality registry, a strict T0-T4 scoring rubric, an honest test inventory, and a synthetic tenant convention, the phase successfully satisfies requirements TFND-01 through TFND-06. The plans demonstrate exceptional scope control by strictly forbidding test rewrites, CI behavioral changes, or premature UI development. The integration of UX Smoothness and Premortem mitigations directly into the task actions ensures the resulting artifacts will be operator-friendly and resistant to score inflation.

## 2. Strengths
*   **Exceptional Scope Control:** The plans repeatedly and explicitly forbid scope creep (e.g., "Do NOT fix Black debt", "FORBIDDEN: create `.github/workflows/testing-campaign.yml`", "Do NOT implement the restaurant generator").
*   **Rigorous Honesty Protocol:** The strict rules around assigning T1 scores (requiring loadable smoke or provisional `T1?` with "CI green unverified") and the explicit callouts of CI rot (Black debt on `studio_routes.py`, missing secrets in `e2e-prod.yml`) prevent false confidence.
*   **Strong Dependency Management:** The dependency chain (`36-01` → `36-02` → `36-03`) correctly serializes the creation of the registry before the inventory and scorecard, mitigating the H1 divergence risk identified in the Premortem.
*   **Operator-Centric UX:** Incorporating the UX Smoothness audit directly into the plans (e.g., the Operator Quickstart in the README, seeding UX traps into the scorecard Gaps) ensures the artifacts are usable by a solo founder, not just AI agents.
*   **Edge Case Handling:** Contested surfaces (`receiving`, `contacts`), legacy routes (`/inventory-legacy`), and deferred platforms (`mobile`) are explicitly mapped and assigned clear ownership rules.

## 3. Concerns
*   **HIGH:** **Brittle Verification Scripts.** The `<automated>` verification blocks and acceptance criteria rely on highly specific `rg` (ripgrep) string matches and exact file counts. Any slight deviation by the executing agent in phrasing or formatting could cause execution to fail, leading to thrashing.
*   **MEDIUM:** **Teardown Gap Dependency.** While `SYNTHETIC-TENANT.md` correctly documents the gap between the 8 `E2E_TABLES` and the ~152 database tables, it pushes the entire burden of expanding the teardown to Phase 37. If Phase 37 misses this, the production database will suffer from `sim-*` orphan pollution.
*   **LOW:** **CI Rot Normalization.** By explicitly documenting that `e2e-prod.yml` is "capability-unverified" and `ci.yml` is red due to Black debt, the phase normalizes a broken CI state. While correct for Phase 36's scope, this poses a risk to Phase 39/40 if the CI isn't fixed before breadth suites are written.

## 4. Suggestions
*   **Relax Exact String Matches:** Consider relaxing some of the exact string matching in the `<verify>` blocks to allow for minor semantic variations by the executing agent, or provide the exact boilerplate text as a heredoc in the prompt.
*   **Phase 37 Hard Blocker:** Add a prominent, unavoidable warning in `SYNTHETIC-TENANT.md` that explicitly blocks Phase 37 from executing any `sim-*` generation until the `E2E_TABLES` list is fully reconciled with the registry's DB domains.
*   **Pre-Phase 39 CI Fix Ticket:** Create a dedicated backlog ticket or a "Wave 0" mini-phase to resolve the `studio_routes.py` Black debt and restore `e2e-prod.yml` secrets *before* Phase 39 begins, ensuring the breadth passes have a working signal.

## 5. Risk Assessment
**LOW**
The risk of Phase 36 failing its objectives or introducing regressions is LOW. The plans are read-only and documentation-focused, with robust guardrails against modifying application code or CI behavior. The primary risk is execution friction due to overly strict verification regexes, rather than systemic failure.

---

## GPT Review

*(via Cursor Task · model `gpt-5.2` — CLI unavailable)*

### Summary

Phase 36’s three-plan structure is **well-scoped and goal-aligned** with TFND-01..06: it establishes (1) a canonical 11-group functionality registry, (2) a locked T0–T4 rubric, (3) an “existing tests” inventory, (4) an 11-row scorecard baseline, (5) CI skeleton annotations that explicitly reuse Phase 25 (no new paradigm), and (6) a `sim-*` synthetic tenant convention with RLS-safe guidance.

The best parts are the **honesty protocols** (provisional `T1?`, “schedule-present / capability-unverified”), the **completeness gates** (cover every Nest module dir / App routes / agent files), and the explicit **out-of-scope constraints** (no rewriting tests, no CI “fixing,” no generator/simulator work). If executed as written, the plans should achieve the TFND foundation and prevent later phases (37–43) from building on inflated coverage claims.

### Strengths

- **TFND coverage is explicit and traceable**: each plan maps cleanly to TFND-01..06 with concrete artifacts under `.planning/testing/`.
- **Dependency order is mostly correct**:
  - `36-02` depends on `36-01` (registry/rubric before inventory→scorecard reconciliation).
  - `36-03` depends on `36-01` + `36-02` (README can link real outputs; CI annotations come after baseline honesty is defined).
- **Anti-scope-creep guardrails are strong**:
  - Repeated “comment-only” CI edits; “do not invent a second prod E2E paradigm”; “do not rewrite tests” (D-05).
- **Edge-case ownership is proactively handled** via “Contested surfaces” (receiving door, contacts, compliance_agent) and the rule “suite owner = registry primary group.”
- **Honesty about CI reality is baked in** (premortem C1/H5):
  - Distinguishes `test-e2e` (local Playwright) vs `e2e-prod` (cloud prod E2E).
  - Requires “secrets present? yes/no as-of date” and blocks conflating a cron schedule with a working gate.
- **Tenant isolation and security posture are directionally right**:
  - `sim-*` prefix convention + idempotent teardown + “never log JWT”/no secrets in docs.
  - Explicitly calls out that service-role seeding is not proof of JWT/RLS correctness.

### Concerns (HIGH/MEDIUM/LOW)

#### HIGH

- **H1: Registry→inventory drift can still happen if executors shortcut reconciliation**
  - Even with `36-02` depending on `36-01`, the inventory task itself is large and human-error-prone. If group assignments are made from “intuition” instead of registry primaries, later phases will dispute ownership and evidence.
  - Mitigation exists (sample 10 module reconcile + explicit requirement), but it’s easy to under-enforce unless treated as a hard gate.

- **H2: “Completeness” checks rely on grep presence, not structured guarantees**
  - The plans verify “every Nest dir appears somewhere” and “Table B covers all `path=`” by approximations. That catches big misses, but subtle misses remain possible:
    - A dir name appearing in prose (not in the Table A row).
    - A route path appearing in a note (not as a table row).
  - Risk: a surface is “mentioned” but not actually owned/mapped in the canonical table.

- **H3: CI skeleton (TFND-05) could be “satisfied” while remaining operationally unusable**
  - The plans correctly label TFND-05 as “schedule-present / capability-unverified,” but they also modify `.github/workflows/ci.yml` and `.github/workflows/e2e-prod.yml`. Any accidental non-comment change would be high blast radius.
  - The plan forbids behavioral edits; execution must be extremely disciplined (diff-review required).

- **H4: Synthetic tenant teardown gap is acknowledged but could still underpower Phase 37**
  - `SYNTHETIC-TENANT.md` embeds the 8-table Phase 25 teardown and demands Phase 37 expansion before multi-archetype seeds. This is good, but if Phase 37 starts without expanding teardown, `sim-*` pollution becomes a real production risk.
  - Recommendation: treat “expanded teardown coverage map” as a Phase 37 entry gate, not just a note.

#### MEDIUM

- **M1: Baseline scoring may still be too generous without a strict “T0 default” posture**
  - The `T1?` protocol is good; however, baseline scoring can become politically optimistic if many groups are set to `T1?` despite having (a) tests that don’t run, (b) tests not wired in CI, or (c) only peripheral tests that don’t cover core workflows.
  - The plans partially mitigate via “runs?=yes” and “loadable smoke” criteria, but execution should bias toward **T0 unless clearly proven**.

- **M2: DB “domain buckets” risk being subjective**
  - Table D is required and anchored to migrations (good), but “domain bucket” boundaries can be debated (e.g., cross-cutting tables, audit/event logs). If the buckets aren’t stable, later teardown/seed coverage tracking becomes noisy.

- **M3: Mobile mapping could confuse campaign scope**
  - You mark mobile as `campaign-deferred` (correct), but it still appears in registry/scorecard. If not carefully worded, later phases may feel compelled to “raise mobile to T2,” violating D-02.

#### LOW

- **L1: Reserved Phase 38 route choice (`/sim` vs `/admin/sim`) might churn**
  - Not a functional risk, but renames later can ripple through docs/checklists. Pick one and stick to it.

- **L2: Inventory file size / ergonomics**
  - `EXISTING-TEST-INVENTORY.md` will be large; the UX smoothness doc correctly positions it as agent-facing. Low risk if README/scorecard truly become the “front door.”

### Suggestions

- **Strengthen structured completeness checks (without scope creep)**:
  - In `FUNCTIONALITY-REGISTRY.md`, make Table A/Table B/Table C explicit sections with consistent row markers so verification can assert “dir X appears in Table A” vs “dir X appears anywhere.”
  - Same for routes: ensure every `path=` is listed as a route-row line, not just mentioned in commentary.

- **Make reconciliation an explicit deliverable, not a footnote**:
  - Add a short “Registry ↔ Inventory Consistency Report” subsection in `TESTING-SCORECARD.md` (or `EXISTING-TEST-INVENTORY.md`) listing:
    - Count of inventory rows per group
    - A small sampled set where group assignment was corrected to match registry
  - This reduces later disputes and prevents silent drift.

- **Bias baselines conservative**:
  - Prefer **T0** when evidence is thin. Use `T1?` sparingly (only when CI wiring exists and the test is at least loadable/collectable).
  - Keep “T2+ is not expected in Phase 36” strongly stated to reduce accidental over-claims.

- **Elevate Phase 37 teardown expansion to a documented gate**:
  - In `SYNTHETIC-TENANT.md`, add a bold “Phase 37 must not proceed until…” checklist item: “teardown covers all domains that generator will write.”

- **Security hygiene in docs**:
  - When requiring “secrets present? yes/no,” explicitly prohibit copying log lines that include values; “names only” is already present—keep it prominent in both README and scorecard honesty blocks.

- **Clarify `packages/*` ownership**:
  - Registry note is good; also recommend explicitly stating whether package test work is expected in breadth phases (39–40) or only in 43, to avoid unowned drift.

### Risk Assessment (LOW/MEDIUM/HIGH)

**MEDIUM.** The plans themselves are strong and include mitigations for the two biggest real-world failure modes (paper-tiger CI and score inflation). The residual risk is execution risk: large manual inventories + mapping tables invite drift, and CI/workflow edits—even comment-only—can cause outsized damage if mistakes slip in. If the “honesty gates” (provisional `T1?`, secrets status, no-promote-past-T1) are enforced strictly, overall risk drops to LOW.

---

## Claude Review

*(CLI attempted — failed)*

```
Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.
```

Re-auth: run `claude /login` (or refresh OAuth), then re-run `/gsd-review --phase 36 --claude` to add a Claude CLI review.

---

## Consensus Summary

Reviewed by **3** systems (Ollama local + Gemini Task + GPT Task). Claude CLI unavailable (401). Other `--all` CLIs not installed.

### Agreed Strengths
- Strong **scope control** — docs/CI-annotate only; no generator/SimPOS/test rewrites (Gemini + GPT)
- **Honesty protocols** — `T1?`, capability-unverified nightly E2E, Black debt called out (Gemini + GPT)
- **Dependency order** `36-01 → 36-02 → 36-03` after premortem soft-block (Gemini + GPT)
- Threat / security awareness around CI secrets and Sentry/`PYTEST_RUNNING` (Ollama + GPT)

### Agreed Concerns *(highest priority)*
1. **Phase 37 teardown gap is still a production landmine** if treated as a note rather than a hard entry gate (Gemini MEDIUM + GPT HIGH H4) — elevate “must not seed multi-archetype until `E2E_TABLES` covers written domains”
2. **Verification / completeness is grep-fragile** — brittle exact strings (Gemini HIGH) and “mentioned in prose ≠ mapped in table” (GPT HIGH H2)
3. **CI workflow edits have high blast radius** even when comment-only — accidental behavioral change or `PYTEST_RUNNING` (GPT H3 + Ollama HIGH)
4. **Score / CI honesty can normalize broken CI** into later phases unless a pre-39 CI fix ticket exists (Gemini LOW/MEDIUM + GPT M1)

### Divergent Views
| Topic | Gemini | GPT | Ollama |
|-------|--------|-----|--------|
| Overall risk | **LOW** | **MEDIUM** (execution risk) | **MEDIUM** |
| Biggest worry | Brittle `rg` verifies | Registry↔inventory drift + teardown gate | Sentry/`PYTEST_RUNNING` + secret exfil |
| Scoring posture | Honesty already strong | Bias harder to **T0** default | N/A (shallow on scoring) |

**Orchestrator read:** Prefer GPT’s MEDIUM overall — plans are solid; residual risk is executor discipline on inventory mapping and comment-only CI diffs. Incorporate Gemini’s Phase 37 hard-blocker wording + GPT’s consistency-report suggestion via `/gsd-plan-phase 36 --reviews` if you want one more revision pass before execute.

### Recommended next
1. Optional: `/gsd-plan-phase 36 --reviews` — fold consensus concerns into plans
2. Or proceed: `/gsd-execute-phase 36` — enforce honesty gates + diff-review CI YAML carefully
3. Ops (out of Phase 36): re-auth Claude CLI; restore e2e-prod secrets; Black-fix `studio_routes.py` before Phase 39
