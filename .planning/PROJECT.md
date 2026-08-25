# Mudavym — Autonomous Restaurant Operations Platform

> Formerly framed as **WineOps AI**. Product brand going forward: **Mudavym**.  
> Canonical expansion vision: [FUTURES.md](./FUTURES.md).

## What This Is

Mudavym is a full autonomous backend system for restaurants — inventory, procurement, communications, POS integration, and intelligent agents. Wine is the first vertical and the **quality bar** for deep extraction (producer, vintage, region, ontology, images). The platform expands in locked order: **wine → full beverages → bakery (first food) → rest of kitchen**.

The current codebase and milestone naming may still say WineOps; identity migrates gradually. The ultimate goal does **not** change: kitchen-grade autonomous restaurant operations.

## Core Value

The system is so reliable that an average agent performs flawlessly because the infrastructure carries it — like a Michelin-star kitchen where systems, not genius, produce consistent excellence.

## Product expansion (futures — not current milestone)

See [FUTURES.md](./FUTURES.md). Summary:

| Stage | Scope |
|---|---|
| 0 (now) | Wine — deep extraction, cellar, procurement |
| 1 | Full beverages — wine subtypes, beer, cocktail, hard alcohol, NA; fine features + photos |
| 2 | Food → bakery MVP (ingredients, recipes, finished goods, waste, POS) then full bakery north star |
| 3 | Rest of kitchen food categories |

**Profile types:** restaurant **members** (owner/manager/staff, per-restaurant roles) and — as a futures addition — **guests**: customers who visit these restaurants, with Beli-style ratings and **points earned for sharing/recommending**. Guest signal is demand-side input to the backend, not a standalone social product. See FUTURES.md §7.

**Ask AI:** global entry that **creates allowlisted actions** (draft PO, vendor email, calendar, inventory drafts, nav) with human confirm — eases complexity as the product expands. See FUTURES.md §8.

## Current Milestone: P2 — Web complete + deploy

Locked 2026-08-25, [ADR 0018](decisions/0018-p2-plan-of-record.md). Docs
bulletproof first; the founder approves the feature set before build; then the
web app feature-complete and deployed. Stages and position: [STATE.md](STATE.md).
Order of operations: [ROADMAP.md](ROADMAP.md).

Prior milestones: v1.0 complete (2026-04-08); v2.0 closed `gaps_found`
(2026-07-28, [audit](archive/v2.0-MILESTONE-AUDIT.md)) — its unfinished work is
the live defect register [v3.0-TECH-DEBT.md](v3.0-TECH-DEBT.md), which feeds
P2.3's proposal rather than a phase plan of its own; P1 Neural Footprint
instrumentation closed 2026-08-25 (ADRs 0006/0008/0017). Requirement IDs and
their status live in [REQUIREMENTS.md](REQUIREMENTS.md), never here.

## Context

**v1.0 completed (2026-04-08):** 17 phases, 73 plans, 96% completion. Hybrid extraction pipeline (Claude Vision + Gemini Flash + YOLO 2-class + Haiku enrichment) fully operational with web verification, ontology validation, critic scores, temporal intelligence, research agent, and dev onboarding UI.

**Live camera capture stack (target, locked 2026-07-27):** RF-DETR for live preview boxes → PaddleOCR (or DeepSeek-OCR on GPU) on shutter → Gemini for field parse (evaluate Qwen2.5-VL / RolmOCR later). Never run full OCR every live frame — boxes live; OCR on shutter. See [SCANNING_PIPELINE_SETUP.md](../SCANNING_PIPELINE_SETUP.md#live-camera-capture-stack-target--2026-07-27).

**Agent system:** `services/agent-orchestrator/` — BaseAgent (Level 3+ infrastructure: circuit breaker, retry, backpressure, idempotency, decision logging, DLQ) and ~24 agents at mixed maturity; the golden-path four were hardened in v2.0. Every model call in both runtimes emits a `neural_footprint_event` row (P1).

**First user:** a Turkish restaurant in SF, connecting through the Toast adapter. Full API access available.

**Positioning (locked 2026-08-24):** Mudavym is **POS-agnostic — a bridge, not a POS, and not Toast-only.**
The provider registry carries 27 providers; Toast is `partial`, Square and Clover are `scaffolded`
with normalizers implemented (`pos-provider.registry.ts:58,71,83`). No document should present
Toast as the product's POS. See OD-38.

**Deployment (live):** Vercel (web) + Supabase Cloud (DB) + Railway (NestJS gateway + Python orchestrator) + CloudAMQP (RabbitMQ) + Upstash (Redis).

## Constraints

- **Quality target**: Level 4 (Resilient) for all agents — not demo-ware, not happy-path-only
- **Solo founder**: Founder + Claude = 2-3 focused things per week
- **No revenue pressure**: Build right, not fast
- **Deployment budget**: ~$10-20/month (Vercel free + Supabase free + Railway $5-10 + CloudAMQP free + Upstash free)
- **Architectural defaults locked**: RabbitMQ+saga, PG events, Redis, Sentry+logs, Diamond testing
- **Backward compatibility**: new infrastructure must not break the v1.0 extraction pipeline
- **Real data**: All E2E testing against real POS data from a live restaurant — never mock-only
- **Expansion quality bar**: Non-wine categories must meet wine-depth extraction + photos (FUTURES.md); no thin SKU rows
- **Docs before features** (ADR 0018): the founder approves the feature set before build; every decision gets a record; claims get executable checks

## Current State

Lives in [STATE.md](STATE.md) — one page, one truth. This file holds identity
and decisions only, so the two can never disagree about what is current.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brand: Mudavym | Broader than wine; autonomous restaurant backend | Locked 2026-07-26 — FUTURES.md |
| Expansion sequence A | Wine → beverages → bakery → kitchen | Locked 2026-07-26 |
| Wine = extraction quality bar | Other categories must match finest-feature + photo depth | Locked 2026-07-26 |
| Bakery first food vertical | Clearest recipe/inventory loop; MVP then north star | Locked 2026-07-26 |
| Extend BaseAgent, not rebuild | BaseAgent already Level 3 (circuit breaker, retry, backpressure, metrics, health, shutdown) | — v2.0 |
| Workflow-first agent hardening | Identify first E2E workflow → bring its agents to Level 4 → expand | — v2.0 |
| Wave sequencing (6 waves, 24 agents) | Golden path first, then communication, intelligence, support, stubs, specialty | — v2.0 |
| C→A→B approach | Audit agents → build infrastructure → wire golden path E2E | — v2.0 |
| 7 core principles | Determinism, idempotency, replayability, observability, isolation, temporal reasoning, evolvability | — v2.0 |
| Real POS data from day 1 | A live restaurant, first via the Toast adapter — no mock-only testing | — v2.0 |
| **POS-agnostic positioning** | Bridge, not a POS; Toast is one adapter of 27, never the framing | Locked 2026-08-24 — OD-38 |
| **P2 plan of record** | Spine reset → page graph → approved feature set → build → deploy | Locked 2026-08-25 — [ADR 0018](decisions/0018-p2-plan-of-record.md) |

### v1.0 Decisions (archived)
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude Vision: extraction brain | Categorically solves abbreviation/layout failures | ✓ Validated |
| Gemini Flash: crawling brain | 10x cheaper than Claude Vision for bulk crawling | ✓ Validated |
| YOLO 2-class: UX preview only | Sufficient for box drawing | ✓ Good (v1.0); superseded as *target* by RF-DETR below |
| Claude Haiku: enrichment | $0.01/wine background enrichment | ✓ Validated |
| Live preview: RF-DETR | SOTA open real-time detector (Apache 2.0 N–L); boxes only | Locked 2026-07-27 — target stack |
| On capture: PaddleOCR (DeepSeek-OCR on GPU) | Production OCR default; GPU alt for heavy pages | Locked 2026-07-27 — target stack |
| Field parse: Gemini now; eval Qwen2.5-VL / RolmOCR | Gemini still best on messy menus; open VLMs later | Locked 2026-07-27 — target stack |
| No full OCR on live frames | Too slow/expensive; shutter-only OCR | Locked 2026-07-27 — target stack |

---
*Last updated: 2026-08-25 — current milestone set to P2 (ADR 0018); state moved to STATE.md as the single source.*
