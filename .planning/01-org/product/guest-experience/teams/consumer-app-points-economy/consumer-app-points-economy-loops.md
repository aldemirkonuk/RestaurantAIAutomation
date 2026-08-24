---
type: loops
division: product
department: guest-experience
team: consumer-app-points-economy
status: provisional
metrics: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.verified_visit_rate, nf_b.abuse_hold_rate, nf_b.review_quality_pass_rate]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-directive]]", "[[consumer-app-points-economy-premortem]]", "[[guest-experience-loops]]", "[[taste-fingerprint-loops]]", "[[guest-identity-consent-loops]]", "[[security-charter]]", "[[design-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_count: 4
loop_ids: ["nf-b-signal-volume", "points-abuse-posture", "ledger-integrity", "consumer-surface-retention"]
loop_close_times: ["weekly", "weekly", "per-commit", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Consumer App & Points Economy — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**All four are dormant** — the team is unstaffed and gated on OD-07. They are written
now because the abuse loop in particular must exist *before* the surface it defends;
a detector designed after the first attack is a detector designed against one attack.

---

```yaml
type: loop
id: nf-b-signal-volume
owner: guest-experience
team: consumer-app-points-economy
measures: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate]
changes: [earning_rules, verification_gate, app_surface]
inputs_from: [design, guest-identity-consent]
outputs_to: [taste-fingerprint, guest-value-monetization]
close_time: weekly
status: proposed
```

**P1 — Volume, read against integrity.** The two measures are deliberately **one
loop**. Volume alone is farmable; the confirm rate — % of points reaching `confirmed`
rather than expiring provisional ([[FUTURES]] §7.3) — is what makes volume mean
anything. **High volume with a low confirm rate is farming, not engagement**
([[product]] §2.3), and the pair is reported together or not at all.

The change lever is deliberately the **verification gate, not the earning rate**. When
the confirm rate falls, the reflexive fix is to make confirmation easier, which raises
the metric by lowering the thing it measures. Weekly, because that is the cadence at
which an abuse pattern is still cheap to reverse.

---

```yaml
type: loop
id: points-abuse-posture
owner: guest-experience
team: consumer-app-points-economy
measures: [nf_b.abuse_hold_rate, appeal_overturn_rate, new_patterns_found]
changes: [detection_rules, rate_limits, attribution_checks, appeal_path]
inputs_from: [security]
outputs_to: [security, guest-value-monetization]
close_time: weekly
status: proposed
```

**P2 — The adversarial loop, and the only one here with a thinking opponent.** It
measures three things and the third is the point: `new_patterns_found`. A loop that
only measures hold rate confirms the detector against itself.

`appeal_overturn_rate` is the calibration signal — a **high** overturn rate means the
detector is too aggressive and the guest experience is being damaged; a **zero**
overturn rate means the appeal path is decorative, which is worse, because `NEW-878`
promises held-plus-appeal rather than silent zeroing and a promise nobody wins is not
an appeal.

**Weekly and permanent.** Downgrading it to monthly after a quiet quarter is exactly
[[consumer-app-points-economy-premortem]] C2 — the adversary reads the defence and
changes, and a stable hold rate under rising volume is a warning rather than
reassurance. This loop is explicitly **exempt from the three-quiet-runs anti-sprawl
rule**, and the exemption is named rather than assumed.

---

```yaml
type: loop
id: ledger-integrity
owner: guest-experience
team: consumer-app-points-economy
measures: [direct_balance_writes, ledger_recompute_agreement]
changes: [ci_gate_status, correction_path]
inputs_from: [engineering]
outputs_to: [guest-value-monetization, finance-pricing]
close_time: per-commit
status: proposed
```

**P3 — Is the balance still derived?** `direct_balance_writes` must be **0**, enforced
by a CI guard in the shape of `scripts/check_no_direct_stock_writes.sh` — a guard this
repo already wrote for **exactly this failure on inventory**, which is why the
counter-pressure is proven rather than proposed.

`ledger_recompute_agreement` — recomputing the balance from the credit history matches
the served balance — is the loop's honest measure: the guard proves no *code path*
edits, the recompute proves the property actually holds.

Per-commit, and the guard must exist **before the first ledger table**. A guard added
after the first `UPDATE` is a guard arguing with a shipped support tool.

---

```yaml
type: loop
id: consumer-surface-retention
owner: guest-experience
team: consumer-app-points-economy
measures: [guest_return_rate_30d, session_to_event_conversion]
changes: [app_surface, onboarding, design_direction]
inputs_from: [design]
outputs_to: [taste-fingerprint, product-vision]
close_time: monthly
status: proposed
```

**P4 — Do they come back?** Instrumented **before** points are visible, and the
ordering is the whole design of the loop: a points economy layered on a surface nobody
returns to is a ledger of nothing, and once points exist, retention and reward-seeking
are inseparable in the data. Measuring retention first is the only chance to know
whether the *product* works.

`session_to_event_conversion` is the bridge to NF-B: a returning guest who emits no
`stimulus → choice` record is engagement without signal, which is
[[consumer-app-points-economy-premortem]] C3 in a number.

Monthly, matched to a 30-day return window.

---

## Loops this team depends on but does not own

- **`guest-subject-coverage`** ([[guest-identity-consent-loops]] G3) — an app emitting
  events for guests who are not subjects produces engagement metrics and zero NF-B
  events. **Ordering: identity write path first.**
- **NF-B event completeness** ([[taste-fingerprint-loops]] F1) — this team emits, that
  team judges. A rating with no identified `stimulus` is not an event, and this team
  does not get to count it either.
- **`nf-b-tourist-baseline`** ([[taste-fingerprint-loops]] F4) — the home-region
  baseline must be a byproduct of where a guest habitually eats, captured by *this*
  surface, **without a survey question**. The hardest capture problem in the sub-layer
  and it lands here.
