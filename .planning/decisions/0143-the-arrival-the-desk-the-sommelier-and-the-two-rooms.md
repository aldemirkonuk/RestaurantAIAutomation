# 0143 — The arrival, the desk, the sommelier, and the two rooms nobody visits

- **Status:** Locked on six founder calls, 2026-09-12, in session.
- **Numbering:** drafted as 0140; 0140 was claimed on a pushed ref by a peer session (`0140-the-door-outbox-keeps-the-receipt-and-claims-nothing-it-cannot-prove.md`) while this sat unfiled, and 0141 and 0142 were taken by this session's own work. Renumbered rather than collided: see CLAUDE.md 5b, "never reuse a number".
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** mudavym, design wave, public pages, PublicShell, admin, admin health, sommelier, ask-ai, onboarding, sketch 104, anon key, RLS
- **Links:** [[0133-a-public-page-has-no-house-so-the-public-door-has-one-switch]] (the switch these pages ship behind), [[0042-iznik-seal-and-warm-charcoal]] (both grounds), [[0112-one-modal-policy-three-shapes-one-primitive]], [[0113-the-assistant-proposes-the-seal-applies]] (what the assistant may do), [[0083-a-page-may-not-claim-a-write-it-never-makes]], `.planning/06-pages/MAKEOVER-VERDICTS.md` (preferences, explicitly NOT decisions)

## Context

The wave was told to finish every route that still renders its legacy design. A
handover analysis then measured something that had not been stated plainly:
**twenty of the twenty remaining pages had no locked design decision.**
`MAKEOVER-VERDICTS.md:4` says so in its own frontmatter — those verdicts are
preferences and inspiration, and *"the one locked decision in this whole review
is the palette"*. What binds every page is cross-cutting only: the palette, the
modal policy, the gating, the honesty rules.

The founder's instruction was exact: the design for these pages must come from a
locked decision, and only where one is MISSING may a new decision be added — and
he must be told before one is. He was told, and answered four of the twelve
questions the analysis produced. Those four answers are this record.

## Decision

### 1. The seven signed-out pages share one shell

`forgot-password`, `reset-password`, `verify-email`, `invite/:code`,
`no-access`, `privacy` and `/v/:slug` are built on a single `PublicShell` —
wordmark, the seal, one sentence in the house voice, both grounds — rather than
seven separate treatments. One thing to get right, one thing to review, and a
stranger meets the same house at every door. The component does not exist yet;
building it is the first task of that group.

`login` and `register` are NOT in this set. The founder rejected their redrawn
versions (*"It looks too modern... This just looks like an AI web page"*) and
asked for today's pages improved instead, so their treatment is open.

### 2. `/admin` and `/admin/health` become one page

Both page notes had already concluded this in their own section 13. `/admin`
becomes the operations desk with health as a section inside it; `/admin/health`
stays as a redirect so no bookmark breaks.

### 3. The sommelier is routed to the assistant that exists

Measured before deciding, which is why this is not the redesign it looks like:

- The page posts to `/api/v1/sommelier/chat` on the orchestrator and **that route
  does not exist** — the orchestrator mounts seven routers and none is chat — so
  every message has always taken the error branch.
- Conversation history is read **straight from the browser to Supabase on the
  anon key**, bypassing the gateway. The policy is `user_id = auth.uid()`, the
  app never gives the Supabase client a session, and `public.users` and
  `auth.users` share no ids, so the read could not match even with one.
  Production answers `200 []`, and the loader catches the error and returns `[]`,
  making a denial and an empty account identical.
- Saving throws with no `onError` while mutations are `throwOnError: false`, so
  nothing on screen ever says a conversation was not saved.
- The footer claims the page *"uses your inventory and sales data"*. No sales
  endpoint is called anywhere in the file, and no model runs.

So: the page is pointed at the assistant the gateway already has (`ask-ai`),
grounded in the cellar and inventory it already reads, under ADR 0113 — it
proposes, a person's seal applies. It says plainly where it has no data instead
of implying sales. And **its conversations move behind the gateway** as a normal
authenticated resource, which retires the anon-key path and fixes the broken
history as a consequence rather than as a separate repair.

### 4. The arrival is C's book, opened by talking, closed by a held seal

He picked, in his own words: *"I liked the seal for most (hold for seal), lay it
by talking features, skyleaf, organized view yet with details."* That is not one
of the five as drawn; it is three of them, and the parts he named say exactly
which three.

**C is the spine.** "Skyleaf" is C's flyleaf — the opening page at `/register`
that asks who keeps the book and which house, and deliberately does NOT ask for a
currency, because a register belongs on its own folio with its own state.
"Organized view yet with details" is C's contents page: five ruled folios, each
carrying its own state — ruled off with the double rule when posted, open in grey
when not, carried forward with a date when skipped, blocked with the reason and
what unblocks it — and never a percentage. C is also the only one of the five
that survives someone closing the tab, because every folio's state is a fact
about the house rather than a position in a flow.

**B and E's voice comes with it.** "Lay it by talking" is E's control and B's
interview: a person may speak a folio instead of typing it, and what they say
lands beside them as rows carrying a provenance — typed, spoken, inferred,
confirmed, defaulted, skipped, not yet answered, cannot be recorded — before
anything is written. Speaking is an input to a folio, not a replacement for the
book.

**The seal is the ceremony, held, and it lands once.** Not per folio. The wax is
rationed to the commitment that does not reverse in one click, which is the batch
entering the book; every sketch's "two roads not taken" rejected a seal per
register for the same reason, and he confirmed it by naming the gesture rather
than the count.

What this inherits from the sketches, unchanged: a skip is a **recorded fact**,
not an absence; the assistant proposes and only the seal applies (ADR 0113);
absence reads *"not yet answered"*; and Google sign-up is drawn unavailable
because no route takes it.

**What is NOT yet decided here, and is named rather than defaulted:** whether A's
first evidence — photograph the last invoice, then read the registers off what
the paper said — opens the book as folio 0. He did not name it, and I will not
infer it from silence. It is the one part of the arrival still open, and it is a
question rather than an assumption because a house with no invoice yet must still
be able to open its book.

The honest gaps the sketches drew in mono are gaps in the build, not in this
decision: `config.propose_batch` is not built, `configuration_step_skipped` is
not an audit action, producers cannot be held one by one, a vendor's usual
currency has no field on the terms DTO, and the speech provider is open (ADR 0113
Q6/Q7). Each is a build task under this record, and each must read as
"not yet answered" rather than silently doing nothing.

### 5. `/dev-sandbox` and `/dev/truth` stay as they are

Neither was ever sketched, neither was given a verdict, and `/dev/truth` has no
page note at all. They are internal tooling with no customer. They keep working
exactly as they do: no Mudavym design, no flag, no dossier, and the design budget
goes to the eighteen routes a customer actually sees.

This is recorded so nobody rediscovers them later as a gap and "fixes" them. A
line goes in each page note saying it was decided, not overlooked. Retiring them
was rejected: `/dev/truth` is the surface that answers what the system actually
believes, which is a diagnostic that has been used and that nothing replaces.

## Alternatives rejected

- **A treatment per signed-out page.** Maximum freedom, seven reviews, and the
  drift that produced forty-seven unlike pages in the first place.
- **Keeping `/admin/health` a separate route** because an owner watching a deploy
  does not want the rest of the admin page in the way. Rejected: both notes had
  already concluded the opposite, and a split can be made later on evidence.
- **Dressing the sommelier without measuring it.** It looked hollow; it was
  broken. A redesign over a page whose core call has never worked would have
  shipped a better-looking lie.
- **Retiring `/sommelier` into the cellar.** Considered seriously — the founder
  chose to make it real instead.
- **Choosing an onboarding direction on his behalf** to save a review round. He
  chose, and he chose a merge rather than one of the five, which is the answer a
  forced single pick would have lost.
- **Reading A's first evidence into his answer** because it is the direction I
  recommended. He named the flyleaf, the contents, the talking and the seal; he
  did not name the photograph. Inferring it would be exactly the "sensible
  default" CLAUDE.md 0.1 forbids, so it is asked instead.
- **Giving `/dev-sandbox` and `/dev/truth` the design** so that every route looks
  like one product. Two more dossiers and two more builds ahead of
  customer-facing pages, for surfaces with no customer.
- **Retiring them.** A cleaner tree, at the cost of the only surface that says
  what the system actually believes.

## Consequences

- `PublicShell` is a new shared component and the first dependency of seven pages.
- The arrival is a build against C's shape, not a fresh design round: sketch 104's
  direction C, its flyleaf and its contents page, are the drawing this builds from.
- Five of the twelve handover questions are now answered; six remain open and one
  new one (folio 0) was opened by this record rather than closed by it.
- `/admin/health` becomes a redirect; anything citing it as a page must be updated.
- The sommelier work is not a page rebuild but a re-pointing: a gateway resource
  for conversations, a real assistant behind the chat, and the removal of three
  claims the page makes today that are false.
- The browser's direct Supabase path for `sommelier_conversations` is retired.
  Whether any OTHER surface talks to the database from the browser on the anon
  key is unmeasured and is named below rather than assumed.

## What this decision does NOT settle

- The login and register treatment, which the founder rejected once already.
- **Whether A's first evidence opens the book as folio 0.** The one open part of
  the arrival, asked rather than assumed.
- The six questions of the twelve that are still open: `/help`,
  `/vendor-prices`, `/promotions`, `/authorize/:integrationId`, `/ask`,
  `/recommendations/catalog`, and the public-document treatment for `privacy`
  and `/v/:slug` beyond the shared shell.
- Whether any page other than the sommelier reads the database directly from the
  browser. That is a measurement nobody has run.

## Founder answer, 2026-09-12 — the agent restart control on the desk

Section 2 above made `/admin` one operations desk and left one control undecided:
restarting or stopping an agent ([[admin]] section 13 item 3, NEW-545). Measured before
asking: `restart_agent` and `stop_agent` in
`services/agent-orchestrator/core/orchestrator.py:497,525` take only an agent NAME;
there is one orchestrator for the whole platform (`get_orchestrator()`, `main.py:69`);
and nothing calls either method — no route reaches them. **A restart is therefore not
a house action.** Restarting an agent restarts it for every restaurant on Mudavym at
once.

**Answered: operators only, never owners.** The restart and stop endpoints are built
behind the admin key, and the controls render on the desk only for a platform
operator. Owners see each agent's health read-only, with a plain line about what is
happening. Rejected: owners restarting behind the held seal — today that lets one house
restart every house's agent, and doing it properly means running agents per house
first, which is a multi-tenancy build and not a button; no control on any screen — the
desk would show a problem it offers no way to act on, including to us.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir | Four calls: the shared shell, the merged admin page, the sommelier routed to the real assistant, onboarding held for his pick |
| 2026-09-12 | Aldemir | Two more: the arrival is C plus the held seal plus talking; the two dev routes stay as internal legacy |
| 2026-09-12 | — | Renumbered 0140 to 0143 after a peer claimed 0140 on a pushed ref |
