---
type: division-teams
division: corporate
status: proposed
date: 2026-08-24
departments: [legal, knowledge-and-documentation, compliance-and-privacy, people-and-agent-ops, strategy-and-fundraising]
teams_listed: 11
teams_staffed_v0: 9
links: [org-structure, foundation-readme, open-decisions, claude-md]
---

# Corporate — team layer

- **Status:** PROPOSED. Departments are LOCKED ([[ORG_STRUCTURE]] §2); this layer is not.
- **Parent:** [[ORG_STRUCTURE]] §1 (Division → Department → Team) · [[README|foundation-README]]
- **Contract:** every team below is one `Team` under a locked department. Team ≠ unit —
  the 7-artifact anatomy in [[ORG_STRUCTURE]] §4 attaches to **departments**, not teams,
  pending OD-17. Teams are the internal split of a department's mandate.

---

## 0. Read this first — the honesty ledger

This is the division with the **least existing code in the company**. Before any team
below is read as capability, here is the true state:

| Department | EXISTS | PARTIAL | NEW |
|---|---|---|---|
| Legal | — | — | **all 15 document types** |
| Knowledge & Documentation | the `.planning/` vault (post-ADR-0032 cleanup); legacy `md/`+`md_files/` retired 2026-08-27 in full (the final `.sql` files exited via the ADR 0026 shrink path) | Obsidian **adopted** ([ADR 0004](../../decisions/0004-obsidian-as-backlink-layer.md)), **not installed** — no `.obsidian` vault exists | frontmatter contract, staleness detection, archive policy |
| Compliance & Privacy | versioned consent + erasure schema; 4 independent PII guards; a privacy notice | privacy notice says "WineOps"; erasure untested end-to-end | **every word of GDPR/CCPA** — zero occurrences in source |
| People & Agent Ops | 26 agent modules, `AgentMetrics`, agent registry, spend logging | metrics have no cost attribution and no doneability verdict | NF-A spine, review rubric, onboarding gate |
| Strategy & Fundraising | `YC_WEDGE_PLAN.md` (406 lines), a prior YC-lens business review | wedge metric named but not instrumented as a company metric | cap table, data room, SAFE, board consents |

**Nine of the eleven teams below start at or near zero.** That is stated once here so it
does not have to be repeated eleven times, and so nobody reads a team name as a shipped
capability. Per [`CLAUDE.md`](../../../CLAUDE.md) §0.4: this document proposes structure,
it does not report work.

**Two verification corrections to the brief that commissioned this doc:**

1. The brief said "27 Python agents." There are **26 agent modules** in
   `services/agent-orchestrator/agents/` (`ls -1 *.py | grep -v __init__` → 26); the 27th
   file is `__init__.py`. Of the 26, **25 extend `BaseAgent`**. This is not pedantry — the
   discrepancy is itself the first finding for §4.1 below.
2. The brief said `md/` = 120 files, `md_files/` = 47. Correct as **total files**;
   as **`.md` files** it is **113** and **42**. The image/asset residue is part of what
   OD-01 has to place.

---

## 1. Legal — 2 teams

Founder-named scope, all NEW: founder agreement · employment agreement · contractor
agreement · NDA · MSA · statement of work · professional services agreement · IP
assignment · SAFE · board consent · stock purchase agreement · advisor agreement · data
processing agreement · business associate agreement · letter of intent.

**The split axis is reversibility, not counterparty.** Six of the fifteen documents move
ownership of the company and are effectively un-undoable. Nine are repeatable paper whose
failure mode is *slowness*, not *permanence*. Running both through one queue means the
high-volume work sets the tempo for the one-way doors — which is the standard way a
founder ends up with a SAFE that has a term nobody modelled.

### 1.1 Instruments & Equity

- **Mandate.** The six cap-table and governance instruments: **founder agreement, SAFE,
  board consent, stock purchase agreement, advisor agreement, IP assignment.** Owns the
  executed-original chain, the board/consent record, and the tie-out to the cap table.
  Drafts on request from Strategy (§5); does not decide terms — the founder does.
- **Why distinct from 1.2.** Blast radius and gate, not subject matter. Every instrument
  here is outside-counsel-gated and permanent; nothing here should ever be turned around
  in an hour. 1.2's entire optimisation is turning things around in an hour. A team cannot
  hold both norms.
- **Evidence.** **NEW — nothing exists.** No cap table, no equity instrument, no board
  record anywhere in the repo. The only adjacent locked fact is
  [ADR 0001](../../decisions/0001-mudavym-single-entity.md) — *"One brand, one legal
  surface"* (line ~38) — which fixes that there is exactly one entity to issue against,
  and therefore exactly one cap table this team owns.
- **Primary metric.** **Instrument chain integrity** — % of executed instruments holding a
  complete chain (signed original + authorising consent + cap-table entry). Only 100% is
  a passing value; anything less is a diligence blocker discovered at the worst moment.
  Baseline: 0 of 0.
- **Premortem.** *We treat the first SAFE as a form to fill in because there is no other
  legal work competing with it, sign it under raise-timeline pressure without modelling
  dilution, and discover the term in the round that follows — by which time it is a fact,
  not a negotiation.*

### 1.2 Commercial & Workforce Agreements

- **Mandate.** The nine repeatable instruments: **NDA, MSA, statement of work,
  professional services agreement, letter of intent, employment agreement, contractor
  agreement, data processing agreement, business associate agreement.** Owns the clause
  library and the `legal-doc-draft` skill named in [[README|foundation-README]] §3.2 (T2).
- **Why distinct from 1.1.** This team's product is a *template system* — reusable clauses,
  a fallback ladder, and an agent-executable drafting path. 1.1 has six documents that will
  each be drafted once and never templated. Optimising for reuse is the whole job here and
  is meaningless there.
- **Boundary with Compliance & Privacy (§3).** Legal owns the **instrument**: the DPA and
  BAA as executable paper, their clauses and negotiation posture. Compliance owns the
  **obligations inside them** — what we actually promise about data and whether the code
  honours it. Signing a DPA whose Annex we cannot satisfy is the failure this boundary
  exists to prevent, and it is a two-signature failure, not a one-team failure.
- **Evidence.** **NEW.** No contract, template, or clause library in the repo. The only
  existing counterparty-facing legal surface is `apps/web/src/pages/Privacy.tsx` — a
  privacy *notice*, not an agreement, and owned by §3.2.
- **Primary metric.** **Median request → executable draft**, with **clause-library hit
  rate** as the leading indicator (% of a new draft assembled from reviewed clauses rather
  than written fresh). A falling hit rate predicts the turnaround regression before it
  shows up.
- **Premortem.** *Every counterparty's redline gets accepted as a one-off because there is
  no library to defend, and after twenty agreements no two say the same thing about
  liability, IP, or data — so nobody can answer "what do we owe our customers?" without
  reading twenty PDFs.*

> ⚠️ **The trim candidate, stated plainly.** Legal has the weakest evidence base of the
> five departments — literally zero artifacts. If the founder wants to cut one split from
> this document, **cut this one** and run Legal as a single team. My recommendation is to
> keep it, because the boundary's whole value is that it exists *before* the first
> instrument rather than after, and it costs one extra charter to hold. But that argument
> is structural, not evidential, and it should be labelled as such.
>
> **A third team was considered and rejected.** "Workforce Paper" (employment, contractor,
> hire-attached NDA/IP-assignment) as its own team is a team invented for symmetry: two of
> fifteen documents, zero employees, zero firing cadence. Folded into 1.2. **Split trigger:
> first W-2 hire, or first contractor in a second jurisdiction.**

---

## 2. Knowledge & Documentation — 3 teams

The department with the most **existing mass** in the division and the clearest live
problem (OD-01). Three teams because three genuinely different failures are visible in the
corpus today, and fixing one does not fix the others.

### 2.1 Corpus & Archive

- **Mandate.** Where a document lives. Owns the OD-01 restructure of `.planning/` (1,082
  `.md`), the legacy `md/` tree (113 `.md`), the duplicated `md_files/` tree (42 `.md`),
  and the permanent tail: placement rules, archive policy, and enforcement of
  [`CLAUDE.md`](../../../CLAUDE.md) §3 (*"Do not create new top-level `.planning/*.md`"*).
- **Why distinct from 2.2.** De-duplicating files and making files navigable are different
  skills with different done-states. Today's corpus proves they are independent: it is
  simultaneously **heavily duplicated** and **almost entirely un-linked**. Fixing either
  leaves the other untouched.
- **Evidence.** **PARTIAL/EXISTS.**
  - **38 basenames appear in both `md/` and `md_files/`. 35 are byte-identical; 3 have
    diverged** (verified by `cmp` over the intersection). The 35 are safe deletions; the
    3 are the actual decision, because for those "which is true?" has no mechanical answer.
  - `md/DOCUMENTATION_INDEX.md` exists — an index already, **last modified 2026-01-29**,
    still titled *"WineOps AI - Complete Documentation Index"*, asserting per-category
    file counts that the tree no longer matches.
  - Largest planning docs: `claude_full_architectural.md` (186KB),
    `UX_PATHS_CATALOG.md` (158KB), `INVOICE_DOC_UX_RESEARCH.md` (83KB) — the grep-target
    set named in [`CLAUDE.md`](../../../CLAUDE.md) §2.
  - Open fork: **OD-01** ([`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md):13).
- **Primary metric.** **Duplicate + orphan document count.** Baseline: 38 duplicated
  basenames, 3 of them ambiguous. Unlike most metrics here it has a real, reachable zero.
- **Premortem.** *OD-01 is treated as a one-time cleanup, gets done once, and six months of
  sessions each drop one more top-level doc "just this once" — so we pay for the
  restructure twice and the second time nobody remembers why the first shape was chosen.*

### 2.2 Graph & Retrieval

- **Mandate.** Whether a document can be found. Owns the Obsidian backlink layer, the
  OD-08 vault mechanics, Graphify, and the **machine-readable frontmatter contract** that
  [[ORG_STRUCTURE]] §5 mandates on every unit doc (`type`, `division`, `links`) — the
  contract that makes [[ORG_STRUCTURE]] §5's "documented now, executable later" (OD-12)
  possible without a rewrite.
- **Why distinct from 2.1.** Different close-times and different decisions. 2.1's work is
  a founder call about shape (OD-01); 2.2's is a tooling call about vault root and plugins
  (OD-08) plus a *continuous* enforcement duty on every doc written thereafter.
- **Evidence.** **PARTIAL — adopted, not installed.**
  - Adoption is **LOCKED**: [ADR 0004](../../decisions/0004-obsidian-as-backlink-layer.md).
    Mechanics are **open**: OD-08 ([`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md):19).
  - **No `.obsidian` directory exists anywhere in the repo.** Obsidian is a decision, not
    yet a tool.
  - **10 files** in all of `.planning/` contain a `[[wiki-link]]` — and 3 of those 10 are
    the ADR/template files that introduced the convention.
  - **4 of 41** spine docs (`.planning/*.md` + `foundation/` + `decisions/`) carry YAML
    frontmatter: `STATE.md`, `v1.0-MILESTONE-AUDIT.md`, `v2.0-MILESTONE-AUDIT.md`,
    `v3.0-TECH-DEBT.md`. **[[ORG_STRUCTURE]] itself — the document that mandates
    frontmatter — does not carry any.** This file is among the first that does.
- **Primary metric.** **Graph coverage** — a compound of (a) % of spine docs carrying valid
  `type`/`division`/`links` frontmatter and (b) `[[link]]` resolution rate. Baseline:
  ≈10% frontmatter, ≈1% of files linked.
- **Premortem.** *We pick a vault root before OD-01 settles the tree, every link is written
  against a path that then moves, and the graph becomes a field of unresolved `[[charter|…]]` —
  at which point the convention gets quietly abandoned and Obsidian is a decision nobody
  uses.*

### 2.3 Standards & Verification

- **Mandate.** Whether a document is *true*. Owns the doc quality bar, the
  [[ORG_STRUCTURE]] §4 anti-sprawl rule (*"an agenda that has not changed in 60 days is
  either finished or fiction"*), brand-drift detection, and the regeneration discipline for
  companion docs that [[README|foundation-README]] declares **"regenerated rather than
  hand-edited"** (`ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md`).
- **Why distinct from 2.1 and 2.3's siblings.** 2.1 answers *where*, 2.2 answers *findable*,
  2.3 answers *still true*. The stale `DOCUMENTATION_INDEX.md` is not misplaced and not
  unlinked — it is **wrong**, and neither sibling's metric would ever flag it.
- **Evidence.** **PARTIAL.**
  - **28 documents across `.planning/` and `md/` still say "wineops"** despite
    [ADR 0005](../../decisions/0005-v3-to-v0-version-reset.md) and the Mudavym rename.
    `PROJECT.md` (line 3) openly concedes it: *"identity migrates gradually."*
  - **A live contradiction, found while verifying this document.** The corpus disagrees
    with itself about its own size: `LLM_INSTRUCTION_PROMPTS.md:166` says **375 insight
    types**, while `YC_WEDGE_PLAN.md:324` and `AGENT_NATIVE_UI_DECISION.md:100` both say
    **573**. (The companion "860-path UX catalogue" figure *is* correct —
    `UX_PATHS_CATALOG.md:5`.) One of the two insight counts is wrong, both are quoted in
    strategy documents, and **the 573 sits in the YC narrative** (§5.1). This is the exact
    class of defect 2.1's and 2.2's metrics cannot see, and the reason this team is not
    a style guide.
  - The verification bar already exists as a rule —
    [`CLAUDE.md`](../../../CLAUDE.md) §7: *"Claims about behavior need evidence… 'Should
    work' is not a report."* — with **no mechanism that checks it**. This team is that
    mechanism.
  - Root `SKILLS.md` — a prose protocol misnamed as a skill registry, still branded
    WineOps. Open as **OD-14**.
- **Primary metric.** **Stale-claim rate** — % of sampled spine-doc claims that fail
  re-verification against source, plus count of live docs past the 60-day rule. A rate that
  cannot be measured is the first deliverable, not an excuse.
- **Premortem.** *Standards ship as a style guide nobody runs, so "documentation-first"
  ([ADR 0002](../../decisions/0002-documentation-first-operating-mode.md)) degrades into a
  corpus that is authoritative in tone and stale in fact — the most expensive possible
  failure, because agents read it and act on it.*

---

## 3. Compliance & Privacy — 2 staffed + 1 trigger-gated

**The split is forced by an asymmetry already visible in the source: the code has run
ahead of the paper.** There are four independent PII guards and a genuinely well-designed
versioned-consent-plus-tombstone schema in the database — and **zero occurrences of
"GDPR" or "CCPA" anywhere in the repo**. One team would keep doing whichever half it is
better at, which is exactly how that gap opened.

### 3.1 Privacy Engineering

- **Mandate.** The technical controls: consent lifecycle, erasure/tombstone execution, PII
  guards in agents and search, the data-flow inventory, and the **consent gate that Media's
  customer research depends on** ([[ORG_STRUCTURE]] §2).
- **Why distinct from 3.2.** This team's artifacts are migrations, guards, and tests. 3.2's
  are registers and obligations. A control with no obligation behind it is guesswork; an
  obligation with no control is a lie — but they are built by different work.
- **Evidence.** **EXISTS, unusually strong for this division.**
  - `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` — consent as a
    **record, not a boolean**: `consent_purpose`, `consent_notice_version`,
    `consent_captured_via` (CHECK-constrained), `consent_captured_at`,
    `consent_withdrawn_at` (lines 58–64). The in-file comment at line 54 states the design
    intent: *"Consent is per GUEST and it is a record with a version, not a boolean."*
    Erasure is a **tombstone** (line 79) — identifiers hard-deleted, row survives.
  - Four independent PII guards, built separately:
    `services/agent-orchestrator/services/constraint_engine.py:113` (C-21/C-08, *"never log
    sensitive content"*); `agents/provider_communication_agent.py:722-728` (classifier →
    discrete mode); `jobs/research_tasks.py:196-201,744-750` (blocks PII snippets from
    `evidence_citations`); `supabase/migrations/20260805000000_baseline_from_production.sql:1080`
    (D-12, PII never returned in search results).
  - Operator-facing consent UI: `apps/web/src/components/settings/ConsentDialog.tsx`,
    `ServicesPermissions.tsx`.
  - **The gap:** four guards, four different mechanisms, **no shared definition of PII**
    and no test proving an erasure request actually clears every store.
- **Primary metric.** **Erasure completeness** — for a guest erasure request, % of stores
  where absence is *proven* by test, not asserted. Baseline: schema supports it; **nothing
  proves it**.
- **Premortem.** *Four PII guards written by four different sessions disagree about what
  PII is, one of them misses a field, and we learn the definition was inconsistent from a
  guest's erasure request rather than from a test.*

### 3.2 Regulatory Posture

- **Mandate.** GDPR/CCPA and state-privacy obligation mapping; the **content** of the DPA
  and BAA (Legal §1.2 owns them as instruments); the subprocessor register; and keeping
  the privacy notice tied to actual behaviour.
- **Why distinct from 3.1.** Its deliverable is an **obligation register** — a mapping from
  each named legal duty to a named control with a `file:line` or an owner. That is the
  artifact that makes 3.1's guards auditable, and it is written, not coded.
- **Evidence.** **NEW, with two unusual head starts.**
  - `grep -ril "gdpr|ccpa|data subject|right to erasure"` over source returns **zero
    hits** outside planning prose. Obligation coverage genuinely starts at 0%.
  - **Head start 1:** `apps/web/src/pages/Privacy.tsx` is already written to the correct
    standard — its own header comment says it was *"Written to match what the code actually
    does rather than boilerplate… If any of those change, this page has to change with
    them."* That sentence is this team's charter, pre-written. It also still says
    "WineOps" (line ~23) — the first item on the list.
  - **Head start 2:** [`EXTERNAL_CONNECTIONS.md`](../EXTERNAL_CONNECTIONS.md) already
    enumerates every third-party host and all 80 environment variables. **That is a raw
    subprocessor register**, generated for a different purpose. Classifying which of those
    hosts receive personal data converts an existing artifact into a required one.
- **Primary metric.** **Obligation coverage** — % of named obligations mapped to a control
  with a citation. Baseline 0%.
- **Premortem.** *We sign a customer's DPA to close a deal, its Annex names controls we
  cannot evidence, and the first security questionnaire from a real restaurant group turns
  a signed promise into a discovered breach of contract.*

### 3.3 Regulated Operations — ⏸ TRIGGER-GATED, not staffed at v0

- **Mandate (dormant).** Alcohol licensing, excise tax, regulatory deadlines — the beverage
  platform's *operational* compliance, entirely separate from privacy law.
- **Why it is named but not staffed.** A wine and beverage platform touching real inventory
  has genuine excise and licensing exposure, and the repo already has a stub reserving the
  work. But folding it into 3.2 would make that team's mandate incoherent — GDPR and excise
  tax share only a word. So it is preserved as a named track with an explicit entry
  trigger, exactly the pattern the founder already accepted for NF-C in
  [[README|foundation-README]] §4.3 (*"preserved as ambition, not carried as dead weight"*).
- **Evidence.** `services/agent-orchestrator/agents/compliance_agent.py` — declares
  `IS_STUB = True` (line 16), subscribes to `compliance.deadline.created` and
  `compliance.report.requested`, and carries `# TODO: Insert compliance_deadlines` /
  `# TODO: Generate compliance_reports and excise_tax_records` (lines 40–41). Its own
  comment explains why the stub is declared rather than hidden: an event-consuming
  no-op *"reads identically to a working one from every dashboard and health check."*
  `core/orchestrator.py:245` refuses to start it even if enabled.
- **Entry trigger.** First customer in a jurisdiction where we hold or touch a licence, **or**
  the first time excise reporting appears in a signed MSA.
- **Premortem.** *The trigger fires and nobody notices, because a dormant team has no
  cadence — so the first excise obligation is discovered by a customer's accountant.*

---

## 4. People & Agent Ops — 2 teams

The AI-native HR function. Its workforce is **26 agent modules**, not people. Two teams
because "who is on the roster" and "is the roster any good" fail independently — and the
evidence shows both are already failing, in different directions.

### 4.1 Roster & Lifecycle

- **Mandate.** Who exists, at what maturity level, and what an agent must have before the
  orchestrator will start it. Owns the roster, the stub register, the Level 0→4 maturity
  ladder, and agent onboarding/retirement.
- **Why distinct from 4.2.** Roster hygiene is cheap, visible, and structural. Doneability
  instrumentation (4.2) is expensive, invisible, and statistical. Under one team the cheap
  visible work wins every week — which is a prediction the current state already confirms.
- **Evidence.** **PARTIAL — infrastructure exists, roster truth does not.**
  - **26 agent modules**; `core/agent_registry.py` (491 lines) is real roster
    infrastructure with lazy proxies.
  - **5 declare `IS_STUB = True`** — `auto_pilot`, `compliance`, `ghost_inventory`,
    `negotiation_playbook`, `shrinkage_detective` — and `core/orchestrator.py:245` refuses
    to start them. **This is the right behaviour and it is already the department's model
    finding**: an unimplemented worker that consumes events is worse than an absent one
    because it looks identical on every dashboard.
  - **A live roster defect, found while verifying this document:**
    `agents/recurring_order_agent.py:14` declares `class RecurringOrderAgent:` — a **plain
    class that does not extend `BaseAgent`**, is not exported from `agents/__init__.py`,
    and is not registered in the orchestrator. It therefore has no metrics, no health
    check, no retry, and no DLQ, and appears on no roster. 25 of 26 modules extend
    `BaseAgent`; this is the one that does not. **This is the first assignment.**
  - The maturity ladder already exists in prose:
    [`PROJECT.md`](../../PROJECT.md) — *"Transform 24 Level 0-1 agents into Level 4
    (Resilient)"* — note it says **24**, against 26 modules today. The ladder needs an
    owner before it needs a rewrite.
- **Primary metric.** **Roster truth** — % of agent modules whose registered state matches
  reality (extends `BaseAgent` · registered · declared level evidenced · stub flag
  accurate). Baseline: at least 2 known defects (1 unregistered module, 1 headcount
  mismatch) out of 26.
- **Premortem.** *The roster becomes a list of filenames rather than a list of workers, so
  "we have 26 agents" is repeated in an investor conversation while 5 are declared stubs
  and 1 is not even wired in.*

### 4.2 Performance & Doneability

- **Mandate.** Is the work any good, and what did it cost. Owns **task-doneability
  criteria** ([[README|foundation-README]] L3), agent performance review, and is the **primary
  consumer of NF-A** ([[README|foundation-README]] §4.2).
- **Why distinct from 4.1.** 4.1 asks *does this worker exist and is it wired in*; 4.2 asks
  *did the task actually get done, and at what cost*. Today the first question has partial
  answers and the second has none — which is precisely the split.
- **Evidence.** **PARTIAL — half of NF-A already emits; the decisive half does not.**
  - `core/base_agent.py:77` `AgentMetrics` — `messages_received/processed/failed/skipped`,
    min/max/total processing time, `errors`, `circuit_breaker_trips`, `pause_count`,
    `restart_count`; `success_rate` at line 144; `get_health()` at line 985.
  - `core/observability.py` — Prometheus `agent_processing_duration_seconds` histogram
    per agent (line 113), with a `NoopMetric` fallback (line 53) so absent Prometheus
    degrades silently rather than crashing.
  - `services/spend_logger.py` — writes to the **`api_spend` table**
    (`supabase/migrations/20260805000000_baseline_from_production.sql:2231`) with
    `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `restaurant_id`.
  - **The two gaps that define this team's first year:**
    1. **`SpendLogger.log()` has no `agent` parameter** (signature at
       `services/spend_logger.py:41-48`). Cost is attributed to a *restaurant* and a
       *model*, never to a **worker**. So "cost per task per agent" — a named NF-A field in
       [[README|foundation-README]] §4.2 — is **not derivable from what is logged today**.
    2. **No doneability verdict exists anywhere.** `AgentMetrics` records `success` meaning
       *"process_message() did not raise"* (`base_agent.py:602`) — which is liveness, not
       correctness. An agent that returns confidently wrong output scores 100%.
  - Compounding: [[README|foundation-README]] §0 item 5 — Anthropic and Gemini are called over
    **raw HTTP, not their SDKs**, so retry/timeout/cost accounting are hand-rolled.
- **Primary metric.** **NF-A doneability coverage** — % of agent task completions carrying
  both a doneability verdict and an agent-attributed cost. **Baseline: 0%**, and that zero
  is the honest number for a department whose charter names NF-A as its primary input.
- **Premortem.** *We keep measuring `success_rate` because it already exists, ship a
  dashboard that is green while agents produce confidently wrong output, and the metric
  becomes the reason nobody looks — the exact failure `IS_STUB` was invented to prevent,
  reappearing one layer up.*

> **A third team was considered and rejected. Human Ops** — real employees, payroll,
> reviews — is one person today. Naming it a team would be pure symmetry. Its scope sits
> in 4.1's charter as an explicit non-goal-until-triggered. **Split trigger: second human
> on the payroll.** Note the ordering consequence: the AI-native HR function will have a
> mature agent-review rubric **before** it has a human-review one, and that is correct
> here rather than an oversight.

---

## 5. Strategy & Fundraising — ⚠️ 1 team (flagged: no internal split at this stage)

**This is the department this document explicitly flags as one team.**

The brief anticipated two — a narrative function and a fundraise-instrument function. On
inspection the second has almost no mandate of its own at v0: the instruments are drafted
by Legal §1.1, the terms are decided by the founder, and what remains is diligence-pack
assembly — a checklist, not a standing unit. Splitting now would create a team whose
weekly agenda is "wait for a raise," and [[ORG_STRUCTURE]] §4's own anti-sprawl rule would
mark it fiction within 60 days. **The split is deferred with a named trigger, not
dismissed.**

### 5.1 Positioning & Fundraise Readiness

- **Mandate.** The wedge and the one sentence; the competitive read; the investor narrative
  and materials; the YC path; the diligence surface (data room, cap-table hygiene,
  metric provenance); and **sequencing requests into Legal §1.1** for SAFE, board consent,
  stock purchase, and advisor agreements. Owns the claim, not the paper.
- **Why one team, not two.** Both halves answer the same question — *is the story we tell
  outsiders true and provable?* Narrative failure is an unevidenced claim; diligence
  failure is an unevidencable one. Same discipline, same evidence base, one cadence.
- **Evidence.** **PARTIAL — the narrative half is unusually well developed; the
  instruments half is empty.**
  - [`YC_WEDGE_PLAN.md`](../../YC_WEDGE_PLAN.md) — 406 lines, at **Revision 3**, and
    genuinely opinionated rather than aspirational:
    - the sentence (§3, line 312): *"Restaurants get overbilled by their distributors and
      never catch it. We catch it from a photo of the invoice."*
    - the metric (line 315): **dollars recovered** — *"Not DAU, not sessions, not
      insights generated… YC-legible, customer-legible, and unfakeable."*
    - the named risk (line 323): *"This repo's biggest risk is not missing features, it is
      surface area"* — line 324 enumerates it: 573 insight types, an 860-path UX
      catalogue, a sommelier AI — *"A YC partner reads that as no wedge."*
    - an honest competitive read against MarginEdge (line 328).
    - §4's track table has real ✅ statuses (A, B0, B0a, B0b, B0c, B1 complete).
  - [`AGENT_NATIVE_UI_DECISION.md`](../../decisions/AGENT_NATIVE_UI_DECISION.md):78 — a prior
    *"Business review (YC-partner lens) — verdict: don't build."* Strategy review is
    already a practice here, not a new habit.
  - [ADR 0005](../../decisions/0005-v3-to-v0-version-reset.md) — the deliberate v3→v0
    reset is a positioning decision already on the record.
  - **NEW:** no cap table, no data room, no diligence checklist, no SAFE, no board consent.
  - **The gap between those two lines is the team's whole job**: the wedge metric is named
    but is not instrumented as a *company* metric anywhere, so "dollars recovered" is
    currently a slide, not a query. And line 324's own surface-area figure is already
    unreliable — see §2.3, where the corpus quotes both 375 and 573 insight types.
- **Primary metric.** **Claim-to-evidence coverage** — % of claims in the current external
  narrative backed by a live citation (a query, a `file:line`, or a reproducible demo).
  This is the one metric that fails in the same direction as diligence, which is why one
  team can own both halves. Secondary: diligence-pack completeness.
- **Premortem.** *The deck outruns the build — "dollars recovered" goes on a slide before
  any query returns it, a partner asks for the number, and the answer is a verdict count
  rather than money, which costs the meeting and the credibility of every other number
  on the page.*
- **Split trigger.** First live term-sheet conversation, **or** first instrument actually
  issued. At that point Fundraise Readiness earns a standing cadence and separates.

---

## 6. Summary

| # | Department | Team | Evidence | Primary metric | v0 baseline |
|---|---|---|---|---|---|
| 1.1 | Legal | Instruments & Equity | NEW | Instrument chain integrity | 0 of 0 |
| 1.2 | Legal | Commercial & Workforce Agreements | NEW | Request → executable draft | no library |
| 2.1 | Knowledge & Doc | Corpus & Archive | EXISTS | Duplicate + orphan count | 38 dupes (3 diverged) |
| 2.2 | Knowledge & Doc | Graph & Retrieval | PARTIAL | Graph coverage | ~10% fm, ~1% linked |
| 2.3 | Knowledge & Doc | Standards & Verification | PARTIAL | Stale-claim rate | 28 stale-brand docs |
| 3.1 | Compliance | Privacy Engineering | EXISTS | Erasure completeness | untested |
| 3.2 | Compliance | Regulatory Posture | NEW | Obligation coverage | 0% |
| 3.3 | Compliance | Regulated Operations ⏸ | stub only | — | gated |
| 4.1 | People & Agent Ops | Roster & Lifecycle | PARTIAL | Roster truth | ≥2 defects / 26 |
| 4.2 | People & Agent Ops | Performance & Doneability | PARTIAL | NF-A doneability coverage | **0%** |
| 5.1 | Strategy | Positioning & Fundraise Readiness ⚠️ | PARTIAL | Claim-to-evidence coverage | uninstrumented |

**11 teams listed · 9 staffed at v0 · 1 trigger-gated (3.3) · 1 department deliberately
unsplit (§5).** Three additional teams were considered and rejected as symmetry:
Workforce Paper (§1), Human Ops (§4), Market Intelligence (§5).

---

## 7. Forks raised — proposed for `OPEN-DECISIONS.md`

Deliberately **not** written into
[`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md) by this session: four sibling
division sessions are appending to that same table concurrently, and five parallel edits
to one table is a merge conflict, not a decision log. These are staged here for one
batching session to add.

> **Renamespaced 2026-08-24.** First minted as `OD-C1`…`OD-C5` (`OD-` prefix reads as the
> canonical register); reissued as `CORP-Fn` — see [FORK-REGISTRY](../../02-advisory/decision-office/FORK-REGISTRY.md).
> `CORP-F6`…`CORP-F8` were minted later in Knowledge & Documentation and are recorded there too.

| Proposed ID | Fork |
|---|---|
| CORP-F1 | **Does a *team* get the 7-artifact anatomy, or only a department?** [[ORG_STRUCTURE]] §4 costs 168 docs at 24 units; at team granularity it is far more. Interacts with OD-17. |
| CORP-F2 | **DPA/BAA ownership split** — Legal §1.2 owns the instrument, Compliance §3.2 owns the obligations (proposed here). Confirm, or give one team both? |
| CORP-F3 | **Strategy stays one team until a term sheet** (proposed §5). Confirm the trigger, or split now? |
| CORP-F4 | **Is Regulated Operations (alcohol/excise, §3.3) Corporate's at all**, or does it belong to Product once a licensing feature exists? |
| CORP-F5 | **Does `SpendLogger.log()` gain an `agent` parameter?** Without it, NF-A's named "cost per task" field is not derivable (§4.2). Schema + call-site change; belongs with OD-11. |

---

## 8. Cross-division boundaries this layer asserts

- **Legal §1.2 ↔ Compliance §3.2** — instrument vs obligation (see §1.2).
- **Legal §1.1 ↔ Strategy §5.1** — Legal drafts equity instruments; Strategy sequences and
  requests them; the founder decides terms. No team decides its own terms.
- **Compliance §3.1 ↔ Commercial/Media** — the consent gate Media's customer research
  depends on is *operated* by Privacy Engineering; Media is a consumer, never an owner.
- **People §4.2 ↔ Intelligence/Research & Math** — Research & Math *builds* NF-A and the
  harness; People & Agent Ops *consumes* NF-A to review the workforce. Same data, opposite
  direction. If both own the metric definition it will be defined twice.
- **Knowledge §2.3 ↔ every division** — Standards & Verification reviews docs it does not
  write. Note this is the same independence argument [[ORG_STRUCTURE]] §3 makes for the
  advisory layer; whether 2.3 should instead sit under the **Decision Office** advisory is
  a real question that OD-15/OD-16 should absorb rather than this document pre-empting.
