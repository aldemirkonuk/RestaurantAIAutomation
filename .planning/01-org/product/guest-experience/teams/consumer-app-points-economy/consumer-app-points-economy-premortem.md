---
type: premortem
division: product
department: guest-experience
team: consumer-app-points-economy
status: provisional
metrics: [nf_b.points_confirm_rate, nf_b.events_per_active_guest_month, nf_b.abuse_hold_rate]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-directive]]", "[[consumer-app-points-economy-loops]]", "[[guest-experience-premortem]]", "[[guest-identity-consent-charter]]", "[[guest-value-monetization-charter]]", "[[design-charter]]", "[[security-charter]]", "[[FUTURES]]", "[[OPEN-DECISIONS]]"]
---

# Consumer App & Points Economy — Premortem

> Written at founding, before success is assumed. This team is **unstaffed and gated
> on OD-07**; the premortem is written first anyway, which is the point of premortem
> being artifact #2.

The team-doc line this expands ([[product]] §2.3): *"Points ship before verification
does, the ledger fills with provisional credits from a device farm, and the first real
restaurant perk is redeemed by an abuser — after which no restaurant opts in again."*

It is 2027-08-24. Five mechanisms, most likely first.

---

## C1 — Points shipped before verification, and the first perk was redeemed by an abuser

**The predicted failure.** Verification is the hard half: a real check-in channel, POS
or reservation linkage, device attribution, a review quality gate. Points are the fun
half and they demo. So points ship first — *"verification lands next sprint, we'll
keep everything provisional until then"* — and provisional turns out to be a promise
about a future state machine rather than a state machine. The ledger fills with
credits from a device farm. Then a restaurant opts into a funded perk ([[FUTURES]]
§7.4), an abuser redeems it, and the restaurant pays real money to a fraud.

**The damage is not the perk.** It is that restaurant-funded perks are opt-in per
restaurant, and opt-in programs die by word of mouth among operators. One redemption
by an abuser is a story that reaches every restaurant in the city, and there is no
version of the program that recovers from it, because the next restaurant's decision
is not about our fix — it is about the story.

**Earliest observable signal.** `nf_b.points_confirm_rate` not being computable — not
low, *not computable*, because the confirmation state machine does not exist. That is
the tell, and it is visible on day one of the ledger. Second signal:
`nf_b.events_per_active_guest_month` rising faster than `nf_b.verified_visit_rate`.
Third, and cheapest: any credit path whose default state is `confirmed`.

**What would have prevented it.** A build order enforced as a gate:
**verification ships before earning, and no perk is redeemable before
`nf_b.points_confirm_rate` has been stable for a full quarter**
([[consumer-app-points-economy-directive]]). Plus `NEW-871` early — provisional and
confirmed points visually distinct, with hover explaining what confirms them — because
a guest-visible provisional state is much harder to quietly treat as real than a
back-office flag. And redemption stays where [[FUTURES]] §7.4 puts it: **status and
badges only** at launch.

---

## C2 — The abuse posture became a checklist and the adversary adapted

Rate limits, a duplicate-device check, an attribution rule. Shipped, ticked off,
done. But the adversary is a **human who observes the defence and changes** — which
is the specific reason this is a separate team ([[product]] §2.3). Six months later,
farming runs through borrowed real devices, real accounts, and reviews written to pass
the quality gate exactly. Every control still passes its own test, and every control
is being routed around.

**Earliest observable signal.** `nf_b.abuse_hold_rate` **stable or falling while
volume rises**. A static hold rate under growth does not mean abuse is under control;
it means the detector's distribution has stopped changing while the attacker's has
not. Second signal, organisational: no abuse-pattern review on the calendar — the
posture became a project with a completion date.

**What would have prevented it.** A **standing weekly abuse review** with new patterns
written up as findings, not a one-time control set. Detection tuned against **held
credits and appeal outcomes** rather than against a fixed rule list — appeals are the
adversary's own feedback channel and the highest-signal data the team will get. And a
posture rule with no exception: **a control that has never fired is not proof of
safety, it is an untested control** ([[consumer-app-points-economy-directive]]).

---

## C3 — It looked like a business tool and the guest never came back

The staff app exists (`apps/mobile/src` — `api`, `components`, `design`, `guidance`,
`lib`, `state`), the design system exists, the components exist, and reusing them is
faster, cheaper, and defensible at every review. The result is a competent operator
console with a points balance in it. The guest — who is not paid to be there, not
trained, and comparing it to Beli and Instagram without being asked to — opens it
once. `nf_b.events_per_active_guest_month` sits near zero, and every metric in
[[taste-fingerprint-charter]] and [[guest-value-monetization-charter]] inherits that
zero.

**Earliest observable signal.** The first consumer surface built primarily from staff
components. Not because reuse is wrong — because the *decision* to reuse was made on
build speed, and that is the moment the surface's audience quietly changed.

**What would have prevented it.** The consumer surface treated as a **separate design
problem with its own quality bar**, owned with [[design-charter]] but with this team
holding an explicit **rejection right** over a reskinned console. And measuring
retention **before** measuring points: a points economy layered on a surface nobody
returns to is a ledger of nothing.

---

## C4 — OD-07 resolved toward Beli after the build had started

The most expensive failure and it has nothing to do with execution. This team is
**gated on OD-07** — build independently vs explore a Beli collaboration
([[OPEN-DECISIONS]]:18). If the gate is treated as advisory and building starts
first, then a collaboration resolution arrives against a half-built consumer app, a
half-designed points ledger, and — worst — an **abuse posture authored against the
wrong threat surface**, since a partner's platform brings its own identity, its own
farming vectors, and its own defences.

**Earliest observable signal.** Any consumer-app implementation work starting while
OD-07 is open. There is no subtler tell and none is needed; the gate is binary.

**What would have prevented it.** Holding the team **unstaffed** rather than
"provisionally scoped" — the difference between a written entry trigger and a soft
intention. And giving OD-07 a **forcing function**: [[FUTURES]] §7.5 already provides
the guest MVP scope the decision was waiting on, so the blocker on the founder call is
smaller than it looks and should be surfaced in the open-decision digest until it
closes.

---

## C5 — The ledger was edited

The rule is *append-only, balance derived* ([[FUTURES]] §7.3) — the same discipline
inventory already learned the hard way. Then support needs to fix a wrongly-credited
guest, and an `UPDATE` is one line. It ships as an admin tool with an audit note.
Twelve months later the balance is authoritative-by-convention, a reconciliation
disagreement appears, and there is no way to recompute which side is right because the
history has been edited.

**Earliest observable signal.** Any code path writing a balance directly rather than
appending a credit event. Cheap to detect with a CI guard in the shape of
`scripts/check_no_direct_stock_writes.sh`, which exists in this repo for **exactly
this failure on inventory** — the pattern is already proven here, on the same class of
mistake.

**What would have prevented it.** That guard, written **before** the first ledger
table, plus a reversal path that is itself an append: a correction is a compensating
entry, never an edit. Support's legitimate need is real and is met by appending, which
is why the guard costs nothing to hold.

---

## The one that would end it

**C1.** C2 is a chronic condition managed by posture, C3 is recoverable with a
redesign, C4 is expensive but survivable, C5 is caught by a guard this repo already
knows how to write.

C1 ends the program, because restaurant-funded perks are **opt-in per restaurant** and
the failure destroys the thing the opt-in depends on. And it is the *default* build
order — points are the fun half, verification is the hard half, and nothing except an
explicit gate reverses that. The gate is the first rule in
[[consumer-app-points-economy-directive]] for that reason.
