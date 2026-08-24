---
type: loops
division: product
department: guest-experience
team: guest-identity-consent
status: provisional
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.refusal_count, nf_b.consented_link_rate, nf_b.unverified_identifier_share]
updated: 2026-08-24
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-directive]]", "[[guest-identity-consent-premortem]]", "[[guest-experience-loops]]", "[[taste-fingerprint-loops]]", "[[compliance-privacy-charter]]", "[[security-charter]]", "[[partnerships-integrations-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_count: 4
loop_ids: ["guest-merge-gate", "guest-pii-guard-integrity", "guest-subject-coverage", "consent-provability"]
loop_close_times: ["per-commit", "per-commit", "weekly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Guest Identity & Consent — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Two of the four below close **per-commit**. That is unusual and it is the point: this
team's signature error is irreversible, so any loop that closes on a review cadence
is a loop that *reports* the error rather than preventing it.

---

```yaml
type: loop
id: guest-merge-gate
owner: guest-experience
team: guest-identity-consent
measures: [nf_b.false_merge_count, nf_b.copresence_negative_pairs]
changes: [ci_gate_status, merge_policy]
inputs_from: [security, red-team]
outputs_to: [compliance-privacy, product-vision, taste-fingerprint]
close_time: per-commit
status: proposed
```

**G1 — The gate that must never fire.** `guest_copresence_negatives` (`:519-540`)
harvests free negative labels from a fact about the world: two guests linked to the
same check are different people. Every check with n≥2 links emits C(n,2) negatives at
zero labelling cost, growing with every service — the direct analogue of the 732,874
free negatives the wine work harvested (`:246-252`).
`scripts/eval_guest_merge_policies.py` fails CI on **one** false merge.

**Per-commit, because prevention and reporting are different jobs.** The view ships
**empty** and that is deliberate (`:513-518`): register A6 records a merge policy
self-graded against probes its own author imagined, and the gate exists so that cannot
recur. It must be **wired while it passes trivially** — a green gate is a fact, a gate
introduced after a violation is a negotiation.

**What it changes:** nothing, when healthy. A firing gate changes `merge_policy`, and
that change is founder-only ([[guest-identity-consent-directive]]).

---

```yaml
type: loop
id: guest-pii-guard-integrity
owner: guest-experience
team: guest-identity-consent
measures: [pii_guards_present, guard_allowlist_entries]
changes: [ci_gate_status, guard_definitions]
inputs_from: [security, engineering]
outputs_to: [compliance-privacy, legal]
close_time: per-commit
status: proposed
```

**G2 — Do the four guards still exist?** Not *do they pass* — that is what they
already do — but **are they still there**, structurally. The four are independent by
design and each closes a different hole, so the loop asserts all four separately:
(1) `check_no_guest_name_matching.sh` green with an **empty allowlist** (`:37-38`);
(2) `check_no_raw_guest_channels.sh` likewise; (3) `revoke all on
public.guest_identifiers from authenticated, anon` still present at `:485`;
(4) `guest_pepper()` still **raises** on a missing vault secret rather than falling
back to a constant (`:353-359`).

`guard_allowlist_entries` is the sensitive measure. Both allowlists are empty today.
The first entry may be perfectly correct and is never routine —
[[guest-identity-consent-directive]] escalates on it.

---

```yaml
type: loop
id: guest-subject-coverage
owner: guest-experience
team: guest-identity-consent
measures: [nf_b.subject_coverage, nf_b.consented_link_rate, nf_b.refusal_count, nf_b.unverified_identifier_share]
changes: [consent_capture_channel, guest_link_write_path]
inputs_from: [design, compliance-privacy, partnerships-integrations]
outputs_to: [taste-fingerprint, guest-value-monetization]
close_time: weekly
status: proposed
```

**G3 — Does anything become a guest, and at what refusal cost?** Coverage and
refusals are measured in **one loop, on purpose**. Read alone, coverage invites the
threshold; read together, they describe a policy. The change lever is *which capture
channel is live* — four are permitted (`:61-62`) and they differ sharply in what they
produce: `reservation_form` and `loyalty_signup` yield verified identifiers,
`staff_verbal` yields the unverified rows the migration warns about at `:148-151`.

Weekly, because a capture channel either works in service or it does not, and one
week of service is enough to know.

`nf_b.unverified_identifier_share` is expected to be **high**, and a *falling* number
with no change that explains it is a signal to investigate, not to celebrate — it
means something began treating unverified identifiers as merge-eligible. This is the
mechanical early warning for [[guest-identity-consent-premortem]] F1.

---

```yaml
type: loop
id: consent-provability
owner: guest-experience
team: guest-identity-consent
measures: [consent_versions_with_retrievable_text, guests_under_unretrievable_version, erasure_receipts_written]
changes: [consent_notice_version, notice_archive]
inputs_from: [compliance-privacy, legal]
outputs_to: [compliance-privacy, legal]
close_time: quarterly
status: proposed
```

**G4 — Can we still prove what we told them?** `consent_notice_version` (`:59`) is a
version column with **no process that bumps it** and no archive of prior text. The
loop measures how many live versions still have retrievable notice text and how many
guests sit under a version we can no longer produce — the second number must be zero
and is unmeasured today.

It also carries `erasure_receipts_written`, because `erasure_receipt_id` (`:82`) is a
column nothing writes: an erasure that produces no receipt is a claim, not a proof.

Quarterly, matched to how often consent copy realistically changes, and run **with**
[[compliance-privacy-charter]] — not reviewed by them afterwards. This is
[[guest-identity-consent-premortem]] F4's counter-pressure.

---

## Loops this team feeds but does not own

- **NF-B event completeness** ([[taste-fingerprint-loops]] L3) — we supply the
  subject; they supply the event. Their metric is undefined until G3 produces a
  non-zero denominator, and saying so is a shared obligation.
- **k-anonymity render gate** ([[guest-value-monetization-charter]]) — we decide who
  *is* a subject; they decide what is shown about groups of subjects.
- **Connector personal-field review** ([[partnerships-integrations-charter]]) — the
  F3 risk lives in code this team does not own, which is exactly why it must be a
  scheduled gate on their side rather than a habit on ours.
