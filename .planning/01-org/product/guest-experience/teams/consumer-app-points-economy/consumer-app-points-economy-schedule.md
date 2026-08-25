---
type: schedule
division: product
department: guest-experience
team: consumer-app-points-economy
status: provisional
metrics: [nf_b.points_confirm_rate, nf_b.abuse_hold_rate, nf_b.events_per_active_guest_month]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-loops]]", "[[consumer-app-points-economy-directive]]", "[[guest-experience-schedule]]", "[[skills-charter]]", "[[security-charter]]", "[[design-charter]]", "[[FUTURES]]", "[[OPEN-DECISIONS]]"]
---

# Consumer App & Points Economy — Schedule & Skills

> **The team is unstaffed and gated on OD-07.** Only `od-07-watch` and
> `ledger-write-guard` run today. Everything else activates with the team.

## Recurring work

| Cadence | Job | Active? | Emits |
|---|---|---|---|
| Weekly | `od-07-watch` — keeps OD-07 in the open-decision digest until it closes, noting that [[FUTURES]] §7.5 already supplies the MVP scope the call was waiting on | **yes** | — |
| Per-commit | `ledger-write-guard` — no code path writes a points balance directly; modelled on `scripts/check_no_direct_stock_writes.sh` | **yes** — write it **before** the first ledger table | `direct_balance_writes` |
| Weekly | `abuse-pattern-review` — new farming patterns written up as findings; detection retuned against **held credits and appeal outcomes**, not a fixed rule list | on activation | `nf_b.abuse_hold_rate` · `appeal_overturn_rate` · `new_patterns_found` |
| Weekly | `volume-and-confirm` — `nf_b.events_per_active_guest_month` printed **beside** `nf_b.points_confirm_rate`. Never separately | on activation | both |
| Weekly | `appeal-queue-review` — every held credit reviewed within the promised window; `NEW-878` requires held-plus-appeal, never silent zeroing | on activation | `appeal_overturn_rate` |
| Daily | `expiry-notice-run` — unconfirmed points nearing expiry notify the guest **before**, not after (`NEW-872`) | on activation | — |
| Monthly | `ledger-recompute` — balance recomputed from credit history matches the served balance | on activation | `ledger_recompute_agreement` |
| Monthly | `retention-read` — 30-day return rate and session-to-event conversion | on activation | `guest_return_rate_30d` |
| Quarterly | `redemption-gate-check` — has `nf_b.points_confirm_rate` been stable for a full quarter? Until yes: **status and badges only** ([[FUTURES]] §7.4) | on activation | Gate verdict |

**Anti-sprawl, with one named exemption.** A job producing no action for 3 consecutive
runs is downgraded or deleted ([[README]] §6). **`abuse-pattern-review` is exempt, and
the exemption is the point:** three quiet weeks against an adaptive adversary is the
condition under which downgrading is most tempting and most wrong
([[consumer-app-points-economy-premortem]] C2). `ledger-write-guard` is exempt on the
usual grounds — a guard that fires arrived too late. Everything else is subject to the
rule normally, including `od-07-watch`, which deletes itself when OD-07 closes.

## Skills owned

Skills live in `.claude/skills/`. **The directory does not exist yet**
([[skills-charter]]). Each proposal names trigger, doneability, and a real past
instance per [[README]] §3.3.

### `ledger-append-only-check` (T2)

- **Trigger.** Any diff touching points, credits, balances, or redemption.
- **Doneability.** Confirms the change appends rather than mutates; confirms a
  correction is a compensating entry; confirms no credit path defaults to `confirmed`.
- **Real past instance.** `scripts/check_no_direct_stock_writes.sh` exists in this repo
  because **inventory learned this exact lesson** — dual bookkeeping, a balance
  authoritative by convention, and no way to recompute which side was right. The
  points ledger is the same failure with a different noun, and the guard is being
  written before the mistake rather than after it.

### `abuse-pattern-writeup` (T2)

- **Trigger.** The weekly abuse review, or any newly observed farming pattern.
- **Doneability.** Produces a finding with the pattern, the signal that caught it, what
  the appeal outcomes said, and what detection change follows — appended to a standing
  pattern log rather than closed as a ticket.
- **Real past instance.** [[FUTURES]] §7.3 names self-referral and duplicate-device
  farming as non-negotiables (`FUTURES.md:178`) with **no mechanism attached**. A
  named threat with no recurring practice becomes a one-time control set — the C2
  failure exactly.

### `consumer-surface-review` (T2)

- **Trigger.** Any new guest-facing surface, before it ships.
- **Doneability.** Judges it as a consumer product against the consumer bar — not
  against the staff app's conventions — and states explicitly whether it reads as a
  reskinned console. Run with [[design-charter]]; the verdict is this team's.
- **Real past instance.** `apps/mobile/src` is a fully-built *staff* app with a design
  system and component library right there. Reuse is faster at every individual
  decision, which is why C3 arrives by accumulation and never by a decision anyone
  would recognise as one.

**Not proposed:** a `points-tuning` or `earning-optimizer` skill. There is no real past
instance and, worse, optimising earning rules against volume is the mechanism by which
the confirm rate quietly stops being the gate.

## Review

All three reviewed against the 30-day staleness rule from the day `.claude/skills/`
exists **and** the team activates. Until OD-07 closes, they are dormant proposals, not
stale skills — the distinction the staleness review is built to make.
