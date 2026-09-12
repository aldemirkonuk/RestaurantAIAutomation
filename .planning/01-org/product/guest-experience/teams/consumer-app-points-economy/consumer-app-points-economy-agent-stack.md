---
type: agent-stack
division: product
department: guest-experience
team: consumer-app-points-economy
status: designed
updated: 2026-08-27
metrics: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.verified_visit_rate, nf_b.abuse_hold_rate]
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-schedule]]", "[[consumer-app-points-economy-loops]]", "[[consumer-app-points-economy-directive]]", "[[consumer-app-points-economy-premortem]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[guest-experience-agent-stack]]", "[[OPEN-DECISIONS]]", "[[FUTURES]]", "[[skills-charter]]"]
---

# Consumer App & Points Economy — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team is **unstaffed and gated on OD-07** — build the guest consumer experience
> independently, or explore a Beli collaboration. That is an open founder fork and
> **this card takes no position on it**, for the reason the charter already gives: an
> independent build maximises this team's scope, which disqualifies it as a neutral
> assessor. OD-05 sits behind the same gate and is the second reason NF-B is held
> ([[0029-p3-plan-of-record]] §3). So the card below is a **dormant-state contract**:
> two things run now, because both are cheap before the domain exists and expensive after.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `points-ledger-sentinel` | Keep OD-07 visible until it closes, and keep "no code path writes a points balance directly" true **before** the first ledger table exists — nothing else until the team activates | NEW |

One row, and most of its card is inert. A roster that staffed the abuse posture, the
appeal queue and the retention read today would be four agents watching an empty
domain, which is how a dormant team acquires a running cost.

## 2. Agent cards

```yaml
agent: points-ledger-sentinel
unit: consumer-app-points-economy
triggers:
  - schedule: "weekly — od-07-watch"                    # mirrored in [[consumer-app-points-economy-schedule]]
  - schedule: "per commit — ledger-write-guard"         # active now; modelled on scripts/check_no_direct_stock_writes.sh
  - topic: points.credit_held                           # publisher: NONE (gap — no ledger, no app; inert until activation)
  - topic: decision.od_07_closed                        # publisher: NONE (gap — OD-07 is a document, see §5)
consumes:
  - "[[OPEN-DECISIONS]] OD-07 and OD-05 rows"
  - "[[FUTURES]] §7 — profile types (§7.1), earning rules (§7.2), the four integrity rules (§7.3, FUTURES.md:178), conservative redemption (§7.4), MVP scope (§7.5, FUTURES.md:199)"
  - "diffs touching points, credits, balances, or redemption anywhere in apps/ or supabase/migrations/"
emits:
  - "direct_balance_writes (expected 0) → [[guest-experience-agent-stack]]'s weekly rollup"
  - the OD-07 line in the open-decision digest, with the note that FUTURES §7.5 already supplies the MVP scope the call was waiting on
  - nf_a events (task_type: ledger_guard_audit)
routing_class: mechanical      # grep and register-read; nothing on the live half is a judgment call
quality_bar: "direct_balance_writes = 0 — but the guard passes today over an empty domain, so a green run is evidence the guard exists, not evidence it discriminates. NONE (gap) for every activation-gated metric: no ledger, no events, no denominators"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant — and not vacuous here: points are the sub-layer's only future money-shaped surface, so the gate is load-bearing rather than inherited
memory: consumer-app-points-economy
escalates_to: "[[guest-experience-charter]]"
```

**Hard rules.** The sentinel takes no position on OD-07 and never states a preferred
branch, including by framing. It never tunes earning rules — *optimising earning rules
against volume is the mechanism by which the confirm rate quietly stops being the gate*
([[consumer-app-points-economy-schedule]]). And it never reports
`nf_b.events_per_active_guest_month` without `nf_b.points_confirm_rate` beside it;
volume alone is farmable, so it is never reported alone.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `ledger-append-only-check` | T2 | Any diff touching points, credits, balances, or redemption | Confirms the change appends rather than mutates, that a correction is a compensating entry, and that no credit path defaults to `confirmed` | `scripts/check_no_direct_stock_writes.sh` exists in this repo because **inventory learned this exact lesson** — dual bookkeeping, a balance authoritative by convention, no way to recompute which side was right ([[consumer-app-points-economy-schedule]] records the lineage; the guard script is the artifact). The points ledger is that failure with a different noun, and the guard is being written before the mistake rather than after it | NEW |
| `abuse-pattern-writeup` | T2 | The weekly abuse review, or any newly observed farming pattern | A finding carrying the pattern, the signal that caught it, what the appeal outcomes said, and the detection change that follows — appended to a standing pattern log, not closed as a ticket | [[FUTURES]] §7.3 names self-referral and duplicate-device farming as non-negotiable (`FUTURES.md:178`) with **no mechanism attached**. A named threat with no recurring practice becomes a one-time control set — [[consumer-app-points-economy-premortem]] C2 exactly | NEW |
| `consumer-surface-review` | T2 | Any new guest-facing surface, before it ships | Judges it against the consumer bar rather than the staff app's conventions, and states explicitly whether it reads as a reskinned console. Run with [[design-charter]]; the verdict is this team's | `apps/mobile/src` is a fully-built **staff** app — `api`, `components`, `design`, `guidance`, `lib`, `state`, verified 2026-08-27 — with a design system sitting right there. Reuse is faster at every individual decision, which is why C3 arrives by accumulation and never by a decision anyone would recognise as one | NEW |

**Not proposed:** a `points-tuning` or `earning-optimizer` skill — no past instance, and
see the card's hard rule.

Consumed, owned elsewhere: durable append-only write mechanics and idempotency
([[engineering-charter]]); device-fingerprinting technique and fraud tooling
([[security-charter]]); the design system ([[design-charter]]).

## 4. Memory

- **Procedural** — the §3 skills. Two of the three are dormant proposals until the team
  activates; dormant is not stale, and the staleness review asks whether the **trigger
  occurred** and the skill failed to fire.
- **Episodic** — nf_a `task_type: ledger_guard_audit` today; on activation,
  `abuse_review` and `appeal_review` with `context.pattern` and `context.appeal_outcome`
  as jsonb keys, because retuning detection against **appeal outcomes** rather than a
  fixed rule list is the whole abuse posture and needs the outcome queryable. NF-B
  contributes nothing: no app, no events.
- **Semantic** — `memory/` beside this file, one fact per file with `source` /
  `confidence` / `last_verified`; index `consumer-app-points-economy-MEMORY.md`. Its
  founding facts seed the pattern log: the inventory dual-bookkeeping lesson and where
  its guard lives; the five load-bearing UX paths (`NEW-863` `:1784`, `NEW-869` `:1790`,
  `NEW-871` `:1792`, `NEW-872` `:1793`, `NEW-878` `:1799` in
  `07-reference/UX_PATHS_CATALOG.md`); and OD-07's state with its date. Every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and FUTURES §7.3's four
  integrity rules. The 41 UX paths are retrieval targets by line range.

**Consolidation** — monthly while dormant, weekly on activation: read the NF-A slice;
distil **failures first** — on activation every overturned appeal becomes a fact naming
the detection mechanism that produced the wrong hold, never "false positives rose";
expire facts unverified 90 days; propose skill candidates. One PR; while dormant, "no
delta" is the honest and expected output.

## 5. Async contract

Interaction is loops ([[consumer-app-points-economy-loops]]: `nf-b-signal-volume`,
`points-abuse-posture`, `ledger-integrity`, `consumer-surface-retention`), NF-A events,
and vault PRs. Gap rows — this unit is mostly gaps, and saying so is the point:

| Gap | Why it is a gap |
|---|---|
| `points.credit_held` has no publisher | No ledger exists — grepped 2026-08-27 across `apps/` and `supabase/migrations/` for `points_ledger`, `guest_points`, `points_balance`: zero matches |
| `decision.od_07_closed` has no publisher | OD-07 is a row in a document. The weekly watch is the only mechanism, so a fork that closes quietly is invisible for up to a week |
| This unit's `emits` have no live consumer | The events it would emit are consumed by [[taste-fingerprint-charter]], which cannot consume food events at all while A15 stands. Both sides of the seam are blocked, by two unrelated decisions |
| The subject does not exist | `nf_b.subject_coverage` is structurally zero, so an app that shipped tomorrow would emit engagement metrics and zero NF-B events. **Ordering matters:** the identity write path precedes this surface, and both are behind the NF-B hold |

## 6. Evidence today

- **NEW — the sentinel and all three skills.** Nothing here runs.
- **NEW as code, complete as design.** [[FUTURES]] §7 (`FUTURES.md:146-199`) plus 41
  enumerated UX paths (`07-reference/UX_PATHS_CATALOG.md:1476-1496` and `:1776-1806`);
  ROADMAP backlog **999.1**. Not a softer EXISTS — greenfield with an unusually complete
  specification attached.
- **EXISTS — only the pattern being copied.** `scripts/check_no_direct_stock_writes.sh`
  is the shape `ledger-write-guard` takes, and it is the one thing on this page that can
  be built before OD-07 closes without choosing the guest product.
