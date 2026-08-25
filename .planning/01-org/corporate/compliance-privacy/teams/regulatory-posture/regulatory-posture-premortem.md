---
type: premortem
division: corporate
department: compliance-privacy
team: regulatory-posture
status: new
metrics: [compliance.obligation_coverage, compliance.unevidenced_clause_count, compliance.notice_accuracy, compliance.subprocessor_classification, compliance.questionnaire_answerable_rate]
updated: 2026-08-24
links: ["[[regulatory-posture-charter]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-directive]]", "[[compliance-privacy-premortem]]", "[[privacy-engineering-charter]]", "[[commercial-workforce-agreements-charter]]", "[[design-partner-operations-charter]]", "[[standards-verification-charter]]", "[[red-team-charter]]", "[[corporate]]"]
---

# Regulatory Posture — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> The team doc's one-line premortem is M1; the rest are the ways a register becomes
> decorative rather than absent.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — We signed a DPA whose Annex named controls we could not evidence

A restaurant group's procurement team attached their standard DPA to a contract that
was closing that week. Legal drafted competently against a template. The Annex of
technical and organisational measures listed the ordinary things: encryption at rest
and in transit, access logging, deletion within 30 days of request, subprocessor
notification, breach notification within 72 hours. Nobody walked it clause by clause
against a control, because the register that would have made that a five-minute check
did not exist and building it would have taken a week the deal did not have.

Nine months later the same group sent a security questionnaire. *"Describe your data
subject erasure process, including all systems in scope"* had no answer that was not
a lie: the tombstone was designed but never built, `erasure_receipt_id`
(`20260819000000_guest_identity_minimal_slice.sql:82`) still pointed at no table, and
the consent record still had zero call sites. A signed promise became a discovered
breach of contract — discovered by the counterparty, which is the expensive way and
the way that ends a renewal.

**The mechanism is not negligence.** It is that a register is worth nothing until the
first signature and everything from the moment after, so deferring it is rational
right up to the moment it is too late. That structure is what makes this the most
likely failure rather than the most careless one.

**Earliest observable signal.** The **first inbound DPA, MSA data-protection exhibit,
or vendor security questionnaire that is answered from a template rather than from a
register.** Visible in the thread, the day it happens. Available today as a leading
indicator: `compliance.subprocessor_classification` is **0 / 50** while
[`EXTERNAL_CONNECTIONS.md`](../../../../foundation/EXTERNAL_CONNECTIONS.md) already
enumerates every host — raw material sitting unconverted is the shape of a team that
will be late.

**What would have prevented it.** Three things, in order of how much they matter:

1. **A one-page register before the first signature, not a complete one.** Ten duties
   mapped to a control or an honest "no control — owner X, due Y" beats ninety mapped
   after the fact. [[regulatory-posture-charter]] §Evidence already contains that
   v0 table; it cost one session.
2. **A hard procedural rule: no data-protection exhibit is signed without a
   line-by-line sign-off from this team**, and the sign-off is permitted to say *"we
   cannot evidence clause 4.3 — strike it or accept the gap in writing."* The team's
   power is not veto; it is making the gap explicit *before* signature, which costs
   one uncomfortable email.
3. **`compliance.unevidenced_clause_count` with a target of hard zero**, reported to
   the founder rather than held internally. It is the only metric here that must
   never be traded off, because it is the only one that converts into a contractual
   claim.

---

### M2 — The register reached 90% coverage and meant nothing

The team, correctly diagnosing M1, built the register fast. Every named duty got a
row. *Purpose limitation → "consent_purpose is recorded per consent."* *Erasure →
"tombstone design in the guest identity migration."* *Confidentiality →
"PII guards in the constraint engine."* All three sentences are true and none of them
is a control that has ever run: the consent record had zero call sites, no erasure
had ever been executed, and the PII guards had three conflicting definitions of PII.
`compliance.obligation_coverage` read 90% for a year. It was measuring how many rows
had text in them.

This is the more insidious failure, because it *looks* exactly like success and it
produces the confidence that makes M1's Annex feel safe to sign.

**Earliest observable signal.** The **first register row whose evidence column
contains a sentence instead of a `file:line`, a test name, or an owner-plus-date.**
One row, visible at review, on the day it is written. Secondary and quantitative:
`obligation_coverage` rising while `compliance.questionnaire_answerable_rate` stays
flat — coverage that does not convert into answerable questions is coverage of
nothing.

**What would have prevented it.** **The counting rule, enforced against this team's
own incentive:** a mapping counts only if the control is evidenced by a `file:line`,
a passing test, or a named owner with a date. *"Handled by our architecture"* counts
as **0**. An honest gap also counts as 0 — but a gap is useful and a vague mapping is
worse than nothing, because it stops the search.

Second counter-pressure: **the register's evidence column is verified by
[[privacy-engineering-charter]], not by this team.** The team that writes the mapping
must not also certify that the control exists. That is the same independence argument
[[ORG_STRUCTURE]] §3 makes for the advisory layer, applied inside a department where
it is cheap to honour.

---

### M3 — The notice drifted from the code, and the drift was found by a customer

`Privacy.tsx` claims the app sets no cookies, keeps session tokens in localStorage,
ships interaction telemetry disabled, and defaults partner sharing to off. Its own
header says *"If any of those change, this page has to change with them."* Over the
year, one of those changed — a vendor script, a telemetry default flipped for a
debugging session and never flipped back, a partner-sharing toggle defaulted on for a
design partner. The page was not updated, because the obligation was written as a
comment and enforced by nothing. A prospect's security reviewer read the page, tested
one claim, and found it false. Every other claim on the page instantly became
untrusted, including the ones that were true.

**Earliest observable signal.** It has **already fired.** The page says "WineOps" at
`:23`, `:31`, `:43` — the pre-Mudavym brand. A claim about identity has been wrong
since the rename and nobody noticed, which is proof that no mechanism watches this
file. That is the cheapest possible demonstration that M3 is real rather than
theoretical, and it should be cited every time someone argues the loop is
unnecessary.

**What would have prevented it.** **A per-PR trigger, not a monthly review.** The
page names four testable claims; each maps to a code fact that can be asserted:
cookie count, token storage location, telemetry default, partner-sharing default. A
test that fails when a claim goes false is worth more than a review that reads the
page. And per [[regulatory-posture-charter]] §non-goals, the staleness *machinery*
should be consumed from [[standards-verification-charter]] rather than rebuilt —
this team owns the claim, not the tooling.

---

### M4 — The subprocessor register described the architecture, not the data flow

The team converted `EXTERNAL_CONNECTIONS.md` into a register — 50 hosts, each with a
row. The classification was done by reading service names, which is fast and mostly
right. Toast is a POS integration, so it receives operational data. Vercel hosts the
frontend, so it receives nothing sensitive. Anthropic and Gemini are "AI providers,"
which sounds like infrastructure. Then someone noticed that outbound vendor emails
are drafted by an LLM over raw HTTP, that a message body can contain a person's name,
phone number and dietary restrictions, and that the PII guard which was supposed to
stop that (`constraint_engine.py:113-117`) detects SSNs and card numbers and **not
names, emails, or phone numbers**. The register said "no personal data." The traffic
disagreed for a year, and the disclosure was to a subprocessor with no DPA in place.

**Earliest observable signal.** Any register row classified as "no personal data" on
the basis of **what the service is** rather than **what a sampled payload contains**.
Visible at classification time in the register's own methodology column — which is
why the register needs a methodology column. Structural warning already present:
`EXTERNAL_CONNECTIONS.md` itself notes Anthropic and Gemini are called over raw
HTTP/axios rather than SDKs, which means no shared middleware sees those payloads.

**What would have prevented it.** **Classify by payload, not by vendor category.**
For every host that receives a request body, sample or reason about what that body can
contain in the worst case, and record the reasoning. And **treat the PII guards'
coverage as an input to the classification**: a host is "no personal data" only if a
control prevents personal data reaching it, cited by `file:line`. Today no such
control exists for names, emails or phone numbers on the LLM path, which makes the
correct v0 classification for those hosts *"receives personal data — no control"*.
Uncomfortable and true.

---

### M5 — The team became a document-writing function and never blocked anything

Twelve months of good documents. A register, a records-of-processing table, a
subprocessor list, a notice review, a questionnaire response library. All accurate,
all maintained. And in twelve months the team never once said "this clause cannot be
signed" or "this host cannot receive that payload," because saying so is
confrontational, always arrives during a deal, and is always the compliance team
being the reason something is slow. The gaps were dutifully recorded in the register's
gap column, where they were visible to everyone and blocking to no one, and the
company shipped past them. When the breach came, the register proved the team had
known — which is worse than not knowing.

**Earliest observable signal.** **A full quarter with `unevidenced_clause_count` > 0
and zero written objections filed.** A team that documents gaps and never objects is
producing an audit trail against its own employer. Countable: gap rows in the register
versus written sign-off refusals, both trivially visible.

**What would have prevented it.** **The sign-off is a required artifact of the
signature, not an optional input.** Structurally: an instrument cannot be marked
executed without an attached sign-off from this team, and the sign-off has exactly
three permitted values — *evidenced*, *strike this clause*, or *gap accepted in
writing by [name]*. The third value is what makes the rule survivable commercially;
it lets the founder overrule, on the record, in one line. **An overruled objection is
a working team. An unrecorded gap is not.**

Second counter-pressure: **route the register's gap column to
[[red-team-charter]] quarterly.** Red Team's scope is attacking decisions
([[ORG_STRUCTURE]] §3), and "we accepted this gap" is a decision. A gap nobody
attacks is a gap nobody owns.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible | Already fired? |
|---|---|---|---|---|
| M1 | Unevidenced Annex signed | First DPA answered from a template | The signature thread | No — 0 instruments |
| M2 | Register coverage is decorative | First evidence cell containing a sentence, not a citation | Register review | No — no register |
| M3 | Notice drifted from code | A claim on `Privacy.tsx` is false | The page itself | ✅ **YES** — brand stale at `:23,31,43` |
| M4 | Register classified by vendor, not payload | A "no personal data" row justified by service category | Register methodology column | No — 0/50 classified |
| M5 | Documented gaps, never objected | A quarter with gaps > 0 and objections == 0 | Gap rows vs sign-off refusals | N/A — no quarter yet |

**M3 has already fired, before the team exists.** That is the most useful fact in this
document: it converts the notice-accuracy loop from a hypothetical into a repair, and
it means the first deliverable of this team is not a policy — it is fixing three
lines that have been wrong since the rename.
