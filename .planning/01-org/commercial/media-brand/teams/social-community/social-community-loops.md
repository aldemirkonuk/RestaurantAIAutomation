---
type: loops
division: commercial
department: media-brand
team: social-community
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[social-community-charter]]"
  - "[[social-community-directive]]"
  - "[[media-brand-loops]]"
  - "[[conversion-funnel-loops]]"
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["social-entry-trigger-watch", "social-referred-activation", "social-reply-routing", "social-name-availability"]
loop_close_times: ["weekly", "monthly", "weekly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Social & Community (M3) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

**One loop runs today. Three are specified and dormant.** Writing the dormant ones now is
deliberate: the launch list should be a thing that is executed, not a thing that is invented
under pressure the week the trigger fires.

---

## 1. Entry-trigger watch — **live**

```yaml
type: loop
id: social-entry-trigger-watch
owner: social-community
measures: [editorial.articles_cleared]
changes: [social-community.status]
inputs_from: [editorial-gate]
outputs_to: [media-brand, social-community]
close_time: weekly
status: proposed
```

**The only live loop, and the only thing keeping this team from being a document.** It
measures one integer and changes one thing: whether this team is dormant.

**Exempt from the three-runs-no-action rule** ([README §6](../../../../../foundation/README.md))
for as long as the team is dormant. Its job is to return "no" until the single week it
returns "yes"; deleting it for producing no action would delete the wake-up mechanism and
leave premortem mechanism 2 — the trigger firing unnoticed — with no counter-pressure at
all. This exemption is written down rather than assumed, because an undocumented exemption
is indistinguishable from an oversight.

**Weekly.** Fast enough that an article is distributed while it is still new.

---

## 2. Referred activation — **dormant**

```yaml
type: loop
id: social-referred-activation
owner: social-community
measures: [social.referred_sessions, social.referred_activated_accounts]
changes: [social.platform_mix, social.posting_rhythm]
inputs_from: [conversion-funnel, content-production]
outputs_to: [media-brand, growth]
close_time: monthly
status: proposed
```

**Blocked on instrumentation that does not exist.** Sentry is the only telemetry SDK in
[EXTERNAL_CONNECTIONS.md](../../../../../foundation/EXTERNAL_CONNECTIONS.md); no funnel step
is attributable to a referrer. G5 owns closing that.

**Deliberately measures the far end of the funnel.** `referred_sessions` alone would reward
posting that gets clicks; the pair only looks healthy when the clicks reach an activated
account, where activated means a first POS-connected day.

**Reports nothing rather than something while blocked.** A follower count entered into this
loop would satisfy the loop and defeat its purpose.

---

## 3. Reply routing — **dormant**

```yaml
type: loop
id: social-reply-routing
owner: social-community
measures: [social.replies_routed, social.replies_unanswered_48h]
changes: [social.routing_rule]
inputs_from: [brand-identity]
outputs_to: [sales, media-brand]
close_time: weekly
status: proposed
```

**The counter-pressure to becoming an unstaffed support channel.**
`replies_unanswered_48h` is the number that matters; premortem mechanism 4 begins at the
second unanswered product question, not the first.

**Has a hard prerequisite from a sibling.** The routing rule points at a support address,
and today that address is `support@wineops.ai` (`apps/web/src/pages/Help.tsx:18`). A routing
rule naming the previous company is worse than no routing rule.

---

## 4. Handle and name availability — **live, but trivially**

```yaml
type: loop
id: social-name-availability
owner: social-community
measures: [social.handles_available, social.handles_reserved]
changes: [social.reservations]
inputs_from: [brand-identity]
outputs_to: [brand-identity, media-brand]
close_time: quarterly
status: proposed
```

**Small, cheap, and it closes a real gap.** Premortem mechanism 3 is the handle being gone at
the moment the team wakes up, twelve months from now, with no warning in between.

**`outputs_to` includes M1 on purpose.** If the new company name is unavailable as a handle,
that is a naming finding, not a social one, and it needs to reach the team that owns the
name while the name is still young.

**Quarterly.** Availability does not change weekly, and a weekly check would be three
no-action runs and a deletion.
