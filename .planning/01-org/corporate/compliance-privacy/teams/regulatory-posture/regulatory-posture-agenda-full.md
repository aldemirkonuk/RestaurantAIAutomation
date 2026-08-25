---
type: agenda-full
division: corporate
department: compliance-privacy
team: regulatory-posture
status: provisional
metrics: [compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, compliance.unevidenced_clause_count, compliance.questionnaire_answerable_rate]
updated: 2026-08-24
links: ["[[regulatory-posture-charter]]", "[[regulatory-posture-premortem]]", "[[regulatory-posture-directive]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-schedule]]", "[[regulatory-posture-agenda-board]]", "[[compliance-privacy-agenda-full]]", "[[privacy-engineering-charter]]", "[[commercial-workforce-agreements-charter]]", "[[design-partner-operations-charter]]", "[[standards-verification-charter]]", "[[security-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Regulatory Posture — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Obligation
> coverage is 0%, verified by grep. There is no policy, no DPA, no BAA, no
> processing record, and no subprocessor register anywhere in this repository.

## What

Four deliverables, sized deliberately small. The failure mode this team must avoid is
not "too little" — it is a comprehensive register that means nothing
([[regulatory-posture-premortem]] M2).

1. **A ten-row obligation register**, where every row is either a `file:line` or an
   honest gap with an owner and a date. Not ninety rows. Ten true ones.
2. **The subprocessor register**, converted from
   [`EXTERNAL_CONNECTIONS.md`](../../../../foundation/EXTERNAL_CONNECTIONS.md)'s 50
   hosts — classified by **what a payload can contain**, not by what the vendor is.
3. **A true privacy notice.** Fix the three stale brand claims and make the four
   testable claims testable.
4. **A signature gate**: no data-protection exhibit is executed without a
   line-by-line sign-off with three permitted values — *evidenced*, *strike this
   clause*, or *gap accepted in writing by [name]*.

Explicitly not on this list: building controls ([[privacy-engineering-charter]]),
drafting instruments (Legal), alcohol and excise
([[regulated-operations-charter]], gated), and a general privacy policy document —
which is downstream of the register and worthless before it.

## How

**Sequencing claim: fix the false thing → register what is true → classify the flows
→ gate the signature.** The order is chosen against the intuitive one, which is
"write the policy first because that is what customers ask for." A policy written
before the register is a description of a system nobody has checked, and it is what
makes M1's Annex feel safe to sign.

- **Fix.** `Privacy.tsx:23,31,43` say "WineOps". That is a false claim about
  identity, live, pre-login, today. It is an hour of work and it is the correct first
  act of a team whose entire product is claims that are true.
- **Register.** Start from the ten-duty table already drafted in
  [[regulatory-posture-charter]] §Evidence. Five duties have partial evidence; five
  have none. The counting rule is the whole discipline: **a mapping counts only if
  evidenced by a `file:line`, a passing test, or a named owner with a date.**
  *"Handled by our architecture"* counts as 0. Two of the five evidenced entries
  already carry mandatory caveats — the consent record has **zero call sites**, and
  the erasure design has **no function, no receipt table, and no test** — and those
  caveats travel with the citation into any Annex that relies on it.
- **Classify.** For each of the 50 hosts, ask *what can a request body to this host
  contain in the worst case?* and record the reasoning in a methodology column. Three
  groups are pre-flagged by the source document and are register entries with a
  question attached rather than unknowns: `wineops.ai` (10 refs, legacy brand),
  `ngrok` (3 refs, *"should not appear in prod paths"*), and 16 placeholder/fixture
  refs. **The non-obvious ones are the LLM hosts:** Anthropic and Gemini are called
  over raw HTTP/axios with no SDK, so no shared middleware inspects those payloads,
  and the guard that would (`constraint_engine.py:113-117`) detects SSNs and card
  numbers but **not names, emails or phone numbers**. On today's evidence the correct
  classification for those hosts is *"receives personal data — no control."*
- **Gate.** One page, agreed before the first deal rather than during it. The team's
  power is not veto; it is making a gap explicit before signature. The third permitted
  value — *gap accepted in writing by [name]* — is what makes the gate survivable
  commercially and what turns an unrecorded risk into a one-line founder decision.

**Method note.** Where a claim can be a test, it should be a test. `Privacy.tsx`
names four testable facts — no cookies, tokens in localStorage, telemetry disabled by
default, partner sharing off by default. Each is assertable in CI. A claim that is
only reviewed drifts; the proof is that the brand claim on that very page has been
wrong since the rename and no review caught it.

## Why now

1. **The first customer DPA arrives as an urgent attachment during a live
   negotiation.** That is the worst possible moment to discover coverage is 0%, and it
   is the moment it will be discovered if nothing changes. Everything about this
   team's value is that it is prepared *before* the forcing event.
2. **A false claim is live right now.** The privacy notice makes an identity claim
   that is wrong. That is not a future risk; it is a present defect on a pre-login
   page, and it is an hour of work.
3. **The raw material for two of four deliverables already exists.**
   `EXTERNAL_CONNECTIONS.md` is a subprocessor register that needs classification, not
   authorship. `Privacy.tsx`'s header comment is this team's standard, pre-written.
   The v0 obligation table cost one session.
4. **[[design-partner-operations-charter]] and Sales will move faster than this
   team.** A design-partner agreement with a data-protection exhibit is exactly the
   first instrument that will need a sign-off, and it will not wait.

**Why *not* now, honestly.** No regulator is looking, no customer has asked, and the
company has no revenue contracts. The register's value is entirely contingent on a
future event, which makes it perpetually deferrable against work with a present
customer. That is precisely why the plan is four items and not forty — a small true
register survives being deprioritised; a large project does not.

## Next steps

| # | Step | Depends on | Unblocks |
|---|---|---|---|
| 1 | Fix `Privacy.tsx:23,31,43` — brand claim is false | — | notice credibility |
| 2 | Assert the four testable notice claims in CI | 1 | `compliance.notice_accuracy` (M3) |
| 3 | Ten-row obligation register with the counting rule enforced | — | everything downstream |
| 4 | Evidence column verified by [[privacy-engineering-charter]], not by us | 3 | M2 independence |
| 5 | Classify 50 hosts by payload, with a methodology column | — | `subprocessor_classification` (M4) |
| 6 | Flag the LLM-host classification as *"personal data, no control"* to [[privacy-engineering-charter]] | 5 | a real control request |
| 7 | Signature gate: three permitted sign-off values, agreed with the founder | — | M1, M5 |
| 8 | Records-of-processing table — purposes, categories, recipients, retention | 3, 5 | subject-access answers |
| 9 | Questionnaire response library, drawn only from the register | 3, 8 | `questionnaire_answerable_rate` |
| 10 | Quarterly gap-column referral to [[red-team-charter]] | 3 | M5 |

Steps 1, 2, 3 and 5 are days of work with no external dependency. Step 7 is a
conversation with the founder and is the one that determines whether this team has
teeth or produces an audit trail against its own employer.

## Questions for the founder

1. **Does this team's sign-off gate a signature?** The proposal is that an instrument
   cannot be marked executed without a sign-off carrying one of three values, the
   third being *gap accepted in writing by [name]*. That third value is the escape
   hatch and it puts the acceptance on the record. Without the gate,
   [[regulatory-posture-premortem]] M5 is unpreventable: the team documents gaps
   nobody is obliged to read.
2. **CORP-F2 — DPA/BAA split.** Legal §1.2 owns the instrument, this team owns the
   obligations ([[corporate]] §7). Confirm, or give one unit both? The split is
   exactly what makes an unevidenceable Annex catchable before signature; collapsing
   it saves one handoff and removes the check.
3. **Which jurisdictions are in scope for v0?** GDPR, CCPA/CPRA, and which US state
   regimes? The register's row count and the notice's content both depend on this, and
   guessing wide produces a register nobody maintains. A named short list is more
   useful than a comprehensive one.
4. **What is our controller/processor posture?** Consent is scoped per restaurant in
   the schema (`20260819000000_guest_identity_minimal_slice.sql:99-105`, *"a new
   disclosure to a new controller requiring its own legal basis"*), which reads as
   *restaurant is controller, we are processor*. If that is the intended posture it
   determines who owes the guest a notice, who answers a subject-access request, and
   what the DPA's shape is. It is currently implied by a schema comment and decided
   nowhere.
5. **May we publish a gap?** A register whose gap column is honest is a liability in
   discovery and an asset in a security review. Both are true. The founder should
   decide the disclosure posture once, rather than the team deciding it implicitly by
   how it words each row.

## What this team owes and is owed

| Counterparty | Owed to them | Owed from them |
|---|---|---|
| [[commercial-workforce-agreements-charter]] | Annex content that is evidenceable; a sign-off with three values | The instrument itself; notice of inbound DPAs on arrival |
| [[privacy-engineering-charter]] | Which duties their controls discharge; control requests with a reason | Verification of every evidence cell; honest gaps |
| [[design-partner-operations-charter]] | Fast turnaround on exhibits; a questionnaire library | Early sight of any agreement with a data clause |
| [[standards-verification-charter]] | The claim that `Privacy.tsx` must stay true | Staleness machinery we consume rather than rebuild |
| [[security-charter]] | Register rows citing their controls | Notice when a control they own changes |
| [[red-team-charter]] | The gap column, quarterly | An attack on every accepted gap |
