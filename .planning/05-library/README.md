---
type: moc
title: Tooling & Reference Library
status: live
decision: OD-22
updated: 2026-08-24
verified: 2026-08-24
links: ["[[HOME]]", "[[OPEN-DECISIONS]]", "[[knowledge-documentation-schedule]]", "[[media-brand-agenda-full]]", "[[corpus-archive-schedule]]"]
---

# Tooling & Reference Library

**This is OD-22.** A durable, in-repo index of the tools, skills, and references the founder
has accumulated across conversations, so they are findable next session instead of scattered
through a transcript.

**24 tool/resource entries — 0 `adopted` · 23 `candidate` · 1 `unverified` · 0 `rejected`** —
plus one shared page covering **8 unverified named references**. 25 notes in total.

---

## The three rules this library runs on

1. **Verified means fetched.** Every entry carries a `verified` date and says what was
   checked and what was not. Where a capability could not be confirmed, the note says
   **UNVERIFIED** instead of describing it. There are real instances of this below —
   Pomelli's URL was wrong, Playwright has no `screenshot` subcommand, Haikei's asset
   licence is unstated, and Phosphor's icon count is not asserted.
2. **Nothing here is adopted.** Per `CLAUDE.md §0.1`, a thing is adopted only when an ADR in
   [`.planning/decisions/`](../decisions/) says so. **No ADR adopts any of these**, so the
   `adopted` column is empty — including for Playwright, which is already installed and
   running in `apps/web`. Being in the tree is not the same as being decided.
3. **The library records; it does not decide.** Where an entry sits on an open decision, the
   note links the decision and stops. AnyDoc is **OD-06**; the harness candidates are
   **OD-03**. This library does not resolve them.

---

## Index

| Entry | Category | What it does | Status | Bears on | Note |
|---|---|---|---|---|---|
| **anydoc** (`firecrawl/anydoc`) | ingestion | Rust lib + CLI converting Word/PowerPoint/Excel/ODF/RTF/EPUB/CSV/PDF to Markdown. No OCR, no ML, no network. MIT | `candidate` | **OD-06** | [[anydoc]] |
| **Unlimited-OCR** (`baidu/Unlimited-OCR`) | ingestion | Open-weights OCR/document-parsing model; multi-page one-shot parsing. MIT, needs an NVIDIA GPU | `candidate` | **OD-06**, OD-04 | [[unlimited-ocr]] |
| **Playwright CLI** | agent-tooling | `test` / `codegen` / `show-trace`. **No** `screenshot` or `pdf` subcommand. Already in `apps/web` | `candidate` | — | [[playwright-cli]] |
| **hermes-agent** (NousResearch) | agent-harness | Python LLM agent harness: self-improving skills, memory, provider-agnostic model routing, chat gateways. MIT | `candidate` | **OD-03**, OD-04 | [[hermes-agent]] |
| **DeepSeek Harness** (`dsh`) | agent-harness | TypeScript plugin-first agent harness on Cordis. MIT. **Declared developer preview — breaking changes expected** | `candidate` | **OD-03** | [[deepseek-harness]] |
| **In-house `BaseAgent`** | agent-harness | The incumbent. RabbitMQ consumption, sagas, DLQ, idempotency, event append, metrics — **and zero LLM integration** | `candidate` | **OD-03** | [[base-agent]] |
| **shadcn/ui** | design-ui | Copy-in component source over Radix + Tailwind. Pattern already used in `apps/web`; CLI **not** wired (no `components.json`) | `candidate` | — | [[shadcn-ui]] |
| **21st.dev** | design-ui | Community registry of React/Tailwind components and blocks, copied via AI prompts. **2 free copies/day** | `candidate` | — | [[21st-dev]] |
| **Animista** | design-ui | Browser generator for CSS keyframe animations. FreeBSD licence, no attribution, zero install | `candidate` | — | [[animista]] |
| **Phosphor Icons** | design-ui | MIT icon family; `@phosphor-icons/react` (legacy `phosphor-react` superseded). Icon count/weights UNVERIFIED | `candidate` | — | [[phosphor-icons]] |
| **Haikei** | design-ui | Browser generator for SVG/PNG backgrounds — blobs, waves, gradients. Free to use; **asset licence UNVERIFIED** | `candidate` | — | [[haikei]] |
| **Motion Primitives** | design-ui | MIT animated React components on `motion` + Tailwind. **Beta**; targets `motion`, not `apps/web`'s `framer-motion@10` | `candidate` | — | [[motion-primitives]] |
| **Google Stitch** | design-ui | Prompt/sketch → UI, reported Figma + HTML/CSS export. Exists; capabilities and quota UNVERIFIED (secondary sources) | `candidate` | — | [[stitch]] |
| **Pomelli** | design-ui | Google Labs/DeepMind marketing-asset generator from a business's website. **URL corrected** — `pomelli.withgoogle.com` 404s | `candidate` | — | [[pomelli]] |
| **taste-skill** | agent-tooling | User-level skill at `~/.claude/skills/`; frontmatter name is `design-taste-frontend`. Scoped to landing/portfolio, **not** product UI | `candidate` | — | [[taste-skill]] |
| **Google Search Console** | seo-analytics | `searchanalytics`, `sitemaps`, `sites`, `urlInspection`. **No credential exists in the repo.** Row/retention limits UNVERIFIED | `candidate` | — | [[google-search-console]] |
| **GA4 Data API v1** | seo-analytics | `runReport` / `runPivotReport` / `runRealtimeReport` / `runFunnelReport`. Not instrumented anywhere; quotas UNVERIFIED | `candidate` | — | [[ga4]] |
| **Ahrefs** | seo-analytics | Free Webmaster Tools verified in detail (5k crawl credits/mo, 1k backlinks at a time, no competitor analysis). **API tier + pricing UNVERIFIED** | `candidate` | — | [[ahrefs]] |
| **DataForSEO** | seo-analytics | API-only SERP / keyword / backlink / on-page data, pay-per-use. **Per-request cost and minimum deposit UNVERIFIED** | `candidate` | — | [[dataforseo]] |
| **Screaming Frog** | seo-analytics | Desktop crawler. Free = **500 URLs**; £199/yr removes the cap and unlocks JS rendering — which a Vite SPA needs | `candidate` | — | [[screaming-frog]] |
| **Microsoft Clarity** | seo-analytics | Free, no traffic cap: session recordings + heatmaps. GDPR/CCPA-ready. Privacy exposure on an authenticated surface is the real cost | `candidate` | — | [[microsoft-clarity]] |
| **AnswerThePublic** | seo-analytics | Question/preposition/comparison keyword data. **API confirmed to exist** — Alpha, paid-plan only, 60 req/min. $20–199/mo | `candidate` | — | [[answerthepublic]] |
| **Perplexity search harvesting** | seo-analytics | §12B assumes the founder's own searches can be harvested. **No API path found. May not be possible as described** | `unverified` | — | [[perplexity-search-harvest]] |
| **`@open-wa/wa-automate`** | messaging | WhatsApp Web automation → HTTP API / webhooks / MCP. **Hippocratic + Do Not Harm licence**, unofficial, ban risk, partly paid | `candidate` | — | [[open-wa]] |
| *8 named references* | unverified | matthewyu.dev · sirio.online · a Framer "anti-portfolio" · a "Jackie Zhang" site · a "Thalia" stylization · Watermelon UI · Mirofish · Jules | `unverified` | — | [[unverified-references]] |

---

## Findings worth reading even if you skip the notes

Five things this pass established that contradict or sharpen what the corpus currently says:

1. **OD-03 may be mis-framed.** `services/agent-orchestrator/core/base_agent.py` has **no
   LLM integration at all** — one grep hit for `completion`, in a shutdown log line. It is
   RabbitMQ + saga + DLQ + idempotency infrastructure. Hermes and `dsh` are reasoning
   harnesses. Presenting them as three options for one slot implies a swap that is not a
   swap; the likely real shape is transport-plus-harness. Founder's call. → [[base-agent]]
2. **AnswerThePublic's API exists.** Three Growth documents record this as an open unknown
   (`search-demand-research-charter.md:103`, `-agenda-full.md:21`, `-premortem.md:63`).
   It exists, it is Alpha, it needs a paid plan, and 60 req/min is far above the documented
   monthly workload. Those three documents can be closed. → [[answerthepublic]]
3. **Perplexity harvesting has no confirmed path.** No API surface for a user's own search
   history was found; only a manual export and third-party scrapers. A manual export is a
   human task, not a loop. → [[perplexity-search-harvest]]
4. **The SEO category is blocked on credentials, not tools.** Verified: `env.example` and
   `services/agent-orchestrator/.env.example` contain **no** Search Console, analytics, SEO,
   or Perplexity key. This confirms `growth-charter.md:168`. Every tool in that category is
   downstream of one missing credential.
5. **AnyDoc and Unlimited-OCR are not competitors.** anydoc handles *digital* documents and
   explicitly does not OCR; Unlimited-OCR handles *scanned/photographed* ones and needs a
   GPU. Today's extractor accepts four image types plus PDF
   (`document-extractor.service.ts:59-64`) and sends everything to `claude-haiku-4-5`
   (`:72-77`) — so an emailed `.xlsx` price list has **no path at all**. An OD-06 bake-off
   that treats the two as one axis will produce a misleading answer.

---

## Retire-to-write

Per `CLAUDE.md §4`, adding documents means naming what they supersede. This library
supersedes **two scattered inline tables**, which should be replaced by pointers here:

| Superseded | What it was |
|---|---|
| `.planning/01-org/corporate/knowledge-documentation/knowledge-documentation-schedule.md:54-60` | A five-row category sketch of the same resources, plus the intended frontmatter contract. The contract is honoured here; the table is now duplicate. |
| `.planning/01-org/commercial/media-brand/media-brand-agenda-full.md:104-117` | A 13-row table of founder-named items marked "Unevaluated" / "Spelling unverified". Seven of its rows are now verified notes; the six reference rows moved to [[unverified-references]] (which adds Watermelon UI and Mirofish). |

**Not done in this session** (this branch was scoped to `.planning/05-library/` only, and
`OPEN-DECISIONS.md` is being edited by concurrent work):

- Replacing those two tables with links here.
- Closing the AnswerThePublic API unknown in the three `search-demand-research/*` documents.
- Marking OD-22 resolved, and recording the OD-03 framing question raised in finding 1.

Ownership stays as `knowledge-documentation-schedule.md:70-75` assigns it: corpus-archive
owns placement, graph-retrieval owns the index being a live query, standards-verification
owns freshness.

## Freshness

Every entry carries `verified: 2026-08-24`. Per the constraint in
`knowledge-documentation-schedule.md`, an entry unverified for **180 days** is stale and
must be re-checked or dropped — a library of dead links is worse than no library, because
it is trusted. Next review due **2027-02-20**.
