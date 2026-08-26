---
phase: 33-multi-restaurant-membership-model
verified: "2026-07-28"
status: passed
method: "retroactive — live code, live routes, and live database, not plan/summary self-reports"
score: "10/10 MEMBER requirements satisfied"
requirements_satisfied:
  [MEMBER-01, MEMBER-02, MEMBER-03, MEMBER-04, MEMBER-05,
   MEMBER-06, MEMBER-07, MEMBER-08, MEMBER-09, MEMBER-10]
---

# Phase 33 Verification — Multi-Restaurant Membership Model

## Why this exists

The v2.0 milestone audit scored Phase 33 `NOT_STARTED` — ROADMAP.md showed 0 of 5
plans checked and the directory held zero SUMMARY files. The integration checker
flagged it as probable tracking drift rather than missing work, and recommended
reconciliation before v3.0 planning so the phase would not be re-planned as new
engineering.

That reconciliation is this document. **It is drift.** All five plans' deliverables
exist, are wired, and the migration is applied to production with real data.

Verified against the running system rather than against SUMMARY files, because the
recurring failure in this codebase is code that exists and does not run — six
instances found during the v3.0 debt compile alone.

## Evidence

### 33-01 — DB schema migration [MEMBER-06] ✅

`supabase/migrations/20260514200000_phase33_ura_membership.sql` exists **and is
applied**. Queried live (`exzueerziesmczwlhomd`):

| Check | Result |
|---|---|
| Migration in `schema_migrations` | 1 (applied) |
| `user_restaurant_access` columns | 11 |
| RLS policies on the table | 2 |
| Rows | 7 |

Real rows matter here: an applied migration with an empty table would mean the
backfill never ran. It did.

### 33-02 — Auth service [MEMBER-01, 02, 07, 08] ✅

`apps/api-gateway/src/auth/auth.service.ts` contains `joinViaInvite`,
`registerRestaurant`, `switchRestaurant` and `generateTokens`. `GET /auth/me/role`
returns **401** unauthenticated — it exists and is guarded, rather than 404.

### 33-03 — Members CRUD backend [MEMBER-03, 04, 05, 10] ✅

`members.service.ts` and `members.controller.ts` exist **and `MembersController` is
registered in `restaurants.module.ts`**. This is the check that matters: an
unregistered controller is invisible at runtime, which is exactly how the inbound
email agents stayed dead for a milestone.

Routes verified live — `401`, not `404`:

```
401  /api/v1/restaurants/abc/members
401  /api/v1/restaurants/abc/invites
```

### 33-04 — Frontend auth + routes [MEMBER-07, 10] ✅

`InviteLanding.tsx` and `NoAccess.tsx` exist and are **routed** in `App.tsx`
(`/invite/:code`, `/no-access`) — built-but-unrouted was a real category in the UX
catalog, so routing was checked explicitly rather than assumed from the files.

### 33-05 — Settings Team tab [MEMBER-09] ✅

`Settings.tsx` renders the Team tab with `TeamMemberRow`, `InviteTeamDialog`, and
member/role/invite handling. `services/api/team.ts` calls the real endpoints:
`GET/POST /members`, `PATCH /members/:id`, `DELETE /members/:id` — matching the
controller's shape, so client and server agree.

## Conclusion

**Phase 33 is complete.** The bugs it was scoped to fix — the `joinViaInvite`
crash, unwritten `user_restaurant_access`, `switchRestaurant` fine-grained
validation, and JWT role sourced from URA — are resolved in `auth.service.ts`, with
the migration, services, and frontend all in place and reachable.

ROADMAP.md checkboxes updated to match. No engineering work remains.

## What this cost, and the lesson

Five plans' worth of apparent work turned out to be zero. The audit could not tell,
because the phase had shipped code and no VERIFICATION artifact — the same gap
still open on phases 18, 19, 20, 22, 28 and 35 (v3.0 task 44.4).

**A phase with working code and no verification artifact is indistinguishable from
a phase that was never started.** That ambiguity nearly cost a re-plan of work
already done, and it is the argument for closing the remaining six.
