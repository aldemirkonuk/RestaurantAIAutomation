# Foundation Breakdown — Mudavym

- **Status:** Mixed. §1 (stack), §4 (neural footprint), §5 (AI-native) are **locked** via [ADR 0006](../decisions/0006-neural-footprint-architecture.md)/[0007](../decisions/0007-org-structure.md). §2 is superseded by [ORG_STRUCTURE.md](ORG_STRUCTURE.md). Items marked `⬦ FORK` remain open and belong to the founder.
- **Date:** 2026-08-24
- **Purpose:** the contract that lets many sessions work in parallel without producing six incompatible structures.
- **Keywords:** foundation, departments, skills, neural-footprint, ai-native, schedules, graph-of-loops

---

## 0. How to read this

This document defines **interfaces, not content**. It says what a department *is*,
what a skill *is*, what a metric event *looks like* — so that a department doc
written in session A and one written in session F are the same shape.

Read order: §1 (stack) → §4 (metric spine) → §2 (departments) → §3 (skills) → §8 (waves).

### Companion documents — the system as it actually is today

Generated 2026-08-24 by scanning the source. These are **grep targets**, regenerated
rather than hand-edited (CLAUDE.md §2):

| Doc | Contents |
|---|---|
| [`ENDPOINTS.md`](ENDPOINTS.md) | All **448 API endpoints** across 44 modules, with auth status per route |
| [`PAGE_MAP.md`](PAGE_MAP.md) | **51 web routes**, the navigation graph (mermaid), and cold-entry pages |
| [`EXTERNAL_CONNECTIONS.md`](EXTERNAL_CONNECTIONS.md) | Every third-party host, SDK, and the 80 environment variables |

**What the scan surfaced** (each needs an owner — see §2.2):

1. **137 of 448 endpoints have no `JwtAuthGuard`.** Combined with `TenantGuard`
   passing unauthenticated requests through, unguarded = internet-reachable.
   Of those: **32** are in webhook modules (`toast`, `simpos`, `pos-hub`,
   `inbound-email`) which are legitimately public but need **signature
   verification** instead; **11** carry an explicit `@Public()` decorator and are
   intentionally public (e.g. `vendor-portal`, a deliberately crawlable vendor
   catalogue). That leaves **94 unguarded by omission** — `analytics` (39),
   `notifications` (24), `communications` (18), `contacts` (8), `dashboard` (8),
   `procurement` (6) — requiring classification. → **Security** (§2.3).

   🔴 **One is live and financially exploitable.**
   `apps/api-gateway/src/analytics/analytics.controller.ts` carries zero
   `@UseGuards` and zero `@Public` — unguarded by omission. Anonymous callers can
   `PUT /analytics/consultants/:restaurantId/toggle` to enable the paid consultant
   layer, then `POST /analytics/consult/:restaurantId`, which reaches
   `consultants.service.ts:159` calling `api.anthropic.com/v1/messages` with
   `claude-opus-4-8` at `max_tokens: 4096`. The only brake is an in-memory,
   per-instance rate limiter. **Unauthorized spend on the founder's key,
   reachable now.**

2. **Square and Lightspeed already appear in source** (`developer.squareup.com`,
   `developers.lightspeedhq.com`), alongside Yelp and Apify. The POS-bridge
   ambition (vision §6) has more groundwork than the docs admit — worth auditing
   before treating multi-POS as greenfield. → **Product & Vision** + **Engineering**.
3. **Legacy brand still live in code:** `wineops.ai` / `app.wineops.ai` / `api.wineops.ai`
   referenced 10×. Brand migration is incomplete below the doc layer. → **Media & Brand**.
4. **`abc123.ngrok.io` and placeholder domains** (`your-domain.com`, `a.com`, `b.com`,
   `via.placeholder.com`) appear in source paths — fixtures or stale config, but they
   should never be reachable from a production code path. → **Security** / **Engineering**.
5. **Anthropic and Gemini are called over raw HTTP, not via their SDKs.** Retry,
   timeout, and cost accounting are therefore hand-rolled — which is exactly the
   surface NF-A (§4.2) needs to measure. → **Research & Math**.
6. **24 routes have no inbound in-app link** and 13 route components could not be
   traced. Some are intentional (deep links, `/v/:slug`), but a page nobody can
   navigate to is either dead or undiscoverable. → **Product & Vision**.

---

## 1. The foundation stack

Seven layers. Each layer may only depend on layers below it. This is the single
rule that keeps modules independently buildable (vision §9's modular principle).

| L | Layer | What lives here | State today |
|---|---|---|---|
| **L0** | **Data substrate** | Wine/food corpora, sales metrics, synthetic generators, POS traffic | ⚠️ **The named blocker** (vision §7). Wine enrichment in progress; food + sales thin |
| **L1** | **Domain core** | Beverage/dish identity, catalogue, inventory lots, procurement, producer reputation | Strongest layer — most `.planning` mass sits here |
| **L2** | **Module softwares** | Floor Checker, Email Watcher, Order Watcher, Invoice Understanding, Vendor Finder, Guest App | Mixed: email/order/invoice partially live; Floor Checker + Guest App unbuilt |
| **L3** | **Agent harness** | `BaseAgent`, orchestration, routing, task-doneability criteria | BaseAgent ≈ Level 3; harness choice open (OD-03) |
| **L4** | **Neural Footprint** | The metric/event spine — §4 below | Architecture locked ([ADR 0006](../decisions/0006-neural-footprint-architecture.md)); **emits nothing yet** — no cost/token instrumentation in `apps/api-gateway` |
| **L5** | **Departments** | The company org: charters, agendas, directives, owned skills | Structure locked ([ORG_STRUCTURE](ORG_STRUCTURE.md)); unit docs being generated |
| **L6** | **Surfaces** | web, mobile, guest app, API, Ask AI | Live, large, uneven |

**Why L4 sits under L5:** departments are evaluated *by* metrics. If departments
are defined before the metric spine, each invents its own success criteria and
nothing is comparable. This ordering is deliberate and is the main sequencing
claim in §8.

---

## 2. Departments

> **Superseded by [`ORG_STRUCTURE.md`](ORG_STRUCTURE.md) and [ADR 0007](../decisions/0007-org-structure.md).**
> That document is canonical for the org: **5 divisions · 20 departments · 2 sub-layers ·
> 3 advisory functions**, with a **7-artifact** unit anatomy (charter, premortem,
> agenda-full, agenda-board, directive, loops, schedule).
> The team layer lives in [`teams/`](teams/), one file per division.
>
> The nine-department sketch that was here originally is kept only in the ADR 0007
> review trail, where it belongs as history. One source of truth per decision.

### 2.3 Security's first assignment (evidence-backed, ready now)

The §12A note "have this team look at the live defects" is actionable today:

- ✅ **Resolved:** the `/ux/*` no-auth defect (D1 in `AGENT_NATIVE_UI_DECISION.md` §4)
  is fixed — `@UseGuards(JwtAuthGuard)` now present at
  `apps/api-gateway/src/ux-optimizer/ux-optimizer.controller.ts:55`.
- ⚠️ **Systemic pattern remains:** `TenantGuard` returns `true` when there is no
  authenticated user (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`),
  by design, logging a warning. So auth depends entirely on each controller
  remembering `JwtAuthGuard`.
- 📋 **Finding:** **11 of 44** controllers in `apps/api-gateway/src` lack
  `JwtAuthGuard`: `analytics`, `dashboard`, `contacts`, `notifications`,
  `communications`, `procurement/recurring-orders`, `pos-hub`, plus
  `toast`, `simpos`, `inbound-email`, `vendor-portal`.
- **The work:** classify each as *intentionally public* (webhooks — likely the
  last four, which need signature verification instead) or *a real gap*, then fix
  the gaps and add a CI check so the class of defect cannot recur.

This is a model for what a department assignment should look like: evidence,
file:line, a classification step, and a recurrence guard.

---

## 3. Skills

### 3.1 What a skill is here

A skill is a **reusable, agent-executable procedure** with a `SKILL.md` (frontmatter
`name` + `description`, then instructions). The description is what makes it
discoverable, so it must say *when to use this*, not just what it is.

**State today:** the repo has exactly **one** project skill
(`.agents/skills/railway-config/SKILL.md`). Root `SKILLS.md` is a prose reasoning
protocol, not a skill, and still says "WineOps AI" — stale brand, worth retiring
or rewriting. Everything else available is user-level GSD tooling, not
project-specific. **Building the project skill layer is close to greenfield.**

### 3.2 Skill taxonomy ⬦ FORK

| Tier | Kind | Examples | Owner |
|---|---|---|---|
| **T1** | **Domain** | `wine-enrichment`, `menu-extraction`, `invoice-parse`, `producer-research` | Engineering / Data |
| **T2** | **Department** | `seo-article-pipeline` (§12B), `legal-doc-draft`, `security-audit-pass` | The department |
| **T3** | **Operational** | `schema-drift-check`, `tech-debt-triage`, `release-verify` | Engineering |
| **T4** | **Meta** | `skill-create`, `skill-review`, `department-agenda-sync` | Research & Math |

T4 is the self-improving loop: skills that create and audit skills. That is what
"create new skills constantly" needs in order to not become sprawl.

### 3.3 Skill creation protocol

Every new skill must, before it is committed:
1. Name the **trigger** — the exact situation where it fires.
2. Name the **doneability criteria** — how we know it succeeded (feeds NF-A, §4).
3. Cite a **real past instance** where it would have helped. No speculative skills.
4. Declare **owning department** and whether it is scheduled (§6).

**Anti-sprawl rule:** a skill that has not fired in 30 days gets reviewed for
deletion. Sprawl is the failure mode of "constantly create skills," and the
counter-pressure has to be built in from day one.

---

## 4. Neural Footprint — the metric spine

You chose all three tracks, with A and B as priorities. Here is how they fit, and
one argument.

### 4.1 The definition we're inventing

No external source defines "neural footprint" as a metric — I searched and found
none. TRIBE is Meta's fMRI brain-encoding model; The Sapient Company is a separate
brain-decoding company. So this is **our term**, and the definition should earn it:

> **Neural footprint** = the durable, structured trace a decision-maker leaves
> behind — enough signal to model *why* it chose what it chose, not merely *what*
> it chose. Applied to agents (NF-A) and to guests (NF-B) with one shared schema.

That framing is what makes A and B genuinely the same object rather than two
dashboards sharing a name: both record **stimulus → internal state → choice →
outcome**. That is also the mechanism-level reasoning demanded in vision §11
(reason like chemistry, not like tagging).

### 4.2 The three tracks

| Track | Subject | Records | Consumes into |
|---|---|---|---|
| **NF-A** *(priority)* | Agents | task type, model, tokens, latency, retries, tool calls, doneability verdict, cost | Harness improvement, cost routing, ML training signal (vision §4) |
| **NF-B** *(priority)* | Guests | dish/wine exposure, choice, repeat, rating, context (region, season, companions) | Taste fingerprint, personalization, geo/cultural layer (vision §11–12) |
| **NF-C** *(gated)* | Biological | neuro/biometric response to stimulus | Research only — see argument below |

### 4.3 ⚠️ My argument on NF-C — you asked me to flag getting carried away

I think NF-C should be a **named research track with an explicit entry trigger,
not a participant in the v0 schema.** Reasoning:

- Literal neuro-decoding needs fMRI/EEG hardware, consenting subjects, and
  neuroscience staff. There is no path from today's repo to an emitted NF-C event.
- Designing the v0 schema around a source that will emit nothing costs real
  design tax on the two tracks that *will* carry the product.
- The vision's own named blocker (§7) is **data** — wine, food, sales. Not neuro.
  NF-C competes for attention with the thing actually holding the system back.
- The *inspiration* is genuinely valuable and we keep it: mechanism-level modeling
  is already baked into the §4.1 definition and into NF-B's design.

**What I propose instead:** design the NF schema with a `subject_type` field
(`agent` | `guest` | `bio`) so NF-C can plug in later without migration, and open
a research track whose entry trigger is explicit — e.g. *"a funded study partner
or a consumer-grade biosignal device with an API."* That way it is preserved as
ambition, not carried as dead weight. ⬦ FORK — this is yours to overrule.

### 4.4 Shared event shape (sketch)

```
neural_footprint_event
  subject_type    agent | guest | bio
  subject_id
  stimulus        what was presented / what task arrived
  context         jsonb — region, season, page, restaurant, model, ...
  internal_state  jsonb — confidence, considered alternatives, reasoning trace ref
  choice          what was selected / produced
  outcome         success | failure | partial + doneability verdict
  cost            tokens / latency / money (agent) | null (guest)
  occurred_at
```

⬦ FORK — table-per-track vs one polymorphic table is a real schema decision with
query-performance consequences. Belongs in a dedicated session with the Postgres
best-practices skill loaded.

---

## 5. "AI-native" — reconciled with prior art

**This is already partly decided and I will not relitigate it.**
`AGENT_NATIVE_UI_DECISION.md` §3 reached a **"don't build"** verdict on the
agent-native UI rewrite, with a premortem and a statistical argument (§8: detecting
a 10% lift at 11 restaurants is not feasible).

So **AI-native here does not mean rewriting the UI as a chat surface.** It means:

1. **Ask AI as action composer** — `ask → propose → confirm → execute`, typed and
   allowlisted, never silently mutating stock/money/email (FUTURES §8.1). One
   action schema behind all entry points, not three chatbots.
2. **Every agent decision leaves a footprint** (NF-A) — the app learns from its own
   operation.
3. **Human-gated by default** — the existing recommendation/one-tap pattern is the
   template, not an exception.

If you want to revisit the "don't build" verdict, that is a supersede-ADR, not a
side effect of this document.

---

## 6. Scheduled activities

You chose **persistent scheduled tasks**. Proposed initial cadence ⬦ FORK:

| Schedule | Job | Department | Emits |
|---|---|---|---|
| Daily | Data substrate progress (enrichment coverage, corpus gaps) | Data | NF-A |
| Daily | Open-decision queue digest — what is blocking whom | Product & Vision | — |
| Weekly | Security pass (§12C checklist + new controller/route audit) | Security | — |
| Weekly | Skill health — what fired, what went stale (§3.3 anti-sprawl) | Research & Math | NF-A |
| Weekly | Tech-debt triage against `v3.0-TECH-DEBT.md` | Engineering | — |
| Monthly | Department agenda sync — full vs board agendas drifted? | All | — |

**Rule:** a scheduled job that produces no action for 3 consecutive runs gets
downgraded or deleted. Same anti-sprawl logic as skills.

---

## 7. Graph of loops

Vision §12L calls this a must-have. Concretely it means departments and agents
connect as **feedback loops, not a one-way pipeline**:

```
  Work → Neural Footprint (NF-A) → Research & Math → harness/skill change
    ↑                                                        │
    └────────────────────── improved execution ──────────────┘

  Guest behavior → NF-B → personalization → better recommendation
    ↑                                                  │
    └───────────────── more/better guest signal ───────┘
```

Every loop must name: what it measures, what it changes, and how fast it closes.
A loop that cannot state its close-time is a diagram, not a loop.

⬦ FORK — whether this graph is a *documentation artifact* (Obsidian graph view +
Graphify) or an *executable routing structure* (agents actually dispatch along it).
These are very different builds and the answer changes L3 substantially.

---

## 8. Sequencing — why not all-parallel from minute one

You said everything in parallel. I mostly agree, and I want to argue one narrow point.

**Parallelism works when the interface is fixed.** If six sessions write six
department docs before the department *shape* (§2.1), the skill *shape* (§3.1),
and the metric *schema* (§4.4) are settled, we get six incompatible structures and
pay for all of it twice.

Your own vision says this in §12H: *pick one thing, focus on it first — while
everything else improves in parallel in the background.* Lead priority plus
background parallelism, not equal weight everywhere.

**Proposed:**

- **Wave 0 (serial, small — this doc + one more round):** lock §2.1 department
  anatomy, §3.1 skill anatomy, §4.4 metric schema. That is the contract.
- **Wave 1 (wide parallel):** every department, every skill tier, all at once,
  each session working against the locked contract. This is where "everything in
  parallel" actually pays off — and it goes faster *because* Wave 0 happened.
- **Continuous:** scheduled jobs (§6) begin as soon as their department exists.

Wave 0 is roughly one focused round. I think it buys back far more than it costs.
⬦ FORK — if you'd rather go wide immediately, say so and I'll fan out now; I just
want the tradeoff stated rather than assumed.

---

## 9. Forks raised by this document

Live status is in [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md) — that file is
canonical; this table is a pointer only.

| Raised here | Resolved as |
|---|---|
| OD-09 department set | **Resolved** — expanded to 20, not trimmed ([0007](../decisions/0007-org-structure.md)) |
| OD-10 NF-C scope | **Resolved** — gated research track ([0006](../decisions/0006-neural-footprint-architecture.md)) |
| OD-11 NF storage | **Resolved** — production/research split; column detail still open |
| OD-12 loop graph | **Resolved** — documented now, executable later |
| OD-13 wave plan | **Resolved** — Wave 0 contracts first |
| OD-14 root `SKILLS.md` | Open — retire or rewrite |
| OD-19 endpoint classification | Open — 94 unguarded by omission |
| OD-20 analytics spend exposure | 🔴 Open, urgent |
