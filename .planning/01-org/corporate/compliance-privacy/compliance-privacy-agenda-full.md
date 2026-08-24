---
type: agenda-full
division: corporate
department: compliance-privacy
status: provisional
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, compliance.obligation_coverage, compliance.subprocessor_classification, nf_b.research_store_erasability]
updated: 2026-08-24
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-premortem]]", "[[compliance-privacy-directive]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-schedule]]", "[[compliance-privacy-agenda-board]]", "[[privacy-engineering-agenda-full]]", "[[regulatory-posture-agenda-full]]", "[[regulated-operations-agenda-full]]", "[[legal-charter]]", "[[commercial-workforce-agreements-charter]]", "[[security-charter]]", "[[customer-relationship-research-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[0006-neural-footprint-architecture]]", "[[corporate]]"]
---

# Compliance & Privacy — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Nothing below has
> been built, scheduled, or decided. The department's obligation coverage is 0%, its
> erasure completeness is 0%, and the consent schema it is proudest of has zero
> application call sites.

## What

Close two gaps that opened for opposite reasons, and hold one question open.

1. **Make the existing controls real.** The consent and erasure schema is committed,
   argued and CI-guarded, and nothing calls it. Give it one caller, one erasure
   execution, and one test that proves absence. *(Owner: [[privacy-engineering-charter]])*
2. **Write the paper that does not exist.** There is no policy, no DPA content, no
   privacy programme, and zero occurrences of "GDPR" or "CCPA" anywhere in source.
   Produce an obligation register — a mapping from each named duty to a control with
   a `file:line` or an owner — before the first counterparty asks.
   *(Owner: [[regulatory-posture-charter]])*
3. **Collapse four PII definitions into one.** Three distinct definitions across four
   guards, two of them copy-pasted duplicates that will drift on the first one-sided
   edit. *(Owner: [[privacy-engineering-charter]])*
4. **Force the research-store erasability question into a dated decision.** Not
   resolve it — escalate it, while the store is still empty.
   *(Owner: this department, decided by the founder)*

Explicitly *not* on this list: drafting instruments (Legal), access control
(Security), the guest identity model (Product), and alcohol excise
([[regulated-operations-charter]], gated).

## How

**Sequencing claim: prove → define → register → escalate.** The order matters and
it is not the intuitive one. The intuitive order is "write the policy first, because
the policy is what a customer asks for". That order produces
[[compliance-privacy-premortem]] M2 — a register describing controls nobody has
exercised. Proving one erasure end to end costs a week and makes every subsequent
register entry citable rather than aspirational.

- **Prove.** One guest created through `guest_link_identifier()`; one consent record
  captured via `staff_verbal`; one erasure executed; one test that enumerates stores
  from a live catalogue (`information_schema`, plus the six sinks named in
  `scripts/check_no_raw_guest_channels.sh`) and asserts absence. The denominator of
  `privacy.erasure_completeness` must be **discovered, not declared** — a
  completeness metric over a hand-written list is a tautology
  ([[compliance-privacy-premortem]] M3).
- **Define.** One `pii.py` module with one pattern set, imported by
  `constraint_engine.py` and `provider_communication_agent.py` (today: two identical
  copies, no shared import) and by `research_tasks.py` (today: a disjoint
  email/phone definition). Then a `scripts/check_single_pii_definition.sh` guard in
  the exact shape of the five `check_*.sh` guards already wired into CI, so the
  divergence cannot recur silently.
- **Register.** Convert two artifacts that already exist for other purposes:
  [`EXTERNAL_CONNECTIONS.md`](../../../foundation/EXTERNAL_CONNECTIONS.md) (50 hosts,
  8 SDKs, 80 env vars) becomes the subprocessor register once each host is classified
  as personal-data-receiving or not; `apps/web/src/pages/Privacy.tsx` becomes the
  notice-accuracy baseline, because its own header comment already states the correct
  standard — *"Written to match what the code actually does rather than boilerplate…
  If any of those change, this page has to change with them."*
- **Escalate.** One `OPEN-DECISIONS.md` fork on NF-B erasability, paired to OD-11,
  with three named candidate mechanisms and their costs. Decided by the founder with
  [[taste-fingerprint-charter]] and [[neural-footprint-instrumentation-charter]]
  present. **This department must not resolve it alone** — see §Questions 5.

**Method note.** Every control this department writes should be enforced by a grep,
not by a review, wherever a grep is sufficient. The repo has already proved the
pattern works for privacy specifically: `check_no_guest_name_matching.sh` and
`check_no_raw_guest_channels.sh` run on push, PR **and** a daily cron
(`.github/workflows/schema-parity.yml:19-27, 152-154`). Copy that shape; do not
invent a review process.

## Why now

Four reasons, in decreasing strength:

1. **Every one of the four items gets strictly harder with time, and three are
   currently free.** `check_no_raw_guest_channels.sh` makes this argument about
   itself in its own header: *"once a year of payloads has absorbed phone numbers,
   no grep un-absorbs them."* The same is true of the research store's erasability,
   of the PII definition (three definitions is mergeable, thirty is a project), and
   of the subprocessor classification. Zero rows is the cheapest possible moment.
2. **The first customer DPA is a deal-blocker on a deadline.** It will arrive as an
   urgent attachment during a live negotiation, which is the worst possible moment to
   discover that `compliance.obligation_coverage` is 0%. A one-page register beats a
   complete one that arrives after signature.
3. **[[customer-relationship-research-charter]] is blocked on a gate that does not
   exist.** Media & Brand's research team is chartered to touch identified
   individuals under a legal gate, and the gate is this department's. They cannot
   start; we are the dependency.
4. **The design work is already done and unusually good.** This is not a department
   that has to win an architecture argument first. The consent-as-a-record decision,
   the tombstone-not-soft-delete reasoning, and the hash-only channel storage are all
   committed and defended in-file. The remaining work is execution and paper.

**Why *not* now, stated honestly.** No customer has asked, no regulator is looking,
and the product's named blocker is data ([[README]] §1), not compliance. A department
with zero obligations mapped competing for attention against the actual blocker
should expect to lose most weeks — which is exactly why the plan above is sized in
days rather than quarters, and why [[regulated-operations-charter]] is gated rather
than staffed.

## Next steps

| # | Step | Owner | Blocks |
|---|---|---|---|
| 1 | One consent record written through `guest_link_identifier()` — the schema's first caller | [[privacy-engineering-charter]] + [[guest-identity-consent-charter]] | everything downstream; M1 |
| 2 | Catalogue-driven erasure test: create → exercise → erase → enumerate → assert absence | [[privacy-engineering-charter]] | `privacy.erasure_completeness`; M3 |
| 3 | Erasure receipt table — `erasure_receipt_id` (`:82`) currently references nothing | [[privacy-engineering-charter]] | provable erasure |
| 4 | Single `pii` module + `check_single_pii_definition.sh` CI guard | [[privacy-engineering-charter]] | `privacy.pii_definition_count` → 1 |
| 5 | Classify all 50 hosts in `EXTERNAL_CONNECTIONS.md` → subprocessor register | [[regulatory-posture-charter]] | any DPA Annex |
| 6 | One-page obligation register: 10 duties → control or named gap | [[regulatory-posture-charter]] | M2 |
| 7 | Fix the notice: `Privacy.tsx` still says "WineOps" (`:23`, `:31`, `:43`) | [[regulatory-posture-charter]] | notice accuracy |
| 8 | Raise NF-B erasability into `OPEN-DECISIONS.md`, paired to OD-11 | this department → [[decision-office-charter]] | M4 |
| 9 | Stand up the consent gate as a callable check, so Media can start | [[privacy-engineering-charter]] | [[customer-relationship-research-charter]] |
| 10 | Register the [[regulated-operations-charter]] trigger on a real cadence | [[compliance-privacy-schedule]] | a dormant team with no cadence never wakes |

Steps 3, 4, 7 and 8 are days of work. Steps 1, 2 and 9 require negotiation with
Product and are the realistic critical path. Step 5 is mechanical and can run in
parallel with all of it.

## Questions for the founder

1. **Who owns guest consent *capture*?** `consent_captured_via` is CHECK-constrained
   to four channels (`:60-62`) and none has an implementation. Whoever builds the
   capture surface arguably owns the record. Proposed: Product builds the surface,
   this department owns the record's contents and validity rules. Per CLAUDE.md §0.1
   this is not decided until it is written in `.planning/decisions/`. **Needs an
   `OPEN-DECISIONS.md` entry; this session had no write access outside the department
   directory.**
2. **CORP-F2 — DPA/BAA split.** Legal §1.2 owns the instrument, this department owns
   the obligations ([[corporate]] §7). Confirm, or give one unit both? The split is
   what makes an unevidenceable Annex catchable before signature; collapsing it saves
   one handoff and loses that check.
3. **CORP-F4 — is [[regulated-operations-charter]] Corporate's at all?** Alcohol
   excise may belong to Product once a licensing feature exists. Answering it now
   costs nothing; answering it after the trigger fires costs a re-org during a
   deadline.
4. **Does this department get to refuse a signature?** The charter claims a
   line-by-line sign-off on any data-protection exhibit, with the right to say *"we
   cannot evidence clause 4.3; strike it or accept the gap in writing."* That is a
   veto over a revenue event and needs the founder's explicit backing to survive
   contact with a live deal.
5. **NF-B erasability — who decides, and by when?** [ADR 0006](../../../decisions/0006-neural-footprint-architecture.md)
   locks the research store as append-only and never migrated. Guest taste
   fingerprints are personal data. The three candidate reconciliations
   (crypto-shredding per-subject keys, subject-level partitions, aggregate-only
   retention) all cost ML value and all must be designed in from row one. **This
   department is deliberately not proposing an answer** — a privacy function that
   quietly picks the ML-cheapest option has failed. It needs a founder decision with
   a date while the store is empty.
6. **Do guest-data-use widenings route through [[red-team-charter]]?** Ethics &
   Responsible AI was considered and not adopted, so its scope sits in the line and
   this department reviews itself ([[compliance-privacy-premortem]] M5). A standing
   Red Team referral restores the independence the org knowingly gave up, at the cost
   of one referral per proposal.

## Cross-department dependencies this department is on the hook for

| They need | From us | Status |
|---|---|---|
| [[customer-relationship-research-charter]] | The consent gate, as a callable check | not built — they are blocked |
| [[commercial-workforce-agreements-charter]] | DPA/BAA Annex content that is evidenceable | not written |
| [[taste-fingerprint-charter]] | What NF-B may not condition on; what happens on erasure | unanswered |
| [[security-charter]] | A single definition of PII to protect | 3 definitions, 4 guards |
| [[standards-verification-charter]] | Notice claims that stay true as code changes | `Privacy.tsx` brand already stale |

**Correction to a sibling document, raised here rather than edited there:**
`teams/commercial.md:578-580` says Media's customer research is reviewed by *"Ethics
& Responsible AI (advisory, ORG_STRUCTURE §3)"*. That function was **considered and
not adopted** ([[ORG_STRUCTURE]] §3, struck row). The review it names lands on this
department. Flagged for whoever batches the corporate/commercial cross-references.
