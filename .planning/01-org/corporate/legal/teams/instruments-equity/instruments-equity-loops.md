---
type: loops
division: corporate
department: legal
team: instruments-equity
status: provisional
metrics: [legal.instrument_chain_integrity, legal.counsel_gate_compliance, legal.consent_record_completeness, legal.cap_table_tie_out_divergence]
updated: 2026-08-24
links: ["[[instruments-equity-charter]]", "[[instruments-equity-premortem]]", "[[instruments-equity-directive]]", "[[instruments-equity-schedule]]", "[[legal-loops]]", "[[positioning-fundraise-readiness-loops]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
---

# Instruments & Equity — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

This team's loops are mostly **event-closed**, and that is a deliberate design rather than
a shortcut. A periodic loop over six instruments that may take three years to all exist
would report "nothing" every week until it was quietly abandoned — the exact staleness
[[legal-premortem]] M1 describes. Event-closed loops are silent when there is nothing to
close and instantly live when there is.

The two periodic loops that remain are periodic for a reason: they detect **drift**, and
drift has no event to fire on.

---

## L-IE-1 — Chain completion as a state transition

```yaml
type: loop
id: ie-chain-completion
owner: instruments-equity
measures: [legal.instrument_chain_integrity, legal.counsel_gate_compliance]
changes: [legal.instrument_register, legal.cap_table]
inputs_from: [positioning-fundraise-readiness, legal]
outputs_to: [legal, positioning-fundraise-readiness, decision-office]
close_time: per_instrument
status: proposed
```

Fires at signature and must close before the instrument can be marked `executed`.
Asserts four things: **signed original** on file, **authority** (a consent dated before its
action, or the founder's written terms), **consequence model** in the file
([[instruments-equity-directive]] IE-2), and the **downstream entry** it ties out to.

Any leg missing holds the transition — the instrument stays `signed`, which is a visible
and uncomfortable state rather than an invisible one. That discomfort is the mechanism.
An instrument stuck at `signed` past one close-time escalates.

Baseline **0 of 0**. Only 100% passes (`corporate.md:80-83`), and 0 of 0 is an unread
score rather than a good one.

---

## L-IE-2 — Cap-table tie-out

```yaml
type: loop
id: ie-cap-table-tie-out
owner: instruments-equity
measures: [legal.cap_table_tie_out_divergence, legal.instrument_chain_integrity]
changes: [legal.cap_table, legal.instrument_register]
inputs_from: [legal]
outputs_to: [positioning-fundraise-readiness, decision-office]
close_time: quarterly
status: proposed
```

Counters [[instruments-equity-premortem]] M3. Re-reads **every** executed instrument
against the cap table — every one, not a sample. At this volume a sample is a rounding
error, and at higher volume the un-sampled row is the one that is wrong.

**Direction matters and is the point of the loop:** the cap table is corrected from the
paper, never the paper from the cap table. A divergence found here is always a cap-table
defect, never an instrument defect, because the executed original is by definition what
happened.

One divergent row is the alarm. There is no "acceptable divergence" threshold, and setting
one would be the first step toward the spreadsheet becoming the truth.

Quarterly rather than event-closed because divergence is introduced by *editing the
spreadsheet*, which is not an event this team sees.

---

## L-IE-3 — Consent-record ordering

```yaml
type: loop
id: ie-consent-ordering
owner: instruments-equity
measures: [legal.consent_record_completeness, legal.retroactive_consent_count]
changes: [legal.consent_record, legal.instrument_register]
inputs_from: [legal]
outputs_to: [decision-office, red-team]
close_time: per_board_action
status: proposed
```

Counters [[instruments-equity-premortem]] M5. Fires on every board action and closes when
the authorising consent is on file **dated before the action**. A consent dated afterwards
is refused by the register rather than accepted with a note.

The metric is deliberately defined on **ordering** rather than presence, because a consent
record that is 100% present and 60% reconstructed scores 100% under the presence
definition — and that is precisely how the failure stays invisible until somebody reads
the record as a narrative rather than as a checklist.

Zero board actions this quarter is a valid recorded reading. This loop is allowed to be
boring; it is not allowed to be absent.

---

## L-IE-4 — Verbal-commitment reconciliation

```yaml
type: loop
id: ie-verbal-commitment-reconciliation
owner: instruments-equity
measures: [legal.open_requests_without_instrument, legal.days_from_engagement_to_request]
changes: [legal.instrument_register]
inputs_from: [positioning-fundraise-readiness, roster-lifecycle, legal]
outputs_to: [legal, decision-office]
close_time: monthly
status: proposed
```

Counters [[instruments-equity-premortem]] M4. Asks one question monthly: **is there anyone
who believes they have been promised equity, or a role, or terms, who has no open request
in the register?** Advisors, prospective investors, early collaborators, anyone.

Periodic rather than event-closed for the obvious reason — the failure *is* the missing
event. Nothing fires when a promise is made in a conversation, so something has to go
looking.

The output is not a document. It is a list of names, and an empty list is the good answer.
`legal.days_from_engagement_to_request` should be **0** by [[instruments-equity-directive]]
IE-5; any positive number is the gap this loop exists to close.

---

## L-IE-5 — Activation check

```yaml
type: loop
id: ie-activation-check
owner: instruments-equity
measures: [legal.instruments_issued_count, legal.agenda_content_diff_days]
changes: [legal.team_structure, instruments-equity.charter]
inputs_from: [positioning-fundraise-readiness, legal]
outputs_to: [legal, decision-office]
close_time: quarterly
status: proposed
```

The team's own honesty loop, and the local half of [[legal-loops]] L-LEG-5. This team is
**armed rather than running** ([[instruments-equity-charter]] §Entry conditions), and a
team that is armed for long enough without firing becomes indistinguishable from a team
that does not exist.

Quarterly, it reports two numbers and nothing else: instruments issued, and days since
[[instruments-equity-agenda-full]] last changed **in content** (a date bump counts as
unchanged — that is [[legal-premortem]] M1's disguise). At the second consecutive quarter of
zero-and-stale, the merge condition in L-LEG-5 fires and this charter folds back into
[[legal-charter]].

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-IE-1 chain completion | per instrument | Broken chains found at diligence rather than at signature |
| L-IE-2 cap-table tie-out | quarterly | M3 — the spreadsheet becoming the truth |
| L-IE-3 consent ordering | per board action | M5 — retroactive governance record |
| L-IE-4 verbal-commitment reconciliation | monthly | M4 — promises outside the register |
| L-IE-5 activation check | quarterly | M1 department-level — a team that never fires |

No loop here counters [[instruments-equity-premortem]] M2 — the missing IP assignment —
and that is deliberate rather than an omission. M2 has no recurring signal to loop on; its
signal is a **single absent row that is absent right now**. It is carried as a next step in
[[instruments-equity-agenda-full]] and as an open item on
[[instruments-equity-agenda-board]], where it stays visible until it is closed once.
