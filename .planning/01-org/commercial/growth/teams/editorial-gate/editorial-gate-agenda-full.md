---
type: agenda-full
division: commercial
department: growth
team: editorial-gate
status: provisional
metrics: [editorial.claims_traceable_pct, editorial.gate_bypass_count, editorial.overstated_claim_catches]
updated: 2026-08-24
links: ["[[editorial-gate-charter]]", "[[editorial-gate-premortem]]", "[[editorial-gate-loops]]", "[[editorial-gate-directive]]", "[[editorial-gate-schedule]]", "[[editorial-gate-agenda-board]]", "[[growth-agenda-full]]", "[[content-production-charter]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[YC_WEDGE_PLAN]]", "[[OPEN-DECISIONS]]"]
---

# Editorial Gate — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

G3's founding work is **writing down the rules before the first draft exists**, because a
gate that is assembled while a queue is waiting will be assembled to clear the queue.

Four artifacts, none of which requires a publishing target, a CMS, or a single written word
of content:

1. **The provenance format.** What a source is, what counts as one, where it lives relative
   to the draft, and what a claim with no source does (it is removed, not softened).
2. **The banned-construction list**, as a document with a reason per entry. "Streamlined" is
   entry one, supplied by the founder. Em dashes are entry two. Press-release register is
   the hardest entry and needs worked examples rather than a definition.
3. **The verdict artifact.** One file per unit, one field per check, committed. This is what
   makes a bypass an absence in version control rather than a forgotten conversation.
4. **The claim-strength rule**, written out with its canonical instance: *dollars recovered*
   means **we asked** until an 812 credit memo is observed ([[YC_WEDGE_PLAN]]:31-33).

## How

**The verdict artifact, with one field per check, in this order:**

| # | Check | Verdict | Why the order matters |
|---|---|---|---|
| 1 | **Claims traced** — every factual sentence has a source | pass / return / **reject** | Runs first, always. A returned draft stops here, so a claim failure is never buried under stylistic notes ([[editorial-gate-premortem]] M2) |
| 2 | **Claim strength** — no claim exceeds what its source supports | pass / **reject** | Reject, not return. Overstatement is not a drafting error |
| 3 | **Banned constructions** — em dash, buzzword list, press-release register | pass / return | The linter has already run; the human judges register, which the linter cannot |
| 4 | **Voice** — conforms to [[brand-identity-charter]]'s guide, with the clause cited | pass / return | A verdict citing no clause is a taste argument, and taste arguments are lost to deadlines |
| 5 | **Would a reader who believed this page be surprised by the truth?** | pass / **reject** | Applied to the whole page and hardest to omissions. This is the check that catches a true page that misleads ([[editorial-gate-premortem]] M4) |

**Return versus reject is a real distinction, not a severity scale.** A *return* says the
prose is wrong and G2 revises. A *reject* says the claim is wrong, and revision is not the
remedy — the sentence goes, or the unit does.

**The gate never rewrites.** Rewriting makes the gate a co-author, and a co-author cannot
judge. This is stated in the charter and repeated here because it is the rule most likely to
be broken out of helpfulness.

**Sequencing against the rest of Growth.** None of the four artifacts depends on a
publishing target, which makes G3 the only Growth team that is not blocked. It should be
finished before [[content-production-charter]] drafts anything.

## Why now

- **The recovery claim is forming right now.** The design partner is not yet connected
  (`DEP-06` unchecked), the invoice half of the match is still typed by hand, and the first
  credit request has not been sent. Establishing what *dollars recovered* means **before**
  there is a number to publish costs a paragraph. Establishing it afterwards means retracting
  a page.
- **Rules written under no pressure are the only rules that survive pressure.** Every entry
  on the banned-construction list is easy to agree to today and will be argued about the
  first time it costs a deadline.
- **G3 is unblocked and the rest of Growth is not.** Doing this work now is the department's
  only available progress that is not waiting on an engineering decision.

## Next steps

1. Write the provenance format. One page. Include a worked example on a real claim from
   [[YC_WEDGE_PLAN]].
2. Write the banned-construction list with a reason per entry and three worked examples of
   press-release register, since that is the entry a definition cannot carry.
3. Define the verdict artifact and where it lives — this is coupled to
   [[content-production-charter]]'s content-repository question and should be decided
   together in [[OPEN-DECISIONS]].
4. Agree the claim-strength rule with [[design-partner-operations-charter]], since S1
   produces the evidence G3 will be refusing to overstate. Agreeing it while both units are
   unloaded is much cheaper than agreeing it over a specific draft.
5. Ask [[brand-identity-charter]] for a date on the voice guide. Until it exists, check 4
   records **"no guide"** rather than passing, so the gap is visible instead of silently
   waived.

## Questions for the founder

1. **You are currently the only editor.** What is your sustainable rate — units per week?
   Growth will cap production at that number rather than build a queue that pressures you.
   This is the direct counter to [[editorial-gate-premortem]] M1.
2. **Fork CM-F1.** Should this team merge into [[content-production-charter]]? Recorded, not
   resolved. G3's only ask either way: the verdict artifact survives the merge, because it is
   what makes a bypass visible.
3. **Press-release register** is the hardest rule to enforce and the one you named most
   vividly. Can you mark up two or three examples of writing that fails it? Worked examples
   are enforceable; a definition is not.
4. **Is `editorial.gate_bypass_count` genuinely absolute?** G3 has written it as a hard zero
   with no exception path. If there is a circumstance where you would override the gate, it
   should be named now rather than discovered during a launch week.
