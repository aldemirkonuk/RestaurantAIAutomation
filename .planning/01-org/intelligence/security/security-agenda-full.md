---
type: agenda-full
division: intelligence
department: security
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.unverified_public_ingress, nf_a.unauthenticated_inference_spend, sec.recurrence_guard_present, sec.checklist_12c_items_with_a_reading, sec.fail_open_defaults]
updated: 2026-08-24
links: ["[[security-charter]]", "[[security-premortem]]", "[[security-agenda-board]]", "[[security-directive]]", "[[security-loops]]", "[[security-schedule]]", "[[access-control-tenant-isolation-charter]]", "[[perimeter-ingress-integrity-charter]]", "[[ai-surface-security-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# Security — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Every number below is a
> reading taken from the repo on 2026-08-24, but nothing in the "next steps" section has
> been started.

## What

Three campaigns, in dependency order rather than importance order.

**Campaign A — close OD-19 (the endpoint classification).** 94 routes unguarded by
omission, classified **per route**, remediated, and pinned by a CI assertion. Owned by
[[access-control-tenant-isolation-charter]] with
[[perimeter-ingress-integrity-charter]] as the second charter on the same team, because
the classification verdict *is* the choice of which control applies.

**Campaign B — establish the ingress baseline.** 43 routes are supposed to be
unauthenticated (32 webhook-module + 11 explicit `@Public()`). How many of them prove
where the request came from is currently **unknown**, and establishing that number is the
deliverable. Two of five ingress modules verify signatures correctly today
(`toast`, `pos-hub`); one accepts a shared secret in a query string (`inbound-email`); one
is misclassified entirely (`simpos`); one is genuinely-public content with no
publish-state audit (`vendor-portal`).

**Campaign C — make the AI surface testable.** An adversarial corpus, a reconciliation of
the "never auto-send" claim against the code that auto-sends, and a per-tenant inference
budget that does not wait on telemetry. Owned by [[ai-surface-security-charter]], which
starts day one and is blocked on nothing for its first two deliverables.

## How

**The sequencing decision, stated once and defended.** Campaign A ships its **CI check
first, red**, with all 94 routes in an allowlist file — *before* a single guard is added.
This looks backwards and is the single most important choice in this agenda. It converts
remediation from "add a decorator" into "delete a line from a reviewed file", which means
the number cannot fall without a diff and cannot rise silently at all. [[security-premortem]]
M1 is the argument; the repo's four prior one-off fixes are the evidence.

**Classification is per route and produces a written verdict**, one of four:
`guard` · `public-with-signature` · `public-content-with-publish-check` ·
`delete`. The fourth is not decoration — nine of the eleven non-webhook `@Public()` routes
are `communications/test/e2e/step1..6` and `test/send-template`
(`ENDPOINTS.md:153-162`), a test harness that triggers real vendor email, publicly
reachable in a production build. "Should this exist at all" is a legitimate verdict.

**Controls are copied, not invented.** The repo already contains the fail-closed shape
(`toast.service.ts:112-121`, `pos-hub.service.ts:87-95`, `dev-bypass.util.ts:46-52`) and
the grep-guard CI shape (four scripts wired into `.github/workflows/ci.yml`). This
department's job is to point proven mechanisms at an unprotected class, which is a much
cheaper claim than "build a security program."

## Why now

Two reasons, one urgent and one structural.

**Urgent:** the analytics hole was live, financially exploitable, and reachable by anyone
with `curl` — two calls to enable and drive `claude-opus-4-8` on the founder's key
(`consultants.service.ts:154-176`). It is fixed on `fix/analytics-endpoint-auth`
(`99da5eb`, +7 lines) and **that branch is not merged to `main`**. The single highest-value
action available to this department today is a merge, and it does not need a department to
happen. **Recommend merging it standalone rather than folding it into the sweep** —
OD-20's framing offers both.

**Structural:** the defect class has now recurred four times and been fixed four different
ways. Each fix was correct. None of them prevented the next one. A class that recurs after
documentation is a class that needs a mechanism, and the window to install the mechanism is
*before* the 94 are drained, not after — because once the number is 0, nobody funds a
guard for a solved problem. That window closes the day someone runs the heroic pass.

## The §12C checklist — every item, with a reading

Fifteen items. **8 have a reading; 7 do not.** An item with no reading is written
`unmeasured`, never omitted (see [[security-premortem]] M-summary).

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | No secrets in frontend | ⚠️ **PARTIAL** | `VITE_DEV_AUTH_BYPASS_SECRET` ships in the web bundle. Server-side gate is fail-closed and `NODE_ENV`-scoped (`dev-bypass.util.ts:46-52`), so risk is contained — but the value is in whatever bundle it was built with. 17 `VITE_*` vars total. |
| 2 | No CORS `*` in prod | ⚠️ **PARTIAL** | Not `*`, but `main.ts:26` allow-lists `/^https:\/\/.*\.vercel\.app$/` with `credentials: true` in production — every app on a shared multi-tenant domain. |
| 3 | Rate limiting | ⚠️ **PARTIAL** | Global `APP_GUARD` (`app.module.ts:120-123`), sane tiers (`rate-limit.guard.ts:27-33`), **in-memory `Map`** (`:65-70`). Effective limit = tier × instance count. |
| 4 | Parameterized queries | ❓ **unmeasured** | Supabase client is parameterized by construction; no audit of raw-SQL paths or RPC arguments has been done. |
| 5 | Hashed passwords | ✅ **EXISTS** | `bcrypt` throughout `auth.service.ts` (`:117`, `:201`, `:594`, `:1180`, `:1492`, `:1498`, `:1644`). |
| 6 | No sensitive data in localStorage | 🔴 **FAIL** | `AuthContext.tsx:130-131` stores `accessToken` **and** `refreshToken` in `localStorage`. 295 `localStorage` references in `apps/web/src`. Any XSS is a full account takeover with refresh persistence. |
| 7 | No open admin panels | ❓ **unmeasured** | Requires the route-level classification to answer; several of the 94 are admin-shaped (`POST /notifications`, `DELETE /contacts/:id`). |
| 8 | Email verification | ✅ **EXISTS** | `email_verified: false` on registration (`auth.service.ts:603`), checked at `:468`; invite path sets `true` because the owner vouched (`:1190`). |
| 9 | Non-guessable IDs | ❓ **unmeasured** | UUID shape is validated in `jwt-auth.guard.ts:48-59` — but see the dead-code note below. `vendor-portal` uses `:slug`, which is guessable by design and needs an enumeration control instead. |
| 10 | Careful request-body logging | ❓ **unmeasured** | No audit. Interacts with item 6 and with prompt/PII logging in [[ai-surface-security-charter]]. |
| 11 | Webhook signature verification | ⚠️ **PARTIAL** | 2 of 5 ingress modules verified and fail-closed (`toast`, `pos-hub`); `inbound-email` uses a shared secret accepted via `?secret=`; `simpos` is misclassified; `vendor-portal` needs a different control entirely. |
| 12 | No stack traces in prod | ❓ **unmeasured** | `common/error-tracking/` exists; behaviour under `NODE_ENV=production` unverified. |
| 13 | Dependency currency | ✅ **EXISTS** | `.github/dependabot.yml`; Trivy SARIF in `ci.yml:244-254`; CodeQL `security-extended` per-PR and weekly (`codeql.yml`). |
| 14 | Password strength | ⚠️ **PARTIAL** | `@MinLength(8)` on all three password DTOs (`change-password.dto.ts:9`, `join-via-invite.dto.ts:7`, `register-restaurant.dto.ts:6`). No complexity rule, no breach-list check. |
| 15 | File-upload validation | ⚠️ **PARTIAL** | 15 MB body cap with a documented derivation (`main.ts:41-60`), `MAX_UPLOAD_BYTES` in `apps/web/src/lib/uploadAccept.ts`. Content-type/magic-byte validation unverified. |

**Item 6 is the highest-severity checklist finding and it is not on OD-19's list**, which
is a useful warning about scoping this department to the endpoint sweep alone.

**A note on item 9.** `jwt-auth.guard.ts:48-59` computes `userIdIsUuid` and
`restaurantIdIsUuid` and then **does nothing with either value** — the block has no
`if`, no throw, no log. It is a half-finished check that reads as a control at a glance.
Not exploitable, but it is a precise instance of the "hollow feature that reports success"
class named at `.planning/v3.0-TECH-DEBT.md:127`, sitting inside the auth guard itself.

## Next steps

Ordered. Nothing here is started.

1. **Merge `fix/analytics-endpoint-auth` to `main`.** Answers OD-20. One file, +7 lines.
   Does not need this department, and should not wait for it.
2. **Write the CI check red.** `scripts/check_endpoint_guards.sh` + an allowlist seeded
   with all 94 routes and all 43 intentionally-public ones, as two separate lists. Wire
   into `.github/workflows/ci.yml` alongside the four existing grep guards.
3. **Classify the 94, per route, with a written verdict.** Six modules; `analytics` (39)
   is already answered by step 1. Output is a diff to the allowlist, not a report.
4. **Resolve `simpos` (11 routes).** The confused-deputy case in [[security-charter]].
   Determine whether `POST /simpos/:id/check/:id/close` reaches a real tenant's inventory
   and whether the sim restaurant is an isolated tenant. **This is a classification
   question with a possible severity attached; do it before step 3's long tail.**
5. **Establish `sec.unverified_public_ingress`.** 43 routes, one verdict each.
6. **Seed the adversarial injection corpus.** Four seed shapes are already named in the
   repo's own prompt (`inbound-responder.service.ts:693`). Ship a failing test first.
7. **Reconcile "never auto-send."** `inbound-responder.service.ts:156-157` says it never
   sends; `:509-513` schedules a send after a 2-minute undo window. Fix the claim or the
   code — and record which, because the two have different owners.
8. **Per-tenant daily inference ceiling** on the two paid analytics routes, default
   closed. Crude, needs no telemetry, closes [[security-premortem]] M4's window while
   RM-3 is pending.
9. **File the RM-3 ask with a date** (L-SEC-5). Not a hope.

## Questions for the founder

1. **INTEL-F4 — do SEC-1 and SEC-2 start merged?** This department recommends **yes**, one
   team with two charters, splitting when `sec.unguarded_authenticated_surface` hits 0
   with CI holding it. The `simpos` case is new evidence the division doc did not have.
2. **OD-20 — merge the analytics fix standalone, or fold it into the sweep?** Recommend
   standalone, today. Severity is not a documentation question.
3. **Are the nine `communications/test/e2e/*` routes meant to be reachable in a
   production build?** They carry `@Public()` deliberately and they trigger real vendor
   email. `delete` may be the correct verdict; that is not our call to make alone.
4. **Item 6 — tokens in `localStorage`.** Moving to httpOnly cookies is an
   [[platform-api-charter]] change with real scope (CSRF, mobile, 295 call sites). Do we
   open it now, or record it and continue? Recording it is a defensible answer; silence
   is not.
5. **Does `simpos` belong in the production bundle at all?** It is registered
   unconditionally (`app.module.ts:84`) and is described in its own module docstring as
   *"a synthetic test fixture, not a WineOps feature."*
