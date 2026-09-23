# 0143 — The arrival, the desk, the sommelier, and the two rooms nobody visits

- **Status:** Locked on six founder calls, 2026-09-12, in session. **[AMENDED 2026-09-16 by [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] rows 4, 7, 8, 10 and 11 — Studio and SimPOS, the public doors, the contact address, the desk's defaults, and the arrival's threshold, `/onboarding` redirect and tutorial action boxes. See "Founder answers, 2026-09-16" below. Answered, not built.]** Extended by two more, 2026-09-18 (ADR 0149 rows 41-42 — see the addendum below).
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
building it is the first task of that group. [2026-09-16, ADR 0149 row 7: the treatment Codex drew for these doors is ratified — see the founder answers of that date below and ADR 0133's amendment. "Both grounds" is read under 0149 row 6: charcoal, and paper only where a surface declares it.]

[2026-09-17, ADR 0149 row 35: **`/login` and `/register` take the flyleaf look of sketch 104 direction C** (same fields and flow; nothing moves), reopening this record's improve-in-place-only reading for those two pages. A sketch (118) goes to the founder before the build; the flyleaf itself still lives on `/get-started`.] [2026-09-19: sketch 118 = **B, the endpaper** (the founder's answer, over the README's recommended A). It is built as `EndpaperShell` on `/login` and `/register`, with Google sign-in also on `/login`'s first page (ADR 0149 row 35).]

`login` and `register` are NOT in this set. The founder rejected their redrawn
versions (*"It looks too modern... This just looks like an AI web page"*) and
asked for today's pages improved instead, so their treatment is open.

### 2. `/admin` and `/admin/health` become one page

Both page notes had already concluded this in their own section 13. `/admin`
becomes the operations desk with health as a section inside it; `/admin/health`
stays as a redirect so no bookmark breaks. [2026-09-16, ADR 0149 row 10: the desk's defaults are kept — see the founder answers of that date below.]

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

**C is the spine.** "Skyleaf" is C's flyleaf — the opening page at `/register` [CORRECTED 2026-09-12 by the founder, asked because this contradicted his ruling that `/register` is improved in place with no redraw: **the flyleaf opens `/get-started`**, as the first spread of the book straight after sign-up, and `/register` is untouched and keeps its currency field. Folio 1 shows the currency given at sign-up as already posted, marked as stated, so nothing is asked twice. Rejected: building the flyleaf at `/register` (the redraw refused twice); flyleaf wording on today's form (a flyleaf in words only, with currency still at the door).]
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
than the count. [CLARIFIED 2026-09-12 by the founder, asked because ADR 0144:31 has folio 0's proposals "confirmed in place", a different moment from this one: **only what Mudavym proposed waits for the seal.** What a person typed posts at once. See the founder answers below.]

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
Q6/Q7) [CORRECTED 2026-09-12: the founder answered Q6 and Q7. Recognition is on-device and only the rows are kept; see "Founder answers, 2026-09-12 — the voice, what the seal covers, and the emails at the door" below]. Each is a build task under this record, and each must read as
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

[2026-09-16, ADR 0149 row 4: SimPOS (`/simpos/:restaurantId` and its two children) joins these two — an internal tool kept as it is, outside the design and outside the legacy deletion. Studio (`/studio` and its children) is NOT decided: it waits on a check of the Codex conversations for an update in flight.]

[2026-09-17, ADR 0149 row 32: the Codex-conversation check found no Studio update (the founder never named Studio to Codex; the Studio pages date from April 2026). **Studio is kept as an internal tool**, beside SimPOS, `/dev-sandbox` and `/dev/truth`, outside the design and outside the legacy deletion.]

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
  and `/v/:slug` beyond the shared shell. [2026-09-16: that treatment is now settled by ADR 0149 row 7.]
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

## Founder answers, 2026-09-12 — who an operator is, and where home is

**Who counts as a platform operator.** The restart answer above assumed an
identity this codebase does not have: `RolesGuard` knows owner, manager and
staff (`roles.guard.ts:5`), the ux-optimizer controller says "this codebase has no
platform-admin role" (`ux-optimizer.controller.ts:68`), and ADR 0124 declined to
invent one. Asked, and then asked again to remove an ambiguity in the first
answer, the founder chose: **an operator needs BOTH a platform flag that only SQL
can set AND Studio's `developer` role.** The role says what kind of person they
are; the flag, which no API can write, says they may act on the whole platform.
Being invited as a Studio developer -- an API path, through invite tokens -- is
never enough by itself. Today that is the founder alone. This builds what ADR
0124 chose not to, so the build carries its own migration, guard and a registry of
the routes that require it. Rejected: either one alone being enough (anyone ever
invited as a Studio developer could restart every house's agents); an allowlist
of user ids in the environment (outside the database and outside review); no
operator screen at all.

**Where "home" is for a stranger.** The PublicShell wordmark on the seven
signed-out pages and the `/v/:slug` footer line "Published on Mudavym." both link
to **`/login`**. Measured first: `mudavym.com` answers 200 with the app itself,
whose `/` is the dashboard behind a login, and there is no separate landing page
in the tree -- so a link to `/` would only bounce a stranger. When a real landing
page exists the link moves to it in one line. Rejected: linking `/` (a redirect,
and a "home" that lands on a login wall); a footer link with no wordmark link.

## Founder answers, 2026-09-12 — the voice, what the seal covers, and the emails at the door

**The voice. This closes ADR 0113 Q6 and Q7.** Section 4 lets a person speak a folio
instead of typing it. **Answered: recognition happens on the device, and only the rows
are kept.** The browser's own speech recognition turns speech into text, the same
recognition `SpotCountPanel.tsx:84-86` already uses. No audio and no transcript leave the
device, and nothing new is billed. The record is the result: each row lands marked
`spoken`, exactly like a typed row apart from that provenance. The transcript is not
stored. Where the browser offers no recognition (Safari and Firefox may not), the control
says it is unavailable rather than silently doing nothing.

Rejected:
- on-device recognition that also keeps the transcript, a new store of a person's own
  words that would need a retention rule;
- a hosted model, which sends voice off the device, spends per use against the house's
  allowance and needs a disclosure on `/privacy`;
- typing only for now.

**What the one held seal covers.** Section 4 says the seal lands once, on the batch
entering the book (0143:95). ADR 0144 says folio 0's invoice proposals are confirmed in
place (0144:31). Those were two different moments, and nothing said which entries wait.
**Answered: only what Mudavym proposed waits.** Anything the person typed posts
immediately, because they wrote it. Anything Mudavym proposed waits in one batch and enters
the book only when the seal is held. That covers a spoken entry it interpreted, an entry it
inferred, and a suggestion read off the invoice. The seal therefore means "I have read what
Mudavym put here", and typing never waits on a ceremony.

Rejected:
- everything waits for the one seal: closing the tab loses the draft, or needs a draft
  store, and C was chosen partly because it survives a closed tab;
- invoice proposals join the batch while hand-typed folios post: spoken entries would then
  post unsealed even though Mudavym interpreted them.

**The emails that bring a stranger to these doors. OD-27 is partly lifted.** The seven
public doors say Mudavym, but the emails that deliver people to them said "WineOps AI".
Measured on `origin/main` beb00db4 when this was written:
- the verification email: `auth.service.ts:986`, `:1011`, `:1033`;
- the password reset: `auth.service.ts:2077` and `email-templates/password-reset.template.ts:49,54`;
- the Studio invite: `email-templates/studio-invite.template.ts:19`.

A reset link from WineOps AI that opens a Mudavym page reads like phishing. **Answered:
rename the auth emails only.** For verification, password reset and team invite, the
sender name, subject, heading and footer say Mudavym. Every other WineOps string waits
for the planned migration, as OD-27 decided on 2026-08-24. `git grep -c "WineOps"
origin/main -- apps/api-gateway/src` counted 133 lines on beb00db4. (The question put to the
founder said 106; that was a different count, and 133 is the one measured here.)

Rejected:
- keep deferring, so every sign-up and every reset crosses brands at the moment trust
  matters most;
- lift OD-27 wholesale now, which would do the full recalibration as a hotfix in one large
  diff.

**`/login` and `/register`.** This ruling had been recorded only in a build brief: both
pages are improved in place behind the public design switch (`publicDesign.ts`), not
redrawn. With the switch off, each renders exactly as main does. Built in 78910028.

## Founder answers, 2026-09-16 — carried from ADR 0149

Answered in session and recorded verbatim in
[[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]]'s
founder-answers table; the row numbers below are that table's. None of this is built yet.

**Studio and SimPOS (row 4).** The founder: *"/studio was getting another update I'm not
sure tho, check codex convos but imPOS keep-asis"*. **SimPOS stays as it is**: an internal
tool, outside the Mudavym design and outside the legacy deletion, the same standing section 5
gives `/dev-sandbox` and `/dev/truth`. **Studio is open** [2026-09-17: closed by ADR 0149 row 32 — kept as an internal tool; see §5]: it waits on a check of the Codex
conversations, and nothing about its design or deletion is decided until that check is read
back to him.

**The public doors (row 7).** The treatment Codex built is ratified: a readable `/privacy`,
the vendor board at `/v/:slug`, sign in before resending verification, today's invite
preview fields, and publisher attribution with no Mudavym seal. Adopting the code itself
stays under 0149 row 1 (audited, adversarially judged, adopted only if the quality baseline
is great). Carried also into ADR 0133's amendment of the same date.

**The contact address (row 8).** `support@mudavym.com` everywhere a person is told how to
reach us: `/privacy`, `/help`, and the auth-email footers. Measured when this was written:
`support@wineops.ai` appears 5 times under `apps/web/src` and `apps/api-gateway/src`
(`grep -rnoE 'support@[a-z.-]+'` at `60ed83a7`), and no other support address appears.

**The desk's defaults (row 10).** Kept: the five local-only knobs removed, the other tabs
linked out, and the health read for owners only (read-only, consistent with the 2026-09-12
restart answer above).

**The arrival (row 11).** Three things: **(a)** the house-wide low-stock threshold is one
line on folio 2; **(b)** `/onboarding` redirects permanently to
`/get-started`; **(c)** in his words, *"+ improve the UI for tutorial action boxes"* — drawn
first as sketch 115 for his review, one of 0149's gated stops, before it is built. Carried
also into ADR 0144.

## Founder answer, 2026-09-19 — a stuck batch is resumed only by the manager who sealed it

A crash mid-`apply()` or mid-`undo()` strands a batch at `'applying'` or `'undoing'`
(section 4's held seal; the resume mechanics are this lane's own C2 build,
`arrival.service.ts:697-853,882-961`). Resuming is a same-actor operation everywhere in
this service, not a special case of resume alone: `batch()` (`:446-463`) scopes every
read of a batch — behind `propose`, `discard`, `apply`, `undo` and `issueApplySeal`
alike — by `user_id = actor.userId` (`:457`), so a different manager of the same house
cannot read, let alone act on, a colleague's batch at all. `manage()` (`:69-75`) only
confirms the caller may administer the house in general; it does not widen who may
touch one specific batch row. The question this lane's adoption surfaced: if the
manager who sealed a batch is away when it crashes, should an owner, or any other
manager, be able to force it forward? **Answered: no. A batch stuck at `'applying'` or
`'undoing'` is resumed only by the manager who sealed it, as built.** No code follows
from this answer — it ratifies the existing per-user scoping rather than widening it.

Rejected:
- an owner override, so an absent manager's crash cannot block the house's own
  configuration indefinitely — rejected because a second person resuming a batch they
  did not seal would replay a write that neither the seal challenge nor that person's
  own hold ever covered for them;
- any manager of the house resuming any other manager's batch, for the same reason.

Founder's answer, verbatim as recorded: *"stuck Arrival batch = only the sealing
manager resumes"* (`founder-sketch-decisions-106-115.md`, "Lane answers batch 4,"
2026-09-19 ~10:00Z).

## Addendum — 2026-09-18: the OD-03 core-line diet does not bind this lane

**ADR 0149 row 41 (founder, 2026-09-18).** The wave-4 close-out pass on this lane's
Python half (`services/agent-orchestrator/`) asked whether ADR 0039's Track A clause —
*"Nothing in Track A may extend `core/` while A1 runs"* (`0039-activation-plan-of-record.md`
line 37, the OD-03 bake-off diet) — binds a product bug-fix lane like this one, which is
not Track A's OD-03 bake-off work. **Answered: it does not.** The founder accepted the
growth on this lane as it stands, measured against `origin/main` `60ed83a7`:

- `core/*.py` grew 6817→7048 lines (+231) — mostly the lifecycle bug fixes this lane made
  (a `_shutdown_event`/`cleanup()` drain fix for `NotificationAgent` and `CalendarAgent`,
  a forgotten-task-handle fix in `_drain_tasks`, a suspend-monitor `try`/`except` fix);
- every agent now holds a full local queue's broker deliveries **unacknowledged** rather
  than dropping the oldest one, so `drop_oldest_on_overflow` (`base_agent.py:221`,
  default `True`) is now read nowhere in `core/`;
- `MessageBus` gained a new public method, `stop_consuming()`.

No follow-up ADR is required for this growth. Two smaller items that rode on the same
question are left as built, not reopened by this ruling: an operator's stop still lasts
only until the next deploy or process restart, and the gateway's 60s operate-call timeout
(`AGENT_OPERATION_TIMEOUT_MS`) is not being raised further as part of this answer. Detail
and the measured line counts live in [[admin#The next build — /admin (Mudavym desk)]];
this addendum is the decision record CLAUDE.md §5 requires for it.

**ADR 0149 row 42 (founder, 2026-09-18).** A second, narrower question from the same
pass: keep the gateway's receipt read-repair (reconciling a pending
`platform_agent_operations` row against the orchestrator's own in-memory record), or drop
it. **Answered: keep it**, on the condition that a receipt says so plainly when that
record is gone — most often because the orchestrator restarted since the request was
made. Built as a caption on the affected receipt in `AdminDesk.tsx`, driven by
`agent-operations.controller.ts`'s existing `remote: "absent"` reconciliation outcome,
which was already computed but never surfaced to the reader before this pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | Aldemir | Four calls: the shared shell, the merged admin page, the sommelier routed to the real assistant, onboarding held for his pick |
| 2026-09-12 | Aldemir | Two more: the arrival is C plus the held seal plus talking; the two dev routes stay as internal legacy |
| 2026-09-12 | — | Renumbered 0140 to 0143 after a peer claimed 0140 on a pushed ref |
| 2026-09-12 | Aldemir | Three more: on-device speech keeping only the rows (closes 0113 Q6/Q7); only what Mudavym proposed waits for the seal; the auth emails renamed, OD-27 partly lifted |
| 2026-09-17 | Aldemir | Via ADR 0149 rows 32 and 35: Studio kept as an internal tool; `/login` and `/register` take the flyleaf look (sketch 118 first) |
| 2026-09-19 | Aldemir | Via ADR 0149 row 35: sketch 118 is **B, the endpaper**, and Google sign-in also goes on `/login`'s first page |
| 2026-09-16 | Aldemir | Five more, via ADR 0149 (rows 4, 7, 8, 10, 11): SimPOS kept as-is and Studio waiting on the Codex-conversation check; the public doors' treatment ratified; `support@mudavym.com` everywhere; the desk's defaults kept; the threshold on folio 2, `/onboarding` redirecting permanently to `/get-started`, and the tutorial action boxes redrawn for review |
| 2026-09-18 | Aldemir | ADR 0149 rows 41-42: the OD-03 core-line diet does not bind this product lane, growth accepted as-is; read-repair kept, on condition a gone record reads plainly |
| 2026-09-19 | Aldemir | A batch a crash stranded at `'applying'` or `'undoing'` is resumed only by the manager who sealed it — ratifies the C2 lane's existing per-user batch scoping, no code change |
