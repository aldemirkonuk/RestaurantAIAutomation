---
type: premortem
division: product
department: product-vision
team: ask-ai
status: provisional
metrics: [askai.refusal_correctness, askai.allowlist_family_count, askai.entry_point_count]
updated: 2026-08-24
links: ["[[ask-ai-charter]]", "[[ask-ai-loops]]", "[[ask-ai-directive]]", "[[product-vision-premortem]]", "[[inbound-understanding-charter]]", "[[ai-orchestration-charter]]", "[[security-charter]]", "[[red-team-charter]]", "[[FUTURES]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Ask AI — Action Composer — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — The allowlist grew one convenience at a time until something mutated stock without a human

The team's own named premortem (`teams/product.md:237-240`), and the one failure that is not
recoverable by an apology. [[FUTURES]] §8.1's single non-negotiable is that AI never
silently mutates stock, money, or outbound vendor email. The allowlist is the mechanism, and
it is the most reasonable thing in the world to extend by one entry: a manager asks, the
action is low-risk, the PR is small, it ships on a Friday. Repeat for twelve months. Then
one entry has a code path where the confirm step is enforced client-side, or a "low-risk"
inventory transfer turns out to be a stock mutation with a different name — and `NEW-902`,
the audit history, was the half that got deferred, so nothing can even reconstruct when it
started.

**Earliest observable signal.** The **first** action family added without a paired refusal
test — not the tenth. Second signal, equally early: the first allowlist entry whose confirm
step is not enforced server-side.

**Counter-pressure.** Three mechanisms, all structural rather than social.
**(a)** The allowlist is **one file that CI diffs**, so adding an action is a reviewed change
to a single artifact rather than a decorator inside a PR of forty — the same shape
[[engineering-premortem]] M2 prescribes for `@Public()`.
**(b)** `askai.allowlist_family_count` is reported as a **stability metric**: growth is a
signal to investigate, not a milestone to celebrate.
**(c)** `NEW-902` ships **with** the first executing action. An audit trail added later
cannot audit the period before it existed, which is precisely the period that matters.

---

### M2 — Refusal correctness was never measured, because refusals are invisible

`askai.refusal_correctness` is the charter's hard gate. It is also the easiest metric in the
company to never build: a refusal produces no row, no order, no email, no visible outcome.
Confirm rate, by contrast, is trivially instrumented and looks like progress. So the team
ships confirm-rate dashboards, the refusal set is a handful of examples someone wrote once,
and nobody notices that the model started attempting billing changes because nothing counts
attempts.

**Earliest observable signal.** `askai.confirm_without_edit_rate` published in any report
where `askai.refusal_correctness` is absent or marked "N/A". The first occurrence is the
signal.

**Counter-pressure.** **A refusal is a logged NF-A event**, with the same shape as a
confirm: `stimulus → internal_state → choice(refuse) → outcome`. Counting refusals as
absences is what makes the gate unmeasurable, so the schema treats them as first-class from
the first line of code. And the two numbers are published as a pair or not at all — the
same discipline [[inbound-understanding-charter]] applies to acceptance and false-accepts,
for the identical reason.

---

### M3 — Four entry points became five, because unifying is a migration and adding is a feature

Today there are four divergent AI entry surfaces — the Reports pill
(`apps/web/src/components/reports/organisms/AICommandPalette.tsx:191`), the mobile Wine
Agent FAB (`apps/mobile/src/guidance/WineAgentFab.tsx`), `/sommelier`
(`apps/web/src/pages/SommelierAI.tsx`), and two placeholder routes — plus the deterministic
§A command palette next door. [[FUTURES]] §8.3 requires **one** action schema behind all of
them. But unification means touching three shipped surfaces, and the next product need
("guests should be able to ask about the wine list") is far cheaper to satisfy with a fifth
bot. The failure is not that unification is hard; it is that it never becomes urgent.

**Earliest observable signal.** `askai.entry_point_count` rising above 4. The weekly
entry-point drift check ([[ask-ai-schedule]]) exists solely to catch this within a week
rather than a quarter.

**Counter-pressure.** A **new AI entry surface is only permitted if it calls the shared
action schema** — that is a team-level rejection, not a debate
([[ask-ai-directive]]). And unification is sequenced by *schema first*: because the schema
is writable today without the composer, each existing surface can be migrated behind it
incrementally rather than in one migration nobody has time for.

---

### M4 — The composer became a chatbot, and the settled "don't build" verdict eroded by increment

[[AGENT_NATIVE_UI_DECISION]] §3 reached a **"don't build"** verdict on the agent-native UI
rewrite. This team is the single most likely place for that to unravel — not by anybody
proposing a rewrite, but by a chat surface being the obvious next step from a text box that
already accepts intent. `/sommelier` is already a chat UI. Multi-step requests (`NEW-905`)
want conversation. Six months of reasonable increments and the product's centre of gravity
is a chat window, which is the exact thing the review rejected — and the environment's
reasons have not changed: high staff turnover, oral training (*"hit the blue button on the
right"*), muscle memory during service.

**Earliest observable signal.** Any Ask AI feature whose value proposition is conversational
continuity rather than a completed action. Concretely: persistent chat threads, follow-up
turns that do not produce a card, or a proposal to make Ask AI the default landing surface.

**Counter-pressure.** The charter names the settled decision explicitly, and
[[product-vision-directive]]'s settled-decision rule routes any proposal with that effect
straight to `OPEN-DECISIONS.md` as a supersede-ADR request. The design constraint that
enforces it in practice: **action cards, not walls of text** ([[FUTURES]] §8.3,
`NEW-899`) — every interaction terminates in a card the user confirms, edits, or discards.
A turn that produces no card is a Q&A answer, and Q&A is explicitly not this team's product.

---

### M5 — It was built against a product nobody uses, and the allowlist was designed for imagined workflows

`recommendation_actions` = **0 rows** — nobody has ever acted on a recommendation.
`procurement_orders` = **1**. `pos_checks` = **0** ([[AGENT_NATIVE_UI_DECISION]] §2). The
allowlist families in [[FUTURES]] §8.2 are plausible, well-chosen, and entirely
hypothetical: *"reorder low Barolo from our usual provider"* presumes a usual provider, a
par level, and a person who reorders. Twelve months later the composer handles seven action
families beautifully and the one thing an actual operator wanted — which nobody could have
guessed — is not among them.

**Earliest observable signal.** The allowlist reaching its MVP size before a single real
user has spoken an intent into any entry point. Also: `askai.confirm_without_edit_rate`
being unmeasurable at the second close-time because there are no confirms to measure.

**Counter-pressure.** **Log intents before building actions.** The cheapest useful version of
this team is an entry point that captures what people ask for and refuses everything —
turning [[FUTURES]] §8.2's guessed families into an observed distribution. The department's
subject rule applies ([[product-vision-directive]]): a new action family should name the
restaurant that asked for it. Until then the allowlist is deliberately **small and
navigation-heavy** (`NEW-897`, deep-link + coach, no mutation), because navigation assist is
the one family that is useful on day one and cannot corrupt anything.

---

## Cross-cutting counter-pressure

- **Refusals are events, not absences.** The single design decision that makes the hard gate
  measurable at all (M2).
- **One CI-diffed allowlist file**, and family-count reported as stability rather than
  growth (M1).
- **No new AI entry surface unless it calls the shared schema** (M3).
- **Every interaction terminates in a card** — the practical enforcement of the settled
  decision (M4).
- **Log intents before building actions** (M5).
- **[[red-team-charter]] should attack the allowlist boundary definitions** specifically —
  "inventory transfer" and "stock mutation" are the same operation under two names, and that
  is where the non-negotiable gets crossed without anyone deciding to cross it.
  Findings-only ([[ORG_STRUCTURE]] §3).
- **Anti-sprawl:** unrevisited in 60 days, this document is fiction (foundation §3.3).
