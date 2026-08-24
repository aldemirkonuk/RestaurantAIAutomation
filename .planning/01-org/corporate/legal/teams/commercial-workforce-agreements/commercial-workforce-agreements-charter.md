---
type: charter
division: corporate
department: legal
team: commercial-workforce-agreements
status: new
metrics: [legal.request_to_executable_draft_days, legal.clause_library_hit_rate, legal.annex_satisfiability_signoff, legal.named_reviewer_coverage, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[commercial-workforce-agreements-premortem]]", "[[commercial-workforce-agreements-agenda-full]]", "[[commercial-workforce-agreements-agenda-board]]", "[[commercial-workforce-agreements-directive]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-schedule]]", "[[instruments-equity-charter]]", "[[regulatory-posture-charter]]", "[[privacy-engineering-charter]]", "[[roster-lifecycle-charter]]", "[[README|foundation-README]]", "[[corporate]]"]
---

# Commercial & Workforce Agreements — Charter

Division **Corporate** → Department [[legal-charter]] → Team
`commercial-workforce-agreements` (§1.2 of
`.planning/foundation/teams/corporate.md:89-114`).

> Not legal advice, and not drafted legal text. This charters a function that will
> commission and assemble paper reviewed by a qualified lawyer. **No clause language
> appears anywhere in this team's vault, by rule** ([[legal-directive]] R7).

## Mandate

Own the **nine repeatable instruments** — NDA, MSA, statement of work, professional
services agreement, letter of intent, employment agreement, contractor agreement, data
processing agreement, business associate agreement — together with the **clause library**
and the `legal-doc-draft` skill named in [[README|foundation-README]] §3.2 (line 145)
(`corporate.md:91-94`).

The unifying property is that each of these will be drafted **many times**, against many
counterparties, and each one's failure mode is *slowness* or *drift* rather than
*permanence*. The team's actual product is therefore not a document. It is a **template
system**: reusable reviewed clauses, a fallback ladder of pre-decided negotiating
positions, and an agent-executable assembly path.

## Boundaries

Owns outright:

- **The nine instruments**, request to executed.
- **The clause library** — the reviewed text, its versions, and which version governs which
  live counterparty.
- **The fallback ladder** — preferred / acceptable / walk-away positions per contentious
  section, decided once with the founder and counsel, then *applied* rather than
  re-litigated.
- **The redline log** — per agreement, which clause moved, to which ladder position, and why.
- **`legal-doc-draft`** — and its shape: **retrieval, not generation**
  ([[legal-premortem]] M5).
- **Turnaround** — the queue, its ageing, and what "executable" means.

Explicitly **not** owned:

| Not ours | Whose | The line |
|---|---|---|
| The six one-way doors — founder agreement, SAFE, board consent, stock purchase, advisor agreement, IP assignment | [[instruments-equity-charter]] | Reversibility. Our whole optimisation is speed; theirs is that nothing here is ever fast |
| **The obligations inside a DPA or BAA** — what we actually promise about data and whether the code honours it | [[regulatory-posture-charter]], [[privacy-engineering-charter]] | We own the **instrument**; Compliance owns the **obligations inside it** (`corporate.md:99-103`) |
| Terms — liability ceilings, IP posture, walk-away points | **Founder**, once, with counsel | We apply a decided ladder; we do not set its rungs |
| The privacy notice — `apps/web/src/pages/Privacy.tsx` | Compliance §3.2 | A public notice is not an agreement between two parties |
| Parsed supplier terms — currency, MOQ, `payment_terms` | Engineering / procurement — `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` | Reading "Net 30" out of an email is procurement. Making it enforceable is us |
| Hiring, performance, payroll | People & Agent Ops (Human Ops deferred, `corporate.md:396-399`) | We own the employment *agreement*, not the employment *relationship* |
| The skill registry itself | [[skills-charter]] (Applied AI) | We author skills; we do not govern the registry |

## Distinct from its sibling because

**This team's product is a system; its sibling's product is six documents**
(`corporate.md:95-98`). Optimising for reuse — clause library, fallback ladder, assembly
path — is the entire job here and is *meaningless* next door, where six instruments will
each be drafted once and never templated.

The norms are also incompatible in a way that matters more than the subject matter.
[[instruments-equity-charter]] holds "nothing here is ever turned around in an hour". This
team holds "the second NDA must be faster than the first". Put both in one queue and the
high-volume norm wins, because it has more weekly evidence behind it — which is exactly how
a SAFE ends up getting the turnaround treatment of a tenth NDA (`corporate.md:61-63`).

## The boundary with Compliance & Privacy — the two-signature rule

DPA and BAA sit in this team, and they are the only two instruments in the department that
**cannot be executed by Legal alone**.

- **Legal signs** that the instrument is sound: clauses, liability, negotiation posture.
- **[[regulatory-posture-charter]] signs** that every Annex commitment maps to implemented,
  tested behaviour, with [[privacy-engineering-charter]] naming the test.

Signing a DPA whose Annex we cannot satisfy is the failure this boundary exists to prevent,
and it is a **two-signature failure, not a one-team failure** (`corporate.md:99-103`). The
live relevance is not theoretical: erasure is graded **untested end-to-end**
(`corporate.md:31`, `:471`) and GDPR/CCPA appear **zero times** in source
(`corporate.md:31`) — so the first firing of this gate will fail, which is the correct
outcome and the reason to wire it before a DPA arrives rather than after.

Staged as **OD-C2** (`corporate.md:495`): confirm the two-signature split, or give one team
both halves.

## Metrics it moves

| Metric | Definition | Baseline |
|---|---|---|
| `legal.request_to_executable_draft_days` | **Median** request → executable draft. "Executable" means a named human reviewed it and no `[GAP]` remains — never "sent" | **Unmeasurable.** No requests, no library (`corporate.md:107-110`) |
| `legal.clause_library_hit_rate` | % of a draft assembled from reviewed clauses rather than written fresh. **The leading indicator** — it moves a quarter before turnaround does | **0%.** The library does not exist |
| `legal.annex_satisfiability_signoff` | % of executed DPAs/BAAs carrying a Compliance signature | **0 of 0** |
| `legal.named_reviewer_coverage` | % of executed agreements with a named human reviewer recorded | **0 of 0.** Target 100% |
| `nf_a.doneability_verdict` | On assisted drafts, defined as *"a named human reviewed it"* — never *"the agent completed"* | **n/a** — `.claude/skills/` does not exist |

The metric pair is the point. Hit rate falling while turnaround holds means drift is
accumulating unseen. Turnaround improving while hit rate does **not** means text is being
generated rather than assembled — [[legal-premortem]] M5, visible as a number before it is
visible as an incident.

## Evidence today

**NEW.** No contract, no template, and no clause library exist anywhere in the repo
(`corporate.md:104-106`). Verified independently: a repo-wide filename sweep for
`nda|msa|contract|agreement|dpa|baa` returns only incidental matches — `.github/dependabot.yml`
and planning files whose names contain the substring "agenda".

Two adjacent surfaces exist and **neither is an agreement**, which is worth stating
precisely because both are easy to mistake for one:

1. `apps/web/src/pages/Privacy.tsx` — a privacy **notice**, not an agreement, owned by
   Compliance §3.2 (`corporate.md:104-106`). It also still names the retired brand at
   line 23.
2. `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` — a parser that
   already extracts a supplier's currency, unit and case price, MOQ, discount tiers,
   `payment_terms` (line 33) and per-field provenance quotes (line 38) from an email, with
   validation flags for mismatches.

The second is the most useful fact this charter can cite. **The company already reads its
suppliers' commercial terms as structured data and has never agreed any of them in
writing.** The downstream consumer for this team's output is therefore already built; what
is missing is the paper that would make a parsed `"Net 30"` mean anything. Note the
ownership line carefully — that parser belongs to Engineering/procurement, and this team
would be overreaching to claim it.

**The one skill this team is meant to own does not exist as a file.**
[[README|foundation-README]] §3.2 names `legal-doc-draft` (line 145); `.claude/skills/` is not
present in the repo at all.

## Split trigger — Workforce Paper

Employment, contractor and hire-attached agreements sit here rather than in their own team,
because a "Workforce Paper" team at v0 would be two of fifteen documents, zero employees
and zero cadence — a team invented for symmetry (`corporate.md:123-126`).

**Split trigger: first W-2 hire, or first contractor in a second jurisdiction.** The second
condition is the substantive one: one jurisdiction is a template, two is a research
practice, and that is a different job from clause assembly.

## The trim flag applies here too

`corporate.md:116-121` names Legal the trim candidate and this split **structural, not
evidential**. This team has the better claim of the two to independent existence — its
mandate is a system that will be exercised repeatedly — but it has produced nothing. If
[[legal-loops]] L-LEG-5 fires, the nine instruments become a class inside one team.
