---
type: charter
division: product
department: guest-experience
team: consumer-app-points-economy
status: new
metrics: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.verified_visit_rate, nf_b.abuse_hold_rate]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-premortem]]", "[[consumer-app-points-economy-agenda-full]]", "[[consumer-app-points-economy-agenda-board]]", "[[consumer-app-points-economy-directive]]", "[[consumer-app-points-economy-loops]]", "[[consumer-app-points-economy-schedule]]", "[[guest-experience-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[guest-value-monetization-charter]]", "[[design-charter]]", "[[security-charter]]", "[[partnerships-integrations-charter]]", "[[engineering-charter]]", "[[FUTURES]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]", "[[product]]"]
---

# Consumer App & Points Economy — Charter

> **NEW as code. Fully specified as design.** No `points`, `ledger`, `ratings`, or
> guest-app code exists — grepped this session. `apps/mobile/src` is the *staff* app.
> This is not a softer EXISTS: it is greenfield with an unusually complete
> specification attached.
>
> ⬦ **Gated on OD-07.** This team's existence is downstream of a founder call that has
> not been made. It stays unstaffed until it is.

## Mandate

Own the guest-facing product — profile, rate a dish, follow a restaurant, discover,
share — and the **append-only points ledger** that pays for contribution.

This is the **signal source**. Teams 2.1 and 2.2 have a subject and a model and
nothing flowing between them; a guest who never opens anything emits no
`stimulus → choice` record. Every NF-B metric downstream of this team inherits
whatever this surface produces, including its zero.

And it must be **consumer-grade**. The guest is not paid to be here — nobody employs
them, nobody trains them, and a business tool reskinned gets uninstalled. Closer to
Beli than to a back-office console. That is a product constraint with a metric
attached, not an aesthetic preference: `nf_b.events_per_active_guest_month` is the
number a reskinned console fails.

## Why distinct

**A different adversary.** This is the decisive argument and it is not a matter of
degree. [[guest-identity-consent-charter]] and [[taste-fingerprint-charter]] defend
against **data-quality error** — a wrong merge, a miscounted event, a model that
overfits. Errors do not adapt. This team defends against **humans deliberately
farming points**: self-referral, duplicate devices, review spam, conversion fraud.
An adversary observes the defence and changes. [[FUTURES]] §7.3 makes abuse control
non-negotiable, and **abuse defence is a full-time posture, not a checklist item on a
modelling team** ([[product]] §2.3).

**A different user, app, and business model.** Guest, not operator. Consumer app, not
the staff app. Contribution-for-points, not a subscription.

**From [[design-charter]]:** they own the design system and motion substrate. This
team owns that the product must *feel* consumer-grade and will reject a reskinned
console — a judgment, made against a metric, that a system-owning team should not be
asked to make about its own system.

**From [[guest-value-monetization-charter]]:** this team's customer is the **guest**;
theirs is the **restaurant**. Opposite incentives, deliberately kept in different
teams.

## Boundaries

Owned outright:

- The **guest profile** — handles, preferences, follows, activity — and the fact that
  it belongs to nobody: a guest profile exists independent of any restaurant org
  ([[FUTURES]] §7.1, `FUTURES.md:157`).
- **Rating, photo, share, discovery** surfaces and the events they emit.
- The **append-only points ledger** and the four integrity rules ([[FUTURES]] §7.3):
  append-only with derived balance, verification gates value, no self-referral or
  duplicate-device farming, review quality gate, consent-first.
- **Verified visit** — one channel at MVP ([[FUTURES]] §7.5).
- **Abuse defence**: rate limits, attribution checks, device signals, the appeal path.
- **Tiers and badges.** Redemption stays deliberately conservative — status and tiers
  only at launch; restaurant-funded perks are opt-in per restaurant, configured and
  funded by the restaurant ([[FUTURES]] §7.4).
- The 41 enumerated paths: §W `NEW-652…NEW-666` (`UX_PATHS_CATALOG.md:1471-1491`) and
  §AB `NEW-861…NEW-885` (`:1771-1801`).

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| Guest identity keys, merging, consent record shape | [[guest-identity-consent-charter]] | We collect consent through our surfaces; we do not decide what a verified identity is. |
| Taste modelling | [[taste-fingerprint-charter]] | We emit events; they model them. A ranked algorithmic feed is **deferred** at MVP ([[FUTURES]] §7.5) and is theirs when it arrives. |
| Restaurant-facing dashboards, segments, k-anonymity | [[guest-value-monetization-charter]] | Different customer, opposite incentives. |
| Cash-value rewards, redemption marketplace, platform-funded perks | **Nobody — forbidden for now** | [[FUTURES]] §10: *"Cash-value or platform-funded rewards before points integrity is proven"* is a non-goal (`FUTURES.md:282`). |
| Advertising and monetization | [[guest-value-monetization-charter]] | Pricing is separately founder-deferred; no model proposed here. |
| Ledger *infrastructure* — durable append-only writes, idempotency | [[engineering-charter]] | Same discipline inventory already solved. Integrity **rules** are ours; the write mechanics are not. |
| Device fingerprinting technique, fraud tooling selection | [[security-charter]] | They own technique; we own the abuse posture and the appeal path. |
| The Beli relationship as a deal | [[partnerships-integrations-charter]] | **OD-07.** |

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `nf_b.events_per_active_guest_month` | Ratings, photos, verified visits per active guest — each a `stimulus → choice` record | 0 — no app exists |
| `nf_b.points_confirm_rate` | % of points reaching `confirmed` rather than expiring provisional | undefined — **integrity gate** |
| `nf_b.verified_visit_rate` | Share of visits verified through a real channel vs self-reported | undefined |
| `nf_b.abuse_hold_rate` | Share of credits held pending review, and appeal outcomes | undefined |
| `nf_b.review_quality_pass_rate` | Ratings passing the quality gate before points confirm | undefined |

**Volume alone is farmable, so it is never reported alone.** High
`nf_b.events_per_active_guest_month` with low `nf_b.points_confirm_rate` is farming,
not engagement ([[product]] §2.3), and the two numbers appear together or not at all.

## Evidence today — **NEW**

### The design contract is complete

[[FUTURES]] §7 (`FUTURES.md:146-199`): profile types (§7.1), earning rules (§7.2),
integrity rules (§7.3), conservative redemption (§7.4), MVP vs north star (§7.5).
Promotion trigger stated: **999.1 promotes when restaurant-side operations are stable
enough that demand-side signal has somewhere useful to land** (`FUTURES.md:199`).

### 41 paths, already written

Several are load-bearing and unusually well-judged, which is why they are named rather
than counted:

- `NEW-871` — provisional vs confirmed points **visually distinct**, with hover
  explaining what confirms them. Guest-visible integrity, not back-office integrity.
- `NEW-872` — unconfirmed points expire and the guest is notified **before** expiry,
  not after.
- `NEW-878` — suspected abuse leads to **points held plus an appeal path**, never
  silent zeroing.
- `NEW-863` — points history as an append-only ledger view: every credit with its
  source event.
- `NEW-869` — the *higher* referral bonus attaches to a verified **visit**, not to a
  signup. Value follows verification, exactly as §7.3 requires.

Full ranges: `UX_PATHS_CATALOG.md:1471-1491` and `:1771-1801`.

### ⚠️ Nothing exists as code

- Grepped `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src`, and
  `supabase/migrations/` for `points_ledger`, `guest_points`, `points_balance` —
  **no matches**.
- `apps/mobile/src` is the **staff** app: `api`, `components`, `config.ts`, `design`,
  `guidance`, `lib`, `state`.
- Scheduled as ROADMAP backlog **999.1** (`ROADMAP.md:639`), `PROJECT.md:27`.

### ⚠️ The signal source has no subject

`nf_b.subject_coverage` is structurally 0% — no application code writes the guest
identity tables ([[guest-identity-consent-charter]]). An app that emits events for
guests who do not exist as subjects produces engagement metrics and zero NF-B events.
**Ordering matters:** the identity write path precedes this surface, not the reverse.

## Entry trigger

**Two conditions, both required, neither satisfied.**

1. **OD-07 resolves** ([[OPEN-DECISIONS]]:18) — build the consumer experience
   independently, or explore a Beli collaboration. Founder call, after guest MVP scope
   exists (which [[FUTURES]] §7.5 already provides). This charter **takes no
   position**, and says why: an independent build is the outcome that maximises this
   team's scope, which disqualifies it as a neutral assessor. Both branches are real —
   under collaboration, much of this charter becomes an integration contract rather
   than a build, and the abuse posture may be partly inherited rather than authored.
2. **`nf_b.subject_coverage` is non-zero** for at least one restaurant — there is
   somebody to attribute a choice to.

Until both hold, this team is `status: new` and **unstaffed**. Writing the charter is
not activating the team; it is making sure that when the trigger fires, the reasoning
is already there.
