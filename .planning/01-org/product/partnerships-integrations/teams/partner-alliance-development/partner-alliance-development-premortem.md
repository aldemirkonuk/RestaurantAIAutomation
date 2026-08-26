---
type: premortem
division: product
department: partnerships-integrations
team: partner-alliance-development
status: new
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-directive]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[consumer-app-points-economy-charter]]"
  - "[[decision-office-charter]]"
  - "[[OPEN-DECISIONS]]"
---

# Partner & Alliance Development — Premortem

> Written at founding, before success is assumed.

It is August 2027. Nine providers are still blocked, OD-07 is still open, and nobody can say
whether that is a market answer or an absence of effort. Here is how, most likely first.

---

## M1 — OD-07 was decided by drift, in the direction nobody argued for

**The mechanism.** No one ever says *"we are building the guest app independently."* What
happens instead is that guest-experience work is nearer, more legible, more fun, and more
obviously within our control than an outreach email to a company that may not reply. So it
advances — a slice at a time, each slice individually defensible. Six months on, the
differentiating surface is half-built, the sunk cost is real, and the Beli conversation is
finally opened from a materially weaker position: there is nothing left to co-design, so the
only thing on the table is distribution on someone else's terms. OD-07 (`OPEN-DECISIONS.md:29`)
still reads "open." It was closed months ago, by accumulation.

**Earliest observable signal.** The conjunction, not either half: **OD-07's line unchanged for
two consecutive months while guest-experience commits continue landing.** Either alone is
fine — an untouched decision on a dormant area is just patience. Together they are a decision
being made without a decision.

**Counter-pressure.** Three, and the first two are cheap:
1. **The option memo ships early and unconditionally.** Not a recommendation — a written
   statement of what collaboration would buy, what it would cost, what it would foreclose, and
   what the option is worth if left unexercised. Written now, while the position is strong,
   because a memo written after the build is a rationalization.
2. **A staleness alarm with teeth.** 60 days untouched *with* continuing guest commits →
   [[partner-alliance-development-directive]] escalates a **decision-by-drift finding** to
   [[decision-office-charter]], naming the specific commits that accumulated. The team cannot
   make the call; it can make the drift impossible not to notice.
3. **A named gate:** the option memo exists before the guest build passes its next milestone.
   That is the only structural link between the two, and without it they are two independent
   trains on the same track.

---

## M2 — "Zero agreements" is reported for a year, and nobody can tell whether we tried

**The mechanism.** The primary metric is `pi.unblocking_agreements`, and zero is explicitly an
acceptable v0 result — correctly, because a counterparty's clock is not ours. But a metric
that is allowed to read zero is a metric nobody has to explain. Month after month the report
says "0 agreements," everyone nods because it was pre-agreed that zero is fine, and the
question *"how many attempts, and what came back?"* is never asked. At month twelve the
department cannot distinguish between three genuinely different worlds: nobody replied; nobody
was contacted; or six replied and the terms were bad. Those demand opposite responses, and the
reporting cannot tell them apart.

**Earliest observable signal.** The **first** monthly report that states an agreement count
without an attempt count. Month one, not month twelve.

**Counter-pressure.** The metric is a **pair, and the loop refuses to report one half alone**
([[partner-alliance-development-loops]] L1): agreements *and* `pi.time_to_first_response`,
plus raw attempts. Attempts move weekly even when agreements do not, so the pair is always
informative. Plus the blocker ledger: every one of the nine providers carries a state —
*never contacted* / *contacted, no reply* / *in conversation* / *declined* / *signed* — and
"never contacted" is a legitimate, visible state rather than a gap. **A ledger where all nine
read "never contacted" after six months is a real finding.** A silent zero is not.

---

## M3 — The team chases the nine because they are enumerable, when the nine are the wrong nine

**The mechanism.** The blocker list is beautifully concrete: nine providers, nine line numbers,
nine names. That concreteness is seductive in exactly the way [[pos-bridge-charter]]'s
27-provider registry is seductive — it converts an open-ended commercial problem into a
checklist. So outreach starts at TouchBistro (`:119`) and works down. But the registry's own
sequencing says these are *"Tier 2+ — only when selling into chains"* (`:10`), and we are not
selling into chains; we have zero merchants of any size. Twelve months of effort goes into
agreements that would unblock providers no current or near-term customer runs, while the
actual commercial blocker — a single restaurant willing to send us their data by any means —
sits with a different team entirely.

**Earliest observable signal.** Outreach begins to a `partner_agreement` provider before any
named venue has asked for it. Detectable at the first outreach decision, not later.

**Counter-pressure.** A hard precondition in [[partner-alliance-development-directive]]:
**no partner-agreement outreach begins without a named venue that runs that POS.** The nine
are a *ledger to be maintained*, not a queue to be worked. Until a venue names one of them,
this team's real work is the Beli memo, the ledger, and the outreach machinery — none of which
requires guessing which counterparty matters. This also keeps the team honest about the
founder-deferred target list: we are not proposing one, and the precondition means we do not
need one.

---

## M4 — The Beli exploration becomes a relationship, and the relationship becomes the strategy

**The mechanism.** The opposite failure to M1, and it is the reason M1's counter-pressure is
a *memo* rather than a *conversation*. Exploration is fun; a warm counterparty is flattering;
the conversation generates momentum of its own. Scope creeps from "understand the option" to
"co-design the guest experience," and the guest product is quietly shaped around a partner
who has signed nothing. When it does not close — most do not — the guest roadmap has to be
unwound, and a year of design decisions were taken to fit a partnership that never existed.

**Earliest observable signal.** A guest-experience artifact that references the partner as a
premise. First occurrence, not tenth: a spec, a schema field, or a scope decision that assumes
their existence.

**Counter-pressure.** The exploration's deliverable is **explicitly a memo, not a
relationship** ([[partner-alliance-development-charter]] non-goal 1). And a firewall rule:
**no guest-experience artifact may take the partnership as a premise while OD-07 is open.**
[[consumer-app-points-economy-charter]] builds as though the answer is "independently," until
the founder says otherwise. That is the conservative default and it is reversible; the reverse
is not.

---

## M5 — Türkiye is worked as a backlog when half of it is not a partnership problem at all

**The mechanism.** The five Türkiye entries (`:268-322`) get treated as five more rows in the
blocker ledger and worked the same way. But the registry already records a different answer
for at least one of them — Wolvox: *"start with file export → csv_import bridge."* That is not
an agreement to negotiate; it is a file to parse, and `csv_import` is `available` today. If
the whole market is worked as a BD motion, the fastest available path in it is missed, and the
one entry that could produce a real connection this quarter is queued behind four that cannot.

**Earliest observable signal.** A Türkiye entry entering the outreach ledger without first
being checked against the two universal providers. Visible at ledger-entry time.

**Counter-pressure.** A triage step before any provider enters the outreach ledger: **can this
counterparty be reached through `generic_webhook` or `csv_import` instead?** If yes, it is not
this team's problem — it is [[pos-bridge-charter]]'s, and it is much faster. The registry
already did this triage for Wolvox; the process should generalize it rather than lose it.

---

## The one that would hurt most

**M1.** M2 and M3 waste effort and are correctable once seen. M1 forecloses a strategic option
permanently and does so without anyone noticing a decision was taken — which is the precise
failure mode this entire org chapter was built to prevent
([[ORG_STRUCTURE]] §3, [[decision-office-charter]]).
