---
type: directive
division: applied-ai
department: skills
team: skill-registry-authoring
status: partial
metrics: [skills.protocol_compliance_rate, skills.description_disambiguation_rate]
updated: 2026-08-24
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-premortem]]", "[[skill-registry-authoring-loops]]", "[[skills-directive]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Skill Registry & Authoring — Directive

How *this* team decides. Shape: an **admission gate with a machine-checkable
predicate at every node**. Nodes that depend on a reviewer's judgement are marked;
there is exactly one, and reducing it to zero is the team's design goal.

## The gate

```mermaid
graph TD
  A["Skill proposed"] --> B{"name + description present?"}
  B -->|no| R1["REJECT · malformed"]
  B -->|yes| C{"description states<br/>WHEN to use this,<br/>not only what it is?"}
  C -->|no| R2["REJECT · undiscoverable.<br/>A skill nobody selects is dead weight."]
  C -->|yes| D{"past_instance resolves to a<br/>commit SHA / path:line / decision link?"}
  D -->|"free text"| R3["REJECT · anti-speculation gate.<br/>§3.3 rule 3. Log as harvest candidate."]
  D -->|resolves| E{"doneability criteria stated<br/>and machine-checkable?"}
  E -->|no| R4["REJECT · cannot feed NF-A"]
  E -->|yes| F{"owning_department declared<br/>AND != skills, unless tier T4?"}
  F -->|no| R5["REJECT · route to owning dept.<br/>We own envelopes, not content."]
  F -->|yes| G{"trigger intersects any<br/>registered skill's trigger?"}
  G -->|yes| H["MERGE or NARROW ⟨judgement⟩<br/>— the one human node"]
  G -->|no| I["ACCEPT · commit to .claude/skills/<br/>· add to registry index"]
  H --> I
  I --> J["Hand off to lifecycle:<br/>30-day firing clock starts"]
  J --> K[[skill-lifecycle-anti-sprawl-charter|"skill-lifecycle-anti-sprawl"]]
```

## Decision rights

**Ours, no escalation:**

- Accept / reject / merge-or-narrow any proposed skill against the gate above.
- The contract: required frontmatter fields, the description bar, the review checklist.
- The registry index shape and what counts as a registered skill.
- Whether a proposal is instead logged as a harvest candidate.
- Rejecting a skill for description collision, even over the author's objection —
  collision is a registry-level harm the author cannot see.

**Escalates to [[skills-directive]] → `OPEN-DECISIONS.md`:**

| Escalation | Why |
|---|---|
| Requiring a `tier` field | [[README]] §3.2 taxonomy is `⬦ FORK`; encoding it would decide it by side effect (CLAUDE.md §0.1) |
| **OD-14** root `SKILLS.md` | Named open decision |
| Whether skill #1 may be a port of `railway-config` with no past instance of ours | A first entry that violates our own rule sets the precedent |
| Waiving the past-instance rule for any skill | The waiver *is* the failure mode; it cannot be granted at team level |
| Registry ceiling N | [[skills-directive]] — a team scored on creation must not set the creation limit |

## Escalation trigger

1. **A waiver is requested for `past_instance`.** Never granted here. Every instance
   of M1 in [[skill-registry-authoring-premortem]] begins with a reasonable-sounding
   exception.
2. **A domain department asks us to write the body**, not just review the envelope
   ([[skills-premortem]] M4).
3. **Two skills in one quarter rejected for the same collision.** That is a taxonomy
   problem, not an authoring problem, and it belongs upstream.
4. **`script_to_skill_ratio` unchanged after the `skill-create` meta-skill ships.**
   The compliant path is not actually faster; escalate rather than add enforcement.

## Standing rule

**When accept and reject are balanced, reject** — inherited from [[skills-directive]]
and worth restating at the gate that actually applies it. A missing skill costs one
author an inconvenience. An unnecessary skill costs every future selection, and
will not be deleted, because deletion needs firing evidence this system does not yet
produce.
