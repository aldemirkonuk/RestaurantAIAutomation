---
type: premortem
division: product
department: guest-experience
parent_department: product-vision
status: provisional
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.event_completeness, nf_b.ops_conversion, nf_b.k_anonymity_pass_rate]
updated: 2026-08-24
links: ["[[guest-experience-charter]]", "[[guest-experience-directive]]", "[[guest-experience-loops]]", "[[guest-identity-consent-premortem]]", "[[taste-fingerprint-premortem]]", "[[consumer-app-points-economy-premortem]]", "[[guest-value-monetization-premortem]]", "[[compliance-privacy-charter]]", "[[red-team-charter]]", "[[FUTURES]]", "[[OPEN-DECISIONS]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Guest Experience — Premortem

> Written at founding, before success is assumed. Per [[ORG_STRUCTURE]] §4 this is
> artifact #2 deliberately: a unit that cannot articulate its own failure before it
> starts has not been thought through.

It is 2027-08-24. The Guest Experience sub-layer has failed. Five mechanisms, most
likely first. The team-level premortems specialise these; this one is about how the
*sub-layer* fails as a whole.

---

## M1 — The guest side became a social network and nothing came back

**Most likely, because it is the pleasant failure.** Ratings, follows, photos, a
feed, tiers — all of it shippable, all of it demoable, none of it landing anywhere
in restaurant operations. `nf_b.ops_conversion` sits at 0 for four consecutive
quarters and nobody escalates, because every individual quarter had visible progress
in guest metrics. [[FUTURES]] §10 names this exact outcome as a non-goal —
*"Turning the guest side into a standalone social network — it exists to feed
restaurant operations"* (`FUTURES.md:281`) — and the non-goal is violated by
accumulation, never by a decision anyone would recognise as one.

**Earliest observable signal.** The first monthly review where the guest deck leads
with engagement numbers and `nf_b.ops_conversion` is a footnote. Not the value of
the number — its *position on the slide*. Second signal, mechanical: any month in
which `nf_b.events_per_active_guest_month` rises while `nf_b.ops_conversion` is flat
at zero.

**Counter-pressure.** `nf_b.ops_conversion` is the **first** line of
[[guest-experience-agenda-board]] and of every review, above engagement, permanently.
And the loop `nf-b-ops-conversion` in [[guest-experience-loops]] has a **quarterly**
close-time with a written consequence: two consecutive quarters at zero and the
sub-layer's charter goes back to Product & Vision for a scope decision — not more
funding, a scope decision. The counter-pressure is that the failure has a scheduled
date on which it must be spoken aloud.

---

## M2 — Coverage pressure broke the merge rule, and a guest found out before we did

The identity slice ships with no threshold at all — *exact verified key, a human
assertion, or nothing*
(`20260819000000_guest_identity_minimal_slice.sql:27-35`). Then
[[taste-fingerprint-charter]] cannot model on 3% subject coverage and
[[guest-value-monetization-charter]] cannot fill a segment card, and the pressure
arrives from *inside* the sub-layer, in the reasonable-sounding form: *"high-confidence
fuzzy match, only for verified-looking phone numbers, only for the pilot."* One PR,
one Friday. Twelve months later a corporate assistant who books dinners for twelve
executives is one guest holding twelve people's histories — the case the migration
names at `:148-151` — and it does not look like a bug. It looks like the system
working. **No un-merge reverses a disclosure** (`:33-34`).

**Earliest observable signal.** Not a false merge. The **conversation**: any proposal
whose sentence contains "confidence", "threshold", or "just for the pilot" applied to
guest matching. Second signal, mechanical: a diff touching
`guest_link_identifier()`, `guest_channel_canonicalise()`, or the four PII guards
(`check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`, the
`revoke all` at `:485`, `guest_pepper()`) — any of which should be rare enough that
each one is an event.

**Counter-pressure.** Three, layered. (1) [[guest-identity-consent-charter]] is
measured on **refusals**, not on match rate, and reports the refusal count *as an
achievement* in the same review where coverage is complained about. (2) The
zero-false-merge CI gate already exists — `guest_copresence_negatives` (`:519-540`)
+ `scripts/eval_guest_merge_policies.py` — and it shipped **before the data** on
purpose; it must be wired into CI while it still passes trivially, because a gate
added after the first violation is a gate someone will argue with. (3) Any change to
the merge rule is a **founder-only decision** routed through [[OPEN-DECISIONS]] with
a mandatory [[red-team-charter]] finding attached. Written into
[[guest-experience-directive]] as the one thing this sub-layer cannot decide for
itself.

---

## M3 — We modelled taste on 37 strings and believed the model

Dish identity is deferred (A15, [[DISH_IDENTITY_DESIGN]]) and the corpus is 47
checks, one restaurant, one day, 37 distinct item strings. A taste graph gets built
anyway, because a taste graph is buildable on anything. Personalization recommends
the ribeye to everyone, because the ribeye is most of the corpus. The model's
confidence is read as the data's confidence, a restaurant changes a par level on it,
and the first externally-visible output of NF-B is a wrong operational decision with
our name on it.

**Earliest observable signal.** The first NF-B "insight" whose supporting event count
is not printed next to it. Sample size disappearing from the artifact is the tell,
and it disappears for good UI reasons every single time.

**Counter-pressure.** `nf_b.event_completeness` is defined so that it *cannot* be
gamed by counting: an event missing `stimulus`, `choice`, `outcome`, or `context`
does not count as an NF-B event, and a rating with no identified dish has no
`stimulus`. Plus a rendering rule with no exception — **every guest-derived claim
renders its n, or it does not render**. And [[taste-fingerprint-charter]] enters
**wine-only**, where identity is deterministic and measured, rather than
food-and-wine at 37 strings.

---

## M4 — The k-anonymity threshold got lowered for the pilot restaurant

The segment card has nothing to show because the pilot restaurant has eleven
consented guests. The threshold moves from k=20 to k=5 "temporarily, for the pilot".
A manager recognises a regular in a three-person segment. The consent record we so
carefully versioned (`:54-64`) is then the *evidence* that we told them we would not
do this — the artifact built to protect the guest becomes the artifact that proves
the breach.

**Earliest observable signal.** The threshold appearing as a **configurable value**
anywhere — an env var, a settings row, a per-restaurant override. Configurability is
the mechanism; the lowering is just its first use. Second signal: any segment view
that renders while returning fewer than k underlying subjects, even in a staging
environment.

**Counter-pressure.** The k-threshold is a **constant in code with a CI guard**, in
the same shape as the four PII guards that already work (`check_no_guest_name_matching.sh`
is the template) — not configuration, not a feature flag, not a per-restaurant
setting. Below k the surface renders *"not enough data yet"*, which is a normal,
shippable, non-embarrassing state, and designing that empty state **early** is what
removes the incentive to lower the number later. And per
[[guest-value-monetization-charter]], the review of a k-threshold change is
[[compliance-privacy-charter]]'s, never this sub-layer's — the unit that benefits
from a personalization feature cannot neutrally assess it ([[ORG_STRUCTURE]] §3).

---

## M5 — Four teams were stood up, three had nothing to do, and the sub-layer lost credibility

The least dramatic and the most probable-in-aggregate. Two teams are hard-blocked by
decisions already made and one has zero groundwork ([[guest-experience-charter]]
§Team count). Staffed anyway, they produce charters, agendas, and no artifacts, and
by month six "Guest Experience" reads to the rest of the org as the place documents
go. Then, when the identity work genuinely needs defending, nobody believes the
request.

**Earliest observable signal.** Two consecutive monthly agenda syncs where a team's
`agenda-full` §Next steps is unchanged and its `updated` frontmatter has moved anyway.
Dataview makes this visible in [[guest-experience-agenda-board]] — that is what the
query is for.

**Counter-pressure.** Trigger-gated teams carry `status: new` and an **explicit entry
trigger written in their charter**, and they stay unstaffed until it fires. The
anti-sprawl rule from [[README]] §3.3/§6 is applied to *units*, not only to skills
and jobs: a unit whose agenda has not changed in 60 days is either finished or
fiction ([[ORG_STRUCTURE]] §4), and this sub-layer will name which.

---

## The one that would end it

M2. M1 wastes a year, M3 embarrasses us, M4 costs a restaurant and a regulator
conversation, M5 costs credibility. **M2 discloses one person's dining history,
spend, allergies and companions to another person, and cannot be undone.** Every
other counter-pressure in this document is negotiable under pressure. That one is
not, and this premortem exists so that when the pressure arrives — and it will
arrive from inside the sub-layer, wearing the words "coverage" and
"high-confidence" — it is recognised as the thing that was predicted.
