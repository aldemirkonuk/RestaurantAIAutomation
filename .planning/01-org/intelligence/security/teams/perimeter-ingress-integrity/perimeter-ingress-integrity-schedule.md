---
type: schedule
division: intelligence
department: security
team: perimeter-ingress-integrity
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-agenda-board]]", "[[security-schedule]]", "[[access-control-tenant-isolation-schedule]]", "[[integration-engineering-charter]]", "[[platform-api-charter]]", "[[skills-charter]]"]
---

# Perimeter & Ingress Integrity — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Fail-mode check — flag any new control that permits a request when its secret is unset | `sec.fail_open_defaults` |
| **Per PR** | Secret-shape check — flag a credential read from a query parameter, or a new `VITE_*` var whose name contains `SECRET`/`KEY`/`TOKEN` | `sec.secrets_in_url_or_bundle` |
| Weekly | L-PII-1 ingress verdicts — one module per session, verdict template filled | `sec.unverified_public_ingress` |
| Weekly | L-PII-2 fail-mode audit | `sec.controls_with_no_secret_test` |
| Weekly | New public-route review — any route added with `@Public()` or no guard, sender named before merge | Verdicts |
| Monthly | L-PII-3 rate-limit multiplier report | `sec.effective_ai_tier_limit` |
| Monthly | L-PII-4 secret-surface inventory — **sunsets after 3 flat runs** | `sec.env_vars_with_named_consumer` |
| Monthly | Observe-then-enforce reviews — read one close-time of would-have-rejected logs on any pending control change | Enforce / hold decision |
| Quarterly | Charter staleness sweep (foundation §3.3, §6) | Archive or revision |

**Anti-sprawl, applied honestly to two entries.** L-PII-4 is an inventory task in a
recurring costume and carries an explicit 3-run sunset. The weekly ingress-verdict sitting
drains 43 routes and then has no steady-state purpose — it is deleted, not renamed, when
the baseline is confirmed. What survives the campaign is the **per-PR** work and the weekly
new-public-route review: something has to read every new `@Public()` forever.

**The observe-then-enforce entry is a real cadence, not a ceremony.** A rejected webhook
does not page anyone — it just stops arriving. Changing a control on a live ingress route
without first reading what it would have rejected is how vendor data goes missing for a
month ([[perimeter-ingress-integrity-directive]], integration-break rule).

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.
Registry governance is [[skills-charter]]'s (Applied AI); we author.

Two skills, each citing the real past instance foundation §3.3 requires. Both **proposed,
not built**.

### `webhook-signature-audit`

- **Trigger.** Weekly, per ingress route; and per PR touching any controller under
  `toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`, or
  `common/orchestrator/inbound-email.controller.ts`.
- **Doneability.** For each route, emits the five verdict fields — `sender`, `proof`,
  `fail_mode`, `verdict`, `evidence`. **A route with a `proof` and no named `sender` is a
  FAILED check, not a pass.** That inversion is the entire point of the skill.
- **Real past instance.** `simpos` carries a correct, fail-closed, tested HMAC
  (`simpos.service.ts:498-502`) and eleven unguarded routes, and is labelled *"webhook
  module — expected public, must verify signatures instead"* (`ENDPOINTS.md:536`). A
  signature-only audit passes it. A sender-first audit fails it at field one.
- **Owner.** This team. **Scheduled:** yes, weekly + per-PR.

### `fail-open-audit`

- **Trigger.** Per PR touching any guard, strategy, or module that reads a secret from
  config; and monthly across the repo.
- **Doneability.** Emits a list of code paths where a missing secret leads to `return true`,
  `skip`, or `logger.warn` followed by normal processing. Passes only at **zero**. Must also
  assert that each fail-closed branch has a test — `pos-hub.service.spec.ts:239` is the
  reference.
- **Real past instance.** Three independent `|| "your-secret-key-change-in-production"`
  fallbacks shipped separately (`jwt.strategy.ts:12-13`, `auth.service.ts:64-66`,
  `auth.module.ts:28-30`), each by someone who did not know about the other two, plus
  `tenant.guard.ts:38-46` doing the same thing for authentication. Four instances of one
  shape means the next one arrives by default, not by mistake.
- **Owner.** This team. **Scheduled:** yes, per-PR + monthly.

### Deliberately not proposed

- **`secret-rotation`** — premature and actively misleading while two known leak paths
  defeat rotation by construction: the `?secret=` query credential is already in access-log
  history, and `VITE_DEV_AUTH_BYPASS_SECRET` is compiled into every bundle ever built.
  Close the paths, then automate the rotation.
- **`cors-policy-generator`** — the CORS policy is one file with one unscoped pattern
  (`main.ts:26`). A generator is more machinery than the problem, and
  [[platform-api-charter]] owns the file anyway.
- **`ddos-response`** — no incident history, no on-call, and detection-and-response was
  rejected at `intelligence.md:505` with an entry trigger. A runbook nobody reads is
  sprawl with a serious face.
