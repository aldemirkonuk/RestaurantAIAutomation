---
type: premortem
division: corporate
department: compliance-privacy
team: privacy-engineering
status: exists
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.guard_allowlist_size, privacy.store_inventory_coverage]
updated: 2026-08-24
links: ["[[privacy-engineering-charter]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-directive]]", "[[compliance-privacy-premortem]]", "[[regulatory-posture-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[security-charter]]", "[[red-team-charter]]", "[[0006-neural-footprint-architecture]]"]
---

# Privacy Engineering — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> The team doc's one-line premortem is M1; the other four are the mechanisms that
> make M1 survivable or fatal.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — Four PII guards disagreed, one missed a field, and a guest's erasure request taught us the definition was inconsistent

This is the founding premortem and it remains the most likely, because the
disagreement **already exists and is already invisible**. Twelve months on:
`constraint_engine.py` and `provider_communication_agent.py` still carried the same
seven regexes in two places — until someone hardened one of them to catch IBANs and
did not touch the other, so outbound drafts were blocked on a pattern that inbound
classification let through. `research_tasks.py` still defined PII as email-or-phone
only, so a research snippet containing a card number was written into
`evidence_citations` and D-12's `sensitive = false` predicate happily returned it in
search. Nobody noticed for eight months, because **every one of those guards was
green the entire time**. The inconsistency surfaced when a guest asked what was held
about them and the answer had to be assembled by hand.

**Earliest observable signal.** The **first commit that edits one PII pattern list
and not the other.** Today `constraint_engine.py:28-36` and
`provider_communication_agent.py:40-48` are byte-identical modulo `re.compile`;
`git log -p -- <both files> | grep PII_PATTERNS` returns nothing yet. The day it
returns a one-sided hunk is the day the divergence started, and it is a query, not a
judgement.

**What would have prevented it.** Three counter-pressures, none of which is vigilance:

1. **One module, one pattern set, imported.** `services/agent-orchestrator/privacy/pii.py`
   with a single definition and a version constant. Duplication is the mechanism;
   removing the duplication removes the mechanism.
2. **`scripts/check_single_pii_definition.sh`** in the shape of the five `check_*.sh`
   guards already in CI: fail the build if a regex resembling a PII pattern appears
   outside the module. A grep is enough, and the failure it prevents is a disclosure.
3. **A shared corpus test, not just a shared list.** One fixture file of PII
   specimens — SSN, IBAN, card, email, phone, passport, a guest name, a hashed
   channel — asserted against *every* consumer of the definition. The list makes them
   agree today; the corpus makes them agree after the next edit. And it makes the
   gaps visible: today's specimens for "guest name" and "taste vector" would fail on
   all four guards, which is a finding worth having in writing.

---

### M2 — Erasure was declared complete against a list we wrote ourselves

The runbook enumerated the stores: `guests`, `guest_identifiers`, `guest_check_links`.
It ran, it passed, the receipt said complete. Over the year the platform added
`analytics_cache` rows keyed by guest, an `event_store` payload carrying a check
link, a Sentry breadcrumb, a `conversation_embeddings` row, and the NF-B research
store — and the runbook was never widened, because widening it required someone to
notice a new table *and* connect it to a person. The metric read 100% throughout,
which is worse than reading 40%, because a wrong number ends the conversation that a
low number starts.

`check_no_raw_guest_channels.sh` names six sinks that would swallow a channel
silently — `pos_checks.raw`, `events`, `notifications`, `decision_log`,
`event_store`, `analytics_cache.data` — and says of them: *"None of them holds guest
PII today. That is precisely why this rule is free to enforce now and impossible to
enforce later."* The same sentence is true of the erasure denominator, and it was not
acted on.

**Earliest observable signal.** The **first monthly erasure drill whose denominator
is a constant in a file rather than a query against `information_schema`.** Visible
in the drill's own source on day one. Secondary signal: `privacy.erasure_completeness`
reports 100% while `privacy.store_inventory_coverage` is below 100% — those two
numbers are inconsistent by construction, and a dashboard showing both makes the lie
self-evident.

**What would have prevented it.** **The denominator is discovered, never declared.**
The drill enumerates tables from the live catalogue, classifies each as
person-bearing or not, and *fails* on any table it has never classified. A new
migration therefore breaks the drill until someone classifies its tables — which is
the same forcing function `schema-parity.yml` already applies to hand-applied DDL,
for the same reason: *"drift is usually introduced outside a PR"* (`:23-25`).

---

### M3 — The guards' allowlists ate the guards

Both guard scripts ship with an empty allowlist and an explicit invitation to add to
it: *"a false positive is one line in the allowlist below, a false negative is a
disclosure."* That trade is correct once. It is not correct thirty times. A year of
broad patterns against a growing codebase produced a steady trickle of false
positives, each individually obviously fine, each resolved in the cheapest available
way. By month nine the allowlist had eighteen entries, three of which were no longer
accurate descriptions of the code they exempted, and one of which was a genuine
violation that had been mis-triaged during a release crunch. The guard still passed.
It was passing over a hole.

**Earliest observable signal.** `privacy.guard_allowlist_size` crosses **5**, or any
single entry survives two consecutive quarters without being re-verified. Both are
countable directly from the `ALLOWLIST=()` array in each script; both are zero today,
which makes this the cheapest tripwire in the department to arm.

**What would have prevented it.** **An expiring allowlist.** Each entry carries a
date and an owner, and the guard fails on entries older than one quarter until they
are re-verified or fixed. This converts the cheap path from "add a line" into "add a
line that will come back to you", which is the only version of an allowlist that does
not accumulate. Secondary: **allowlist additions require a second reader** — the same
person who hit the false positive should not be the one who classifies it, because at
that moment they are optimising for getting their build green.

---

### M4 — We built controls for a schema nobody called, then guest data arrived somewhere else

Twelve months of good work: an erasure function, a receipt table, a consent gate, a
unified PII module. All correct. All operating on `public.guests`, which still had
zero writers. Meanwhile guest data entered the system the way it actually enters
systems — a restaurant emailed a reservation CSV, a POS integration surfaced a
cardholder name on a check, a support thread quoted a phone number — and landed in
`pos_checks.raw`, in a `notifications` payload, and in an `analytics_cache` blob.
None of those paths passed through `guest_link_identifier()`, so none of the controls
applied. The team's dashboards were green and describe a system that was not the one
holding the data.

This is [[compliance-privacy-premortem]] M1 seen from inside the team, and it is
listed separately because the team-level counter-pressure is different from the
department-level one.

**Earliest observable signal.** A **grep for person-shaped column names outside
`guest_identifiers`** returns a hit: `phone`, `email`, `card_.*fingerprint`,
`customer_name`, `guest_name` on any table that is not the identity spine. Runnable
today against `information_schema.columns`; expected result today is a small number
of pre-existing operator/vendor contact columns, which is exactly the baseline worth
recording before it grows.

**What would have prevented it.** **A guard on the bypass, not only on the path.**
The two existing guards protect the correct route. The missing third —
`check_no_guest_pii_outside_identifiers.sh` — asserts that no table outside the
identity spine carries a person's contact attribute. Written in the same shape and
with the same argument as its two siblings, and cheap now for precisely the reason
`check_no_raw_guest_channels.sh` gives about itself: *"once a year of payloads has
absorbed phone numbers, no grep un-absorbs them."*

---

### M5 — We accepted an unerasable store because refusing it was not our call, and never escalated it either

The NF-B research store began accumulating. This team knew — it is written in the
charter — that
[ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md) locks the
research store as append-only, deliberately wide, and **never migrated**, and that a
guest taste fingerprint is personal data. The team also knew that resolving the
tension was above its pay grade: crypto-shredding, subject partitions, and
aggregate-only retention all cost ML value, and a controls team does not get to
unilaterally impose an ML cost. So it did the reasonable thing and wrote the tension
down. Writing it down is not escalating it. Twelve months later the store held a year
of rows, all three reconciliations had become expensive, and the first erasure
request produced an answer that was true of the production store and false of the
system.

**Earliest observable signal.** **The first NF-B row written while
`OPEN-DECISIONS.md` has no entry for research-store erasability.** Not the
thousandth — the first. The signal is a join between a row count and a decision log,
and both sides are currently zero, which is the only moment at which the check is
free.

**What would have prevented it.** **Convert the tension into a dated fork, with a
named decider, before the store has rows** — paired to OD-11, listing the three
candidate mechanisms and their costs, decided by the founder with
[[taste-fingerprint-charter]] and [[neural-footprint-instrumentation-charter]]
present. And a hard sequencing rule the team *can* enforce without overreaching:
**erasability requirement precedes first write.** This team does not get to choose
the mechanism; it does get to insist that a mechanism is chosen before the store
starts filling, which is a schema-review right it already exercises on migrations.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible | Free today? |
|---|---|---|---|---|
| M1 | PII guards diverge | First one-sided edit to a pattern list | `git log -p` over both guard files | ✅ identical today |
| M2 | Erasure measured against a declared list | Drill denominator is a constant, not a query | The drill's own source | ✅ no drill yet |
| M3 | Allowlists ate the guards | `guard_allowlist_size` > 5, or an unreviewed entry ages 2 quarters | `ALLOWLIST=()` in both scripts | ✅ both empty |
| M4 | Data arrived off the guarded path | Person-shaped column outside the identity spine | `information_schema.columns` | ✅ baseline recordable now |
| M5 | Unerasable store accepted by silence | First NF-B row with no `OPEN-DECISIONS.md` entry | Row count vs decision log | ✅ both zero |

**All five are free to arm today and all five get more expensive monotonically.**
That is not a coincidence — it is the same structural property the two existing guard
scripts identified about themselves, and this team was founded on top of two
artifacts whose authors already understood it. The failure mode is not missing the
argument; it is having the argument in a file header and not extending it to the four
places it also applies.
