---
type: schedule
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: partial
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[supplier-distributor-network-charter]]"
  - "[[supplier-distributor-network-loops]]"
  - "[[supplier-distributor-network-directive]]"
  - "[[partnerships-integrations-schedule]]"
  - "[[design-partner-operations-charter]]"
---

# Supplier & Distributor Network — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Daily** | Feed freshness sweep — every feed's `last_refreshed_at` against its expected cadence; breaches are loud | L2 |
| **Per page creation** | Publish-state check — does this vendor page have a relationship behind it, and is its slug non-enumerable? | L3 |
| **Weekly** | Counterparty liveness — live / stale / lapsed, and portal logins | L1, `pi.live_counterparties` |
| **Weekly** | Declined-work log review — pre-seam work handed to Sales, recorded rather than shadow-worked | L4 |
| **Monthly** | Boundary pressure — CM-F3 and PROD-F2 days-since-touched, plus the share of blockers owned elsewhere | L4 |
| **Quarterly** | Intake-channel audit — do all four channels (email, photo, upload, SFTP drop) still land in one document model, with downstream blind to the channel? | — |
| **Day 90 (one-off, dated)** | Dissolution review — if both forks open and metric still 0, write the merge proposal | L4 |

**Anti-sprawl.** A job producing no action for 3 consecutive runs is downgraded or deleted.
Applied honestly here, two of these will trip it and should:

- **The daily freshness sweep will produce no action until a feed exists.** It is scheduled
  now anyway, because the *instrumentation* it depends on must exist before the first live
  feed. It is exempt until the first feed lands, then subject to the rule immediately.
- **The quarterly intake audit** has no channels to audit yet. If it produces nothing for
  three runs it should be deleted, not defended — the four-channel model is
  `YC_WEDGE_PLAN.md`'s design, and auditing an unbuilt design is theatre.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Per foundation §3.3 each names a trigger,
doneability criteria, and a real past instance.

| Skill | Trigger | Done when | Real past instance | Tier |
|---|---|---|---|---|
| `feed-freshness-check` | Daily, per counterparty feed | Every feed's last refresh is compared to its cadence; *dormant*, *empty* and *stale* are reported as three distinct states | **Yes** — `provider-intelligence.service.ts` makes **6** reads against a dormant `provider_promotions` (`:135, :159, :179, :197, :222, :414`), all returning nothing gracefully. The inability to distinguish those states is live in the code today | T3 |
| `publish-state-audit` | A vendor page is created or its relationship state changes | Page renders only in a published relationship state; slug confirmed non-enumerable | **Yes** — Security's SEC-2 found `ENDPOINTS.md` had prescribed **signature verification** for `vendor-portal`, the wrong control entirely; the real risks are slug enumeration and unpublished-page leakage. The correction landed (`ENDPOINTS.md:656`); the control it implies did not | T2 |
| `counterparty-state-sync` | Weekly, and on any feed or login event | Every distributor carries a current state with a date; decayed relationships transition rather than persist as "live" | **Yes, negatively** — there is no state model today, and `procurement_orders` = 1 with 0 live counterparties means every record in the system is in an unstated state | T2 |
| `boundary-blocker-log` | Any blocker owned by another unit | The blocker is recorded with its true owner and the work is handed off, not shadow-worked | **Yes** — CM-F3 (`commercial.md:631`) and PROD-F2 both cross this team today and neither has an owner. This session is the first time the overlap has been written down from this side | T2 |

**Honest note.** All four are grounded in real, current defects rather than hypotheticals —
which is a fair reflection of this team's position: the surfaces exist, nothing has flowed
through them, and the gaps are visible in code. `boundary-blocker-log` is the odd one out in
kind: it is an organizational skill rather than a technical one, and if the org ends up with a
general mechanism for recording cross-unit blockers, this should be deleted in favour of it.

## Deliberately not scheduled

- **Portal feature work.** Frozen while `pi.live_counterparties` == 0, except features that
  reduce the effort of becoming the first live counterparty
  ([[supplier-distributor-network-directive]] Graph B).
- **EDI transport work of any kind.** `YC_WEDGE_PLAN.md:40-41` — build no VAN or AS2.
- **Distributor outreach.** Pre-seam under the CM-F3 proposal; belongs to
  [[design-partner-operations-charter]] until the founder rules otherwise. **We do not
  shadow-schedule it.**
- **Pricing or supply terms review.** Founder-deferred.
