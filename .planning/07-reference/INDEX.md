---
type: index
title: Reference corpus index
status: live
updated: 2026-08-27
links: ["[[0032-vault-cleanup-cut-line]]"]
---

# 07-reference — closed records and reference corpora

Created under [ADR 0032](../decisions/0032-vault-cleanup-cut-line.md)
(founder mapping calls, 2026-08-27). Everything here is **reference, not spine**:
grep it, cite it by `file.md:line`, never restate it (CLAUDE.md §2/§4). The rule
for what lands here: a doc goes into `01-`…`06-` only when a directory's charter
genuinely fits; otherwise it comes here. Nothing in this directory is the current
plan of record — that is `PROJECT.md` → `STATE.md` → `ROADMAP.md`.

| Doc | What it is | Status |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | Requirements ledger, grouped by version — the durable record that made deleting `phases/` safe | Historical (its own banner, ADR 0018) |
| [v1.0-MILESTONE-AUDIT.md](v1.0-MILESTONE-AUDIT.md) | What v1.0 shipped and concluded | Historical record |
| [v2.0-MILESTONE-AUDIT.md](v2.0-MILESTONE-AUDIT.md) | What v2.0 shipped, `gaps_found` — feeds `v3.0-TECH-DEBT.md` | Historical record |
| [UX_PATHS_CATALOG.md](UX_PATHS_CATALOG.md) | 760-path UX catalog driving the burn-down | Catalog, partially STALE (see v3.0-TECH-DEBT 44.13) |
| [ANALYTICS_FEATURE_CATALOG.md](ANALYTICS_FEATURE_CATALOG.md) | 347-insight analytics catalog; machine exports in `datasets/planning-exports/` | Catalog |
| [BEVERAGE_CATALOGUE_ARCHITECTURE.md](BEVERAGE_CATALOGUE_ARCHITECTURE.md) | Beverage identity/merge design contract | Design contract (P3.B input) |
| [BEVERAGE_CATALOGUE_PLAN.md](BEVERAGE_CATALOGUE_PLAN.md) | Companion plan to the architecture above — they travel together | Plan |
| [INVENTORY_SOTA_PLAN.md](INVENTORY_SOTA_PLAN.md) | Lots-as-source-of-truth inventory rebuild, 3 gated phases | Approved plan |
| [INVENTORY_ADD_REMOVE_SCENARIOS.md](INVENTORY_ADD_REMOVE_SCENARIOS.md) | Add/remove flow scenarios | Shipped |
| [INBOUND_EMAIL_INTELLIGENCE_PLAN.md](INBOUND_EMAIL_INTELLIGENCE_PLAN.md) | Inbound email triage/classification plan | Phase 0 shipped; rest dormant |
| [INVOICE_DOC_UX_RESEARCH.md](INVOICE_DOC_UX_RESEARCH.md) | Invoice/document UX research | Research record |
| [MENU_EXTRACTION_SCALE_PLAN.md](MENU_EXTRACTION_SCALE_PLAN.md) | Menu-extraction scaling plan | Plan |
| [PRODUCER_REPUTATION_PLAN.md](PRODUCER_REPUTATION_PLAN.md) | Producer reputation pipeline; raw data in `datasets/planning-exports/` | Plan |
| [CONVERSATION_THREADING_PLAN.md](CONVERSATION_THREADING_PLAN.md) | Vendor-conversation threading | Shipped |
| [SYNTHETIC_DATA_AND_DOCS_PLAN.md](SYNTHETIC_DATA_AND_DOCS_PLAN.md) | Synthetic data + docs generation | Shipped |
| [PROSPECTS_ATTRIBUTION_ARCHITECTURE.md](PROSPECTS_ATTRIBUTION_ARCHITECTURE.md) | Prospects/attribution design | Phases 1–3 code-complete, dormant |
| [UX_SELF_LEARNING_AGENT.md](UX_SELF_LEARNING_AGENT.md) | Self-learning UX optimizer foundation | Foundation shipped |
| [DISH_IDENTITY_DESIGN.md](DISH_IDENTITY_DESIGN.md) | Dish identity design | Design record |
| [claude_full_architectural.md](claude_full_architectural.md) | Pre-Mudavym architecture essay — oldest doc in the vault, kept by founder call | Historical (kept, ADR 0032) |
| [SCHEMA_DRIFT_INVENTORY.txt](SCHEMA_DRIFT_INVENTORY.txt) | 2026-08-04 schema-drift snapshot | Partially superseded by ADRs 0026/0031; retire when schema-migrations reconciles |
| [LLM_INSTRUCTION_PROMPTS.md](LLM_INSTRUCTION_PROMPTS.md) | Tombstone stub for the retired WineOps prompt library — recovery instructions inside | Retired 2026-08-27; successor planned |
<<<<<<< HEAD
| [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) | Mudavym feature backlog aligned to expansion stages (was `md/06-planning/`) — cited by FUTURES §7 | Reference |
| [MOBILE_APP_SETUP_AND_STATUS.md](MOBILE_APP_SETUP_AND_STATUS.md) | Mobile app setup + status (was `md/05-guides-setup/`) — linked from `apps/mobile/README.md`; P3.A input | Guide |
| [GOOGLE_AND_API_CREDENTIALS_SETUP.md](GOOGLE_AND_API_CREDENTIALS_SETUP.md) | Google + API credentials from scratch (was `md/05-guides-setup/`) | Guide |
| [TOAST_API_DEVELOPER_GUIDE.md](TOAST_API_DEVELOPER_GUIDE.md) | Toast developer-guide research report (was `md/Toast_API/ToastAPI`) | External-API reference |
| [TOAST_API_CONFIGURATION.md](TOAST_API_CONFIGURATION.md) | Toast platform integration/config report (was `md/Toast_API/`) | External-API reference |
=======
>>>>>>> origin/main
