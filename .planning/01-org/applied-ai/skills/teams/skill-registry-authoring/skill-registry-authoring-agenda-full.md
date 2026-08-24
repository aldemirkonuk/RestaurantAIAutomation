---
type: agenda-full
division: applied-ai
department: skills
team: skill-registry-authoring
status: provisional
metrics: [skills.protocol_compliance_rate, skills.registry_size, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-premortem]]", "[[skill-registry-authoring-directive]]", "[[skill-registry-authoring-loops]]", "[[skill-registry-authoring-schedule]]", "[[skill-registry-authoring-agenda-board]]", "[[skills-agenda-full]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Skill Registry & Authoring — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. `.claude/skills/`
> does not exist; the registry holds 0 committed skills.

## What

Turn [[README]] §3.1–3.3 from prose into an enforced contract, and put the first
real skill behind it. Four concrete artifacts:

1. `.claude/skills/` — created, committed, with a seed skill in it.
2. `SKILL.template.md` + a written contract, owned here rather than borrowed from a
   gitignored vendor file.
3. `scripts/check_skill_protocol.sh` — the §3.3 gate, in CI.
4. A registry index: skill · tier · owning department · trigger · past instance.

## How

- **Contract from the shape that already works.** `.agents/skills/railway-config/SKILL.md`
  demonstrates the bar: an actionable `description:3` that enumerates *when to use
  this*, numbered rules including prohibitions (`:16`), a command block (`:31`), an
  authoring section (`:69`), and a review checklist (`:204`). Extract that shape,
  commit it, cite provenance — do not keep reading a gitignored file as canon
  ([[skill-registry-authoring-premortem]] M4).
- **Enforcement by grep, not by reviewer.** The repo already proves the pattern:
  five `scripts/check_*.sh` guards wired into `.github/workflows/ci.yml`. The §3.3
  gate is the sixth. Make `past_instance` resolve to a commit SHA or a `path:line`
  so the anti-speculation rule is checkable rather than aspirational (M1).
- **Collision scan at authoring time.** Diff a proposed trigger against every
  registered trigger *before* accept, not weekly afterwards (M2).
- **Make compliance faster than the bypass.** A `skill-create` meta-skill that
  pre-fills trigger, past instance, and owning department from the motivating commit.
  If authoring a skill is slower than writing a script, the registry loses (M3).

**Sequencing note.** This team can do all of the above **without** the telemetry
that blocks [[skill-lifecycle-anti-sprawl-charter]]. It is therefore the department's
only unblocked team, and should not wait.

## Why now

- **The retrofit cost is zero today and rises with every skill.** At
  `registry_size == 0`, setting the contract is free. There is no better moment and
  there will not be one.
- **OD-14 is trivially closable and actively misleading.** Root `SKILLS.md` is the
  file a new contributor opens looking for the registry; it is a reasoning protocol
  and still says "WineOps AI" (`SKILLS.md:3,53`).
- **Procedures are already being written constantly** — just into `scripts/`, with
  no protocol, no owner, and no discoverability. The mandate is being satisfied in
  the wrong place.

## Next steps

| # | Step | Output | Blocked by |
|---|---|---|---|
| 1 | Create `.claude/skills/` | directory, committed | — |
| 2 | Extract `SKILL.template.md` into ownership | committed template + provenance note | 1 |
| 3 | Write the contract doc: required frontmatter, description bar, tier field | contract | 2 |
| 4 | `scripts/check_skill_protocol.sh` + wire into `.github/workflows/ci.yml` | CI guard | 3 |
| 5 | Seed skill #1 with a genuine citable past instance | first registry entry | 3 |
| 6 | Close **OD-14** — retire or rewrite root `SKILLS.md` | one fewer stale doc | founder call |
| 7 | Registry index doc + trigger-collision scan | index | 5 |
| 8 | `skill-create` meta-skill (T4 — the one tier this dept may own) | faster compliant path | 4 |

Steps 1–5 are days. Step 6 needs a founder sentence. Step 8 is the one that decides
whether M3 happens.

## Questions for the founder

1. **OD-14 — retire or rewrite root `SKILLS.md`?** If rewrite: does the reasoning
   protocol move into `CLAUDE.md`, into a T4 skill, or stay as prose under a
   non-colliding filename?
2. **Does skill #1 have to be a genuinely new skill, or may we port
   `railway-config`?** Porting gives a real, working entry immediately but cites no
   past instance of *ours* — it would enter the registry non-compliant with the very
   rule this team enforces. Recommendation: port it as `_contract/` provenance and
   make skill #1 something with a real citation.
3. **What is the description bar?** The vendor file's `description:3` is ~60 words
   and enumerates five trigger verbs. Is that the standard, or is it too long to
   scale across 15+ skills?
4. **Tier field in frontmatter — required?** [[README]] §3.2 marks the T1–T4
   taxonomy `⬦ FORK`. Requiring a `tier` field commits to a taxonomy that is not
   locked. Ask before encoding it.
