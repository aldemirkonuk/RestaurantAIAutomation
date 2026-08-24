---
type: premortem
division: corporate
department: compliance-privacy
status: partial
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, compliance.obligation_coverage, nf_b.research_store_erasability]
updated: 2026-08-24
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-directive]]", "[[privacy-engineering-premortem]]", "[[regulatory-posture-premortem]]", "[[regulated-operations-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[customer-relationship-research-charter]]", "[[taste-fingerprint-charter]]", "[[guest-identity-consent-charter]]", "[[0006-neural-footprint-architecture]]", "[[corporate]]"]
---

# Compliance & Privacy — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> Every signal below is a query or a count, not a judgement call.

## It is 2027-08-24 and this department has failed. What happened?

---

### M1 — The schema stayed a monument: nothing ever called it, so no control was ever real

Twelve months on, `20260819000000_guest_identity_minimal_slice.sql` is still the
best-argued file in the repository and still has **zero call sites**. Guest data
arrived anyway — through POS checks, through reservation exports, through a CSV a
restaurant emailed — and landed in whatever column was convenient, because the
correct destination required a `guest_link_identifier()` call nobody had wired.
The two CI guards passed the whole time, faithfully, because they guard a path
nobody uses: `check_no_raw_guest_channels.sh` greps for raw channels being *written*,
and no code writes guests at all. A guard over an unused path is a green check that
means nothing, and it was read as evidence of control for a year.

This is the most likely failure because it is the *current state*, extended. It
requires nobody to do anything wrong.

**Earliest observable signal.** `privacy.consent_call_sites` is still **0** at the
end of the first quarter in which any guest-facing feature ships. Concretely:
`git log --since` shows a guest feature merged, and
`grep -rn "guest_link_identifier|consent_purpose" apps/ services/` still returns
nothing. Today the count is 0 with no guest feature, which is consistent; the day
those diverge is the signal.

**What would have prevented it.** Three specific counter-pressures:

1. **A guard that fails on the *bypass*, not on the path.** The existing guards
   protect the correct path. The missing one asserts that no table outside
   `guest_identifiers` carries a column matching `phone|email|card_.*fingerprint`
   for a person — a `check_no_guest_pii_outside_identifiers.sh` in the shape of the
   two that exist. Cheap now, impossible after a year of payloads
   (`check_no_raw_guest_channels.sh` makes exactly this argument about itself).
2. **The first consent write is a department deliverable, not a Product favour.**
   One `staff_verbal` capture path, end to end, so the record has been exercised
   once. A schema with one real caller is a different object from a schema with none.
3. **Erasure completeness measured against *actual* stores, not designed ones.**
   See M3.

---

### M2 — We signed a DPA whose Annex we could not evidence

A restaurant group's procurement team sent a standard DPA. Closing the deal needed
it signed this week. Legal drafted competently against a template; the Annex listed
the usual technical and organisational measures — encryption at rest, access
logging, deletion within 30 days, subprocessor notification. Nobody checked those
line by line against a control, because the register that would have made that a
five-minute check did not exist (`compliance.obligation_coverage` = 0%). Nine months
later the same group sent a security questionnaire. "Describe your data subject
erasure process" had no answer that was not a lie, and a signed promise became a
discovered breach of contract — discovered by the counterparty, which is the
expensive way.

The mechanism is not negligence. It is that **the register is worth nothing until
the first signature and everything from the moment after**, so it is always
rationally deferrable right up to the point where it is too late.

**Earliest observable signal.** The first inbound DPA, MSA data-protection exhibit,
or vendor security questionnaire arrives — and the response is drafted from a
template rather than from a register. Visible the day it happens, in the thread.
A weaker leading signal available today: `compliance.subprocessor_classification`
is 0/50 while [`EXTERNAL_CONNECTIONS.md`](../../../foundation/EXTERNAL_CONNECTIONS.md)
already enumerates every host — the raw material sitting unconverted.

**What would have prevented it.** **A one-page register before the first signature,
not a complete one.** Ten obligations mapped to a control or an honest "no control —
owner X, due Y" beats ninety mapped after the fact. Plus a hard procedural rule with
a named owner: **no data-protection exhibit is signed without a
[[regulatory-posture-charter]] line-by-line sign-off**, and that sign-off is allowed
to say *"we cannot evidence clause 4.3; strike it or accept the gap in writing."*
The department's power here is the ability to make a gap explicit before signature,
which costs one uncomfortable email and saves a breach.

---

### M3 — Erasure "worked" and left copies, because completeness was measured against the design

The first real erasure request arrived. The tombstone ran: identifiers deleted,
label and consent nulled, `erased_at` set. Everyone was satisfied because the
migration's own comment says erasure is *"a DELETE with nothing left to shred"* —
and that sentence is **true of the path it describes and silent about every other
path**. The guest's data had also reached: the NF-B research store, which is
append-only and never migrated ([ADR 0006](../../../decisions/0006-neural-footprint-architecture.md));
`analytics_cache.data`; an `evidence_citations` row a research job wrote before the
PII filter was tightened; a Sentry breadcrumb; a Gmail thread in
`conversation_embeddings`. The erasure receipt asserted completeness. It could not
have known.

**Earliest observable signal.** The **first erasure test that enumerates stores from
`information_schema` rather than from a hand-written list** returns a store the
runbook does not mention. That is a one-off script, runnable this week, and it will
find something — `check_no_raw_guest_channels.sh` already names six sinks that would
swallow a channel silently. If the test is never written, the substitute signal is
the absence itself: `privacy.erasure_completeness` stays *asserted* rather than
*measured* for two consecutive quarters.

**What would have prevented it.** **The metric's definition, enforced literally: %
of stores where absence is proven by test.** Not "% of stores we believe are
clean". The proof has to be a test that (a) creates a guest, (b) exercises every
write path that touches a person, (c) erases, (d) enumerates every table, cache and
external store from a live catalogue, and (e) asserts absence. Any store the test
cannot reach is reported as a **known gap with an owner**, which is far more useful
than a receipt that overstates. And crucially — **the denominator is discovered, not
declared.** A completeness metric whose denominator is a list someone wrote is a
tautology.

---

### M4 — The research store made erasure impossible, and we found out by exercising the right

NF-B accumulated for a year exactly as designed: append-only, deliberately wide,
never migrated — the property that makes it valuable for training and that ADR 0006
locked on purpose. Then a guest exercised erasure. There was no mechanism to remove
their rows, because "never migrated" is not a policy that has an exception clause,
and the alternatives all cost something real: crypto-shredding needs a per-subject
key designed in from row one; subject-level partitioning constrains the write path;
aggregate-only retention throws away the very signal the store exists to keep. All
three are cheap at zero rows and expensive at a year of rows, and the year had
passed. The department had noticed the tension, written it in a charter, and never
converted it into a decision with a date — so it stayed a paragraph while the store
filled.

**This is the mechanism this department most uniquely owns**, because nobody else in
the org has both halves of it in view: [[taste-fingerprint-charter]] sees the ML
value, [[neural-footprint-instrumentation-charter]] sees the schema, and only this
department is accountable for the right that collides with them.

**Earliest observable signal.** The **first NF-B row written before the erasability
question has an `OPEN-DECISIONS.md` entry with an owner and a close-time.** Not the
thousandth — the first. `nf_b.research_store_erasability` is `unanswered` today and
the store is empty today; those two facts expire together.

**What would have prevented it.** **Escalate it as a decision now, while the store
is empty, and refuse to let it be resolved inside this department.** Concretely:
an `OPEN-DECISIONS.md` fork paired to OD-11, stating the three candidate mechanisms
and their costs, decided by the founder with [[taste-fingerprint-charter]] and
[[neural-footprint-instrumentation-charter]] in the room. The department's job is
to make the decision *unavoidable and dated*, not to make it. A privacy function
that quietly picks the ML-cheapest option has failed differently but just as badly.

---

### M5 — We reviewed our own use of guest data, and the review was always fine

Ethics & Responsible AI was considered and not adopted ([[ORG_STRUCTURE]] §3), and
its scope landed here, in the line. Twelve months on, every proposal to widen guest
data use — reuse `service_personalisation` consent for a lookalike model, let the
recommender condition on inferred spend band, share a cohort with a design partner —
was reviewed by the department that also has an interest in the product shipping.
Each individual call was defensible. The aggregate drifted a long way from what a
guest was told at capture, and no single reviewable moment marked the drift, because
the reviewer and the reviewed were the same function. This is precisely the
arrangement [[ORG_STRUCTURE]] §3 rejects for advisory functions — *"an advisory
function that reports inside the line it reviews is not independent"* — and adopting
Ethics scope into the line accepted that cost knowingly.

**Earliest observable signal.** The **second** approved widening of a purpose beyond
`service_personalisation` with no dissent recorded anywhere. One clean approval is
normal; two in a row with no written objection means the review is not adversarial.
Countable: `consent_purpose` distinct values in the schema versus purposes actually
relied on in code, plus the count of findings this department has filed *against
its own division's proposals*.

**What would have prevented it.** **Route guest-data-use decisions through
[[red-team-charter]] as a standing referral, not as an escalation.** Red Team's
scope is *attacking decisions* ([[ORG_STRUCTURE]] §3) and a purpose-widening is
exactly a decision. This costs one referral per proposal and restores the
independence the org deliberately gave up. Second counter-pressure: **every
purpose-widening produces a written notice-version bump.** `consent_notice_version`
exists in the schema (`:59`) for this reason — if a use change does not require a
new notice version, it is not a widening; if it does, the bump is the audit trail
that a self-review cannot suppress.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible |
|---|---|---|---|
| M1 | Schema never called | A guest feature ships while `consent_call_sites` == 0 | `grep -rn "guest_link_identifier" apps/ services/` |
| M2 | Unevidenced DPA Annex | First inbound DPA answered from a template, not a register | The signature thread; `subprocessor_classification` 0/50 |
| M3 | Erasure left copies | First catalogue-driven erasure test finds an unlisted store | A one-off script over `information_schema` |
| M4 | Research store unerasable | First NF-B row written with no dated decision on erasability | `OPEN-DECISIONS.md` vs the research store's row count |
| M5 | Self-review always passes | Second purpose-widening approved with no recorded dissent | `consent_notice_version` bumps vs purposes in code |

**Three of these five are already measurable today and four of the five get
strictly harder with time.** M1, M3 and M4 in particular are cheap now precisely
because the counts are zero — which is the same argument
`scripts/check_no_raw_guest_channels.sh` makes about itself in its own header, and
it was right.
