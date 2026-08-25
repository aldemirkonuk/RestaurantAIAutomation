---
type: schedule
division: advisory
department: decision-office
status: new
metrics: [decisions.open_count, decisions.median_age_days, decisions.unowned_count, decisions.close_rate_per_week, triggers.dated_unwatched_count, loops.undefined_close_time_count, corpus.stale_citation_count]
updated: 2026-08-24
links: ["[[decision-office-charter]]", "[[decision-office-loops]]", "[[decision-office-directive]]", "[[decision-office-premortem]]", "[[decision-office-agenda-board]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[README|foundation-README]]", "[[OBSIDIAN_VAULT]]", "[[red-team-charter]]", "[[standards-verification-charter]]", "[[knowledge-documentation-charter]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[sales-charter]]", "[[legal-charter]]", "[[LOOP-MAP]]"]
---

# Decision Office — Schedule & Skills

## Recurring work

**Nothing below is scheduled yet.** Every row is `NEW`. The function owns zero
running jobs today and did not exist as a document before this session.

| Cadence | Job | Emits | Loop | Status |
|---|---|---|---|---|
| **Weekly** | **Register triage** — every open row gets its owner, filed-date and severity re-checked; ages recomputed; digest ships **whether or not anything moved** | Weekly digest → founder | L1 | NEW |
| **Weekly** | **Dated-trigger scan** — `days_to_next_trigger` for all six known triggers, reported from now, not from November | Digest line | L2 | NEW |
| **Weekly** | **Escalation ageing** — anything re-raised twice goes to founder **and** [[red-team-charter]] on the third | Escalation | L2 | NEW |
| **Per-intake** | **ID allocation** — mint an unused ID, or record a collision. Never reassign a cited ID | Register row | L3 | NEW |
| **Monthly** | **Unfiled-fork sweep** — grep `01-org/` + `02-advisory/` for identifier-shaped tokens absent from the register | Findings | L3 | NEW |
| **Monthly** | **Loop close-time audit** — the 396 blocks: undefined close-times, status-vocabulary drift, `exists` ratio | Findings + [[LOOP-MAP]] input | L4 | NEW |
| **Monthly** | **Contradiction + stale-citation sweep** — re-verify every `path:line` a decision rests on | Findings → owning unit | L5 | NEW |
| **Monthly** | **Anti-sprawl enforcement pass** — the three rules below, run as one job | Findings → owning unit | L1 | NEW |
| **Quarterly** | **Authority self-audit** — **owned by [[red-team-charter]], not by us** | Findings → founder | L6 | NEW |
| **One-off** | **Fork-registry reconciliation** — the first assignment. **Time-boxed to two close-times**; if it is not in front of the founder by then it is abandoned, not extended ([[decision-office-premortem]] M4) | Proposal → founder | L3 | NEW |
| **Dated — 2026-11-24** | **Four triggers land on one day.** [[skills-charter]], [[skill-harvesting-charter]], [[sales-charter]], [[outbound-engine-charter]]. Not a cadence — a calendar entry that must survive three months of unrelated work | Escalations | L2 | NEW |
| **Dated — ≈2026-11-22** | Day-90 review for [[supplier-distributor-network-charter]] | Escalation | L2 | NEW |

**Why weekly for triage.** [[README|foundation-README]] §6 already proposes a **daily**
*"Open-decision queue digest — what is blocking whom"*, assigned to Product &
Vision. That cadence and that owner are both wrong now, and this office says so
rather than quietly running a second one:

- **Daily is too fast.** A 35-row register whose items unblock on *scheduled
  sessions* and *founder calls* cannot change daily. A daily digest would be
  identical five days running and would hit §6's own rule — *a scheduled job that
  produces no action for 3 consecutive runs gets downgraded or deleted* — inside
  the first week. It would be correct to delete it, which is a bad way to lose the
  only decision-facing job in the corpus.
- **Weekly matches the decision rate.** Every resolved row carries the same date.
  The observed close rate is a burst, not a daily stream — 2 closes against 14 new
  rows in the session this document was written.
- **The owner is now this function.** §6 predates [[0007-org-structure]], which
  created the Decision Office and gave it the register. **Reassigning the row is
  not this office's call** — it is a contradiction between two foundation
  documents, exactly like OD-25, and it is filed as such
  ([[decision-office-agenda-full]] §Questions), not resolved here.

## Anti-sprawl enforcement this function runs

Three rules already written and **never once enforced**. They are org-wide, they
have no owner, and they are the concrete form of the ratchet OD-26 names. This
office runs the *detection*; the owning unit does the deleting.

| Rule | Source | Trigger | What this office does | What it does **not** do |
|---|---|---|---|---|
| **Agenda unchanged in 60 days = finished or fiction** | [[ORG_STRUCTURE]] §4 | `updated` older than 60 days on any `agenda-full` / `agenda-board` | Lists it, with age, to the owning unit and the digest. **A date-only diff counts as untouched** — [[legal-charter]]'s sweep already caught that dodge (`legal-schedule.md:27`) and it is adopted here | Decide whether it is finished or fiction. The unit answers |
| **Skill unfired in 30 days = reviewed for deletion** | [[README|foundation-README]] §3.3 | Registered skill with no firing evidence in 30 days | Reports the count and the ages | Run the review — that is [[skill-lifecycle-anti-sprawl-charter]]'s. **Today the number is 0 of 0**: `.claude/skills/` exists with `README.md` and **zero `SKILL.md` files**, so the rule is live and vacuous |
| **Scheduled job with no action in 3 runs = downgrade or delete** | [[README|foundation-README]] §6 | Any row in any `schedule.md` producing no output for 3 consecutive runs | Reports it, **including rows in this table** | Downgrade another unit's job |

**First sweep will be large, and that is the point.** 581 unit documents were
written in two sessions and all carry `updated: 2026-08-24` — among them **194
agenda documents** (`agenda-full` + `agenda-board`, this unit's two included). The
60-day clock therefore starts together and **expires together, around 2026-10-23**,
putting all 194 into the sweep on one day — roughly one month before the four dated
triggers land on 2026-11-24. Two org-wide staleness events one month apart, both
currently unwatched. Naming the dates now is cheaper than discovering them in
October, and a sweep that flags 194 documents at once will be ignored unless it is
expected.

**The rule applies to this page.** Twelve proposed jobs for a function with zero
artifacts is already at the edge of §6. The rows that earn their slot are the first
three — weekly triage, dated-trigger scan, escalation ageing. Everything monthly is
provisional until it produces an action; the quarterly audit is exempt by design
(see [[decision-office-loops]] L6: an authority audit that returns zeroes and gets
downgraded for it would be an elegant way to delete the only external check on this
office).

## Skills owned

Skills live in **`.claude/skills/`** — auto-discovered, committed, PR-reviewable
(`OPEN-DECISIONS.md`, Resolved table). A skill that has not fired in 30 days is
reviewed for deletion ([[README|foundation-README]] §3.3).

**Count today: 0.** The directory now **does** exist and is tracked
(`.claude/skills/README.md`), holding zero `SKILL.md` files — which quietly
half-closes **CORP-F7**, an open item that ~99 `schedule.md` files still describe as
unresolved. That is [[decision-office-loops]] L5's contradiction **C4**, and this
office found it in its own first hour rather than in a sweep three months from now.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### Candidates, held to [[README|foundation-README]] §3.3's four fields

The protocol is not relaxed for the office that reports on everyone else's
compliance with it.

| Candidate | Trigger | Doneability | Real past instance (rule 3) | Eligible? |
|---|---|---|---|---|
| `fork-id-collision-scan` | Any session about to mint a fork ID, and the monthly unfiled-fork sweep | Every identifier-shaped token in `01-org/` + `02-advisory/` resolves to exactly one register row, or is listed as a collision | ✅ **This session.** Six IDs (`OD-19`…`OD-24`) carry 2–3 meanings each across 5 divisions; three generators independently hand-corrected their own briefs (`product-vision-charter.md:133`, `design-agenda-board.md:104`, `supplier-distributor-network-charter.md:73`). The scan is a `grep` those three ran by hand | **Yes** |
| `register-triage-digest` | Weekly, or on demand before a founder session | Every open row carries owner + filed-date + age; digest leads with the oldest | ✅ **This session.** 23 rows read by hand to establish `unowned_count = 23`; recomputing that weekly by hand is the definition of a codified procedure | **Yes** |
| `dated-trigger-calendar` | Weekly scan; fires on the date | Every dated trigger in the corpus has a `days_until` and a terminal state | ✅ **This session.** Six triggers found by grepping five date literals across 581 files; four collide on 2026-11-24 and none had a watcher | **Yes** |
| `loop-close-time-audit` | Monthly | All 396 blocks parsed; undefined close-times and status drift listed | ✅ **This session.** `privacy-engineering-loops.md:188` (`close_time: UNDEFINED`) and `content-production-loops.md:58` (`status: monthly`) were both found this way | **Yes** — but see the blocker below |
| `stale-citation-verify` | Monthly, and before any doc cites a `path:line` | Every cited `path:line` a decision rests on still contains what it claims | ⚠️ **One instance only** — `YC_WEDGE_PLAN.md:401` → `ReceivingWorkspace.tsx`. Real, and it *inverted* rather than drifted. But this overlaps [[standards-verification-charter]]'s mandate | **Not yet** — seam belongs to Knowledge & Documentation first |
| `adr-index-parity` | Per ADR added or superseded | `decisions/README.md` matches the files on disk | ❌ **No instance.** The index is currently correct | **No** — ineligible under rule 3 |

**Two are listed as ineligible on purpose.** Under §3.3 rule 3 a skill without a
cited past instance may not be written, and the office that reports monthly on
everyone else's compliance is the last unit that gets to make an exception for
itself. Leaving the gap visible costs nothing; papering over it would cost the
standing that is this function's only real asset.

**`loop-close-time-audit` carries a blocker worth stating here rather than burying
it in a loop.** It must parse the loop blocks, and **none of the 396 is
machine-readable in the way [[ORG_STRUCTURE]] §5 and [[OBSIDIAN_VAULT]] §4 assume**
— every generator, this one included, wrote the block into a fenced ` ```yaml `
region in the document body rather than into frontmatter, where Dataview cannot
index it. So the skill parses by `grep`, `[[LOOP-MAP]]` cannot be a Dataview query,
and OD-12's *documentation now, executable later* rests on a format that is not
currently machine-readable. **Moving 396 blocks is a corpus-wide change and is not
this office's to make** — it is filed for the founder and
[[architecture-review-charter]], not fixed here.
