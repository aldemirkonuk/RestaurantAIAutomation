---
type: page
route: /studio/certify
slug: studio-certify
softwares: [wine-studio]
component: apps/web/src/pages/studio/StudioCertify.tsx
audience: dev
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 1
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-queue]]"]
---

# /studio/certify — certified contributors admin

> **Part of** [[08-softwares/wine-studio|Wine Studio]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Studio** (header) → [[studio]] `/studio`
- **Queue** (header) → [[studio-queue]] `/studio/queue`
- **Invite contributor** → (modal — InviteDialog) → API `POST /api/v1/studio/invite`
- **Revoke** → API `PATCH /api/v1/studio/contributors/:userId/revoke`
- **Enable / Disable** → API `PATCH /api/v1/studio/contributors/:userId/enable|disable`

## 1. Purpose
Manage the certified-contributor roster: invite (single-use link), revoke, and
enable/disable contributors who feed the studio ingestion pipeline.

## 1a. Features *(internal admin)*
- Certified-contributor roster table
- Invite a contributor with a single-use link
- Revoke, enable, or disable a contributor

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list) except the studio header's
"Certify" link, rendered only for review_admin/developer (`StudioLayout.tsx:58-67`).
Route gate: `requiredStudioRole={['developer','review_admin']}` (`App.tsx:184-191`).

## 3. Files
- Route: `apps/web/src/App.tsx:184-191` → `pages/studio/StudioCertify.tsx` (91 lines)
- `pages/studio/certify/ContributorTable.tsx` (194), `InviteDialog.tsx` (152)
- Shell: `pages/studio/StudioLayout.tsx`

## 4. Endpoints
- `GET /api/v1/studio/contributors` — 60s poll (`StudioCertify.tsx:16,24-28`)
- `PATCH /api/v1/studio/contributors/:userId/revoke` (`StudioCertify.tsx:33-36`)
- `PATCH /api/v1/studio/contributors/:userId/enable|disable` (`StudioCertify.tsx:41-44`)
- `POST /api/v1/studio/invite` (`certify/InviteDialog.tsx:31`)
Server: orchestrator `studio_routes.py:483` (invite), `:760` (contributors),
`:789-` (revoke/enable/disable PATCHes). Not in the gateway atlas — same routing gap
as [[studio]] §9.

## 5. Signals
none.

## 6. Tier cut
Outside the tier axis — internal admin for the S06/S17 data-supply chain.

## 7. Rebrand surface
1 — shared "WineOps Studio" header (`StudioLayout.tsx:33`).

## 8. State & config
Studio role gate (§2); Bearer token from localStorage (`StudioCertify.tsx:10-13`).

## 9. Gaps
- ~~Same **/api routing gap** as [[studio]] §9~~ — **closed for this page 2026-08-26**
  ([ADR 0021](../decisions/0021-studio-invites-are-self-service.md)): `StudioProxyController`
  forwards `/api/v1/studio/*`, so all four §4 calls now resolve.
- `handleRevoke`/`handleToggleEnable` don't check the response status
  (`StudioCertify.tsx:32-46`) — a failed PATCH still invalidates the query and looks
  like success (the "reachable code that does nothing" failure mode named at
  `v3.0-TECH-DEBT.md:53-56`).

---

## 10. Maturity — **broken**, and the least honest of the three studio pages

Four calls, four 404s, and the page presents every one of them as success or emptiness.

- All four are bare relative fetches — contributors `StudioCertify.tsx:16`, revoke `:33`,
  enable/disable `:41`, invite `certify/InviteDialog.tsx:31`. Relative `/api/v1/*` goes
  to the NestJS gateway (`apps/web/vite.config.ts:24-27`; `vercel.json:7-10`), which
  mounts under `api/v1` (`apps/api-gateway/src/main.ts:77`) and has no studio
  controller. [[studio]]'s `CommandBar` got the orchestrator base URL
  (`CommandBar.tsx:42`); this page did not.
- **The failed load renders as an empty roster.** `useQuery` here destructures only
  `{ data, isLoading }` (`:24`) — there is no `isError` branch, so a 404 falls through
  to "No certified contributors / Invite trusted contributors using the button above"
  (`:69-78`). That is the contract's *hollow* failure mode inside a *broken* page: it
  looks like a fresh install rather than a dead endpoint. Compare [[studio-queue]],
  which does branch on `isError` (`StudioApprovalQueue.tsx:77-82`).
- **Revoke reports success on a 404.** `handleRevoke` awaits the fetch without checking
  `resp.ok` (`:32-38`), so it never throws; the caller's `try/catch` therefore takes the
  success path and fires `toast.success('Contributor revoked')`
  (`certify/ContributorTable.tsx:50-53`). The confirm dialog, the destructive-action
  copy and the green toast are all real; only the write is not. `handleToggleEnable`
  (`:40-46`) has the same shape with no toast at all.
- **A second, independent defect that survives the routing fix: the invite link goes
  nowhere.** The dialog builds `${APP_URL}/studio/invite/${token}`
  (`InviteDialog.tsx:23-25`), but no such route exists — `App.tsx` registers only
  `/studio`, `/studio/queue`, `/studio/certify` (`App.tsx:167,177,185`), so the link
  hits the catch-all and redirects to the dashboard (`App.tsx:307`).
- **A third: the redemption endpoint cannot be used by the person being invited.**
  `POST /api/v1/studio/invite/redeem` is gated by
  `require_studio_role("developer", "certified_contributor", "review_admin")`
  (`api/studio_routes.py:517-521`) — you must already hold a studio role to accept the
  invite that grants you one. The invite flow is unshippable as specified even with
  perfect routing.
- Server side is otherwise complete: invite issue (`studio_routes.py:483`), contributor
  list (`:760`), revoke (`:791`), enable (`:812`), disable (`:1025`).

## 11. Data flow

**Calls out**

| Method | Path | Auth | Server | Returns / today |
|---|---|---|---|---|
| GET | `/api/v1/studio/contributors` (relative, 60 s poll) | Bearer from `localStorage` (`:10-13`); server verifies the Supabase JWT + role (`services/override_service.py:34-79`) | `api/studio_routes.py:760` | `{contributors[]}` — `user_id`, email, role, `revoked_at`, trust count. **404s → empty state** |
| PATCH | `…/contributors/:userId/revoke` | Bearer, review_admin/developer | `studio_routes.py:791` | **404s → green success toast** |
| PATCH | `…/contributors/:userId/enable` · `/disable` | Bearer | `studio_routes.py:812`, `:1025` | **404s → silent no-op** |
| POST | `/api/v1/studio/invite` | Bearer | `studio_routes.py:483` | `{token, expires_at}` → single-use link. **404s → honest error toast** (`InviteDialog.tsx:39-45`) |

**Fed by**

- `user_roles` rows are the only source. They are created by **invite redemption**
  (`studio_routes.py:517`) — which, per §10, no invited user can reach — or by direct
  DB insert. So in practice the roster is **seeded by hand in Supabase**, and this page
  is a read-only mirror of manual work.
- `promotion_policy` on a `certified_contributor` row is what decides whether their
  overrides skip [[studio-queue]] (`studio_routes.py:216-222`); trust accrual is
  maintained by `check_and_update_trust` on queue decisions (imported `:48`).
- The two-tier role read (JWT `app_metadata.roles`, else a `user_roles` DB lookup,
  `override_service.py:39-42,77-79`) is why roles work in dev without the Supabase JWT
  hook configured.

**Writes**

- `user_roles` — `revoked_at` set/cleared; new rows on invite redemption.
- `studio_invites` — one row per generated token, single-use (409 if consumed, 410 if
  expired, `studio_routes.py:524-527`).
- Downstream: a revoked contributor loses `require_studio_role` on every studio route,
  so [[studio]] ingest/override and this page's own access all deny at the same moment;
  their pending rows stay in [[studio-queue]].

## 12. Design intent

**Should be:** the roster that decides who may touch the master catalogue — invite by
single-use link, watch trust accrue until a contributor earns auto-promotion, and revoke
in one action when trust is lost. The destructive action must be unambiguous, and the
invite must actually be redeemable.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — with an invite CTA (`:69-78`)… but it is also what an error renders | |
| Loading | **yes** — three skeleton rows (`:65-68`) | |
| Error | **no.** No `isError` anywhere in the page (`:24`); mutations swallow non-OK responses (`:32-46`) | |
| Permission-denied | **yes** — route gate, "Studio Access Required" (`ProtectedRoute.tsx:105-124`) | |

**Where the UI misleads**

1. **"No certified contributors" for a dead endpoint** (`:69-78`) — the single most
   misleading state in the studio cluster.
2. **`toast.success('Contributor revoked')` after a 404**
   (`ContributorTable.tsx:50-53` + `StudioCertify.tsx:32-38`). The confirm step
   (`:41-60`) makes it read as a deliberate, completed, destructive act.
3. **`{contributors.length} active contributors` in the subtitle** (`:54`) counts every
   row including revoked ones — the table itself computes `isActive = !c.revoked_at`
   (`ContributorTable.tsx:95`), so the header and the rows disagree.
4. **A copyable invite link that redirects to the dashboard** (§10) — the copy button
   and 2-second "Copied" confirmation (`InviteDialog.tsx:50-54`) make it feel shipped.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/studio/certify`** — Not rebuilt. The same act as the team invite — reuse the one exception component, or collapse the policy (fork F2).

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/studio/certify` | Invite a contributor | popover · modal | Target · fork F2 | The same shape as Invite a team member. A second component would be the 'second anchored modal' ADR 0112 says collapses the policy — so it is the same component with a second opener, or the founder collapses to two shapes. | `pages/studio/certify/InviteDialog.tsx:106 (Radix dialog today)` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 13. Roadmap

1. **Prefix all four calls with the orchestrator base** (`CommandBar.tsx:42` pattern).
   Same one-line fix as [[studio]] §13.1 and [[studio-queue]] §13.1 — do all three
   together or the cluster stays inconsistent.
2. **Check `resp.ok` in `handleRevoke` / `handleToggleEnable`** (`:32-46`) and throw, so
   the existing `catch` + error toast in `ContributorTable.tsx:52-53` can do its job.
   Independent of #1 and worth doing regardless — a success toast for a failed write is
   the failure mode `v3.0-TECH-DEBT.md:53-56` names.
3. **Add an `isError` branch** so a dead roster stops reading as an empty one.
4. **Build `/studio/invite/:token`** — the route the dialog already links to
   (`InviteDialog.tsx:25`), posting the token to `…/invite/redeem`.
5. **Drop the studio-role requirement from `invite/redeem`** (`studio_routes.py:519-521`)
   — the invite token *is* the credential. *Blocked: this is a security posture change
   (who may redeem, and under what rate limit) and belongs in an ADR before it ships.*
6. Count only non-revoked rows in the subtitle (`:54`).

---

## 14. Update — 2026-08-26, [ADR 0021](../decisions/0021-studio-invites-are-self-service.md)

§10's verdict was accurate when written and is now out of date. Recording the delta rather
than rewriting it, so the diagnosis stays readable next to what it caused.

- **The four 404s are gone.** The founder chose the gateway proxy over the direct-to-orchestrator
  base URL, so `studioApi.ts` resolves relative paths and `StudioProxyController` forwards
  `/api/v1/studio/*`. §13.1's "prefix all four calls with the orchestrator base" is superseded:
  the prefix is the gateway, not port 8000.
- **§10's fourth and fifth points are fixed, not just routed around.** `/studio/invite/:token`
  now exists ([[studio-invite-redeem]]), and `redeem_invite` no longer requires a studio role —
  it binds the grant to the invited email instead. The invite flow that was "unshippable as
  specified" is shippable.
- **The invite is now sent, not copied.** §12's "copyable invite link that redirects to the
  dashboard" is gone: the gateway emails the invite and the token never reaches this browser.
  The copy affordance survives only as a fallback when delivery fails, since the row exists by
  then and would otherwise be orphaned.
- **Still true:** §10's `isError` gap. The roster still has no error branch, so a failed load
  renders as an empty roster. Unchanged by ADR 0021 — the calls now succeed, but the misleading
  empty state is still what a future failure will look like. §13.3 stands.

Maturity moves **broken → working-with-one-known-gap**; the frontmatter is updated to match.
