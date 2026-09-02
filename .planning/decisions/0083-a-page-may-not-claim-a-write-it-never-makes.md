# 0083 — A rebuilt page may not claim a write it never makes, nor call a failure a wait

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder)
- **Keywords:** communications, templates, persistence, save, no-op, tenant key, query key, cache, failure, latency, em dash, SMS, honesty, page rebuild
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0020-no-fabricated-answers]], [[0045-mudavym-page-rebuild-wave]], `.planning/06-pages/communications.md`, PR — `fix/communications-page`

## Context

The `/communications` rebuild (`apps/web/src/pages/communications/next/`) was
audited against [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) and five
defects were verified. Four are that ADR's clauses violated in a new place. The
first is a class 0051 did not name, because the dashboard that forced 0051 had
no writes at all.

**1. The page asserted a persistence it did not have.** `TemplateSheet.tsx:85`
read *"Saving stores it for later; sending always happens from a conversation."*
Both builders were mounted with `onSave={onClose}` (`:106,108`) — the template
object was handed to a function that ignores its argument. Neither builder
writes: `GmailTemplateBuilder.handleSaveTemplate` (`:482-537`) made no network
call and touched no storage, and `SMSTemplateBuilder` said so in a comment
(`// Simulate save delay`, `:378`). Both then set `saveSuccess` and closed on a
1500 ms timer. Pressing Save showed a green tick and discarded the work.

The legacy page has the same no-op **and does not claim otherwise**, so this was
a regression the rebuild introduced — an untruth in prose laid over an existing
gap. It is also the first defect of its kind found in this wave: 0051's five
clauses all govern what a page *displays*, and every one of them was satisfied
here. A sentence about what a *button* does was outside the rule.

**2 and 3. Two caches were not keyed by tenant, and that matters more here.**
`useProcurementConversationHistory` used the constant key
`['procurement','history']` (`useConversationQueries.ts:284`); the schedules
query used `['report-schedules']` (`useCommsNextData.ts:43`).
`useConversationThreads`, in the same file, gets this right (`:193`) with a
comment explaining why — so the rule was known and applied unevenly.

The aggravating fact: **the gateway never reads the `X-Restaurant-Id` header**
the client stamps (`services/api/client.ts`). A repo-wide grep finds that header
only in test fixtures. `procurement.controller.ts:737` scopes the history from
`user.restaurantId` on the JWT alone. So scoping depends entirely on a re-minted
token — and `AuthContext.tsx:433` catches a **failed** switch and proceeds,
logging that it will continue "with X-Restaurant-Id header only", a fallback the
gateway does not implement. A failed switch plus a constant key renders the
previous tenant's conversation book under the new tenant's name, with no banner.

**4. A permanent failure was rendered as latency.** `schedulesKnown =
schedulesQ.data !== undefined` (`useCommsNextData.ts:94`) cannot tell a failure
from a request in flight, so the rail printed *"The schedule list hasn't
answered yet — —"* (`CommunicationsNext.tsx:366-368`) **forever**:
`public.scheduled_reports` is created by no migration in `supabase/migrations/`,
and a later migration names it as one of five tables that lived outside that
directory and production never saw
(`20260826170000_integration_oauth_tables.sql:26`). The endpoint 500s every
time. The **legacy page got this right and the rebuild deleted it**:
`Communications.tsx:269,293-299` holds a separate `schedulesError` and says
*"Saved schedules could not be loaded, so this list is not a record of what
exists"*, under a 12-line comment citing the same production verification.

**5. The error banner covered one query of five.** `isError: historyQ.isError`
(`useCommsNextData.ts:96`). `threadsQ`, `activeQ`, `schedulesQ` and `gmailQ` had
no failure surface, so each failure rendered as the em dash 0051 reserves for
"has not answered". "Try again" was reachable only when the history failed, so
it could never retry the other four.

**6. The SMS line described a channel nothing can reach.**
`CommunicationsNext.tsx:333-335` said SMS templates *"stage for the messaging
channel"*. All 27 production `procurement_conversations` rows are
`channel='email'`; `POST /communications/sms` exists in the gateway but a
repo-wide grep over `apps/web` finds **zero** callers.

## Options considered

**For the template claim (defect 1):**

1. **Delete the sentence, leave the no-op.** Cheapest and immediately honest —
   it is what legacy does. Leaves a Save button that silently destroys work,
   which is a worse experience than the sentence was, and leaves the feature
   dead in a page the wave is supposed to be finishing.
2. **Wire Save to the existing server store.** `POST /restaurants/:rid/templates`
   already exists, is JWT-guarded, and `useTemplates.createTemplate`
   (`hooks/useTemplates.ts:22-31`) already calls it. Makes the sentence true.
   Costs a shape decision, because the server's shape is much narrower than the
   builders' (below), and costs touching two shared builder components.
3. **Build a template store that matches the builders.** A migration adding
   panels/thumbnail/category columns, or a JSON document table. Correct in the
   long run; a schema decision the founder has not made, and far outside a
   five-defect page fix.

**For the SMS workshop (defect 6):**

1. **Remove it until a sender exists.** Honest by subtraction; deletes a
   workshop that, once Save works, does something real.
2. **Keep it, and say plainly what it is.** Requires the copy to name the
   absence rather than imply the channel.

**For the failure surface (defect 5):** per-figure failure sentences, versus one
banner that names every failed source with a per-figure mark. Four sentences
inside a strip built to be scanned would bury the distinction they exist to
draw.

## Decision

**A rebuilt page may not claim a write it never makes.** The claim and the
behaviour are fixed together, and where they cannot both be had, the claim goes.
Concretely, extending [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) with
a sixth clause:

> **A statement about what an action does is a claim, and is bound by the same
> rule as a displayed figure.** A page may not say a control persists, sends,
> schedules or deletes unless it does. A confirmation may not precede the
> outcome it confirms: a success state renders only after the write has been
> accepted, and a rejection is said in words and does not close over the work.

Applied to the six defects:

- **P1 — wired, option 2.** `TemplateSheet` now posts through
  `useTemplates().createTemplate`. Both builders `await onSave(...)` inside a
  try/catch and set `saveSuccess` only after it resolves; a rejection leaves the
  builder open with the work intact and the sheet's own banner says why. The
  fake `// Simulate save delay` is gone — the wait is the real request.

  **What is stored, exactly**, because the server's shape is narrow and the
  global pipe is `whitelist: true, forbidNonWhitelisted: true` (`main.ts:52-56`)
  so posting the builder's own object would 400 on every field the DTO does not
  model. `communication_templates` holds `name`, `subject`, `body`, `type` and
  nothing else. So: SMS stores the message text verbatim and lossless; email
  stores the panel structure as JSON in `body`, which keeps the author's work
  rather than discarding it. There is **no re-open round trip** — the builder is
  never handed a stored template back — and the banner does not pretend
  otherwise. The only gateway reader of this table filters
  `type='sender_identity'` (`procurement.service.ts:2697-2703`), so these rows
  cannot reach the outbound send path.

  The sentence *"You are editing a saved template"* also went: the sheet never
  passes `editingTemplate`, so the builder always opens on a new, unsaved one.

- **P2 — both keys carry the tenant**, matching the sibling hook that already
  did. `procurementHistoryKeys.all` survives as an invalidation prefix only.
- **P3 — `schedulesError` restored** as a state distinct from "not yet
  answered", with the legacy page's sentence and its reasoning.
- **P4 — one banner, five sources.** The banner names every failed source in
  words; each figure carries `data-state` and an accessible name distinguishing
  *failed* from *has not answered*; and "Try again" now refetches all five,
  including the Gmail status it previously could not reach.
- **P5 — kept, relabelled (option 2).** Once Save works, the SMS workshop
  genuinely stores a template, so removing it would delete a working feature
  along with a false claim. The copy now states that no SMS sender is reachable
  from this page and that every recorded conversation is email.

**The rule is held by a command, not a reviewer.**
`scripts/check_windowed_figures.py` gains `/communications` as its third page
and a new **W7**: a page declares the shared query hooks its cache actually
lives in, by function name, and the guard checks their keys too. W6 reads only
the page's own files, and this page's largest bucket
(`useProcurementConversationHistory`) lives in a shared hooks file W6 can never
see — a green W6 here would have been a tick over the defect.

Extending the guard exposed **two vacuities in its existing rules**, both
measured by deleting the `≥` from the live strip and watching it print *clean*:
the floor-marker test was a substring match, so `MERGE` (in this page's own
header) and `GET` satisfied a marker of `GE`; and once matched as an identifier,
a leftover `import { GE }` satisfied it after every use was gone. Markers are
now matched as identifiers with imports stripped, which hardens `/receipts` too.
The key matcher also learned key factories and shared key constants
(`queryKey: someKeys.forRestaurant(rid)`), which it previously could not see at
all — the same vacuity class as the `useQuery<T>({` bug a prior extension found.

## Consequences

- **Easier:** the honesty rule now covers verbs, not only nouns. "Does this
  button do what the page says it does" becomes the same yes/no test as "is this
  figure measured", and W7 means a page's cache correctness no longer depends on
  where its hooks happen to live.
- **Harder / given up:** an email template's panel layout is stored as JSON and
  is **not re-openable in the builder**. Saving an email template and coming
  back to edit it is not a flow that exists; the row is a record, not a document
  the workshop can reload. That is stated in the sheet and recorded here rather
  than papered over, and it is the honest limit of the store that exists today.
- **Given up:** this page now issues one write. It previously issued none, and
  that property was worth naming — but the write is user-initiated, confined to
  the explicit Save action, and reports its own outcome. Nothing about rendering
  the page writes anything.
- **Not fixed here, and owned elsewhere:** the history endpoint admits six
  statuses of which only `SENT` and `APPROVED` occur, so **15 of 27 production
  conversations are invisible**, including every inbound reply. That is a
  gateway change and belongs to the sibling working `apps/api-gateway/**`; no
  test written here pins the current exclusion.
- **Revisit when:** a founder decision defines what a stored email template is —
  then the choice is whether to give it a real document store with a re-open
  round trip, not whether the current one is honest about its limits.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir | Locked with the page fix; 0051 extended with a sixth clause covering claims about actions |
