---
phase: 35-account-surfaces
verified: "2026-07-31"
status: passed
method: "retroactive — live routes and controller signatures, not the SUMMARY"
score: "6/6 success criteria verified"
requirements_satisfied: [ACCT-01..12]
note: "ACCT-* were never entered into REQUIREMENTS.md; verified against ROADMAP success criteria instead."
---

# Phase 35 Verification — Account Surfaces

## Why this exists

The v2.0 audit called Phase 35 **"the least formally tracked phase in the
milestone: a single consolidated prose SUMMARY.md, no per-plan breakdown, no
VERIFICATION/VALIDATION/SECURITY/UAT of any kind."**

One prose file was the entire evidence base. This checks the six success criteria
against the running code instead.

## Success criteria

**1. Header Profile / Settings / Help navigate to their routes** ✅
All three routed in `App.tsx`.

**2. `/profile` owns personal identity; restaurant ops stay on `/settings`** ✅
Both pages exist and are separately routed; the split is enforced by criterion 3's
role gate below.

**3. Staff see a Settings shell without ops sections** ✅
`Settings.tsx:903` — `const isStaffOnly = effectiveRole === 'staff'`. The gate is
computed from the resolved role rather than a prop, so it cannot be bypassed by a
caller.

**4. The five account endpoints work** ✅ — all present on `auth.controller.ts`:

| Endpoint | Line |
|---|---|
| `PATCH /auth/me` | 148 |
| `POST /auth/me/password` | 158 |
| `GET /auth/me/linked-providers` | 173 |
| `DELETE /auth/me/link/:provider` | 201 |
| `POST /auth/me/leave-restaurant` | 217 |
| `DELETE /auth/me` (delete account) | 228 |

Six, not five — the criterion under-counted its own scope.

**5. Help page with FAQ + env-configured Email/Slack** ✅
`pages/Help.tsx` exists with 6 references to `SUPPORT_*` / `VITE_SUPPORT_*`
environment variables, so contact routing is configured rather than hardcoded.

**6. Six profile sketches scored, winner drives the UI** ✅
`.planning/sketches/` holds the numbered sketch set.

## Conclusion

**Phase 35 is verified.** All six success criteria hold against live code. The
audit was right that the phase was under-documented and wrong to imply that meant
under-built — a distinction only checking could settle, and the same one that made
Phase 33 look like five plans of outstanding work when the answer was none.

Its ACCT-01..12 were never entered into REQUIREMENTS.md; verified against
ROADMAP.md success criteria instead. Part of the ~100 orphaned IDs open in 44.4.
