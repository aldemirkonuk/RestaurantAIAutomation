---
type: agenda-full
division: commercial
department: sales
team: outbound-engine
status: provisional
metrics: [sales.sending_identity_isolated, sales.claim_provenance_rate, sales.qualified_conversation_rate, sales.suppression_integrity]
updated: 2026-08-24
links: ["[[outbound-engine-charter]]", "[[outbound-engine-premortem]]", "[[outbound-engine-directive]]", "[[outbound-engine-loops]]", "[[outbound-engine-schedule]]", "[[outbound-engine-agenda-board]]", "[[sales-agenda-full]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[media-brand-charter]]", "[[reliability-sre-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Outbound Engine — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Zero emails have been
> sent, zero prospects exist, and the target list is founder-deferred. **Everything below
> is design work.** A version of this agenda that produces sends this quarter is a version
> that violated the entry trigger.

## What

Four artifacts, all buildable while dormant, none of which send anything:

1. **Sending isolation, decided and enforced.** A separate identity for cold outbound,
   plus a CI guard making the separation structural.
2. **A suppression design.** Per-domain, honoured within 24 hours, built before sending
   rather than after.
3. **A qualification rubric, frozen.** Written while the pipeline is empty — the only
   moment it can be written honestly.
4. **A claim allowlist.** Enumerated, cited, and currently **empty** — which is the correct
   contents.

**Explicitly not on this list, and not anywhere in this document:** a target list, a
segment definition, a scraping script, a count of restaurants, a geography, or a cuisine.
The list is founder-deferred and is not sketched here. Separating the machine from the list
is the only reason this team can work at all right now.

## How

- **Isolation — configuration, not architecture.** The seam already exists and is unused:
  `env.example:165` declares `EMAIL_BACKEND=gmail`, and a second backend key is already
  reserved (`SENDGRID_API_KEY`, `env.example:167`, read at
  `services/agent-orchestrator/config/settings.py:202`). What must not happen is cold mail
  leaving the transactional identity — one hardcoded sender
  (`apps/api-gateway/src/communications/gmail.service.ts:76-78`) that also carries vendor
  procurement mail and customer notifications
  (`apps/api-gateway/src/communications/communications.controller.ts:1028-1031`). Enforce
  with a grep-grade CI guard in the shape of the repo's existing `scripts/check_*.sh`
  family: **no outbound module may reach `GmailService`.** Buildable today, with nothing to
  send.
- **Suppression — copy the shape already in the repo.** The `prospects` module dedupes
  unknown senders **by domain** and never auto-replies
  (`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`). That is exactly
  the right shape for suppression, pointed the other way. *(It is a pattern to copy, not a
  pipeline to inherit — see [[outbound-engine-charter]] §The `prospects` module is not this
  team's pipeline.)* Per-domain, 24-hour honour window, and the stop path wired to the
  sequence engine rather than sitting beside it — [[outbound-engine-premortem]] M4 is
  entirely a story about those two systems being separate.
- **Rubric — write it empty.** At least one **hard disqualifier**, so the rubric can
  actually fail a prospect: no POS API access; single location with no wine programme; a
  distributor mix that cannot produce the documents the four-way match needs. Freeze before
  the first send; later changes need a written rationale and a re-scored cohort, so
  loosening is visible rather than gradual. → M5
- **Claim allowlist — start empty and keep it empty.** `sales.verified_dollars_recovered`
  is `$0`. Until [[design-partner-operations-charter]] produces a **landed** credit
  (`.planning/YC_WEDGE_PLAN.md:31-33`), the allowlist contains no dollar figures at all.
  What it *may* contain from day one is the **mechanism**: the four-way document model,
  and specifically that when the distributor's own ship notice says 22 and its own invoice
  says 24 there is nothing left to argue about (`.planning/YC_WEDGE_PLAN.md` §REVISION 3;
  `overbilled_vs_ship` outranks every verdict but a missing invoice, `:342`). That is true
  today, needs no number, and is a stronger opening than one we cannot defend.

**Method note — what "done" looks like while dormant.** Four documents, one CI guard, one
domain **not yet purchased**, and zero sends. If at the end of the quarter this team has a
sequencing tool subscription, a warmed domain, or a spreadsheet with restaurants in it, it
has failed regardless of what else it produced.

## Why now

1. **Three of the four artifacts are only honest while the pipeline is empty.** A
   qualification rubric written after the first conversations describes them instead of
   judging them ([[outbound-engine-premortem]] M5). An allowlist written when a number
   exists will be written around that number. This is the one window.
2. **The CI guard costs nothing and prevents the worst outcome.** M1 takes down procurement
   and presents as a procurement bug. Preventing it before any send is a grep; diagnosing
   it afterwards is days.
3. **The isolation decision gets more expensive after send #1.** Reputation is
   path-dependent — a domain's history cannot be un-sent.

Against: none of this is urgent, and that is exactly the risk. Work that is cheap and
non-urgent is work that never happens. Hence a schedule with dates rather than an intention.

## Next steps

Ordered. Nothing here sends anything.

1. **Write the CI guard.** No outbound-path module may import `GmailService`. Model it on
   `scripts/check_no_direct_stock_writes.sh`.
2. **Decide the sending identity** — domain and backend — and record it in
   [[outbound-engine-directive]] as a pre-commitment. **Do not purchase yet**; purchase is
   spend, and spend is gated.
3. **Draft the suppression design**, per-domain, 24-hour honour, wired to the sequence
   stop path.
4. **Write and freeze the qualification rubric**, including at least one hard disqualifier.
5. **Create the claim allowlist, empty**, with the mechanism-only opening as its first
   permitted claim.
6. **File the legal-basis question** with [[compliance-privacy-charter]] — an answer that
   takes weeks should not be started on the day the list un-defers.
7. **Add the outbound-reputation note** to the procurement runbook with
   [[reliability-sre-charter]], so M1's wrong-diagnosis half costs hours rather than days.

## Questions for the founder

1. **Do you accept the entry trigger?** No staffing, spend, tooling, domain purchase, or
   sends until `verified_dollars_recovered > 0` **and** you un-defer the list. This team
   should look idle until then, and this question exists so that idleness is a decision
   rather than something that has to be defended later.
2. **Which domain sends cold mail?** A subdomain of the eventual brand domain, or a
   separate one entirely? A subdomain shares some reputation surface with the parent; a
   separate domain is cleanest but starts colder. Cheap to decide now, expensive to change
   after warmup.
3. **What is the un-defer trigger for the list?** Not the list itself — the *condition*
   under which you would choose one. Without a condition, "deferred" and "abandoned" become
   the same state, and [[outbound-engine-premortem]] M3 is a team filling that vacuum.
4. **Is one hard disqualifier enough?** This team proposes "no POS API access" as the
   minimum, because the product's value depends on it and the design partner's API access
   is the exception rather than the norm (`.planning/PROJECT.md:127`). If the rubric cannot
   disqualify anyone, the qualified-conversation rate measures nothing.
5. **If S1 never produces a landed credit, does this team survive?** [[sales-premortem]] M5
   proposes folding Sales into [[growth-charter]] at 2026-11-24 under that condition. This
   team is the half that would be deleted, and it is better to agree that now than to argue
   it then.
