---
type: agenda-full
division: commercial
department: growth
status: active
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, content.published_units_per_week, content.faq_orphan_pages, editorial.claims_traceable_pct, editorial.gate_bypass_count, seo.indexed_pages, seo.soft_404_rate, answer_surface.assistant_citations, funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.fabricated_social_proof_count]
updated: 2026-08-28
links: ["[[growth-charter]]", "[[growth-premortem]]", "[[growth-directive]]", "[[growth-loops]]", "[[growth-schedule]]", "[[growth-agent-stack]]", "[[growth-agenda-board]]", "[[growth-questions]]", "[[search-demand-research-agenda-full]]", "[[content-production-agenda-full]]", "[[editorial-gate-agenda-full]]", "[[technical-seo-ai-answer-surface-agenda-full]]", "[[conversion-funnel-agenda-full]]", "[[client-surfaces-charter]]", "[[brand-identity-charter]]", "[[compliance-privacy-charter]]", "[[design-partner-operations-charter]]", "[[strategy-fundraising-charter]]", "[[decision-office-charter]]", "[[0039-activation-plan-of-record]]", "[[perplexity-search-harvest]]", "[[answerthepublic]]", "[[OPEN-DECISIONS]]"]
---

# Growth — Full Agenda

> **Active — dated 2026-08-28.** First real agenda, replacing the 2026-08-24 provisional
> forecast. Written under [[0039-activation-plan-of-record]] Track B, `GENERATION_BRIEF` §8.
> Every task below names a **doneability**, a **close_time**, and the **evidence** that makes
> it real. Reach items are graded, and the ones that are aspiration pending a decision say so
> in their own row rather than in a footnote.

## The one thing that changed today

**OD-53 is settled on both halves, by fetch, dated.** The seed for this agenda was to stop
quoting Growth's step 1 as a possibility and find out. Two dated lines, in the form ADR 0016
fixed for model rate rows:

| Half | Verdict | Source | Retrieved |
|---|---|---|---|
| (a) Perplexity search-history endpoint | **NO.** The complete published endpoint index — Router (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/models`), Agent (`/v1/agent`, `/v1/agent/{id}`, `+files`, `+cancel`), Search (`/v1/search`), Embeddings (`/v1/embeddings`, `/contextualized`), Sonar (`/v1/chat/completions/async` and its list/get), Auth (`/v1/auth/token`, `/revoke`), Analytics (`/v1/analytics/usage`, `/usage/v2`) — contains **no endpoint returning the authenticated user's own searches, threads, or Library history**. The one list endpoint, `GET /v1/chat/completions/async`, returns *async API requests for a given user*, not web-app searches | `https://docs.perplexity.ai/llms.txt` (endpoint index); `https://docs.perplexity.ai/api-reference` | 2026-08-28 |
| (a) corroboration | The API is **zero-retention by policy** — "We do not retain any query data sent through the API and do not train on any of your data" — so there is no API-side store a history endpoint could read. Separately, the feature was **requested and promised and has not shipped**: a Perplexity staff reply dated **2025-06-08** said "We are actually actively working on this, should be available by end of August 2025"; twelve months later it is absent from the index above | `https://docs.perplexity.ai/faq/faq`; `https://community.perplexity.ai/t/i-would-like-an-api-to-retrieve-conversation-history/478` | 2026-08-28 |
| (b) AnswerThePublic API tier / price / rate limit | **API exists. Alpha.** Enabled per workspace under **Account → API Access**; anyone in the workspace generates a **personal access token**; **60 requests per minute per token**; higher throughput by request to Support. Covers keyword research — creating searches, retrieving reports, requesting AI-model answers. **Included with paid plans, not available on the free plan.** Each API search consumes plan credits; the same keyword/language/region within 24h reuses the existing search rather than spending again | `https://answerthepublic.zendesk.com/hc/en-us/articles/15219088022555-Does-AnswerThePublic-Have-an-API` (vendor help centre) | 2026-08-28 |
| (b) price | Starter **US$20/mo** (US$160/yr, US$99 lifetime), 60 monthly credits · Growth **US$99/mo** (US$792/yr, US$490 lifetime), 350 credits · Business **US$199/mo** (US$1,592/yr, US$990 lifetime), 800 credits | `https://answerthepublic.com/pricing` | 2026-08-28 |

**Three honesty notes on the fetch, because a settled decision is only as good as its
residual unknowns:**

1. **The cheapest tier that carries API access is still unconfirmed.** The vendor's help
   centre says "paid plans" without naming a floor; the pricing page (retrieved 2026-08-28)
   lists **no API line on any tier**. [[answerthepublic]] flagged this same gap on
   2026-08-24 and it did not close. Do not assume Starter includes it — that is the one
   thing GRO-3 must confirm before any spend proposal.
2. **A third-party review disagrees and is wrong.** `thatmarketingbuddy.com/api/answerthepublic`
   (page dated updated 2026-07-08) states "No API available. No Zapier or Make integration
   either." The vendor's own help centre overrides it. Recorded rather than silently
   discarded, because the next person searching will hit that page too.
3. **Half (a) is an absence of a capability, not an absence of confirmation.** That is a
   stronger verdict than [[perplexity-search-harvest]] could reach on 2026-08-24 — it had a
   no-evidence search pass; this has the complete published index plus a zero-retention
   policy statement plus a broken twelve-month-old shipping promise. Growth may now state
   plainly: **the founder's pipeline step 1 cannot be built as a programmatic harvest of
   Perplexity history.** What it can be is GRO-2.

**Consequence, stated once so it is not re-litigated:** the corpus is not retrieved, it is
**captured at source**. A harvest that depends on a human clicking "Export Data" is a
scheduled human task, and any loop close_time claimed for it is fiction
([[perplexity-search-harvest]]). Capture-as-you-search is a loop. That is GRO-2, and it is
the difference between the founder's pipeline running and the founder's pipeline being a
diagram.

## What

Growth's agenda is **not** "start the pipeline". It is three things in dependency order, and
the ordering is the department's only real decision:

1. **Settle what the pipeline stands on** — OD-53 (done, above), the publishing target
   (undecided and *never filed*), and the corpus mechanism that replaces the impossible one.
2. **Run the loop end-to-end once, on a surface that already exists** — `/v/:slug` is public,
   server-rendered, and already emits schema.org JSON-LD nobody has validated. It needs no
   decision from anyone. This is the agenda's most ambitious move and its cheapest.
3. **Keep every published promise true while measuring** — the funnel, the privacy coupling,
   and the three hard zeros.

**Publishing stays outward-facing throughout.** Every drafting task below produces a
*proposal*; a human publishes. No task in this agenda gives any agent an outbound publish
right — the `growth-board-keeper` card fixes `mutate_stock_money_outbound: confirm` as a
constant precisely because publishing to a public URL is an outbound act
([[growth-agent-stack]] §2).

## The agenda

Owner column is the team lane. `close_time` is when the task must have **moved**, not when it
must be finished — a task still in the same state at its close_time is an escalation, per
[[growth-directive]]'s escalation trigger 4.

### §A — The spine: the corpus, on verified ground

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-1** | Carry the settled OD-53 verdict into the three team documents that still ask it as an open question, and flip [[perplexity-search-harvest]] from `unverified` to `verified: no such endpoint` with the dated lines above | G1 [[search-demand-research-agenda-full]] | The word "unverified" no longer appears against either half in `search-demand-research-charter.md:103`, `search-demand-research-agenda-full.md:21`, `search-demand-research-premortem.md:63`, and each carries the URL + retrieval date rather than a restatement | **14 days** (2026-09-11) | The three citations are named in [[answerthepublic]] §"Why it might matter here specifically"; the OD-53 register row names exactly this deliverable ("Two dated lines in this entry, in the form ADR 0016 fixed for model rate rows") |
| **GRO-2** | **Build capture-at-source as step 1.** The `search-harvest-capture` skill: every research session writes the exact queries it ran to the corpus *as it runs them*, not reconstructed afterwards. The manual Perplexity export becomes the named backstop, with its human cost stated as a number | G1 | Two consecutive weekly research sessions each produce a committed corpus file with ≥1 captured query and **zero** entries reconstructed from memory; the `demand-queue-keeper` card's declared gap — `topic: research.session_completed → publisher: NONE (gap — OD-53)` — gets a named publisher | **weekly**, first close 2026-09-04 | `cards.json` `demand-queue-keeper.declared_gaps[0]` names this exact gap and cites OD-53; [[growth-schedule]] §Skills row 1 names the skill and its real past instance (`services/agent-orchestrator/api/research_routes.py` harvests external sources at scale and retained none of its queries) |
| **GRO-3** | The AnswerThePublic adoption brief: which paid tier actually carries API access, the Alpha-breakage risk, the credit arithmetic against the documented workload, and a recommendation. **Growth proposes; it does not purchase** | G1 → [[decision-office-charter]] | A one-page brief carrying: the tier that includes API access **confirmed with the vendor, not inferred**; the 60 req/min limit measured against the workload of ten distinct questions per topic monthly; the Alpha-breakage inheritance stated; and an explicit "no credential exists — `env.example` (194 lines, verified 2026-08-28) has no slot" line | **14 days** (2026-09-11) | The dated fetch above; `search-demand-research-charter.md:27` and `-schedule.md:23` fix the workload as "ten most distinct questions per topic, monthly"; [[answerthepublic]] §"What adopting it would cost" already flags that Starter's API inclusion "was not separately confirmed and should be checked before purchase" |

### §B — The decision that blocks eight items, and was never filed

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-4** | **The publishing-target decision brief**, with a recommendation rather than three neutral options. Inside `apps/web` / a separate surface / a static generator — each costed against a *measured* property of the current deploy, not an argument | Growth dept → [[decision-office-charter]] | A brief whose row text is ready to file verbatim, each option carrying one measured cost, and a named recommendation Growth is willing to be wrong about in writing | **14 days** (2026-09-11) | The 2026-08-24 agenda called this "an **open decision**, not a task" and item 1 of 8. **Four days later there is still no row**: the register runs OD-01…OD-110 with no publishing-target entry (verified 2026-08-28). A blocker that blocks eight items and is not in the register is the register-rot failure the vault has already learned twice |
| **GRO-5** | **The crawl-floor census — measured, never inferred.** `curl -I` three nonexistent URLs against the live deploy; fetch `/`, `/privacy`, `/v/:slug` with JS disabled; request `/robots.txt`, `/sitemap.xml`, `/llms.txt`; record response headers on a content route | G4 [[technical-seo-ai-answer-surface-agenda-full]] | A committed census file with **observed** status codes, so `seo.soft_404_rate` is a measurement and not an assertion. A census that cannot reach the deployment **fails**; it never reports green | **7 days** (2026-09-04), then weekly | `vercel.json:13-16` rewrites `/((?!api/\|assets/).*)` → `/index.html`, so the CDN answers 200 before React loads; `apps/web/src/App.tsx:328` then redirects client-side. `apps/web/public/` holds exactly seven files, none of them a crawl file. **Citation drift corrected 2026-08-28:** wave-1 docs cite `vercel.json:12-15` and `App.tsx:302`; both moved. The `crawl-surface-sentinel` card's quality bar supplies the fail-not-green rule |

### §C — The ambitious move: run the whole loop on a surface that already exists

**The argument.** Every Growth loop except L-GRO-6 is blocked on a publishing target, and the
publishing target is blocked on a founder decision. But the company already operates one
public, server-rendered, schema-emitting content route, and it needs nobody's permission:
`/v/:slug` (`apps/web/src/App.tsx:160`), served by a `@Public()` controller
(`apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:40`) whose service emits
schema.org JSON-LD server-side (`vendor-portal.service.ts:127`) under a discipline stated in
its own comment at `:120` — *a zero-price Offer is a valid document and a false statement*.
[[growth-schedule]]'s `answer-surface-audit` row states the gap in one line: it "already
emits JSON-LD **nobody has ever validated against a consumer**."

So: stop waiting. Run publish → index → cite against the surface that exists.

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-6** 🔭 | **Make `/v/:slug` the pilot answer surface.** Validate its JSON-LD against at least one real consumer, establish whether it is indexed at all, and run L-GRO-3 end-to-end against real URLs — months before a marketing surface exists | G4 + G2 | The emitted JSON-LD validates against a structured-data consumer with the result committed; `seo.indexed_pages` reports a **measured** number (zero is a valid measurement) or names the precondition that made it unreadable; one full L-GRO-3 close-time runs against live URLs rather than reporting *blocked* | **45 days** (2026-10-12) | `App.tsx:160`; `vendor-portal.controller.ts:40` (`@Public()`); `vendor-portal.service.ts:120,127`; [[growth-schedule]] `answer-surface-audit` names the never-validated JSON-LD as the past instance. **Graded — the reach is real but conditional:** whether any vendor catalogue is *published* in production is unverified from the repo. **Step one of this task is that check**, and if the answer is none, the task converts to a finding and the loop stays blocked. Saying so here is cheaper than discovering it at the close_time |
| **GRO-7** 🔭 | **The answer-surface citation probe**, so `answer_surface.assistant_citations` becomes an instrument instead of an intention: ask the corpus's own questions of the major assistants on a cadence, record whether a Mudavym URL is cited, feed the result back into page shape | G4 | A runner producing a dated table over ≥20 questions with its **sampling frame written down**, where every number carries the word *sampled* by construction; a run against a zero-page corpus prints `0 of 20, sampled` rather than crashing or reporting *blocked* | **monthly**, first dry run 2026-09-28 | [[growth-loops]] L-GRO-3 fixes close_time monthly and already records the honest limitation — "assistant citation is sampled, not enumerated. There is no impressions report for an AI answer"; the `crawl-surface-sentinel` quality bar requires *sampled* "wherever it appears". **Graded:** the runner is buildable now; a non-zero citation number is aspiration pending GRO-4 |
| **GRO-8** 🔭 | **The first content unit is the discipline itself.** Draft the answer-surface rule the repo already enforces — *emit no claim rather than a false one* — as the pilot long-form unit plus its ten FAQ pages, and run the entire pipeline through it once: corpus → draft → mandatory human pass → publish → FAQ layer → refeed | G2 + G3 | The unit clears G3 **on first pass** with a complete provenance record; the article is served with a real status code and a title visible with JS disabled; each of the ten FAQ pages contains something the article does not; a human — not an agent — performs the publish | **60 days after GRO-4 resolves** | `vendor-portal.service.ts:120` is the source and it is *our own code*, which is why this unit's provenance is complete on day one and its claims cannot be overstated — the exact opposite of the recovery-number failure ([[growth-premortem]] M2). Answer-first template per [[content-production-agenda-full]] §How. **Graded: aspiration pending GRO-4.** It is drafted, gated, and held — never published into a surface that does not exist ([[growth-directive]] sequencing rule) |
| **GRO-9** | `robots.txt`, sitemap, canonical tags, `llms.txt` — each shipped **with its honesty note in the same commit** | G4 | Files served, sitemap non-empty, and a one-paragraph committed note stating that `llms.txt` is a young convention with no guaranteed consumer and an unverified benefit | **30 days after GRO-4 resolves** | `apps/web/public/` holds seven files, none of them a crawl file; `apps/web/index.html` has a `<title>` at `:7` and a `<meta name="description">` at `:8` and **no `og:`, no `twitter:`, no `rel="canonical"`** (verified 2026-08-28); [[technical-seo-ai-answer-surface-agenda-full]] §How already writes the `llms.txt` honesty note |

### §D — The gate: the only Growth team nothing blocks

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-10** | **The provenance format and its first worked example — before any draft exists.** One file format, one worked example, and the worked example is the recovery number | G3 [[editorial-gate-agenda-full]] | The format exists as a committed file; the worked example demonstrates the format **catching** an overstatement — *dollars recovered* resolved down to *we asked*, not *we received*; and the five-check verdict artifact runs claims-traced first, always | **21 days** (2026-09-18) | [[YC_WEDGE_PLAN]]:31-33 is the claim; [[editorial-gate-agenda-full]] §How fixes the five checks and their order; [[growth-schedule]] per-publication row makes the verdict a committed artifact. **G3 is the one lane with no blocker** ([[editorial-gate-agenda-full]]: "None of the four artifacts depends on a publishing target"), which makes this the department's only immediately-runnable production work |
| **GRO-11** 🔭 | **The claim register, stocked before the gate opens.** The gate is being built for pages that do not exist while the company's *existing* outward claims — deck, vault, app copy — sit ungraded. Build the register against those surfaces now, so G3 opens against a stocked provenance store rather than an empty one | G3 | Every claim in the register carries either a `path:line` or an external URL **with a retrieval date**, and `claim-provenance-check` can grade every row; `editorial.claims_traceable_pct` becomes computable against a real denominator instead of `n/a` | **30 days** (2026-09-27) | [[growth-schedule]] `claim-provenance-audit` (T2) names the recovery number as "exactly the claim this exists to catch". **Boundary check is step one and is not optional:** `GENERATION_BRIEF` §8.3 assigns corporate/strategy-fundraising "the YC readiness register with per-claim verification". If that register is the same mechanism, Growth **consumes it and does not build a second one** — the ask goes to their `questions.md`, and this row converts to a consumer row. Two claim registers is the sprawl this vault's retire-to-write rule exists to prevent |

### §E — Measure the funnel without making a published page false

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-12** | **Exhaust the two no-consent options before proposing either of the other two**: server/CDN log-derived visit counts, then first-party session counting without a cookie | G5 [[conversion-funnel-agenda-full]] | `funnel.measurable_steps` moves from **0** to **≥3** pre-login steps with **zero diff required** to `apps/web/src/pages/Privacy.tsx`. If it cannot, the written finding names which step is unreachable and why — an unreachable step recorded is a result; an unrecorded one is [[growth-premortem]] M4 beginning | **30 days** (2026-09-27) | `apps/web/src/lib/uxSignals.ts:15` ships dark (`VITE_UX_OPTIMIZER === "true"`) and `:21` states the server "buckets on the authenticated user id" — it cannot observe a first visit by construction. `Privacy.tsx:31` promises no tracking cookies and no consent banner; `:49` says telemetry is off unless explicitly enabled. [[conversion-funnel-agenda-full]] §How ranks the four options |
| **GRO-13** | **The privacy-coupling guard, in CI rather than in memory.** Any diff touching tracking configuration or `apps/web/index.html` ships with a `Privacy.tsx` diff, or neither ships | G5 + [[compliance-privacy-charter]] (they hold the pen); CI change asked of [[client-surfaces-charter]] | A guard that **fails** a synthetic PR which would have passed before it existed — proven against the pre-fix tree, not asserted — and that **blocks rather than passes** when it cannot determine the answer | **21 days** (2026-09-18) | `Privacy.tsx:11` states the coupling contract *in a code comment, where CI cannot read it* — "If any of those change, this page has to change with them." [[growth-schedule]] `privacy-coupling-check` (T3) names CI as its trigger; the `funnel-census-keeper` quality bar already fixes the rule: "A coupling check that cannot determine the answer **blocks**, it never passes" |
| **GRO-14** | **Close the 404 seam by naming the one unit that ships it.** G4 owns the status code at the host; G5 owns the page and its CTA; neither ships it alone, so today neither ships it | G4 (decides) + G5 (objects), per [[growth-directive]] §seams | A nonexistent URL returns a **non-200 status observed in production** — not a screenshot — and the page behind it is `NotFoundError` with a CTA a lost visitor can act on | **30 days** (2026-09-27) | `apps/web/src/components/ui/error-state.tsx:142` exports `NotFoundError`, referenced **only by its own Storybook file** (verified 2026-08-28: the sole other repo hit for the string is an unrelated camera `DOMException` case at `components/scanner/CameraCapture.tsx:29`). A rewrite cannot produce a 404: this needs a hosting-layer mechanism, not a router change |

### §F — The honesty machinery that makes the rest publishable

| ID | Task | Owner | Doneability | close_time | Evidence |
|---|---|---|---|---|---|
| **GRO-15** | **Design the empty state for social proof deliberately**, so the honest option is the available one. Copy and structure only — **not** landing visuals, which are held | G5 + G3 | A written, dated statement shippable today with one design partner and no verified recovery number ("One design partner, results pending verification" is a shippable sentence), and `funnel.fabricated_social_proof_count` still **0** | **30 days** (2026-09-27) | [[growth-premortem]] M5: the soft version — a case study written from a design partner's politeness — is the one that actually happens. **Lock respected:** brand/landing visuals are HELD (ADR 0039, founder re-confirmed 2026-08-28); this task produces the sentence and the slot's logic, never the visual design |
| **GRO-16** | **Run L-GRO-6 monthly and let it report red.** Every green checklist item asserted against its bound outcome metric | Growth dept (`growth-board-keeper`) | A board where **every row carries a value, the word "blocked", or "unmeasurable" with its failed precondition named** — and zero composite scores. A single "growth score" is a failed run | **monthly**, first close 2026-09-28 | The `growth-board-keeper` card's `quality_bar` states this verbatim; [[growth-loops]] L-GRO-6 is the one loop that "can close today — and it will report red"; [[growth-premortem]] M3 is the failure it exists to catch |

🔭 = reach item. Four of sixteen. Each carries its own grading in its evidence cell.

## What is aspiration, plainly

- **GRO-8 is aspiration pending GRO-4.** It is drafted and gated on schedule; it is not
  published until a target exists. Publishing it early is precisely [[growth-premortem]] M1.
- **GRO-6 is conditional on a fact this agenda could not verify from the repo** — whether any
  vendor catalogue is published in production. Step one is that check, and a negative answer
  converts the task to a finding.
- **GRO-7's runner is buildable now; its numbers are not.** A citation count against zero
  published pages is `0 of 20, sampled`, which is a measurement, not a result.
- **GRO-11 may be somebody else's task.** Boundary check first; a second claim register would
  be sprawl, not ambition.
- Everything else is work that can start this week.

## Cross-unit asks (filed to the other unit's `questions.md`, never assumed)

| To | Ask | Why it is theirs |
|---|---|---|
| [[client-surfaces-charter]] | The hosting-layer mechanism for a real 404 status, and server-rendered `<title>` on content routes | Growth states the requirement; Engineering ships it ([[growth-charter]] §non-goals) |
| [[compliance-privacy-charter]] | Every word of any notice amendment GRO-12 implies, and review of the GRO-13 guard's semantics | Growth never drafts privacy copy — full stop |
| [[brand-identity-charter]] | The voice guide G3 enforces, and the banned-construction list | **A gate enforcing its own opinion is not a gate.** M1 writes the definition; G3 applies it |
| [[strategy-fundraising-charter]] | Does the YC readiness register subsume GRO-11's claim register? | One mechanism or two — their answer decides whether GRO-11 is a build or a consume |
| [[design-partner-operations-charter]] | The dated artifact behind any recovery figure, before it appears in a draft | S1 produces verified dollars; G3 refuses anything stronger |
| [[decision-office-charter]] | File GRO-4's brief as a register row, and confirm OD-53's two dated lines land in the register | Growth wrote the lines; the register is not Growth's to edit |

## Questions for the founder

1. **Where does content get published?** Unchanged from 2026-08-24, still unfiled, still
   blocking eight items. GRO-4 will bring a recommendation rather than three neutral options.
2. **Given OD-53(a) — no Perplexity history endpoint exists** — do you accept
   **capture-at-source** (the searches are written down as a session runs them) as step 1 of
   your pipeline, or do you want the monthly manual export with its human cost stated as a
   number? Growth's recommendation is capture-at-source; the export is a scheduled human
   task, and a scheduled human task is not a loop.
3. **The domain.** `wineops.ai` is still live across shipped surfaces and `apps/web/index.html:7`
   still titles every page *WineOps AI — Restaurant Wine Management*. Publishing under a name
   we are migrating away from costs the credibility the content is buying. Before or after
   the first unit?
4. **Gate throughput.** If you are the only editor, what is the sustainable weekly number?
   Growth caps production at it rather than building a queue.
5. **Pre-login measurement.** GRO-12 assumes we keep the promise at `Privacy.tsx:31` and
   measure without a cookie. Confirm, or tell us to change the promise — Growth will not act
   on either without you.
6. **Which claim leads?** The corpus is built around it, and GRO-8 currently proposes the
   discipline itself as unit one because it is the claim whose provenance is complete today.

## Seeds considered and rejected

| Seed | Why not |
|---|---|
| Brand-voice groundwork as a Growth task | [[growth-charter]] §non-goals is explicit: [[brand-identity-charter]] *writes* the voice definition, G3 *applies* it. A gate enforcing its own opinion is not a gate. Filed as a cross-unit ask instead |
| A landing or marketing page sketch | **Locked** — brand/landing visuals are HELD (ADR 0039, re-confirmed 2026-08-28). The canvas at `sketches/065-growth-agenda-canvas/` is an agenda one-pager, not a landing page |
| Anything with a price on it | **Locked** — pricing is founder-deferred; [[unit-economics-pricing-charter]] owns it. GRO-3 proposes a spend *brief*, not a purchase, and names no price for our own product |
| "Start the Search Console refeed loop" | Its precondition is a verified domain and an indexed page; scheduling it now would be a task that cannot close, which is [[growth-premortem]] M1 in miniature |
| The `question-set-distinctness` skill | [[growth-schedule]] defers it outright: no past instance, and the skill-creation protocol forbids speculative skills. It returns when the first FAQ layer exists |
| A composite "growth health score" for the board | The five numbers are not commensurable and the `growth-board-keeper` quality bar makes averaging them a **failed run** |

## Next close-time

**2026-09-04** — GRO-2 (first weekly capture) and GRO-5 (crawl-floor census) must have moved.
Anything in §A or §B unmoved at 2026-09-11 escalates to [[decision-office-charter]] under
[[growth-directive]] trigger 1: *the publishing target is still undecided at the start of a
close-time.*
