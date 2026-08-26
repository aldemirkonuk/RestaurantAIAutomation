---
type: page
route: /promotions
slug: promotions
component: apps/web/src/pages/Promotions.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[orders]]"]
---

# /promotions — vendor offers, trusted senders, prospects

## Surface — buttons → where they go

- **Apply to a new order** (row menu + detail) → [[orders]] `/orders?new=1&promo=<id>`
- **Copy code** → clipboard
- **Dismiss** → (local only — dismissed ids persist in localStorage, 8s undo)
- **Attachment** (prospect detail) → external vendor URL

## 1. Purpose
Three tabs (`Promotions.tsx:20`): **Offers** — promotions the AI extracted from vendor
email; **Trusted senders** — sender reputation + trust toggles that skip the spoof
quarantine; **Prospects** — cold outreach from vendors not yet added, with
promote/dismiss/restore. Page subtitle states exactly this (`Promotions.tsx:58-60`).

## 1a. Features
- **Offers** tab: promotions the AI extracted from vendor email; dismiss with an undo window (🚧 dismissal is per-device only; supply pipeline still in shadow mode, so empty is the expected state)
- **Trusted senders** tab: sender reputation + trust toggles that skip the spoof quarantine
- **Prospects** tab: cold outreach from vendors you haven't added — promote, dismiss, restore; view attachments
- Keyboard 1/2/3 switches tabs; export menu; multi-branch prospect fetch

## 2. Entry
Sidebar item (`components/layout/Sidebar.tsx:93`). PAGE_MAP's entry-point list claims
no inbound link — **stale**: the graph cannot trace nav items defined in a data array
(PAGE_MAP's own "unresolved route components" caveat), and this page's link lives in
one. Tab deep-links via `?tab=senders|prospects`
(`Promotions.tsx:23-33`).

## 3. Files
- Route: `apps/web/src/App.tsx:275` → `pages/Promotions.tsx` (795 lines, tabs inline)
- Hooks: `hooks/queries/usePromotionsQueries.ts`
- `components/layout/RestaurantBranchSwitcher.tsx`, `components/ui/ExportMenu.tsx`

## 4. Endpoints
- `GET /providers/promotions/active` (`usePromotionsQueries.ts:22`; ENDPOINTS.md:456)
- `GET /senders/reputation` (`:45`; ENDPOINTS.md:141)
- `POST /senders/trust` (`:55`; ENDPOINTS.md:142)
- `GET /prospects` (`?scope=all` when multi-location, `:98`; ENDPOINTS.md:130)
- `GET /prospects/:id/attachments` (`:108`; ENDPOINTS.md:131)
- `POST /prospects/:id/promote | /dismiss | /restore` (`:118-139`; ENDPOINTS.md:132-134)

## 5. Signals
none.

## 6. Tier cut
Core — S13's "Prospects digest" Core row; the Offers tab is S08-adjacent (drift is
priced from the same vendor mail). See TIER-MAP S13/S08.

## 7. Rebrand surface
none user-visible. (`wineops.promos.dismissed` is a localStorage key,
`Promotions.tsx:101` — §8.)

## 8. State & config
- Offer dismissal is **local-only by design**: "There is no promotions-dismiss
  endpoint, so this is a local preference … with an undo window"
  (`Promotions.tsx:113-117`), persisted at localStorage `wineops.promos.dismissed` (`:101`)
- Keyboard 1/2/3 switches tabs, NEW-352 (`Promotions.tsx:36-47`)
- Multi-location: prospects fetched across branches when >1 restaurant (`:27-28`)

## 9. Gaps
- Local-only dismissal does not sync across devices/users — a deliberate cut (§8), but
  undocumented to the user.
- `v3.0-TECH-DEBT.md:500` — "L187 Promotions non-interactive" is **partly stale**;
  `onDismiss` is wired. Remaining 44.15 entries unverified.
- Offer supply depends on the inbound-email extraction pipeline, which shipped Phase 0
  in shadow mode with `provider_promotions` still dormant (memory:
  `inbound-email-intelligence-plan.md`) — an empty Offers tab is the expected state
  until that wakes. **⚠️ Stale as of 2026-08-26** — see §10: the D3 lane is wired and
  writing.

## 10. Maturity

**partial.** All three tabs read live, producer-backed data through the authenticated
client; the one gap is that offer dismissal is a per-browser preference.

| Evidence | `path:line` |
|---|---|
| **`provider_promotions` is no longer dormant.** The D3 promotions lane runs on *every* provider-matched inbound email: a cheap deterministic pre-filter, then `extractPromotion` (no LLM), dedup on `conditions.signature`, insert, and notify. Wired unconditionally in the inbound bridge. This supersedes §9's carried claim and the note in memory `inbound-email-intelligence-plan.md`. | `common/orchestrator/promotion-extractor.service.ts:37-60,124`; wiring `rabbitmq-bridge.service.ts:789-799`; enum contract `common/orchestrator/promo-extract.ts:8-11` |
| A 09:00 daily digest groups the last 24h of digest-bucket promos per restaurant and notifies. | `promotion-extractor.service.ts:179-215` |
| **Prospects are producer-backed** — `email_prospects` rows are inserted by the D1 lane for unattributed cold outreach, and promote/dismiss/restore are real server writes. The operator-only `/triage` route is correctly gated by a `PLATFORM_ADMIN_USER_IDS` allowlist rather than a tenant role. | `common/orchestrator/prospects.service.ts:220`; controller `prospects.controller.ts:17-56` |
| **Trusted senders write through** — `sender_reputation` is upserted by the triage path and `POST /senders/trust` persists the toggle. | `common/orchestrator/sender-reputation.service.ts:65,143`; `sender-trust.controller.ts:18` |
| **Every call uses `apiClient`**, so all nine endpoints carry the bearer token — notably *unlike* [[recommendations]] and [[recommendations-catalog]]. | `hooks/queries/usePromotionsQueries.ts:2,22,45,55,97,108,118,130,139` |
| **Offer dismissal never leaves the browser.** `wineops.promos.dismissed` in localStorage with an 8s undo — deliberate and commented, but it means a manager who clears an offer has not cleared it for anyone else, or for themselves on another device. | `Promotions.tsx:101,113-117` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/providers/promotions/active` | JWT (class) | `providers/provider-intelligence.controller.ts:104` → `provider-intelligence.service.ts:135` | active `provider_promotions` rows |
| GET `/senders/reputation` | JWT | `common/orchestrator/sender-trust.controller.ts:18` | per-sender reputation + trust state |
| POST `/senders/trust` | JWT | same | upserts the trust flag; skips spoof quarantine on future mail |
| GET `/prospects` (`?scope=all` when multi-location) | JWT (class) | `prospects.controller.ts:33` → `prospects.service.ts:141,338` | cold-outreach rows, each carrying `restaurant_id` for chip filtering |
| GET `/prospects/:id/attachments` | JWT | `prospects.controller.ts` | attachment refs |
| POST `/prospects/:id/promote` · `/dismiss` · `/restore` | JWT | `prospects.controller.ts` → `prospects.service.ts:268,289,385` | `{ promoted, providerId, reused }` etc. — promote creates a real provider |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| **Offers** | D3 lane on every provider-matched inbound email — deterministic extraction, no LLM, deduped by signature | `promotion-extractor.service.ts:37`; `rabbitmq-bridge.service.ts:789` |
| Offer digest | `@Cron(EVERY_DAY_AT_9AM)` rollup + notification | `promotion-extractor.service.ts:179` |
| **Prospects** | D1 lane — inbound mail from senders matching no known provider | `prospects.service.ts:220` |
| **Trusted senders** | triage upserts reputation as mail arrives | `sender-reputation.service.ts:65,143` |
| Upstream of all three | Postmark inbound webhook → RabbitMQ → bridge | `rabbitmq-bridge.service.ts` |

All three tabs have live producers. The shared dependency is inbound vendor email: a
restaurant whose vendors do not email it has three legitimately empty tabs.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Trust a sender | `sender_reputation` | future inbound skips spoof quarantine; changes triage priority (`common/orchestrator/priority.ts`) |
| Promote a prospect | `providers` (reuses an existing row when matched) | [[providers]] roster, [[orders]] vendor picker |
| Dismiss / restore a prospect | `email_prospects.state` | the prospects list |
| **Dismiss an offer** | `localStorage` only | nothing — per-browser (§10) |

## 12. Design intent

**Should be:** everything a vendor sent that is worth money or worth trusting, in one
place — offers to act on, senders to vouch for, strangers to evaluate.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query per tab |
| empty | ✅ | each tab has its own empty copy; correct behaviour given the shared email dependency |
| error | ⚠️ partial | mutations surface failures via react-query; list errors fall back to empty |
| permission-denied | ⚠️ split — the operator-only `/triage` route is correctly allowlisted server-side; the three tenant tabs have no client-side role gate | `prospects.controller.ts:17-23` |

**Where the UI misleads:** dismissing an offer looks like a team action and is a browser
action. §8 documents the cut; the *user* is not told. Two managers will see different
offer lists and neither will know why.

## 13. Roadmap

1. **Correct the stale "dormant" record** — §9 here, the memory file
   `inbound-email-intelligence-plan.md`, and anything in `.planning/` that budgets for
   waking `provider_promotions`. The lane is live; planning against a dormant table wastes
   a milestone. *This dossier's §10 is the correction; the memory still needs updating.*
2. **Add a promotions-dismiss endpoint** so the Offers tab stops diverging per browser.
   The table and controller exist; this is one column and one route.
   *Blocker: none.*
3. Until (2) lands, **say so in the UI** — "dismissed on this device" is one line of copy
   and removes the misleading part immediately.
4. Add an error state to the three list queries so a failed fetch is not rendered as
   "no offers".
5. Verify the remaining 44.15 entries against the real page rather than the catalog
   (`v3.0-TECH-DEBT.md:500`) — `onDismiss` was already found stale.
6. Emit signals: promote/dismiss on a prospect is the highest-intent action on the page
   and nothing records it (§5).
