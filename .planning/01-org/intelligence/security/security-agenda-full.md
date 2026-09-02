---
type: agenda-full
division: intelligence
department: security
status: active
metrics: [sec.unguarded_authenticated_surface, sec.unverified_public_ingress, nf_a.unauthenticated_inference_spend, sec.recurrence_guard_present, sec.checklist_12c_items_with_a_reading, sec.fail_open_defaults]
updated: 2026-08-28
links: ["[[security-charter]]", "[[security-premortem]]", "[[security-agenda-board]]", "[[security-directive]]", "[[security-loops]]", "[[security-schedule]]", "[[security-agent-stack]]", "[[access-control-tenant-isolation-charter]]", "[[perimeter-ingress-integrity-charter]]", "[[ai-surface-security-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[action-safety-the-human-gate-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[compliance-privacy-charter|compliance-charter]]", "[[decision-office-charter]]", "[[0035-wave2-seam-reconciliation]]", "[[0039-activation-plan-of-record]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# Security — Full Agenda

**Dated 2026-08-28.** Every number below was re-measured on this date against the worktree,
not carried forward. The measurement method is stated next to each reading, because this
department's own recurring failure is a number stated by hand
([[security-premortem]] M-summary).

**Method for the census numbers.** All `*.controller.ts` under `apps/api-gateway/src`
excluding `*.spec.ts`; block and line comments stripped first; a class-level guard counted
only from the decorator run immediately above the *controller* class declaration (an
earlier pass mis-scored seven controllers by matching the `UseGuards` import symbol and by
scanning back from a DTO class declared above the controller — both corrected before these
readings were taken).

---

## 1. What the founding documents said, and what is true today

The charter, premortem, schedule and board were written 2026-08-24 and are load-bearing on
a census that has moved twice since. They are not edited here (wave-3 rule, §8.4); the
delta is recorded so no task in this agenda is planned against a stale number.

| Reading | Charter (2026-08-24) | **Today (2026-08-28)** | How it moved |
|---|---|---|---|
| Route decorators | 448 | **463** | 48 non-spec controllers |
| Routes on class-guarded controllers | 311 remembered | **417** | PRs #31/#32 + ADR 0019 D2/D3 |
| Routes on class-**un**guarded controllers | 94 | **40** | reproduces OD-19's recount exactly, independently |
| Of those 40, carrying neither `@Public()` nor a method guard | — | **6** | all six in `auth.controller.ts` |
| `sec.public_decorator_count` | 12 | **17** | ADR 0019 D3 added `webhooks/gmail`; D2 removed nine |
| Unauthenticated surface (declared + undeclared) | 43 in scope | **23** | 17 `@Public()` + the 6 undeclared |
| `sec.fail_open_defaults` | 4 | **1 live + 1 dev-only** | the three JWT fallbacks collapsed into one fail-closed resolver |
| `sec.model_callsites_emitting_cost` | 0 of 7 | **25 of 25** | `common/model-client/` + `SpendLogger` + `check_model_calls_logged.sh` |
| `sec.tenants_with_inference_budget` | 0 | **10 of 10** | `common/model-client/spend-tiers.ts` |
| `sec.injection_corpus_size` | 0 | **0** | unchanged — no file matching `*injection*` exists in the repo |
| `sec.recurrence_guard_present` | false | **false** | `.security/` does not exist; 22 `check_*` scripts, none for guards |

**The denominator has now been stated five ways: 86 → 103 → 94 → 40 → 6.** The fifth
statement is this agenda's, and it is the reason task **S19** exists: a department whose
thesis is *"the codebase's habit is to warn and continue"* has its own habit, which is
*stating a count by hand and publishing it as fact*. Every number above is reproducible;
none of them is yet reproducible **by a committed script**, and that is the gap.

### The residual, named

The 40 routes on class-unguarded controllers resolve as:

| Controller | Routes | `@Public()` | Method guards | Unaccounted |
|---|---|---|---|---|
| `auth/auth.controller.ts` | 29 | 8 | 16 (one route carries both) | **6** |
| `integrations/integrations-oauth.controller.ts` | 5 | 1 | 4 | 0 |
| `events/events.controller.ts` | 3 | 1 | 2 | 0 |
| `common/orchestrator/inbound-email.controller.ts` | 1 | 1 | — | 0 |
| `vendor-portal/vendor-portal.controller.ts` | 2 | 2 | — | 0 |
| | **40** | **13** | **22** | **6** |

The six: `POST /auth/login` (`auth.controller.ts:51`), `/auth/register` (`:91`),
`/auth/oauth/google` (`:106`), `/auth/oauth/microsoft` (`:121`), `/auth/refresh` (`:136`),
`/auth/verify-email` (`:420`).

**None of the six is a hole. All six are public by intent and none is public by
declaration** — they are reachable because `JwtAuthGuard` is absent and
`tenant.guard.ts` returns `true` with no user, which is the *shape* the department was
founded to end even where the outcome is correct. The verdict class for all six is
`public-with-declaration`, not `guard`, and CI cannot tell the difference until the
declaration exists. **This is the finding wave 3 was for, and it does not close OD-19 —
enumerating and proposing is our half; the founder rules.**

Two ingress rows exist today that the charter's 43-route table never contained, because
they were not `@Public()` when it was written:

- `GET /calendar/feed/:token.ics` — `calendar.controller.ts:586-587`. A capability URL: a
  64-char hex token in the path, no rotation, no revocation, and it lands in every proxy
  and referrer log between the subscriber and us. Never audited.
- `GET /events/metrics` — `events.controller.ts:107-108`. Ingestion counters served to
  anyone. Described in its own summary as *"internal/monitoring"*.

### Closed since founding — recorded so nobody re-opens them

- **`simpos` confused deputy** — `simpos.controller.ts:54` now class-guarded, module gated
  on `NODE_ENV !== "production"` (`app.module.ts:89`). Severity queue #2, closed.
- **`communications/test/e2e/*`** (9 routes) — now `@UseGuards(NonProductionGuard)` and no
  longer `@Public()` (ADR 0019 D2, `communications.controller.ts:61-65`). Severity #5, closed.
- **Three JWT-secret fallbacks** — collapsed into `auth/jwt-secret.ts:resolveJwtSecret`,
  which **throws outside development** (`:21-25`) and returns the published default only
  when `NODE_ENV !== "production"` (`:26`). The correct shape now exists in the credential
  itself. Severity #3, downgraded to a dev-only default.
- **`POST /communications/webhooks/gmail`** — stays `@Public()`, now authenticated by a
  Google-signed Pub/Sub OIDC token, fail-closed (ADR 0019 D3). A new ✅ ingress row.

Still open and unmoved: tokens in `localStorage` (`AuthContext.tsx:146-147`), the
`?secret=` query credential (`inbound-email.controller.ts:57-58`), the in-memory rate-limit
`Map` (`rate-limit.guard.ts:70`), the `*.vercel.app` CORS regex with credentials
(`main.ts:24`), and an injection corpus of size 0.

---

## 2. The shape of this agenda

Three campaigns, one per team, plus a department spine. The order is not importance — it is
**the order in which one task makes the next one cheap**.

**Campaign A (SEC-1) — the lid before the burn-down.** The residual is six routes. That is
small enough to fix in an afternoon and therefore *exactly* the moment
[[security-premortem]] M1 predicts we lose the guard forever: nobody funds a recurrence
check for a problem that is already at six. **The check ships first, red, or this
department has repeated the pattern it was founded to end** — for the fifth time.

**Campaign B (SEC-2) — the denominator that is smaller than it looks.** 43 → 23 in scope,
with two rows that appeared while nobody was counting. Re-baselining is not bookkeeping:
`sec.fail_open_defaults` moving 4 → 1 is a metric changing value mid-campaign, which
[[security-directive]] escalation trigger 5 says we may not do silently.

**Campaign C (SEC-3) — the corpus, and only the corpus.** Every other AI-surface number has
been discharged by other units since founding (25 of 25 callsites emit cost; 10 of 10
tenants resolve to an allowance). What is left is the one deliverable nobody else can do
for us and the one the premortem says we will write a document about instead. Per
[[0035-wave2-seam-reconciliation]] §7 our allowlist line is **audit only** — enforcement is
[[action-safety-the-human-gate-charter]]'s, and no task here proposes an enforcement change.

---

## 3. Tasks

Every task carries a doneability, a close_time, and the evidence that makes it real.
`◈` marks a **reach** item — graded honestly in §5, not smuggled in as routine.
Owner is the team's card from `00-index/cards.json`, never a person.

### Campaign A — access-control-tenant-isolation (`guard-census`, `route-classifier`)

| ID | Task | Doneability | close_time |
|---|---|---|---|
| **S1** | Ship `scripts/check_endpoint_guards.sh` + `.security/endpoint-allowlist.txt` **red**, wired into `ci.yml` beside the 22 existing `check_*` guards | The job fails on a synthetic controller added with no decorator, and fails on a route removed from the allowlist without a decorator change. `sec.recurrence_guard_present` flips `true` **before** the primary metric moves at all | **2026-09-04** |
| **S2** | Enumerate and classify all 40 residual routes, per route, five fields (`route · consumer · verdict · control · path:line`) | 40 of 40 carry a written verdict; every `unknown` returns an escalation rather than a verdict; the 6 undeclared auth routes carry a proposed `@Public()` + allowlist row with a named consumer. **Output is a diff to the allowlist, not a report** | **2026-09-11** |
| **S3** | Publish the pair weekly — `sec.unguarded_authenticated_surface` (**6**, provisional) beside `sec.public_decorator_count` (**17**) | A run emitting one number without the other is a **failed** run. A week in which the first falls and the allowlist did not change is recorded as a failed week (L-SEC-1) | weekly, first **2026-09-04** |
| **S4** | Measure `sec.cross_tenant_write_paths` — routes taking `restaurantId` from the URL *and* writing | A number with a script behind it, across all 463 routes. `simpos`'s 11 were the known candidates and are now guarded; this asks whether that was the whole set | **2026-09-25** |
| **S5** ◈ | Guard the **booted router table**, not the source text — enumerate Nest's real route table at boot in CI and diff it against the allowlist | A route composed dynamically (inherited controller, dynamic module) that no grep can see appears in the diff. Falls back to S1's grep guard if the boot harness cannot be reused | **2026-10-09** |

**Evidence.** S1: `.security/` does not exist (verified 2026-08-28); `scripts/` holds 22
`check_*` guards wired into `ci.yml`, so the mechanism is proven and has simply never been
pointed at this class; the allowlist file is a **declared gap** in this team's own card
(`cards.json` → `access-control-tenant-isolation` → `guard-census.declared_gaps`).
S2: OD-19 (`OPEN-DECISIONS.md:32`) asks for exactly this enumeration; the 40 reproduce
independently today. S3: [[security-directive]] rule 3 and the `guard-census` quality bar
(*"both numbers or the run failed"*). S4: `sec.cross_tenant_write_paths` is listed
`unmeasured` in [[access-control-tenant-isolation-charter]] §Metrics. S5:
`scripts/check_gateway_boots.sh` proves a booted-gateway CI step already exists here.

### Campaign B — perimeter-ingress-integrity (`ingress-verdict-sentinel`)

| ID | Task | Doneability | close_time |
|---|---|---|---|
| **S6** | Re-baseline `sec.unverified_public_ingress` per route: **23 in scope**, not 43 | 23 rows, each naming `sender · proof · fail-direction`. **A row with a `proof` and no named `sender` is a FAILED check** — that inversion is the job (`ingress-verdict-sentinel` quality bar). Includes the two rows the founding table never had | **2026-09-11** |
| **S7** | Re-baseline `sec.fail_open_defaults` 4 → 1 live (+1 dev-only) **with an escalation first**, and ship the fail-open grep guard | The escalation is filed before the number is republished ([[security-directive]] trigger 5); the guard fails on a new `return true` in a guard file or a new `\|\| "…"` secret fallback, proven against the pre-`jwt-secret.ts` tree | **2026-09-18** |
| **S8** | Verdict on the `?secret=` query credential (`inbound-email.controller.ts:57-58`) | A written verdict plus a header-only proposal handed to [[platform-api-charter]]. Fails closed today, which is right — the finding is the *channel*, not the direction | **2026-09-11** |
| **S9** | Audit the iCal capability URL (`calendar.controller.ts:586-587`) — rotation, revocation, enumeration resistance, log exposure | Four questions answered with `path:line` or `unmeasured`; if the token cannot be rotated, that is an escalation, not a note | **2026-09-25** |
| **S10** | Specify (not build) a distributed rate limit — `sec.distributed_rate_limit_present` is `false` | A specification [[platform-api-charter]] can implement, naming the store and the failure direction under store loss. We classify and specify; they author | **2026-10-09** |
| **S11** ◈ | Propose narrowing the CORS allow-list — `/^https:\/\/.*\.vercel\.app$/` with `credentials: true` in production (`main.ts:24`) | A named origin list with the deploy surfaces enumerated, and the breakage it would cause stated. **Aspiration pending a founder call** — it trades a deployment convenience for a security default | **2026-10-09** |

**Evidence.** S6: the 17 `@Public()` decorators enumerated 2026-08-28 plus the 6 undeclared;
[[perimeter-ingress-integrity-charter]] §Metrics publishes the provisional 23-of-43 this
supersedes. S7: `auth/jwt-secret.ts:11-26` (the collapse) and
`tenant.guard.ts:38-52` (the survivor, now documented as a no-op backstop with
`JwtAuthGuard` performing the assertion). S8/S9: source, cited above. S10:
`rate-limit.guard.ts:65-70`, whose own comment says to use Redis in production.
S11: `main.ts:16-32`.

### Campaign C — ai-surface-security (`ai-surface-sentinel`)

| ID | Task | Doneability | close_time |
|---|---|---|---|
| **S12** | **Adversarial corpus v1** — ≥60 cases, dual-keyed: each case names the injection shape **and** the guardrail it should trip | The file exists; ≥1 case demonstrably fails without the quarantine and passes with it (**failing test first**, [[security-directive]] rule 4); the four shapes named in our own prompt (`inbound-responder.service.ts:685`) are each represented; the six guardrail families at `:283,:895-920` are each targeted | **2026-09-25** |
| **S13** | Monthly corpus run reporting a **triple**: size, detection rate, and false-positive rate on benign-but-injection-shaped canaries | Two numbers or the run failed; **a run where every case passes is reported `suspicious`, not green**; a rising size at a flat rate is reported as padding | monthly, first **2026-09-30** |
| **S14** | Reconcile *"it never sends"* (`inbound-responder.service.ts:145`) against `willAutoSend` + the 2-minute undo window (`:504-506`) | One of the two changes, and **which one is recorded** — they have different owners. `sec.autonomous_send_rate` gets a number or the word `unmeasured`; it may not stay an adjective | **2026-09-11** |
| **S15** | **Allowlist coverage audit** — every tool/action reachable from a model-authored path, listed with its gate owner | A coverage table, and **zero enforcement changes proposed by us**. Enforcement is [[action-safety-the-human-gate-charter]]'s per [[0035-wave2-seam-reconciliation]] §7; a gap becomes a row in *their* questions file | **2026-10-02** |
| **S16** | Publish `nf_a.unauthenticated_inference_spend` as **`0 — bounded by census 2026-08-28, not measured`**, and file the RM-3 ask with a date | The board shows the bound *and* the word `not measured` in the same cell; `sec.days_dependency_open` keeps incrementing. **Bounding is not measuring, and the loop stays `blocked`** | monthly, first **2026-09-30** |
| **S17** ◈ | Prompt/log content audit — two deepest callsites: what enters a prompt, what leaves in a log | Both callsites answered field-by-field. Anything touching **personal data handling** is handed to [[compliance-privacy-charter\|compliance-charter]] unruled ([[security-directive]] trigger 6) | **2026-10-30** |

**Evidence.** S12: corpus size **0** confirmed 2026-08-28 (no file matching `*injection*`
in the repo); [[security-premortem]] M3; `inbound-responder.service.spec.ts:248-263` tests
the plumbing and not the firing. S13: the `ai-surface-sentinel` quality bar. S14: the two
cited lines, still divergent today. S15: ADR 0035 §7 narrowed this line to audit. S16:
[[security-loops]] L-SEC-5 — NF-A records *which agent*, never *whether the caller was
authenticated*; that dimension is RM-3's to add, not ours.

### Department spine (`sec-orchestrator`)

| ID | Task | Doneability | close_time |
|---|---|---|---|
| **S18** | The §12C pass with dated readings — all fifteen items, weekly | ≥12 of 15 carry a reading by close; each remaining item is written `unmeasured` **and names why it cannot be read**. An item `unmeasured` for three consecutive passes becomes a memory fact about the obstacle, not the number | weekly; **≥12/15 by 2026-09-25** |
| **S19** ◈ | **The measurement ledger** — every `sec.*` metric names a committed executable that prints it | Six metrics, six scripts (or the word `unmeasured` where no script can exist). A number published without one is a failed publication. Retires the hand-counted denominator permanently | **2026-10-16** |
| **S20** | Red Team handoff #1 — hand the 40 verdicts and ask *"which is most likely wrong, and what would we see first?"* | A row in [[red-team-charter]]'s inbound queue with the verdicts attached. Nothing notifies them (declared gap), so it is filed **and** their schedule polls ours | **2026-10-30** |
| **S21** | Dependabot + SARIF triage — the queue exists and nobody reads it | Every open item either merged or deferred **in writing** with a date. Zero silent deferrals | weekly, first **2026-09-04** |

**Evidence.** S18: [[security-schedule]]'s weekly §12C row, `foundation README:266`;
§4 below is the pass taken today. S19: the five-way denominator drift in §1 — the
department's own recurring defect. S20: the quarterly handoff in [[security-schedule]];
the `sec-orchestrator` card emits it. S21: `.github/dependabot.yml` and
`ci.yml:244-254` (Trivy) both exist and are unread ([[security-schedule]]).

---

## 4. The §12C checklist — fifteen items, read 2026-08-28

**11 have a reading; 4 do not.** Founding pass was 8 of 15. An item with no reading is
written `unmeasured`, never omitted — an omitted metric reads as green.

| # | Item | State | Reading (2026-08-28) |
|---|---|---|---|
| 1 | No secrets in frontend | ⚠️ PARTIAL | `VITE_DEV_AUTH_BYPASS_SECRET` ships in the web bundle; the server gate is fail-closed and `NODE_ENV`-scoped (`dev-bypass.util.ts:46-52`), so the value is exposed but inert in production |
| 2 | No CORS `*` in prod | ⚠️ PARTIAL | Not `*`; `main.ts:24` allow-lists `/^https:\/\/.*\.vercel\.app$/` with `credentials: true`. Task **S11** |
| 3 | Rate limiting | ⚠️ PARTIAL | Global `APP_GUARD`, tiers at `rate-limit.guard.ts:28-32`, in-memory `Map` at `:70`. Effective limit = tier × instance count. Task **S10** |
| 4 | Parameterized queries | ❓ **unmeasured** | Supabase client is parameterized by construction; no audit of raw-SQL or RPC-argument paths has been done. **Why unread:** needs a query-surface census nobody owns yet |
| 5 | Hashed passwords | ✅ EXISTS | `bcrypt` throughout `auth.service.ts` |
| 6 | No sensitive data in `localStorage` | 🔴 **FAIL** | `AuthContext.tsx:146-147` writes `accessToken` **and** `refreshToken`. Unmoved since founding. **Highest-severity checklist finding and outside every `sec.*` metric** — see §6 F1 |
| 7 | No open admin panels | ✅ **newly answered** | Falls out of the census: 417 of 463 routes sit on class-guarded controllers, and all 40 residual routes are on `auth`, `events`, `integrations-oauth`, `inbound-email`, `vendor-portal`. No admin-shaped route is unguarded today |
| 8 | Email verification | ✅ EXISTS | Enforced in `jwt-auth.guard.ts` via `assertEmailVerified` with an explicit opt-out decorator (ADR 0023) |
| 9 | Non-guessable IDs | ⚠️ PARTIAL — **founding note corrected** | The dead `userIdIsUuid`/`restaurantIdIsUuid` block the founding agenda flagged is **gone**; the guard now does blacklist → tenant assertion → email verification. `vendor-portal` still uses a guessable `:slug` by design and `calendar/feed/:token.ics` a 64-char token — both need enumeration controls, not UUIDs. Task **S9** |
| 10 | Careful request-body logging | ❓ **unmeasured** | `scripts/check_log_sanitizer_usage.py` exists on the Python side; the gateway has no equivalent audit. **Why unread:** overlaps S17 and lands partly in compliance's scope |
| 11 | Webhook signature verification | ⚠️ PARTIAL → improving | `toast` + `pos-hub` HMAC fail-closed and tested; `webhooks/gmail` now OIDC-verified fail-closed (ADR 0019 D3); `inbound-email` shared secret, still accepts `?secret=`; `vendor-portal` needs publish-state, not a signature. Task **S6** |
| 12 | No stack traces in prod | ❓ **unmeasured** | `common/error-tracking/` exists; behaviour under `NODE_ENV=production` unverified. **Why unread:** needs a running production-mode gateway, which S5's boot harness would give us |
| 13 | Dependency currency | ✅ EXISTS | Dependabot + Trivy + CodeQL `security-extended` all wired. Unread queue is task **S21** |
| 14 | Password strength | ⚠️ PARTIAL | `@MinLength(8)` on all three password DTOs; no complexity rule, no breach-list check |
| 15 | File-upload validation | ❓ **unmeasured** | 15 MB body cap with a documented derivation (`main.ts:41-60`); content-type / magic-byte validation still unverified |

`sec.checklist_12c_items_with_a_reading` = **11 of 15** (was 8). Items 4, 10, 12 and 15 each
name why they cannot be read, per S18's doneability.

---

## 5. The reach items, graded

The founder asked for ambition. Ambition that is not graded is a forecast wearing a task's
clothes, so each `◈` is graded here against the same evidence discipline.

| ID | The reach | Grade |
|---|---|---|
| **S5** | Guard the booted router table rather than the source text | **Evidenced, not proven.** `check_gateway_boots.sh` shows a booted gateway runs in CI; whether its harness can dump Nest's route table is untested. Falls back to S1 cleanly — the reach cannot fail the campaign |
| **S11** | Narrow production CORS | **Aspiration pending a founder call.** The measurement is ours; the trade is not. Scheduled as a *proposal*, and it says so |
| **S17** | Prompt/log content audit | **Evidenced, scope-fragile.** The callsites are enumerable today; the PII half is compliance's ruling, not ours. Scheduled with the handoff built in |
| **S19** | The measurement ledger | **The most ambitious item here, and the best evidenced.** Five denominators in four days is the proof. It is also the only task that makes every other number in this agenda re-checkable by someone who was not in the room |

Deliberately **not** scheduled, with reasons — the anti-sprawl arrow runs from a job to a
skill, never the other way ([[security-schedule]]):

- **An incident-response capability.** No SIEM, no on-call, no incident history; the
  function was rejected at `intelligence.md:505` with a written entry trigger. Scheduling
  it would be inventing the job to justify the skill.
- **A threat model.** Findings about other units' *decisions* are [[red-team-charter]]'s.
  Building it here is [[security-premortem]] M5 starting on day one.
- **Moving tokens out of `localStorage`.** Real, severe, and **not ours to schedule** — it
  is a [[platform-api-charter]] change across CSRF, mobile and 295 call sites. We raise it
  (§6 F1, §7 Q3); we do not put another unit's quarter on our board.
- **Any per-tenant *pricing* tier.** The spend allowances in `spend-tiers.ts` are safety
  ceilings, not a price list; **the pricing model is deferred (OD-23) and nothing here
  assumes its unlock.** Where a ceiling needs a number, the number stays a placeholder.

---

## 6. Findings — things no card and no loop can carry

Per §8.1: a task no card or loop can carry is a finding, not a task.

- **F1 · Item 6 (tokens in `localStorage`) is measured by nothing.** It is outside OD-19,
  outside all six `sec.*` metrics, and no loop in [[security-loops]] would ever move it.
  The highest-severity item on the checklist is the one the department's instrumentation
  cannot see. Raised as Q3.
- **F2 · `security.finding_filed` has no publisher.** Declared as a gap in the
  `sec-orchestrator` card. Findings land as vault PRs; nothing emits an event. The weekly
  pass bounds the blind spot at 7 days, and that bound is the current mitigation.
- **F3 · Nothing measures the gap between a filed verdict and a merged fix.** We classify;
  [[platform-api-charter]] authors. The handoff is a proposal with no clock. A
  `sec.days_verdict_open` metric would close it — but proposing a **new** metric while the
  campaign runs is close enough to trigger 5's spirit that it is filed as a finding for
  [[decision-office-charter]] rather than added here.
- **F4 · Four founding artifacts are load-bearing on superseded numbers.**
  [[security-charter]] (94, the 4 fail-open defaults, `simpos` as live), [[security-premortem]]
  (M1's "all 94 in an allowlist"), [[security-schedule]] (*"ships red with all 94 routes
  listed"*) and [[security-agenda-board]]'s severity queue. The board is corrected in this
  wave; the other three are **not ours to edit under the wave-3 rules** and are recorded
  here so the next charter revision has the delta ready.
- **F5 · `ENDPOINTS.md` is stale on exactly the point OD-19 turns on**, and says so in
  OD-19 itself. Every task above reads source, not the atlas. The atlas correction belongs
  to whoever owns it; this is the second document to record that it is owed.

---

## 7. Questions for the founder

1. **INTEL-F4 — do SEC-1 and SEC-2 start merged?** Still **yes**, one team with two
   charters. New since the founding recommendation: the written split trigger
   (`sec.unguarded_authenticated_surface` = 0 with CI holding it) is now **six routes and
   one CI script away**, not ninety-four. The useful version of this question has changed
   to: *do we pre-commit the split date to the day S1 goes green?*
2. **The six undeclared `auth` routes — declare or leave?** Recommend **declare**
   (`@Public()` + an allowlist row naming the consumer). They are correct today by absence
   rather than by intent, and CI cannot tell an intended public route from a forgotten
   guard until the intent is written down. This is the last of OD-19 and it is a
   declaration question, not a hole.
3. **Item 6 — tokens in `localStorage`.** Open it now as a [[platform-api-charter]] change,
   or record it as a knowingly accepted exposure with an owner and a date? Both are
   legitimate ([[security-directive]] trigger 4). **Silence is not**, and it has been
   silent since 2026-08-24.
4. **`sec.fail_open_defaults` 4 → 1 (+1 dev-only).** Trigger 5 forbids redefining a `sec.*`
   metric while its value is non-zero without escalating. The value genuinely moved — the
   three JWT fallbacks became one fail-closed resolver — so this is an escalation, not a
   redefinition. Confirm we may republish it at 1.
5. **`GET /events/metrics` is public** (`events.controller.ts:107-108`) and serves
   ingestion counters to anyone. Deliberate, or a decorator that outlived its reason? A
   verdict of `delete` is available and is not ours to take alone.

---

## 8. Locks respected

- **Pricing model — deferred (OD-23).** No task proposes a price, a tier boundary, or a
  revenue-linked ceiling. `spend-tiers.ts`'s allowances are read as **safety defaults**
  and are described that way in their own source comment.
- **Brand / landing visuals — held.** Nothing here touches them. Sketch 059 is a
  throwaway thinking surface under the existing sketch conventions, not brand work.
- **No open decision is resolved here.** OD-19 gets its enumeration (S2) and a
  recommendation (Q2); OD-11 stays the named blocker on L-SEC-5 (S16); INTEL-F4 gets a
  sharpened question (Q1). All three remain open.
