# Phase 12: Extensive Gap-Filling Research Agent — Open Questions

**Status:** Awaiting user answers before execution begins.
**Phase dir:** `.planning/phases/12-extensive-research-agent/`

Answers will be captured in a `12-CONTEXT.md` before the executor runs.
Each question includes the default assumption the planner will use if no answer is provided.

---

## Q1 — Field Prioritization in Eligibility Gate

**Question:** Should the research agent target ALL fields with confidence < 0.8, or only a prioritized
subset of the most impactful fields?

**Why it matters:** The full schema has ~31 fields. Researching every low-confidence field maximizes
coverage but inflates cost per record and burns through the daily cap faster. A prioritized core set
focuses budget on fields that drive the most downstream value — region/appellation for ontology
validation (Phase 9), producer for knowledge graph enrichment (Phase 8), vintage for critic score
lookup (Phase 10).

**Options:**

| Option | Target fields | Cost per record | Coverage |
|--------|--------------|-----------------|----------|
| A — All fields | All with conf < 0.8 | ~$0.10–0.25 | Maximum |
| B — Core 10 | wine_name, producer, vintage, region, country, appellation, grape_variety, color, primary_type, alcohol_pct | ~$0.04–0.10 | Structured fields only |
| C — Configurable | `RESEARCH_PRIORITY_FIELDS` in settings.py, default = Core 10 | Tunable | Tunable |

**Planner default if no answer:** Option C — configurable with Core 10 as default. Gives you a dial
to turn as the agent matures and you see which fields are worth the research cost.

---

## Q2 — Tier-A Source Definition

**Question:** What qualifies as a "Tier A" (authoritative) source?

**Why it matters:** Tier-A sources allow single-source auto-promotion at 0.95 confidence. The
distinction between tier-A and tier-B is the difference between "producer's own website says so"
and "a trade magazine said so." Tier-A being too broad increases silent-error risk. Too narrow
reduces fill rate.

**Options:**

| Tier | Sources | Risk |
|------|---------|------|
| **Narrow — Tier A** (recommended) | Producer websites + official appellation bodies (INAO/AOC registry, Consorzio per DOC/DOCG, TTB COLA registry for US, CIVB for Bordeaux) | Low false-positive |
| **Medium — Tier A** | Narrow + established wine press (Wine Spectator, Decanter, Jancis Robinson, Wine Advocate) | Slightly higher |
| **Broad — Tier A** | Medium + Wine-Searcher, Vivino (community-edited) | Propagated-error risk |

**Planner default if no answer:** Narrow. Producer + official regulatory bodies only. Wine-Searcher,
Vivino, and trade press = tier-B (reliable, but must have 2 independent sources for auto-promotion).
This minimizes silent wrong fills — the metric we most care about is `human_override_rate`.

---

## Q3 — Conflict Queue Lifecycle

**Question:** After a human resolves a field conflict (picks one value from `conflict_candidates`),
should the agent be allowed to re-research that field on future runs?

**Why it matters:** Conflicts arise when ≥2 evidence-backed sources disagree (e.g., one says
"Syrah", another says "Shiraz" for `grape_variety`). After a human picks the correct value, what
happens next time the agent runs on that record?

**Options:**

| Option | Behavior | Risk |
|--------|----------|------|
| A — Never re-research | Field locked after human resolution (`source: "human_resolved"`, conf 1.0, agent skips on future runs) | None — safest |
| B — Allow re-research | Human's choice becomes new ground truth, but agent can update if new evidence disagrees | Risk of overwriting human judgment |
| C — Re-research allowed if new evidence tier-A | Agent can re-open a conflict only with tier-A evidence | Low risk |

**Planner default if no answer:** Option A — field locked after human resolution. Matches the
existing `field_corrections` philosophy (human override = final). `merge_field_confidence()` already
refuses to overwrite higher-confidence data, and a human resolution sets confidence 1.0.

---

## Q4 — Per-Record Research Budget Ceiling

**Question:** Should there be a hard per-record cost ceiling in addition to the daily cap?

**Why it matters:** The stop rule (max 8 tool calls) bounds attempts, but not cost — a future model
or expanded field list could make each call more expensive. A per-record ceiling prevents any single
record from consuming the entire daily budget before other records are processed.

**Back-of-envelope cost per record:**
- Serper call: ~$0.005/search × 8 max = $0.04
- LLM snippet parsing (Gemini Flash): ~$0.001/call × 8 = $0.008
- fetch-verify: HTTP only, negligible
- **Total max ≈ $0.05–0.12 per record** at current pricing

**Options:**

| Option | Ceiling | Behavior |
|--------|---------|----------|
| A — None | N/A | Rely on stop rule only |
| B — Hard ceiling | `RESEARCH_MAX_COST_PER_RECORD_USD = 0.25` (configurable) | Task fails gracefully, logs warning, marks run as `partial` |
| C — Soft warning | Log at $0.15, hard stop at $0.50 | Visibility without hard gate |

**Planner default if no answer:** Option B — hard ceiling at $0.25. Complements the stop rule.
Total daily budget at default $5/day ÷ $0.25/record = at least 20 records guaranteed to run.

---

## Q5 — Fetch-Verify Mechanism

**Question:** Should citation verification use lightweight HTTP GET + substring match, or full
Playwright browser rendering?

**Why it matters:** Fetch-verify re-fetches the top citation URL to confirm the proposed field value
is still present on the live page (guards against ephemeral search snippets and pages that change
after indexing). Some pages require JavaScript rendering to display content.

**Tradeoffs:**

| Method | Speed | Coverage | Dependency |
|--------|-------|----------|------------|
| `aiohttp` GET + substring match | ~0.3–0.8s | ~75–80% of target sites (static HTML, Wine-Searcher, most producer sites) | Already in codebase (Session 11) |
| Playwright | ~3–5s | ~95%+ (handles SPAs) | Already in codebase (Phase 6), adds 3–5s per citation |
| Tiered (aiohttp first, Playwright fallback) | ~0.3s typical, 3s for SPAs | ~90% | Reuses both existing tools |

**Planner default if no answer:** Tiered — aiohttp first, Playwright fallback if response body
is < 500 bytes or empty. The `fetch_verify_pass_rate` metric will surface which path hits SPA
pages so you can tune the fallback threshold.

---

*Questions authored: 2026-04-06 — Phase 12 planning*
*Fill answers in `12-CONTEXT.md` before executing plans.*
