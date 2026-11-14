# 0357 — Letter Bench v4 is the house mail terminal

- **Status:** Proposed (the founder's five answers of 2026-11-02 are recorded below; only the template-migration fork is open, and no build step waits on it)
- **Date:** 2026-11-02
- **Decider:** Aldemir (founder)
- **Keywords:** communications, letter bench, designs, blocks, filed, inbox, endpoints, rollout
- **Links:** [[0083-a-page-may-not-claim-a-write-it-never-makes]], [[0118-the-house-writes-its-own-mail]], [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]], [[0173-communications-is-a-catalogue-with-slot-editing]], [[0174-email-is-a-paper-sheet-and-the-house-signs-it]], [[0180-house-mail-is-a-composition-grammar]], [[0260-communications-walk-through-r2-rulings]], [[0264-event-prep-mail-is-off-until-the-founder-arms-it]], [[0266-an-orders-vendor-letter-is-staged-once]]

## Context

On 2026-11-01 the founder ruled that Letter Bench v4 (a design sandbox, Downloads) replaces
what `/communications` shows. v4 is an inline-script prototype with simulated delivery. Its
data is invented: three vendors, three orders, 118 days of generated history, canned vendor
replies. Nothing it shows is real until a gateway endpoint backs it (ADR 0083).

Measured on `main` 2026-11-02 (agent inventory, not fully traced): the gateway already
queues letters with undo, drafts, discards, cancels, lists the address book, and stores flat
templates (`subject` + plain `body`, five categories). It reads replies into
`procurement_conversations` with no HTTP inbox controller. It has per-house archive/export.
Web: `/communications` is `PageGate page="communications"` over `CommunicationsNext`.

## Founder answers, 2026-11-02

1. **Rollout: keep ADR 0131.** The founder first answered "replace `next` for all houses", saw
   it conflicts with ADR 0131 and ADR 0260's follow-up ruling, and chose to keep 0131 (dark on
   merge, then one house at a time; flag only after one house's end-to-end Gmail). Nothing is
   superseded.
2. **Insights and Reports wait for real data.** No example history, ever. Later PR.
3. **Staff see designs, filed letters and the inbox read-only.** Enforced by gateway roles.
   The "Viewing as" switch is not shipped; the page shows the caller's real role.
4. **Ask Mudavym is in scope now.**
5. **Storage: new tables.** Designs live in `letter_designs` (draft blocks, look, purpose,
   name) and `letter_design_versions` (published snapshots). `communication_templates` is
   not extended: it stays flat (`subject` + plain `body`) and keeps serving old sends.
   Rejected: adding blocks to `communication_templates`. It would put block JSON and
   versioning on a table that five send paths read as plain text, so every one of them
   would have to learn to ignore or render blocks.

## Endpoint map

"Exists" means on `main` today. "New" needs a PR. Roles: M = owner/manager, A = any member.

| v4 control | Backing | Status |
|---|---|---|
| Design: designs rail, create from starter | `GET/POST /communications/designs`; table `letter_designs` (draft blocks JSON, look, purpose, name) | New |
| Design: block library, "/" menu | `GET /communications/blocks`: the 12 base block types and variants (ADR 0180 grammar) | New |
| Design: edit, autosave, undo | `PATCH /communications/designs/:id` (M); undo is client-side | New |
| Design: publish, versions, restore, duplicate, delete | `POST .../publish`, `GET .../versions`, `POST .../restore`, `POST .../duplicate`, `DELETE`; table `letter_design_versions` | New |
| Design: preview with order, health checks | `POST .../preview {orderId}` renders merge fields from the real order; `health` returned with it. The promise-to-buy guard already exists on send (422) | New (guard exists) |
| Design: merge-field catalogue | Part of `GET /communications/blocks` | New |
| Design: Ask Mudavym | `POST .../ask` through the orchestrator (ADR 0120: model comes from the task); cleaned to allowed blocks and fields; section-based fallback when no model | New |
| Send: letter, vendor, order, you-write / Mudavym-drafts | `GET /letters/sender`, `/book`, `/templates`, `POST /letters` (202, undo) | Exists; add `designId` + version snapshot |
| Send: guards (one live letter per order, empty field) | ADR 0266 door RPC for orders; field check in preview | Exists / New |
| Send: journey (written, left, sent, opened, replied) | `GET /communications/letters/:id/journey` stitching `relay_email_queue` + `procurement_conversations` status. No open tracking exists, so "opened" is not shown (ADR 0083) | New |
| Send: pull back | `POST /communications/email/:id/cancel`, `POST /letters/:id/cancel` | Exists |
| Send: invitations (guest, vendor, team), RSVPs | Event-prep mail is off until the founder arms it (ADR 0264) | No backing, left out |
| Filed: list, flow counts, filters | `GET /communications/letters/filed?status=` with per-stage counts | New |
| Filed: drawer, timeline, technical record | `GET /communications/letters/:id` | New |
| Filed: discard | `POST /letters/:id/discard` (M) | Exists |
| Filed: clear the sandbox | Not shipped. It deletes mail | Dropped |
| Inbox: waiting on you | `GET /letters/drafts` (M), `GET /conversations/pending/list` | Exists |
| Inbox: approve and send | `POST /conversations/:id/approve` (M, sealed; ADR 0167 credit-claim rule) | Exists |
| Inbox: vendor offers, Answer | Mirrored replies via `GET /conversations`; Answer opens Send as a promotion reply | Exists (shape check owed) |
| Inbox: KPIs, 7-day chart, by-vendor | `GET /communications/inbox/kpis` computed from real rows. `conversations/stats/overview` returns an unverified shape | New |
| Header: Live toggle, ticker | Simulated events only. Not shipped | Dropped |
| Header: Activity feed | `GET /communications/activity` from `system_audit_log` | New |
| Insights, Reports, Monday report | Deferred by answer 2 | Later |

## Build order (each PR 15 files or fewer, each through the ADR 0090 gate)

1. This ADR and README row (own PR). 2. Designs: migration, CRUD, blocks, publish, versions.
3. Design tab UI with self-hosted fonts and Mudavym tokens. 4. Send tab and journey.
5. Filed tab. 6. Inbox tab and KPIs. 7. Ask Mudavym. 8. Insights and Reports.

## Open (the founder's call)

- **Template migration.** Whether and how the existing flat templates become designs is not
  decided here. Build step 2 does not touch them, so nothing waits on it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-02 | — | Drafted from two agent inventories; nothing built |
| 2026-11-02 | founder | Rollout: keep ADR 0131 |
| 2026-11-02 | founder | Storage: new `letter_designs` + `letter_design_versions` tables |
