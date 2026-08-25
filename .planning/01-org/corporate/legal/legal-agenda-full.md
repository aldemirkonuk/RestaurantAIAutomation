---
type: agenda-full
division: corporate
department: legal
status: provisional
metrics: [legal.instrument_chain_integrity, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff]
updated: 2026-08-24
links: ["[[legal-charter]]", "[[legal-premortem]]", "[[legal-agenda-board]]", "[[legal-directive]]", "[[legal-loops]]", "[[legal-schedule]]", "[[instruments-equity-charter]]", "[[commercial-workforce-agreements-charter]]", "[[corporate]]", "[[ORG_STRUCTURE]]", "[[positioning-fundraise-readiness-charter]]", "[[regulatory-posture-charter]]", "[[decision-office-charter]]"]
---

# Legal — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

> Not legal advice. This agenda plans a *function* that will commission paper from a
> qualified lawyer. It contains no drafted legal text and should never be used as any.

## What

Stand up a legal function that has **zero artifacts today** and get it to a state where
the first instrument the company signs is one somebody deliberately chose. Concretely,
four things exist by the end of the first cycle and none of them is a contract:

| Deliverable | Why this and not a document |
|---|---|
| **The instrument register** — states, gates, owning team, retention location | Fifteen document types with no register is a drawer. The register is what makes `legal.instrument_chain_integrity` readable at all |
| **The counsel relationship** — a named firm or lawyer, engaged, who knows the entity | Every rule in [[legal-directive]] routes to "counsel reviews". Without a counsel, R1 is a sentence |
| **The clause library skeleton** — sections named, fallback ladder blank but structured | `legal.clause_library_hit_rate` starts at 0% because the library does not exist (`corporate.md:104-106`). The skeleton is what makes the first agreement contribute to the second |
| **The two-signature gate**, wired with [[regulatory-posture-charter]] | The erasure path is untested end-to-end (`corporate.md:31`). If a DPA arrives before this gate exists, [[legal-premortem]] M4 happens on the first try, not the tenth |

## How

**Sequence: register → gates → counsel → library.** Deliberately *not* "draft the fifteen
documents". Drafting fifteen templates with no counsel, no library discipline and no
register would produce fifteen plausible files — which is [[legal-premortem]] M5 executed
at scale before a single counterparty exists.

1. **Register first**, because it is the only artifact that costs nothing to be wrong
   about and makes every later artifact measurable.
2. **Gates before paper.** R1 (counsel gate), R2 (no same-day execution), R4 (two
   signatures) are cheap to adopt while the register is empty and expensive to adopt on
   the day the first term sheet lands. Rules adopted under pressure are rules that get
   exceptions.
3. **Counsel before the first one-way door.** Not before the first NDA — the repeatable
   class can wait. The ordering matters because the first one-way-door instrument is
   likely to be a founder agreement or an IP assignment, not a SAFE.
4. **Library grows from executed paper**, one agreement at a time, rather than being
   invented up front. A clause is "reviewed" once counsel has seen it in a real agreement;
   inventing a library first produces a library nobody will defend under a redline.

### The sequencing observation this department has to state out loud

There is a full codebase in this repo and **no instrument assigning its IP to the entity**.
[ADR 0001](../../../decisions/0001-mudavym-single-entity.md):38 fixes that there is exactly
one legal surface; nothing anywhere records that the surface owns what has been built. This
is not a legal opinion and this document is not qualified to give one — it is an
*observation about the register being empty*, and the recommendation that follows is a
sequencing recommendation only: **founder agreement and IP assignment are the instruments
to put in front of counsel first**, before SAFE, before any commercial paper. The reason is
structural rather than legal — they are the two instruments whose absence gets discovered
by somebody else, at diligence, when it is least fixable.

## Why now

- **Because every rule here is cheap today and expensive later.** A counsel gate adopted
  with zero instruments in flight costs nothing. The same gate proposed while a term sheet
  is open is a negotiation about the gate.
- **Because the adjacent surfaces are already live.** The system already parses supplier
  `payment_terms` and MOQs out of email with per-field provenance
  (`apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38`). The company is
  already operating on commercial terms it has never agreed in writing. That gap is not
  urgent today and will not announce itself when it becomes urgent.
- **Because a DPA arrives without warning.** The first enterprise counterparty sends
  theirs; there is no preparation window. The two-signature gate either exists before that
  email or it does not.
- **Because the trim question deserves a fair test.** Legal was named the trim candidate
  (`corporate.md:116-121`). Writing the two charters is how the proposal gets tested —
  and L-LEG-5 is how it gets reversed if the test fails.

## Next steps

- [ ] Build the instrument register — states, gates, owning team, retention location —
      [[legal-loops]] L-LEG-1
- [ ] Adopt R1/R2/R4 from [[legal-directive]] **while the register is empty**
- [ ] Engage outside counsel; record who, and for which classes
- [ ] Put founder agreement + IP assignment in front of counsel first —
      [[instruments-equity-charter]]
- [ ] Wire the two-signature gate with [[regulatory-posture-charter]] before any DPA
      arrives — L-LEG-2
- [ ] Name the clause-library sections and the fallback-ladder shape (positions blank) —
      [[commercial-workforce-agreements-charter]]
- [ ] Record the merge condition in L-LEG-5 as a dated commitment, not a sentence
- [ ] Stage **CORP-F2** (DPA/BAA instrument-vs-obligation split) into `OPEN-DECISIONS.md` via
      [[decision-office-charter]] — deliberately not written directly, four sibling
      division sessions are appending to that table concurrently (`corporate.md:486-490`)
- [ ] Correct the stale brand in `apps/web/src/pages/Privacy.tsx:23` — **not ours**;
      route to Compliance §3.2 and record that it was routed

## Questions for the founder

1. **One team or two?** `corporate.md:116-121` names Legal the trim candidate and
   recommends keeping the split on a **structural** argument with no evidence behind it.
   This vault is written at two teams and 21 documents. Is that the right spend for a
   department with zero artifacts, or should Legal run as one team until the first
   instrument exists? L-LEG-5 will ask again in two quarters either way.
2. **Is the counsel gate absolute?** [[legal-directive]] R1 says the six one-way-door
   instruments are *never* executed without outside-counsel review — including the ones
   that arrive as a "standard form". Confirm, because the first exception request will be
   reasonable and will arrive under time pressure.
3. **What is the actual first instrument?** This agenda argues for founder agreement + IP
   assignment ahead of anything else, on sequencing grounds. If the real first paper is a
   SAFE or a customer MSA, the whole ordering above changes.
4. **CORP-F2 — DPA/BAA ownership.** Legal owns the instrument, Compliance owns the
   obligations inside it (`corporate.md:495`). Two signatures, or one team holding both?
   Two signatures is slower and catches M4; one team is faster and cannot.
5. **May an agent draft legal paper at all?** This vault answers: retrieval-shaped
   assembly in the repeatable class only, `[GAP]` markers mandatory, no generative
   drafting on the one-way-door class, named human reviewer on everything
   ([[legal-premortem]] M5). That is a real constraint on the AI-native premise, and it is
   yours to overrule.
6. **Who is the counterparty for the fifteen?** Nine of them presuppose parties that do not
   exist yet — no employees, no contractors, no enterprise customers, no investors. Is the
   scope a *readiness* list or a *build* list? The two produce very different agendas.
