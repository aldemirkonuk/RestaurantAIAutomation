---
type: agenda-full
division: advisory
department: architecture-review
status: provisional
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites]
updated: 2026-08-24
links: ["[[architecture-review-charter]]", "[[architecture-review-premortem]]", "[[architecture-review-agenda-board]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[schema-migrations-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[model-routing-inference-economics-charter]]", "[[product-vision-charter]]", "[[ORG_STRUCTURE]]", "[[README]]", "[[ENDPOINTS]]", "[[PAGE_MAP]]"]
---

# Architecture Review — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

One rule, seven open findings, and no machinery of any kind.

The rule is [[README]] §1: *each layer may only depend on layers below it.* The seven
findings are in [[architecture-review-charter]] §Evidence, each verified against source.
The machinery — a finding log, a destination for a finding, a map from directory to
layer, a check in CI — **does not exist**. This function is graded NEW without
qualification.

That combination sets the agenda, and it sets it in an order that is not obvious. The
tempting first move is to write up the seven findings, because they are real and they are
sitting there. **That is the wrong first move**, and
[[architecture-review-premortem]] #1 is the reason: a finding written into a system that
cannot hold it, age it, or escalate it is a document, and documents are what theatre is
made of. Build the smallest possible mechanism first, then publish into it.

## How

Sequenced. Steps 0 and 1 are together about two days of work and everything else depends
on them.

### Step 0 — decide where a finding lands *(blocks literally everything)*

[[ORG_STRUCTURE]] §3 says findings go into the reviewed unit's `questions.md`. That file
does not exist in any of the 99 units and the 7-artifact anatomy (§4) does not create one.
Every generated unit does carry `agenda-full.md` → *"## Questions for the founder"*, which
is where open questions already collect in practice.

**Two options, and this agenda has a preference but not the authority:**

| Option | For | Against |
|---|---|---|
| **A — add `questions.md` as an 8th artifact** | Matches [[ORG_STRUCTURE]] §3 as written; a finding gets its own addressable file per unit | 99 more files on top of 693; anatomy is **LOCKED** at 7 (OD-17) |
| **B — findings bind to the reviewed unit's `agenda-full.md` §Questions**, tagged `source: architecture-review` | Zero new files; lands where the unit already looks; Dataview can query it | Bends [[ORG_STRUCTURE]] §3's wording; a busy agenda can bury a finding |

**Preference: B**, with the finding *also* written into this function's own log so age is
tracked in one place regardless of where the text lives. But it is a change to a locked
anatomy either way, so it is the founder's. → §Questions #1.

### Step 1 — write the layer map down *(one page; no violation is detectable without it)*

[[README]] §1 gives each of L0–L6 a sentence. Nothing maps a **directory** to a layer, so
*"is this a violation"* currently has no mechanical answer — which means today's seven
findings rest on a reviewer's judgement rather than on a stated rule, and that is exactly
the position from which [[architecture-review-premortem]] #4 starts.

The first draft is short and will be wrong in places, which is the point — a wrong map
gets argued with, and the argument is the review:

| Layer | Directories (first draft) |
|---|---|
| L0 | `supabase/migrations/`, `datasets/` |
| L1 | domain modules in `apps/api-gateway/src/` (catalogue, inventory, procurement) |
| L2 | `services/agent-orchestrator/agents/`, the module-shaped gateway services |
| L3 | `services/agent-orchestrator/core/` |
| L4 | `api_spend`, `decision_log`, and whatever NF becomes — **currently unassignable, see AR-4** |
| L5 | `.planning/01-org/`, `.planning/02-advisory/` |
| L6 | `apps/web/`, `apps/mobile/`, the gateway's controller surface |

The ambiguities are the interesting part and must be recorded as ambiguities rather than
resolved by fiat: the gateway is L1, L2 **and** L6 depending on the file, and `L4` has no
home at all. Owner of the answer: [[engineering-charter]] and
[[ai-orchestration-charter]]; owner of the question: here.

### Step 2 — first sweep, dated, publishing the seven

With 0 and 1 in place, the founding findings are published into a log that can age them.
Sweep one is scoped to **Platform** ([[architecture-review-schedule]] rotation) plus the
two cross-cutting findings (AR-2, AR-4). Each entry carries: severity, `path:line`,
reviewed unit, date raised, and — from day one — **age**.

### Step 3 — one mechanical check, in the shape of the one that already works

`scripts/check_schema_parity.sh` is the only mechanism in the repo that closes a
layer-boundary loop by itself (AR-6). Copy its shape — rebuild from the source of truth,
diff against reality, exit non-zero — for the cheapest violation class:
**an import-boundary check** derived from Step 1's map, wired into CI.

This is deliberately Step 3 and not Step 1. Per [[architecture-review-premortem]] #2, a
function that builds the linter first becomes the linter. The check exists to stop the
grep-able class from consuming human sweeps, not to be the review.

### Step 4 — the first invariant census

The census is the method that finds what a linter cannot, and AR-2 is proof it works: two
lists, counted, one session, a live legal exposure found. First census subject —
**"every model call is metered"** — because it covers AR-3 and AR-4 at once and produces
a number [[neural-footprint-instrumentation-charter]] needs regardless of what this
function concludes. Second — **"every request is tenant-scoped"** (AR-5), coordinated with
[[security-charter]] so it is one finding and not two.

### Step 5 — close the first finding, by either route

The first finding to close — **fixed or accepted in writing** — is the most important
event in this function's first quarter, more than any individual finding's content. It is
the proof that the mechanism converts. AR-2 is the candidate: it is small (append eleven
patterns to a Python list, or delete one of the two copies), unambiguous, and carries
legal exposure that makes "accept in writing" an uncomfortable choice to make silently.

## Why now

1. **AR-2 is live and gets worse by drifting further.** A guardrail that is 19 patterns on
   one path and 8 on the other is not a documentation problem. Every week the two lists
   are maintained independently, the divergence grows, and the comment claiming they are
   identical makes it *less* likely anyone checks.
2. **AR-4 is the only finding with a decaying, unrecoverable cost.** [[README]] §4.1
   defines the neural footprint as *the durable trace a decision-maker leaves behind.*
   Traces not recorded are not recoverable later. Every week without a join key between
   `decision_log` and `api_spend` is a week of agent reasoning whose cost can never be
   attributed, retroactively, by anyone. Nothing else on this agenda decays.
3. **Layer rules are cheap now and expensive at scale.** AR-1 is two files today. [[PAGE_MAP]]
   counts 51 routes and growing. The same pattern at thirty files is a migration project;
   at two it is an afternoon.
4. **The function's own credibility window is short.** Per
   [[architecture-review-premortem]] #1, the habit of acknowledging-and-deferring forms in
   the first few sweeps, and once formed it does not un-form. What this function does in
   its first 42 days determines whether it exists in a year.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 0 | Decide the finding destination — `questions.md` or `agenda-full` §Questions | **Founder** (locked anatomy, OD-17) → §Questions #1 |
| 1 | Directory → layer map, first draft | — |
| 2 | Sweep one: publish the seven findings with ages | Steps 0, 1 |
| 3 | Import-boundary check in CI, shaped like `check_schema_parity.sh` | Step 1 |
| 4 | Census #1 — "every model call is metered" | Step 1 |
| 5 | First finding closed by decision (either way) | Step 2 |

Steps 1, 3 and 4 have **no founder dependency**. If Step 0 stalls, they proceed and the
findings queue locally — but note that a finding queued locally with no destination *is*
[[architecture-review-premortem]] #1 in miniature, which is why Step 0 is a question and
not a task.

## Questions for the founder

1. **Where does a finding land?** [[ORG_STRUCTURE]] §3 says `questions.md`; the locked
   7-artifact anatomy (OD-17) does not create one and none exists. **This function's only
   output currently has no defined destination** (AR-0). Add an 8th artifact, or bind
   findings to the reviewed unit's `agenda-full.md` §Questions? Preference: the latter.
   Either way it is a change to a locked decision.
2. **Is the 42-day age escalation adopted?** A finding that survives three sweeps stops
   being a finding and becomes an `OPEN-DECISIONS.md` binary: *fix it, or accept it in
   writing with an owner and a revisit date.* This is the operational form of the risk
   [ADR 0007](../../decisions/0007-org-structure.md) named when it locked findings-only.
   Without it, findings-only has no failure mode that anyone notices.
3. **Is the merge trigger binding?** *If by 2026-11-24 fewer than half of raised findings
   have closed by decision, Architecture Review merges into [[decision-office-charter]].*
   Symmetric with OD-24 (Skills self-retirement) and directly relevant to OD-26 (do
   structures only ratchet upward?). This function believes it should be binding and
   believes the general rule should be standing.
4. **Who owns the directory → layer map?** Step 1 needs an owner for the *answer*.
   [[engineering-charter]] is the natural one, but the map is the interface between this
   function and every reviewed unit, and an interface owned by the reviewed party is not
   an interface.
5. **AR-2 — fix, or accept?** The commitment guardrail is 19 patterns in TypeScript and 8
   in Python, with a comment asserting they are identical. This is a legal exposure
   (UCC contract formation, per the code's own comment) and a two-hour fix. It is also the
   ideal first close for this function. A written *"accept"* is a legitimate answer — but
   it should be written.
6. **The evaluation seam and its colliding ID.** `teams/technology.md:845` numbers the
   [[agent-evaluation-gates-charter]] ↔ [[evaluation-doneability-charter]] overlap
   **OD-21**, which is already taken (`OPEN-DECISIONS.md:25`, Obsidian workflow, locked).
   It needs a free ID before it can enter the log. Structurally this function reads the
   seam as an **L4 ownership question**, and endorses the instruction already on record:
   if the methodology/operations line fails, **merge — never duplicate.**
7. **Scope — too wide in one direction and too narrow in another, simultaneously.**
   - **Too wide:** *"All of Platform, Applied AI, and Product"* is nine units and ~40
     teams reviewed by a function with no build capacity.
     [[architecture-review-premortem]] #5 is Product silently dropping off the list. The
     rotation in [[architecture-review-schedule]] is the proposed mitigation; narrowing
     to Platform + Applied AI for the first quarter is the honest alternative.
   - **Too narrow, and this is the sharper half:** [[ORG_STRUCTURE]] §3 still words the
     mandate as *"All of Technology + Product"*, written before Technology was split and
     before **Research & Math was promoted to its own division** on 2026-08-24. Read
     literally, **L4's owner is outside the review scope** — AR-4 is addressed to
     [[neural-footprint-instrumentation-charter]], which now sits in Research & Math.
     A layer stack reviewed everywhere except at its metric spine is not reviewed. Either
     §3's wording is refreshed to name the divisions that exist, or AR-4 has no recipient.
