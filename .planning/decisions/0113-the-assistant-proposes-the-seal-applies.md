# 0113 — The assistant proposes the house's configuration; the seal applies it

- **Status:** **Proposed — research and design only, nothing built.** The founder asked for
  the approach, not the build: *"research this and understand how should we approach this."*
  **Two of the five open questions were answered by the founder on 2026-09-04 and are now
  binding on this ADR** — Q2, a sealed batch is revocable as one unit for seven days
  (rule 4a), and Q5, what the assistant may read (rule 6). Q1, Q3 and Q4 remain open.
- **Date:** 2026-09-03 (drafted) &middot; 2026-09-04 (survey verified, sketch 101 drawn)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** configuration assistant, settings, onboarding, propose, confirm, seal,
  hold-to-approve, batch, diff, provenance, skip, audit trail, correlation_id, MCP,
  excessive agency, ask-ai, allowlist
- **Links:** [[0013-one-commitment-guardrail]] (the line a proposal may not cross),
  [[0114-connections-are-the-houses-profile-is-the-persons]] §2 (house declares, each person
  consents — the model rule 6 applies to reads),
  [[0020-no-fabricated-answers]], [[0107-a-declared-server-is-not-a-reachable-one]] (MCP
  runtime, per-tool grant), [[0111-the-calendar-is-the-houses-day-book]] §4 (the ⌘K
  allowlist, and that widening it is a founder decision),
  [[0084-the-communications-gateway-says-what-it-did]] (a batch reports per-item outcome),
  `.planning/06-pages/DESIGN-FOUNDATION.md` §6d, `.planning/06-pages/settings.md` §13,
  `.planning/06-pages/get-started.md` §13, `.planning/08-softwares/mudavym-mcp.md` §3–§4,
  sketch `101-config-assistant/`

## Context

The founder, 2026-09-03, on whether the notification producer defaults should be offered
during onboarding:

> keep as defaults, but while onboarding they have the option to do that. + it will be game
> changer let AI assistant talk with you and handle all the configs then approval button,
> research this and understand how should we approach this

Two asks. The small one: onboarding **offers** the settings the producers and thresholds
use, and keeps the defaults if the owner skips. The large one: an assistant that
**configures the house by conversation**, ending in **one approval control**.

Nothing about this is speculative machinery. Every piece it needs exists and is proven:

- **Propose → confirm → execute** is built and shipped. `POST /ask-ai/propose` never
  executes; a human looks; `POST /ask-ai/actions/:id/confirm` executes through the owning
  service (`ask-ai/ask-ai.controller.ts:34,70`). The confirm is a **compare-and-swap** on
  the row's status, so a double tap executes exactly once
  (`ask-ai/ask-ai.service.ts:500-548`). An operator's edit is re-validated through the
  *same* allowlist and the *same* grounding check as a model proposal, "because an editable
  field is an id-injection hole the moment it is trusted"
  (`ask-ai/ask-ai.service.ts:508-512`). The allowlist is mechanical, not advisory: a
  proposal that is not exactly one of the declared shapes is **rejected, not coerced**
  (`ask-ai/ask-ai-actions.ts:1-30`).
- **The seal** is the house's ceremony for real commitment. `HoldToApprove` fires exactly
  once, nothing happens on an early release, and it says what did not happen
  (`components/mudavym/HoldToApprove.tsx:1-21`).
- **The registers** are built. `/settings` renders **fourteen** of them
  (`pages/settings/next/st-format.ts:112-146`), each declaring where it is kept —
  `restaurant`, `account`, or `browser` (`st-format.ts:31-44`).
- **The audit trail** already stores what an undo needs. `SettingsAuditService.record`
  writes `system_audit_log` with `changes: {register, subject, fields}` where every field is
  `{from, to}` (`settings-audit/settings-audit.service.ts:89-91,205-221`).

And the constraint that shapes everything is also already doctrine, written by this repo
about itself:

> `lead_time_days DEFAULT 7` means every provider row asserts a seven-day lead time from the
> moment it is created. A row reading 7 is therefore *exactly as likely* to mean "nobody was
> ever asked" as "the vendor said a week", and the row itself cannot tell the two apart.
> — `vendor-terms/vendor-terms.service.ts:47-52`

A default is an answer nobody gave. The assistant's whole risk is that it converts every
"nobody gave" into "somebody gave", in one sitting, for the entire house.

### What is measurably broken today, and why it is the same problem

`ThresholdStep`'s **"Skip for now"** calls `onDone()` and writes nothing
(`components/onboarding/ThresholdStep.tsx:80-81`). The only state it could have written is
`restaurants.threshold_configured boolean DEFAULT false NOT NULL`
(`20260805000000_baseline_from_production.sql:3597`) — a boolean that is `false` both for a
house that skipped and for a house that was never asked. So the product **cannot tell the
two apart**, which is [[absence-reported-as-health]] at the front door of onboarding.

## Options considered

The fork is the shape of the interaction, not whether to build it.

### A — one conversation, one **diff of registers**, one seal

The owner talks. The assistant reads every register, and returns one document: *here is
every value I will set, grouped by register, with the reason for each and where the current
value came from.* Each row can be dropped. One hold-to-approve applies what remains.

This is the field's dominant shape for consequential change. Terraform: a saved plan is
reviewed, then applied, and applying a saved plan runs "the operations in the saved plan
without prompting you for confirmation" — the review *was* the confirmation
(<https://developer.hashicorp.com/terraform/cli/commands/apply>). CloudFormation change
sets are executed as a unit and the failure semantics are stated up front: "CloudFormation
stops at the first failure in each independent provisioning path", and the operator then
chooses **Retry**, **Update** or **Roll back**
(<https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html>).
GitHub Copilot Workspace made the *plan itself* the editable artefact before any code is
written — its Plan view supports "Adding, editing, and deleting files" and "Adding, editing,
and deleting steps for a file"
(<https://github.com/githubnext/copilot-workspace-user-manual/blob/main/changes.md>).
Claude Code's plan mode "tells Claude to research and propose changes without making
them"; edits "stay blocked until you approve the plan"
(<https://code.claude.com/docs/en/permission-modes>).

### B — a guided interview, one register at a time, each sealed

Fourteen questions, fourteen seals. Closest to Toast's own onboarding checklist, which walks
hours → payments → menu → modules with skippable sections
(<https://support.toasttab.com/en/article/Self-Service-Guide>).

### C — fill-then-review: the assistant drafts the whole `/settings` page as pending values

Shopify Sidekick's shape. Sidekick fills fields in place and "that field is highlighted in
purple so you can easily identify what was added"; the change lands only when the merchant
presses the page's own control — "The order updates only after you review the changes and
click **Update order**"
(<https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/help-and-guidance>).

### D — do nothing; leave `/settings` as fourteen forms

Costs the founder's stated "game changer", and leaves onboarding's skip still
indistinguishable from never-asked.

## The adversarial pass — four attempts to kill A

Recording these because three of the four **succeeded partially**, and each amendment they
forced is load-bearing. A was not adopted as proposed.

**1. The seal is a per-commitment ceremony, and a 40-field batch devalues it.**
The house's own rule is that hold-to-approve is *rationed* — "bulk/routine actions get the
same die pressed dry (no wax)". One seal over fourteen registers is the EULA gesture: a
signature over text nobody read, which teaches the owner that a seal covers things they did
not read. **Partly fatal.** Amendment: the batch is capped, and the cap is not a number of
fields but a *class* — see rule 3 below. A register that already holds a **stated** value
never enters the batch; it becomes a separate, single, explicit change.

**2. Notion — the closest product in the field — forbids exactly this.**
Notion's agent can create and edit pages, databases, views, properties and relations, and
cannot "manage any workspace level settings, like member roles, billing, security features,
and more" (<https://www.notion.com/help/notion-agent>). The best-resourced team in agentic
productivity drew the line at settings. **Not fatal, but it moves the line.** Notion's line
is drawn by *blast radius* — money, and who may act — not by the word "settings". Applied
honestly to Mudavym's fourteen, the same test excludes Team, Locations, Features and
anything touching payment. It does **not** exclude the registers that encode the house's own
judgment about its own trade. That carve-out is rule 2 below.

**3. The batch cannot be transactional, so "one seal applies it" is a promise the substrate
cannot keep.** Fourteen registers are written by eight services over separate HTTP-shaped
calls; there is no shared transaction. Terraform states the same limit about itself:
"Terraform does not automatically roll back a partially-completed apply"
(<https://developer.hashicorp.com/terraform/cli/commands/apply>). A seal that completes while
three registers silently failed is the purest instance of this repo's cross-cutting fault.
**Fatal as proposed.** Amendment: the batch **never reports a single "Done"**. Every item
carries its own outcome and reason, exactly as `SettingsAuditService.record` already returns
`{recorded, reason}` rather than throwing (`settings-audit.service.ts:188-236`) and exactly
as [[0084-the-communications-gateway-says-what-it-did]] requires. Rule 4 below.

**4. The feature destroys the honesty machinery it is built inside.** If fourteen registers
are filled in one sitting, every one of them reads as *stated*, and the product's ability to
tell "nobody was ever asked" from "the owner chose this" — the rule of
`vendor-terms.service.ts:44-59` — is gone on the house's first day. **Fatal as proposed, and
the deepest of the four.** Amendment: a sealed proposal is **its own provenance class**, not
`stated`. Rule 1 below.

A survives all four only with the four amendments. That is the decision.

## Decision

**Shape A, amended: the assistant may propose a configuration batch across a named subset of
the registers; the batch is a document the owner reads and prunes; one seal applies it; the
apply is not atomic and never claims to be; and a value that arrives this way is recorded as
a third kind of value, distinguishable forever from one typed and from one nobody gave.**

Six rules carry it.

### Rule 1 — three provenance states, not two

Every register value is one of:

| State | Means | How a reader can tell |
|---|---|---|
| `unstated` | indistinguishable from its column default, no override, no stated row | today's rule, `vendor-terms.service.ts:56-59` |
| `stated` | a person typed it into `/settings` | a `system_audit_log` row with no batch id |
| `proposed_sealed` | the assistant proposed it and a person sealed it | a `system_audit_log` row carrying the batch's `correlation_id` **and** the utterance in `reason` |

The third is not cosmetic. It is what lets the assistant later say *"you sealed a 20% market
threshold from a conversation on 3 September — was that right?"* instead of treating it as a
figure a person chose deliberately. It costs **no migration**:
`public.system_audit_log.reason` exists in the baseline (`20260805000000:5564`) and
`correlation_id` was added by `20260805132000:73-75`.

### Rule 2 — the registers the assistant may propose, and the ones it may not

The test is [[0111-the-calendar-is-the-houses-day-book]] §4's, extended one notch. §4 splits
on *does this leave the house?* This ADR adds: *does this change **who may act**, or **what
the house may spend**?*

**May be proposed** (the house's judgment about its own trade — reversible, in-house,
every one already carrying an audit writer or a route that can gain one):

`vendor-terms` · `thresholds` · `notifications` · `cellar` · `calendar` (the feed) ·
`email` (the sign-off) · `measurement`\* · `map`

**May never be proposed** (a change of standing, of money, or of the rules that govern
sealing):

`team` (who works here and their role) · `locations` (the branches on the account) ·
`features` (the switches that change what the system does on its own) · `services` (what the
product may do with the owner's data, and which apps are connected) · `pos` (the till
connection — a credential, not a judgment) · `ledger` (a read-only register — there is
nothing to write) · and anything touching a payment instrument.

Eight and six account for all fourteen; no register is left unassigned.

\* `measurement` is `kind: 'browser'` (`st-format.ts:123`) — kept in localStorage only, so
**a server-side batch cannot write it at all**. It stays on the "may be proposed" side
because the assistant may propose it, but the apply happens in the client and the batch must
say so on the row. A batch that claimed to have written a browser-kept value on the server
would be a fabrication.

**One thing this ADR must not paper over.** `PUT /settings/approval-thresholds` carries
`@UseGuards(JwtAuthGuard, TenantGuard)` and **no role decorator**
(`settings/settings.controller.ts:40,107`), so any authenticated member of the tenant can
rewrite the policy that decides who may seal an order. `@Roles()` and `RolesGuard` exist
(`auth/decorators/roles.decorator.ts`, `auth/guards/roles.guard.ts`) and are used on exactly
two controllers (`auth.controller.ts`, `vendor-intel.controller.ts`). The assistant does not
create this hole, but it would make it reachable by sentence, so **the role gate is a
precondition of the batch, not a follow-up**. OWASP names this class directly: excessive
agency is "excessive functionality, excessive permissions, excessive autonomy", and
independent authorization enforcement is the mitigation, not the model's own judgment
(<https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html>).

### Rule 3 — a stated value is never in the batch

If a register already holds a `stated` value, the assistant may **contest** it but not
batch it. It appears in a separate section — *"you already answered this; I would answer it
differently, here is why"* — and changing it is its own single seal. This is the amendment
that answers kill-attempt 1: the batch is only ever a batch of **answers nobody gave**, so
the seal covers filling silence, never overwriting a person.

### Rule 4 — the batch is applied item by item and reports item by item

One `correlation_id` per batch. Each item writes through the register's own owning service —
never a bypass — so every guard those services carry still runs. Each item's outcome is
recorded, and the completion screen is a **receipt**, not a checkmark: written · refused
(with the reason) · not attempted (with the reason). A batch where every item failed and a
batch that was never applied render differently. `/logs` already reads
`system_audit_log` filtered by `correlation_id` (`logs/logs-timeline.service.ts:302`), so
**the reader for a sealed batch exists and is unfed** — `SettingsAuditService.record` does
not set the column (`settings-audit.service.ts:205-221`).

Undo is therefore a **batch undo**: read the rows with that `correlation_id`, and write each
field's `from` back through the same owning service, as a new audit batch that names the one
it reverses. Salesforce's Setup Audit Trail is the counter-example worth naming — it records
who changed what in Setup, and it "doesn't capture field-level before-and-after values", so
it can never be an undo (<https://www.salesforceben.com/setup-audit-trail-keep-track-of-metadata-changes-in-salesforce/>).
Mudavym's `changes.fields[*] = {from, to}` already does capture them. That is a real
advantage over the field and it should be spent.

#### Rule 4a — a sealed batch stays revocable as one unit for seven days (founder, 2026-09-04)

Question 2 asked whether a sealed batch belongs to the house or dissolves into ordinary
settings the moment it applies. **The founder's answer is neither extreme: it stays revocable
as one unit for a stated window.**

- The batch's `correlation_id` is written on every row it produces — the column the audit
  trail already carries and nothing has ever set (`20260805132000:73-75`;
  `settings-audit.service.ts:205-221`).
- For **seven days** from the seal, one control — *"Undo this setup"* — restores **every**
  prior value in the batch, by writing each field's stored `from` back through that
  register's own owning service, as a new batch that names the one it reverses. Not a direct
  table write, so every guard those services carry still runs on the way back.
- **After seven days each value is an ordinary setting.** The audit rows stay forever and the
  batch stays legible in `/logs` (`logs-timeline.service.ts:302`), but there is no longer a
  single control that reverses them together; changing one is changing one setting.

Two details the window forces, and both are honesty requirements rather than niceties.
**First, the window must be stated on the receipt**, with the date it ends — a window the
owner cannot see is a window they will discover has closed. **Second, an undo offered after
a value has been changed again must say so rather than silently overwriting the newer
value**: the row's current value no longer matches the batch's `to`, which means somebody
acted after the seal, and restoring `from` would erase a person's later decision to fix a
machine's earlier one. Those rows are shown and skipped by default, exactly as rule 3 refuses
to batch over a stated value in the first place.

Why a window at all, rather than forever or never. Forever makes every setting on the page
permanently provisional and gives the batch a second life long after the house has built
habits on it. Never — dissolving on apply — throws away the one advantage the survey found
nothing else has: the from-values are already stored, so the undo costs nothing to keep for a
while. Seven days is the founder's number and it is the right shape: long enough to cover
"we tried it for a week and it was wrong", short enough that nobody reverses a month of
operating decisions with one control.

### Rule 5 — the tool surface: many reads, one write, and the apply verb is never exposed

`.planning/08-softwares/mudavym-mcp.md` §3 documents 42 tools, "33 read-only, 9 write — and
every one of the 9 writes a draft, a proposal, or a record of something that already
physically happened. None sends, approves, or executes" (`mudavym-mcp.md:165-166`). This
feature fits that ladder without bending it.

| Tool | In the documented 42? | Verb |
|---|---|---|
| `settings.feature_flags` | **yes** (`mudavym-mcp.md:151`) | R |
| `cellar.registers` | **yes** (`mudavym-mcp.md:130`) | R |
| `team.members` | **yes** (`mudavym-mcp.md:150`) | R |
| `settings.registers` — all fourteen with **value + provenance state** | **new** | R |
| `settings.vendor_terms` | **new** | R |
| `settings.approval_thresholds` | **new** | R |
| `config.propose_batch` — writes a batch row, executes nothing | **new** | W (approve) |
| `config.apply_batch` | **new, and deliberately NOT exposed** | — |

The last row is the whole design in one line, and it is the pattern the MCP doc already
uses twice: `ask_ai.propose` is exposed and `ask-ai/:id/confirm` is not
(`mudavym-mcp.md:161`); `one_tap.pending` is exposed and `:214` execute is not
(`mudavym-mcp.md:162`). **The seal in a first-party Mudavym client is the only caller of
apply.** MCP's own specification arrives at the same rule from the other side — clients
SHOULD prompt for confirmation on sensitive operations
(<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>) — and Mudavym does
not rely on the client to do that, exactly as [[0111-the-calendar-is-the-houses-day-book]]
§4 already states.

### The onboarding use, which is the smallest instance of all of this

The optional step sits **after** `CellarRegistersOnboarding` and **replaces**
`ThresholdStep`, in the slot `GetStarted.tsx:256-286` already reserves. It offers the values
that have a write path today, and it is honest about the one that does not:

| Offered | Write path that exists |
|---|---|
| low-stock threshold | `menus.service.ts:707-720` (today's step) |
| cellar registers | `cellar.controller.ts:32` and its writer |
| approval ceiling + role | `PUT /settings/approval-thresholds` (`settings.controller.ts:107`) — **behind the role gate of rule 2** |
| notification channel + quiet hours | `PATCH /notifications/preferences` (`notifications.controller.ts:159`) |
| vendor terms for vendors already added | `PUT /vendor-terms/:providerId` (`vendor-terms.controller.ts:71`) |
| **market drop threshold** | **none.** It is read from the `MARKET_SIGNAL_DROP_PCT` environment variable, per deployment, not per house (`notifications/producers/market-price.producer.ts:95-97`; `market-signal.ts:93,96`). It must be **named and not offered** until a per-tenant column exists. |

**Skip semantics.** An explicit skip writes a `system_audit_log` row —
`action: 'configuration_step_skipped'`, `changes: {register, offered: [...], answered: []}`,
no setting changed. Then a skipped register reads *"offered on 3 September, skipped"* rather
than sharing an em dash with a register nobody ever mentioned, and the assistant can later
re-offer it truthfully. This is the whole content of the founder's *"keep as defaults, but
while onboarding they have the option to do that"* — the option is the fact worth recording,
not the default.

## Options rejected, and why

**B — a guided interview, each register sealed.** Rejected on two counts. Fourteen seals in
one sitting turns the seal into a Next button, which is kill-attempt 1 made worse rather than
answered. And it forfeits the only thing a conversation actually buys: the owner says *"we're
a small meyhane, we close Mondays, we buy from three vendors, I sign anything over ₺5,000"*
once and **eight registers move**. An interview re-asks per register, which is precisely what
`/settings` already is — fourteen forms with a wizard chrome on top.

**C — fill-then-review, pending values on `/settings`.** Rejected on measured facts, not
taste. Three of the fourteen registers cannot hold a pending value: `measurement` is
`kind: 'browser'` (`st-format.ts:123`), so there is no server row to stage; `features` writes
to a table with **no changed-at column at all** (`st-format.ts:54-55`: "the settings row has
no changed-at column"), so a pending→applied transition cannot be dated; and `ledger` is
read-only. C would need a `settings_pending_values` table shadowing eight services — more
machinery than the batch itself — for a worse outcome, because a page of grey pending values
is indistinguishable from a page of real ones at a glance. Shopify can afford this shape
because it highlights one field at a time in an admin the merchant already knows; a
fourteen-register first-run page is not that.

**One seal per batch with no per-row pruning.** Rejected: partial approval is the field's
settled answer, from Copilot Workspace's per-step plan editing to Cursor's review surface,
where "The diff view shows changes as they happen" and the run can be stopped and redirected
mid-flight (<https://cursor.com/docs/agent/review>). An all-or-nothing proposal teaches the
owner to reject the whole thing over one wrong row.

**Letting the assistant apply anything without the seal, on the grounds that settings are
reversible.** Rejected: an approval threshold is not reversible in the sense that matters —
between the write and the notice, orders get sealed under it.

### Rule 6 — what the assistant may read: everything the house exposes; a person's mail only by that person's consent (founder, 2026-09-04)

Question 5 asked how much the assistant may read to make a good proposal. The founder's
words:

> everything valuable, but we don't want to touch people's privacy … nowadays everyone gives
> their agents access to their mail — I say everything

Recorded as a line with two sides, not as "everything".

**The house's own record — readable, and every source named in the proposal.** The till
history, the order book, inventory and the ledger, the settings registers themselves, and the
house's vendor threads reached **through a house-declared connection**. These are the
restaurant's books; a manager reading them is doing their job, and so is the assistant. The
obligation that comes with it is disclosure, not restriction: **every proposal row names the
source it was drawn from**, so *"your ceiling should be ₺5,000"* arrives as *"…because 84 of
your last 90 orders were under it"* with the table named. A read the owner cannot trace is a
read they cannot judge.

**A person's mailbox or messages — only through that person's own consent row.** This is
[[0114-connections-are-the-houses-profile-is-the-persons]] §2's model applied unchanged: the
house **declares** the attachment, each person **consents** for themselves, and a consent is
withdrawable "without touching the attachment or anybody else's consent"
(`mcp_connection_consents`). Three consequences follow, and none of them is optional:

1. **The consent is asked for in the same conversation, in plain words, naming what will be
   read and why** — never assumed from the fact that a connection exists, and never inherited
   from a colleague's grant.
2. **The consent is recorded with the batch**, so a proposal that used a person's mail says
   so on its own face and in its audit row, forever.
3. **A withdrawn consent does not retroactively unmake a sealed value** — but it does mean
   the assistant may not re-read that mailbox, and the register still names the source the
   value came from. Absence of a current consent is never rendered as "no source".

The distinction is not "sensitive versus not". It is **whose record it is.** A vendor thread
in the house's shared inbox is the house's correspondence about the house's money. The same
person's personal mailbox is theirs, and the fact that it may contain the same invoice does
not transfer ownership of it. This is the identical test §6b used to place connections and
rule 2 used to draw the assistant's write surface, applied a third time to reads.

The founder's *"I say everything"* is honoured on the house's side without qualification, and
the *"we don't want to touch people's privacy"* half is what makes the person's side a
consent row rather than a setting. OWASP names the failure this avoids as excessive
permissions — "a generic high-privileged identity" standing in for an individual user's
scope (<https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html>).

## Consequences

- **Easier.** A house that answers five sentences ends onboarding with eight registers
  stated rather than defaulted, and every one of them carries the sentence that produced it.
  `/settings` gains a truthful third provenance state instead of a binary. The `/logs`
  timeline's `correlation_id` filter finally has rows to filter.
- **Harder / given up.** The role gate on `PUT /settings/approval-thresholds` becomes
  blocking work before any of this ships. Six registers are permanently out of the
  assistant's reach, and that will look arbitrary to anyone who has not read rule 2. The
  batch apply needs per-item outcome plumbing through eight services, which is the bulk of
  the engineering. Rule 4a adds a seven-day undo path that must handle the changed-since case
  honestly rather than overwriting it, and rule 6 adds a consent prompt inside a setup
  conversation, which is the one place a person is least inclined to read carefully.
- **Revisit when:** a seventh register needs to move from "may never be proposed" to "may be
  proposed" (the rule is wrong, not the register); or a sealed batch is ever undone by an
  owner more than once in a house's first month (the proposal is being read as a formality,
  which means the diff is too long); or an owner asks to undo a batch **after** the seven days
  have run (the window is too short, and that request is the only evidence that would show
  it).

## Questions only the founder can answer

1. **Voice, or typing?** *"let AI assistant talk with you"* — literally talk? On the phone
   (`apps/mobile`) a voice-first setup is plausible; on desktop it is a novelty. The sketch
   draws typing.
2. ~~**Does the batch belong to the house or to the person?**~~ **ANSWERED 2026-09-04 —
   revocable as one unit for seven days, then ordinary settings.** See rule 4a. The
   `correlation_id` the audit trail already carries is what makes it one unit.
3. **Rule 2's line.** `features` is excluded because those switches "change what the system
   does on its own" (`st-format.ts:127`). Is that the founder's line too, or should the
   assistant be able to propose turning autonomy *on* — with the seal — as the natural end
   of a setup conversation?
4. **The market drop threshold** is per-deployment today. Is per-house worth a column and a
   migration, or is one number for every house correct for now?
5. ~~**How much may the assistant read to make a good proposal?**~~ **ANSWERED 2026-09-04 —
   everything the house exposes, with every source named; a person's mailbox only through
   that person's own consent row.** See rule 6.

**Still open after the 2026-09-04 calls: 1, 3 and 4.** On 1, the working assumption is
**typing first** and voice on mobile **left undecided** — the sketch draws typing and nothing
in this ADR depends on the answer. On 3, `features` **stays outside the line** unless the
founder says otherwise; rule 2 is written that way and the question stays filed rather than
closed.

## Review trail

- 2026-09-03 — drafted from the founder's note of the same day. Cut short by the weekly API
  limit before the survey was verified and before the sketch existed.
- 2026-09-04 — **completed.** Field survey of fifteen products and specifications recorded in
  `DESIGN-FOUNDATION.md` §6d, every row carrying a URL; six were fetched and read in full and
  are the quoted rows. **Three citations written from search summaries did not survive that
  check and were corrected** — a Claude Code plan-mode URL that 404s, a CloudFormation
  sentence that is not on the page cited, and a Cursor keyboard quote absent from its own
  docs. Every repo claim re-verified on `feat/mudavym-design-p4`; five line references were
  off by one to three lines after the `origin/main` merge and were corrected. Sketch
  `101-config-assistant/` draws the conversation, the proposal with the seal and the receipt,
  and the onboarding step — 8 screenshots at 1440, both grounds, `scrollWidth === 1440` and
  zero console errors on all eight.
- 2026-09-04 — **two founder calls recorded**, both from the same session as the ADR. Q2 is
  answered by rule 4a (seven-day batch revocation on the `correlation_id`); Q5 is answered by
  rule 6 (the house's record without qualification, a person's mailbox only by that person's
  consent row, per [[0114-connections-are-the-houses-profile-is-the-persons]] §2). Q1 and Q3
  were touched in the same session and **deliberately left open** — typing first with voice
  undecided, and `features` staying outside the line unless the founder moves it.
  **Nothing built** — no file under `apps/`, `supabase/` or `services/` was changed.
