# 0034 — Every unit gets an agent stack: declarative cards, layered git-native memory

- **Status:** **Locked 2026-08-27** — the founder answered the four framing forks
  in-session (via AskUserQuestion), delegated the harness- and memory-approach picks
  with named criteria ("benefit at scale, SOTA" / "fetches what it needs, improves,
  and developers can see how"), and locked the same day by re-stating the criteria
  ("the most scalable and highest quality, cutting-edge for us") — which the recorded
  picks are the ones satisfying; no pick was overruled.
- **Date:** 2026-08-27
- **Decider:** Aldemir (founder) — granularity, placement, and the delegations; Claude — the two delegated picks, recorded here for the founder to lock or overrule
- **Keywords:** agent-stack, agent-card, harness, memory, skills, consolidation, async, ninth-artifact
- **Links:** [[0007-org-structure]], [[0006-neural-footprint-architecture]], [[0008-nf-column-contract]], [[0017-doneability-verdicts-are-sidecar-claims]], `foundation/GENERATION_BRIEF.md` §7, `_templates/agent-stack.md`

## Context

The founder asked for every team to have "its own AI agent skills and harness and
memory," designed **as docs, not build**, working **asynchronously** with `01-org`
and the Applied AI division. The vault has 99 units × 8 artifacts; none of the 8
says what a unit's *agents* are, what they may touch, or what they remember. The
seams already exist and are locked or chartered: the skill envelope
([[skills-charter]]), the harness mechanism ([[harness-runtime-charter]], with
**OD-03 open**), the mutation gate ([[action-safety-the-human-gate-charter]],
FUTURES §8.1), model economics ([[model-routing-inference-economics-charter]]), and
the NF-A event shape (ADR 0006/0008/0017). What is missing is the per-unit contract
that composes them.

Four forks were put to the founder in-session (2026-08-27):
**granularity** — all 75 teams and their orchestrating units (departments +
advisory), not a division-level summary; **placement** — a 9th slug-prefixed
artifact, `<slug>-agent-stack.md`, from a new `_templates/agent-stack.md` (the
retire-to-write rule is read as extended by the org-generation exemption — this is
wave 2 of the same generation, one template + per-unit instances, no competing doc
retired because none exists); **harness treatment** and **memory model** —
delegated, criteria above.

## Options considered

**Harness treatment:**
1. **Declarative agent card, requirements-only** *(chosen)* — each unit declares
   triggers, consumes/emits, routing class, quality bar, autonomy tiers, escalation;
   one centrally-owned runtime consumes N cards. Appeals: at 75+ teams, N specs ×
   1 runtime beats N wirings — the fleet's founding fact (26 modules, 4 different
   counts of "how many agents", `agent-fleet-charter` §Boundaries) is what implicit
   wiring rots into; a card is a diffable source of truth the census can reconcile
   against the registry. It is also the current cross-industry convergence
   (agent manifests/capability declarations). Costs: cards can drift from reality —
   mitigated because the census *is* an Applied AI team's charter metric.
2. **Full per-team harness config** — richer, but it front-runs OD-03 (whose
   charter forbids making any option "progressively more expensive to abandon"),
   blurs the locked Applied AI ownership seam, and multiplies exactly the
   fragmentation the model-pin finding documents (7 call sites, 3 pinned values).
3. **Wait for OD-03** — blocks 99 docs on a bake-off with no date; and a
   requirements-only card is consumable by *any* OD-03 outcome, so waiting buys
   nothing.

**Memory model:**
1. **Layered, git-native, NF-A-spined** *(chosen)* — procedural = skills
   (`.claude/skills/`, Skills' locked location); episodic = the unit's NF-A events
   (the schema already records stimulus → internal state → choice → outcome, which
   *is* an episodic memory row); semantic = one-fact-per-file `memory/` dirs beside
   the unit's artifacts with provenance frontmatter (`source`, `confidence`,
   `last_verified`) and a per-unit index; working = bounded index-first loading. A
   scheduled **consolidation** job distills episodic → semantic (failures first) and
   emits skill candidates into [[skill-harvesting-charter]]'s queue; every memory
   write lands as a PR. Appeals: this is the SOTA loop (reflection, skill
   libraries, tiered memory) built on substrates that already exist here, and it
   satisfies the founder's legibility criterion *structurally* — an agent's learning
   is a reviewable diff, its errors are NF-A rows with sidecar verdicts, and its
   forgetting is an expiry rule a developer can read. Costs: PR-gated writes are
   slower than a database write; accepted — the gate is the feature.
2. **Database-backed memory (NF-extension or vector store first)** — stronger for
   runtime retrieval at volume, but it is a build dependency in a docs-only phase,
   and it fails the legibility criterion: a developer cannot diff an embedding.
   Named as the likely *retrieval accelerator* later, layered under the same
   file-canonical contract, not instead of it.
3. **Do nothing (memory stays implicit in transcripts)** — costs exactly what the
   founder named: no fetchability, no improvement loop, no way to see why an agent
   erred.

## Decision

Adopt a 9th unit artifact, **`<slug>-agent-stack.md`** (template
`_templates/agent-stack.md`), for all 99 units: a **requirements-only declarative
agent card** per agent (harness-agnostic while OD-03 is open; model choice stays
with aio-model-routing; stock/money/outbound mutations stay confirm-gated per
FUTURES §8.1), **§3.3-compliant T2 skill tables** (real past instance or the row
does not exist), and **four-layer git-native memory** with a PR-gated consolidation
loop feeding the skill-harvesting queue. Cross-unit interaction is **async only**:
loops with close_times, NF-A events, vault artifacts/PRs, skill candidates — never
a synchronous call. Everything ships `status: designed`; nothing is build.

## Consequences

- Easier: any harness that wins OD-03 has 99 ready specs to consume; the fleet
  census gains a declared baseline to reconcile against; agent self-improvement
  becomes reviewable in ordinary code review; the skill registry gains a supply
  line that still passes the §3.3 gate.
- Harder / given up: 99 more documents to keep honest (mitigated: cards carry
  gap rows and evidence grades, and the census metric catches drift); per-unit
  memory stays file-speed until a retrieval layer is built.
- Revisit when: OD-03 resolves (cards may gain harness-specific extensions);
  or the first built consolidation loop shows PR-gating is too slow for a
  measured, named cadence — the signal is a consolidation backlog metric, not a
  feeling.

## Corrections — 2026-08-28 adversarial audit

- Stale counts in the locked text: "99 units" became **100** the same day (ADR
  0035 item 8), and the fleet is **24** modules on disk at measurement, not the
  charter-era 26. The lock's substance is untouched; the numbers are.
- **The retire-to-write reading is flagged as a founder fork, not settled.** The
  Context paragraph read wave 2 as covered by the org-generation exemption in a
  parenthetical; the audit correctly notes OD-34's exemption names only "the
  initial 693-doc generation" and that this reading was never put to the
  founder. Put to the founder 2026-08-28 — outcome recorded in the review trail
  when answered.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-27 | Founder (AskUserQuestion, in-session) | Granularity, placement, git handling picked; harness + memory approach delegated with criteria |
| 2026-08-27 | — | Created |
| 2026-08-27 | Founder (AskUserQuestion, in-session) | **Locked** — criteria re-stated ("most scalable, highest quality, cutting-edge"); recorded picks stand unchanged |
| 2026-08-28 | Adversarial audit (founder-ordered) | WOUNDED — stale counts corrected above; retire-to-write exemption escalated to the founder as a fork |
