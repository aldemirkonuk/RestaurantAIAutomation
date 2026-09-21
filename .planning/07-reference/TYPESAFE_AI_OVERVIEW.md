---
type: reference
title: TypeSafe AI (Jev) — product overview, use cases, benefits, limitations
status: research record
updated: 2026-09-17
source: docs.typesafe.ai (crawled 2026-09-17), typesafe-ai/skills GitHub repo
---

# TypeSafe AI — full overview

Research record from crawling `docs.typesafe.ai/llms.txt` and every linked page reachable
from it (introduction, concepts, primitives, patterns, models, API, cookbooks, legal,
agent-skill). Not used anywhere in this codebase yet — this is background for a future
build decision, not a locked choice. Written in plain language, exhaustive on purpose per
founder request; cite this file by section rather than re-deriving from the live docs.

## 1. What it actually is

TypeSafe sells access to **Jev**, a model family they call a "System One model." The pitch:
normal LLMs are built to write text for a human to read. If what you actually want is a
piece of code to make a decision — pick one of three options, rate something on a scale,
answer yes/no — you're currently forcing a text generator to do that, then writing brittle
parsing code to turn its prose back into a value your program can use.

Jev skips the text step. You send it a **state** (the thing to be judged — a message, a
record, a document) plus one or more **questions** with a fixed answer shape, and it
returns **typed values and probabilities** directly: no prose, no parsing, no "please
output JSON" prompt-engineering. It is not an agent — it does not choose its own next step,
call tools, or run a loop. It answers narrow questions that your own code's control flow
decides what to do with.

**Training**: normal LLMs go through RLHF (reward the reply a human prefers — what made
ChatGPT good at conversation) or RLVR (reward verifiably correct answers — what makes
reasoning models good at math, but slow and expensive). TypeSafe trains Jev with something
they call **RLCD** ("reinforcement learning for calibrated decisions"): the model is
rewarded for returning a probability that matches real-world frequency, not for sounding
right. TypeSafe's stated goal is a "greater than 100x intelligence-to-speed-and-cost ratio"
versus asking a general LLM to do the same narrow judgment.

## 2. The three primitives — the entire product surface

Every request is: one `state` + a map of named `questions`, each of a fixed type. All
questions in one request are evaluated **independently and in parallel** — one answer is
never hidden context for another. You can mix all three types freely in one call.

| Type | Answers | What comes back | Use it for |
|---|---|---|---|
| **Choice** | "Which one of these options?" | `choice` (the pick), `probabilities` (full distribution over your options), `confidence` | Routing, classification — anything that maps to a discrete code path |
| **Score** | "Where does this land on a rubric I define?" | `score` (can fall between two levels), `legend`, `probabilities`, `confidence` | Severity, frustration, quality, relevance — anything ordered |
| **Noul** | "Is this true?" | `noul`, a single float 0–1 (no separate confidence field) | Yes/no detection — spam, urgency, "does this contain X" |

Every question needs an `instructions` string (the actual judgment, written out in full —
question **IDs are never sent to the model**, so a self-explanatory-looking ID like
`is_urgent` teaches the model nothing; write the real question in `instructions`). Choice
and Score also need `criteria` (the option list / the ordered rubric levels).

**Answers are constrained by construction** — Jev can only return one of your options or a
position on your levels, never a value outside the schema. There is no "recover the value
from generated prose" step, ever.

## 3. How you're supposed to design a system around it (the "how to build" doctrine)

This is the part TypeSafe pushes hardest, and it's the load-bearing idea for evaluating
whether it fits Mudavym:

- **Code owns the workflow. Jev answers narrow questions inside it.** Not an agent
  replacing your control flow — a component you call from inside it, like a very fast,
  cheap function that understands language.
- **Decompose broad judgments into atomic questions, recombine with code you control.**
  Don't ask "rate this ticket's priority" — ask three separate things (severity, customer
  frustration, information completeness) and combine them with a weighted formula in your
  own code. When priorities change, you edit a number in code, not a prompt.
- **Ask everything you might need in one call, including speculative questions you might
  throw away.** Because every question in a request runs in parallel against the same
  state, adding a question that only matters for 20% of inputs costs almost nothing — the
  code just ignores the unused answers. This is the **Speculative Fan-Out** pattern.
- **Use confidence as a second axis, separate from the answer itself.** High confidence →
  act automatically. Medium → ask for confirmation or flag for review. Low → escalate to a
  human or a real reasoning LLM. Thresholds are meant to scale with the stakes of the
  action (a destructive operation needs a higher bar than a read-only one), and are meant
  to be tuned against your own labeled data, not taken as universal defaults.
- **Two requests are the exception, not the rule.** Only make a second call if your code
  genuinely cannot construct the second request until it has the first answer (e.g. it
  needs the first answer to go fetch more data). Otherwise ask everything together.

## 4. The four named architectural patterns

| Pattern | What it does | What it buys you |
|---|---|---|
| **Speculative Fan-Out** | Batch every question — including ones you might not need — into one call | Cost, speed |
| **Confidence-Gated Routing** | Use `confidence` as a second axis: act, confirm, or escalate | Reliability, safety |
| **Composite Scoring** | Split one fuzzy judgment into several atomic Scores, combine with code-owned weights | Cost, reliability, speed |
| **Intent Routing** | Classify what the user/message wants, route to a handler (deterministic code, a specialist LLM, or a human) | Cost, speed |

## 5. Use cases — by shape of decision, then by industry

**Decision shapes** (from the use-case map — this is the more useful lens than industry):

- **Classification** — one category wins (intent, topic, department, entity type)
- **Detection** — probability that one property is present (spam, fraud, urgency, jailbreak, sensitive data)
- **Scoring** — ordered rubric (severity, relevance, quality, frustration, suitability)
- **Routing** — a category selects the next code path (tool use, escalation, support queue)
- **Search / Retrieval / Ranking** — semantic search, RAG context selection, candidate ordering
- **Verification** — check an artifact for a specific failure mode (citation support, policy violation, tool-call error)
- **ML feature extraction** — turn free text into probabilistic features for a downstream classical model (e.g. CatBoost)
- **Structured data extraction** — recover known fields from unstructured text by turning "what's the value" into "which of these candidate spans is it" (a Choice, not a generation)

**Industries called out explicitly** (each with several concrete example decisions in the
source doc): search/retrieval, scientific literature review, LLM model routing, LLM
guardrails, semantic code linting, recruiting, lead generation/scoring, **customer
support** (ticket classification, urgency/frustration/churn/refund detection, response
verification against policy), insurance claims, financial crime/KYC, legal & compliance,
e-commerce marketplaces (listing classification, counterfeit detection), trust & safety /
moderation, advertising (brand safety), gaming (chat moderation), risk assessment, demand
forecasting, and knowledge-graph entity alignment/verification.

For Mudavym specifically, the closest-fit shapes on the map are the **customer-support**
and **e-commerce marketplace** rows (ticket/email triage, vendor-conversation intent,
invoice/document field extraction, menu/producer entity matching) — none of this is a
recommendation to adopt it, just noting where the vendor's own map lines up with things
this repo already does with other methods (see `INBOUND_EMAIL_INTELLIGENCE_PLAN.md`,
`DISH_IDENTITY_DESIGN.md`, `PRODUCER_REPUTATION_PLAN.md` in this same directory).

## 6. Benefits, with the vendor's own numbers (cookbooks — read the caveats in §8 first)

All these are **vendor-published cookbook results**, not independent benchmarks, and all
ran on `jev-1.12` (one point release behind the current `jev-1.13`), cached and
reproducible via a `json_cache.json` shipped with each cookbook.

- **Batching cost/speed** (`parallel_questions` cookbook): 13 questions over a ~54,000-
  character GDPR article, asked as one batched call vs. 13 separate calls. Same answers
  either way (std-dev of repeated answers was 0 or near-0 under both strategies) —
  **12.2x cheaper, 10.0x faster** batched, because the large document is sent once instead
  of 13 times.
- **Re-ranking accuracy** (`rerank_typesafe` cookbook): BM25 keyword search alone put the
  correct passage first for only 5% of 40 legal queries against a 3,565-passage corpus
  (though it was *somewhere* in the top 30 for 100% of queries). Re-scoring each of the 30
  candidates with one `Noul` question per pair and re-sorting raised that to **18% at rank
  1, 35% in the top 5, 62% in the top 10** — 1,200 calls total, costing $0.0645.
- **LLM guardrails** (`llm_guardrails` cookbook): a battery of 4 `Noul` hazard questions +
  1 `Score` severity question, one call per message, correctly routed a mix of jailbreaks
  (including a real "DAN" prompt and a disguised "Neurosemantical Inversitis" jailbreak),
  medical-dosage requests, and a self-harm message to block/review/support paths
  respectively, while passing ordinary messages and a legitimate refusal-reply through.
  The same probabilities, re-routed under a different named policy (`strict` vs.
  `permissive`), gave different actions — showing policy is a config change, not a re-ask.
- **RAG passage filtering against prompt injection** (`classifying_rag_passages`
  cookbook): a planted forum post containing a hidden instruction ranked **1st** by plain
  cosine-similarity retrieval for a real query — a `contains_prompt_injection` Noul caught
  it at 0.99 and excluded it before it reached the generator model. On a second query, a
  passage that directly contradicted the query's false premise was correctly routed to a
  separate "conflicting evidence" block rather than silently dropped, and the downstream
  LLM answer correctly surfaced the conflict instead of confabulating an answer to a
  premise the docs didn't support.
- **Speed and cost as a structural claim, not just a cookbook**: the vendor states most
  queries complete in ~100ms and the pricing model charges **only for input tokens** —
  output tokens (i.e. the returned decision) are free (see §7).

## 7. Pricing, rate limits, and models (as published; re-verify before budgeting)

- One model family right now: **Jev 1.13** (`jev-1.13.0`). Aliases `jev-latest` and
  `jev-preview` both currently point to it.
- **Price: $42 per billion input tokens ($0.042 per million).** Output tokens are free —
  because outputs are typed values/probabilities, not generated text, there's nothing to
  charge for on the output side.
- **Rate limits (stated as provisional and actively changing):** 250,000 tokens/second,
  1,200 requests/minute. The docs explicitly warn these numbers can move without notice
  while the vendor scales GPU capacity, and that higher/stable limits require a sales
  conversation.
- **Context limit**: 64k tokens combined for `state` + all `questions` in one call; more
  specifically 32k tokens for `state` + the single longest question. ~150,000 characters
  of English text is the practical ceiling per the primitives page.
- Endpoint: `POST https://api.typesafe.ai/v1/systemone`. `GET /v1/models` lists available
  aliases. Python SDK (`typesafe-sdk`, requires Python ≥3.10) and a JavaScript SDK
  (`@typesafe-ai/sdk`) both exist; both retry `429`/`529` with backoff by default.
- **Data/legal**: TypeSafe states a commitment not to train on customer data, offers a
  Data Processing Agreement and a Master Customer Agreement, and offers zero data
  retention (ZDR) for enterprise customers on request (`privacy@typesafe.ai`).

## 8. Limitations — the vendor's own published "jaggedness" list for jev-1.13

TypeSafe publishes a dated, model-version-specific limitations page
(`model-jaggedness/jev-1.13.md`, "last reviewed 2026-09-16" — i.e. the day before this
crawl). This is unusually candid for a vendor doc and is the most important section for
deciding fit:

1. **Literal reading.** It answers the words you wrote, not the intent behind them. No
   room for implied conditions — every boundary case needs to be spelled out explicitly in
   `instructions`/`criteria`, or split into two literal questions combined in code.
2. **Bad at math and counting.** Do not ask it to count occurrences, tally list items, or
   compare numeric magnitudes (including interpolating a Score's `expectation` into an
   exact number). Counting scales with list size and gets worse as the list grows. Convert
   any counting task into N separate yes/no questions and sum the results in code, or just
   do it in code without a model at all.
2b. **Weak with numeric/low-level representations.** Hex colors, RGB triples, raw
   assembly/binary — all underperform their equivalent plain-English description. Convert
   to named/semantic form before asking, keep the model for the genuinely-fuzzy part.
3. **Bad at date/time arithmetic.** Reads dates as text, not ordered quantities — don't ask
   which of two dates is earlier or how far apart they are. Extract the date *parts*
   (month/day/year, each a small closed set → turn into a Choice) with the model, then do
   all comparison/arithmetic in code.
4. **Struggles with indirection.** Multi-hop reasoning (a property of a property, double
   negatives) loses accuracy. Point directly at the relevant state field by name; don't
   make it chain inferences.
5. **Context rot from irrelevant state.** Accuracy drops as the state fills with content
   unrelated to the question being asked, and it gets harder to tell *why* it went wrong.
   Filter/retrieve in code first; send only what each question needs.
6. **Not adversarially robust by default.** It treats the `state` as data, but text
   deliberately written to argue for its own classification, or to inject instructions,
   *can* move the answer — same general class of risk as prompt injection against any
   LLM. The vendor's own mitigation advice is "be explicit in criteria and test edge cases
   before deploying," not "it's immune." (Their own `classifying_rag_passages` cookbook
   shows a 0.99 catch rate on one planted injection example — promising, but one example,
   not a security guarantee.)
7. **Contradictory instructions vs. criteria confuse it** — e.g. a Noul where `true` is
   mapped to mean "no" performs worse. Keep phrasing of the question and its criteria
   aligned and plain.
8. **It cannot generate text.** It is not a substitute for a generative model — for
   extraction with an unbounded answer space, use a real generative model or regex to
   propose candidates, then let Jev *pick* among them (a Choice), rather than asking Jev to
   produce the value itself.

**Other limitations not in that list but visible elsewhere in the docs:**

- **Single vendor, single model family, no images/audio/video** — text (string/JSON/array)
  only, no multimodal input, as of this crawl.
- **Rate limits are explicitly unstable** ("adjusting dynamically... can change without
  notice") — not yet a mature, SLA-backed platform for anything latency- or
  volume-critical without a direct sales relationship.
- **Confidence is a convenience default, not a guarantee.** The vendor is explicit that
  `confidence` is *one* reasonable summary statistic of the probability distribution, and
  that other derived measures may be better for a given use case — you get the full
  `probabilities` array specifically so you aren't locked into their default.
- **New/early-stage company.** Diogo Almeida (co-founder) is credited as a co-inventor of
  RLHF/InstructGPT-era work, which is a credibility signal, not a substitute for
  independent evaluation. No independent (non-vendor) benchmark was found in this crawl —
  everything quantitative in §6 comes from TypeSafe's own cookbooks.

## 9. What installing the agent skill does, concretely

The `typesafe-ai` skill (installed 2026-09-17 into `.agents/skills/typesafe-ai/SKILL.md`
via `npx skills add typesafe-ai/skills --skill typesafe-ai --agent cursor -y`, tracked in
`skills-lock.json`) does not add any TypeSafe code or dependency to this repo by itself —
it only teaches a coding agent (this one) how to reach for the TypeSafe API correctly *if*
a task calls for it: read the live docs index first, prefer atomic decomposed questions,
batch speculative questions, and keep the questions/thresholds in one reviewable file. The
vendor's own "vibe coding" guidance (in `agent-skill.md`) explicitly warns that agents are
bad at writing good questions and that a human should review and edit them collaboratively
— relevant given this project's ADR discipline (CLAUDE.md §0.1–0.2): nothing here should be
wired into product code without a decision record, since none of this is currently used
anywhere in the codebase.

## 10. Sources (every page read for this record)

Index: `docs.typesafe.ai/llms.txt`. Pages fetched: `introduction`, `introduction/quickstart`,
`concepts/system-one`, `concepts/state`, `primitives`, `confidence`,
`concepts/how-to-build-with-system-one`, `concepts/use-case-map`, `patterns`,
`introduction/machine-learning-primer`, `model-jaggedness/jev-1.13`, `models`, `api`,
`legal`, `agent-skill`, and cookbooks `parallel_questions`, `rerank_typesafe`,
`llm_guardrails`, `classifying_rag_passages`. Also read directly:
`github.com/typesafe-ai/skills` raw `SKILL.md` (installed skill source).
