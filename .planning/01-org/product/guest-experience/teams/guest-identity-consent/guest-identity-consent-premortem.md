---
type: premortem
division: product
department: guest-experience
team: guest-identity-consent
status: provisional
metrics: [nf_b.false_merge_count, nf_b.subject_coverage, nf_b.refusal_count]
updated: 2026-08-24
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-directive]]", "[[guest-identity-consent-loops]]", "[[guest-experience-premortem]]", "[[taste-fingerprint-charter]]", "[[guest-value-monetization-charter]]", "[[compliance-privacy-charter]]", "[[red-team-charter]]"]
---

# Guest Identity & Consent — Premortem

> Written at founding, before success is assumed.

The team-doc line this expands ([[product]] §2.1): *"Coverage pressure from 2.2 and
2.4 turns 'exact verified key or nothing' into 'high-confidence fuzzy match', one PR,
one Friday — and the first disclosure is discovered by a guest, not by us."*

It is 2027-08-24. Five mechanisms, most likely first.

---

## F1 — The threshold arrived, and it arrived from inside the sub-layer

**The predicted failure, stated in full.** [[taste-fingerprint-charter]] cannot model
at 3% subject coverage. [[guest-value-monetization-charter]] cannot fill a segment
card. Neither is acting badly; both are doing their jobs, and their jobs require
subjects. The pressure therefore arrives as a *reasonable engineering proposal* from
a colleague, in the register of pragmatism: **"high-confidence match only, only on
verified-looking phone numbers, only for the pilot restaurant."** It ships on a
Friday because it is small. Twelve months later, a corporate assistant who books
dinners for twelve executives is one guest holding twelve people's histories — the
case the migration names at `:148-151` — and it does not look like a bug, it looks
like the system working. A guest sees another guest's allergy note in a staff-facing
profile. **No un-merge reverses that** (`:33-34`).

**Earliest observable signal.** Not the merge. The **vocabulary** — the first
proposal, in any channel, whose sentence about guest matching contains *confidence*,
*threshold*, *fuzzy*, or *just for the pilot*. By the time there is a design doc, the
framing has already won. Second signal, mechanical: any diff touching
`guest_link_identifier()`, `guest_channel_canonicalise()`, or `is_merge_eligible`.
Third: a proposal to build a **merge queue** — deliberately absent per `:22-25` —
because a queue needs candidates and candidates need a similarity score. The queue is
the threshold's delivery vehicle.

**What would have prevented it.** Four things, and they must all exist:
1. This team is measured on **`nf_b.refusal_count` as output**, reported in the same
   review where coverage is complained about. Structural, not cultural.
2. `scripts/eval_guest_merge_policies.py` wired into CI **while it passes trivially**.
   A gate added after the first violation is a gate someone argues with; a gate that
   has been green for a year is a fact.
3. Any merge-rule change is **founder-only, with a mandatory [[red-team-charter]]
   finding attached before discussion** ([[guest-identity-consent-directive]]). This
   removes the Friday-afternoon path entirely — not by policy, but by making the
   decision un-makeable at that altitude.
4. The **owning team of the pressure is not the owning team of the rule**. That is
   the whole reason 2.1 and 2.2 are separate teams ([[ORG_STRUCTURE]] §3).

---

## F2 — Coverage stayed at zero and the team was quietly declared done

The opposite failure and, on today's evidence, at least as likely. The slice is
already shipped and already excellent, so the team reads as *finished*. Nobody wires
a write path, because writing one requires a consent capture channel, which requires
a UI, which requires design time nobody scheduled. `nf_b.subject_coverage` stays
structurally 0% — verified today: no application code touches any of the four guest
symbols. Eighteen months of service pass. Every one of those interactions could have
become an NF-B event **and cannot be backfilled**, which is the exact property the
migration was built around (`:16-25`).

**Earliest observable signal.** The team's `agenda-full` §Next steps unchanged across
two monthly syncs while `updated` moved — visible in
[[guest-experience-agenda-board]]'s Dataview, which is what the stale query is for.
Second signal, more specific: the `guest_identifier_pepper` vault secret still not
provisioned. `guest_pepper()` raises until it is (`:353-359`), so an unprovisioned
secret is proof that nothing has ever attempted a write.

**What would have prevented it.** A **first write path** as the team's founding
deliverable, deliberately tiny: one restaurant, one capture channel of the four the
schema already allows (`:61-62`), no UI beyond what exists. And
`nf_b.subject_coverage` on the sub-layer board as a **structural zero with a named
cause**, not as a low number — because a low number reads as progress-in-progress and
a structural zero reads as a missing part.

---

## F3 — Erasure did not erase, and we found out from a regulator

A guest exercises deletion (`NEW-662`, `NEW-884`). `erased_at` is set, identifiers
hard-deleted, label and consent nulled — exactly as designed (`:79-82`). But by then
a plaintext phone number has reached `pos_checks.raw` through the POS webhook, or a
notification payload, or a `decision_log` entry, because some integration that is not
this team's code captured it before `guest_link_identifier()` ever ran. The migration
is explicit that this is the whole point of the hashing discipline and equally explicit
that it holds only *today*: *"None of those holds guest PII today, which is exactly why
the rule is free now and impossible later"* (`:135-136`).

**Earliest observable signal.** A new inbound integration — POS, reservation,
loyalty, email — landing without a review of what personal fields it persists. The
signal is the **absence of a review**, which is why it must be a scheduled gate rather
than a habit. Second signal: `check_no_raw_guest_channels.sh` gaining an allowlist
entry. Both guard scripts ship with **empty** allowlists (`check_no_guest_name_matching.sh:37-38`);
the first entry is the moment the property stops being absolute.

**What would have prevented it.** Extending `check_no_raw_guest_channels.sh` to run
against **every new inbound payload path**, not only the guest module — the risk is
in code this team does not own. Plus a standing item in the connector review owned
with [[partnerships-integrations-charter]]: *what personal fields does this connector
persist, and where.* And an **erasure receipt** that enumerates what was deleted —
`erasure_receipt_id` already exists as a column (`:82`) with nothing writing it.

---

## F4 — Consent was captured, and we could not prove what it said

`consent_notice_version` is a text column (`:59`) with **no process that bumps it**
and no store of prior notice text. Marketing edits the consent copy; nobody
increments the version, or someone does and the old text is gone with the previous
deploy. A year later a guest asks what they agreed to, or a regulator does. We have a
version string that points at nothing. The versioned-consent design — the single
best idea in the slice, and the reason `:55-56` rejects a boolean — becomes
decorative.

**Earliest observable signal.** Two distinct consent copy strings in git history with
the same `consent_notice_version` value. Cheap to detect and detectable only if
someone looks, which is why it is a scheduled job rather than a principle.

**What would have prevented it.** The `consent-copy-diff` skill in
[[guest-identity-consent-schedule]]: any change to consent text, purpose strings, or
capture channels bumps the version and archives the prior text as a retrievable
artifact. Plus the quarterly `consent-version-audit` with
[[compliance-privacy-charter]]: every live version still has retrievable text, and no
guest sits under a version we can no longer produce.

---

## F5 — The reasoning was lost because it only ever lived in SQL comments

The slice's real asset is not its DDL, it is its **argument** — why no threshold, why
a tombstone and not a soft delete, why the card fingerprint is quarantined despite
being verified, why incompleteness must fail to a split. All of it lives in comments
inside one migration file. A migration is the one artifact nobody re-reads: it ran
once, it is history. Eighteen months on, a new contributor sees three tables and a
generated column, cannot see why, and rebuilds the "missing" merge queue in good
faith.

**Earliest observable signal.** Any design document about guests that does not cite
`20260819000000_guest_identity_minimal_slice.sql`. That is the moment the reasoning
has stopped propagating.

**What would have prevented it.** The `guest-merge-review` skill
([[guest-identity-consent-schedule]]) — triggered by any diff touching the identity
functions, and its job is to *re-apply the argument*, not to check syntax. Plus this
charter set, which lifts the load-bearing lines out of the comments and into
documents that are read. That is a substantial part of what this team is for.

---

## The one that would end it

F1. F2 wastes eighteen months of unbackfillable signal, F3 and F4 are regulator
conversations with a paper trail we mostly have, F5 is slow decay. **F1 discloses one
person to another and cannot be undone.** Every counter-pressure above is negotiable
under coverage pressure except the founder-only gate, which is why that gate is the
first line of [[guest-identity-consent-directive]] and not a bullet somewhere in it.
