# 0100 — Triage every security alert by reachability, not by severity label

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** codeql, dependabot, ssrf, ssti, xss, redos, prototype-pollution, security, triage
- **Links:** [[0087-phantom-dependency-pinned-real-one-unpinned]], [[0092-parity-compares-against-what-was-merged]], PR for `fix/security-alerts-triaged-and-closed`

> **Number:** this ADR was assigned **0098**. That number was already taken on
> a ref and in a peer worktree by
> `0098-a-preference-is-read-from-the-column-it-lives-in.md`. The next
> candidate, **0099**, was *also* taken — by an unpushed peer worktree
> (`agent-ae8b06cd5016b01e7`, `0099-vendor-email-had-no-caller-identity.md`)
> that no ref-based sweep can see. This is **0100**.
>
> This is the third recorded instance of the same failure: concurrent sessions
> each take "the next free number" from a trunk that cannot show them unpushed
> peers. The memory rule already says to sweep `git worktree list` as well as
> refs — that is what caught 0099, and it caught it only *after* the CLAIMS
> rows had been written under the wrong id and had to be renumbered. **A
> reserved ADR number handed to a session is stale the moment a peer session
> starts.** Sweep both, immediately before writing, and again before pushing.

## Context

The brief described **29 open CodeQL alerts**. The API reports **382**, of
which **57** carry a `security_severity_level`; the remaining 325 are
maintainability notes (`py/unused-import` and similar). A second tool (Trivy)
contributes another 266 open alerts that are not CodeQL at all. The "29" was
not reproducible from any filter tried, so this ADR works from the measured
57 and says so rather than quietly reconciling to the brief.

The standard applied to each finding is the one set by the earlier `py/redos`
precedent: **decide by reachability and by what failure would mean, not by the
severity badge.** A finding that is unreachable today but sits one keyword
argument from a live sink is worth closing; a finding rated `high` whose
failure mode is benign is worth dismissing in writing.

## Options considered

1. **Bulk-dismiss the low-severity majority, fix the criticals.** Cheapest, and
   wrong in a specific way: two of the three criticals turned out to be
   *less* dangerous than a `high` sitting in the same file, and the most
   valuable single find (an unvalidated bulk DTO) came from a `high`
   loop-bound alert that reads like noise.
2. **Fix every alert.** Not possible honestly — several are false positives
   where "fixing" means contorting correct code to satisfy a query, and one
   class (`py/clear-text-logging` in a demo script) is the script's purpose.
3. **Triage each by reachability, fix the real ones at the class level, and
   write the reason for every dismissal.** Chosen.

## Decision

Each alert was traced to its source, and grouped by *root cause* rather than by
alert id, so one fix closes a cluster. Counts below are measured, not
estimated.

### CodeQL — the numbers

| | Count |
|---|---|
| Open CodeQL alerts (all) | 382 |
| …of which carry a security severity | **57** |
| Fixed in this change | **36** |
| Dismissed with a written reason | **16** |
| Left open, named below | **5** |
| Non-security maintainability notes, untouched | 325 |

### Criticals: 3 flagged, 2 genuinely exploitable, 1 latent

- **`py/full-ssrf` ×2 — `menu_analyzer_agent.py:626,727` — REAL, unauthenticated.**
  `POST /api/v1/scan/menu` takes `image_base64: Optional[str]` with no
  validation, and the agent branches on the **value**
  (`image_source.startswith("http")`), not the field name. Posting
  `{"image_base64": "http://169.254.169.254/latest/meta-data/..."}` makes the
  orchestrator fetch cloud metadata from inside the deployment network. Neither
  scan router carries an auth dependency (`scan_routes.py:81`).
  Fixed with `utils/safe_fetch.py`: scheme allowlist, public-IP-only check on
  every resolved address (v4, v6, and IPv4-mapped v6), per-hop redirect
  re-validation, size cap, timeout. **The same sink existed twice more in
  `visual_verification_agent.py:419,490` and CodeQL did not flag either** —
  both were fixed, so the fix count exceeds the alert count for this class.
- **`py/template-injection` — `template_engine.py:127` — REAL but not yet reachable.**
  A plain `jinja2.Environment` compiling caller-supplied template strings.
  Measured pre-fix: `{{ ''.__class__.__mro__[1].__subclasses__() }}` renders
  13,804 characters of gadget chain. No caller passes `use_jinja=True` today —
  which is precisely the redos precedent, so it was fixed
  (`SandboxedEnvironment`) rather than dismissed. Post-fix the same payload
  raises `SecurityError: access to attribute '__class__' of 'str' object is
  unsafe`.

### The most valuable find came from a "high", not a critical

`js/loop-bound-injection` on `inventory-ledger.service.ts:195` pointed at
`BulkTransactionDto` (`inventory-ledger.dto.ts:346`), which had **no validation
decorators at all** — no `@IsArray`, no `@ArrayMaxSize`, and critically no
`@ValidateNested`/`@Type`, so every nested transaction object in a bulk call
went unvalidated by the global ValidationPipe. Fixed with the full decorator
set and `BULK_TRANSACTION_MAX = 500`.

### Other fixes, by root cause

- **One regex HTML parser replaced 8 alerts.** `GmailService.htmlToPlainText`
  and vendor-intel's `htmlToText` were separate `String.replace` chains
  producing `js/bad-tag-filter`, `js/double-escaping`,
  `js/incomplete-multi-character-sanitization` ×3 and `js/polynomial-redos`.
  Both now call one single-pass scanner
  (`apps/api-gateway/src/common/html/html-to-text.ts`): linear time, handles
  `</script >`, cannot reassemble `<scr<script>ipt>`, decodes entities once.
  17 tests, written against the exact bypasses.
- **`js/xss-through-dom` — `SommelierAI.tsx:619` — REAL.** Assistant messages
  went through a markdown-ish replace chain into `dangerouslySetInnerHTML`
  with nothing escaped. The prompt is built from wine and vendor names, so the
  model's output is attacker-influenceable. Now escape-first
  (`apps/web/src/lib/assistantMarkdown.ts`): after escaping, the markdown
  patterns can only emit the fixed tag set, so the output tag set is closed by
  construction.
- **`py/jinja2/autoescape-false` — `docgen/render.py:61` — REAL.** Invoice data
  interpolated into HTML that Chrome renders to PDF. Verified safe to enable:
  no template under `scripts/docgen/templates/` uses `|safe` or `Markup`.
- **`py/polynomial-redos` ×2 — `template_engine.py`.** `\{([^}]+)\}` rescans to
  end-of-string from every `{`. Measured: 4000 chars 0.044s → 16000 chars
  0.613s (quadratic). `[^{}]` makes it flat. **Three occurrences existed; only
  two were flagged.** All three fixed.
- **`py/clear-text-logging` — `seed_database.py:1088-1090` — REAL.** These read
  `SEED_DEMO_PASSWORD` / `SEED_MANAGER_PASSWORD` from the environment and
  printed the values, so any run with real credentials set writes them to the
  job log. Now prints the variable *name*, never the value.
- **`js/biased-cryptographic-random` — `auth.service.ts:942`.** Unbiased today
  only because `CHARSET` happens to be 32 characters and 256 divides evenly.
  Switched to `crypto.randomInt`, so uniformity of organisation invite codes no
  longer depends on nobody ever removing an ambiguous letter from the alphabet.
- Also fixed: prototype-key filter in `deepMerge`, `Object.create(null)` for
  the inbound-email header map, `base64url` for the Gmail MIME encode,
  hostname-parsed Upstash check (TS + Python), CSPRNG fallback for the UX
  session id, backslash-first markdown cell escaping, full regex-metacharacter
  escaping in the SMS preview, HTML+log escaping in `gmail-reauth.js`,
  `sanitize_for_log` on three template-manager log lines, and stack-trace
  suppression in `studio_routes.py`.

### One fix was made, then reverted — OD-93 was right and this pass was wrong

`py/log-injection` ×2 on `synth/snapshots.py:432,452` were initially "fixed" by
sanitising `archetype_id`, on the reasoning that `refresh_snapshot` is reachable
from `POST /api/v1/admin/synth/refresh` (`synth_routes.py:111`) and therefore
request-derived. **That reasoning was wrong, and an existing verified claim
already said so.** `_resolve_ids` (`synth_routes.py:37-45`) rejects any
archetype not in `list_archetypes()` with a 400 *before* the call, and
`refresh_snapshot` independently raises `KeyError` for any id that is not a
literal `JSONL_SOURCES` key. The value at both log sites is always one of a
handful of literal strings and cannot carry a newline. The route is also
admin-authenticated (`Depends(verify_admin_key)`).

The change was reverted. It surfaced only because `check_decision_claims.sh`
failed OD-93's row — the claims harness caught a regression that reading the
code alone had not. **Reachability was asserted from one call site without
checking the guard between them**; the lesson is to run the claims guard
*before* concluding a triage, not only before committing.

### Dismissed, with reasons (16)

- **`py/log-injection` ×2 — `snapshots.py:432,452`** and **`py/log-injection` —
  `admin_routes.py:166`.** All three per OD-93, re-verified above: the first two
  are allowlist-gated literals, the third is an `int` bounded by
  `Field(ge=0, le=4)` after Pydantic validation.

- **`js/user-controlled-bypass` ×2 — `toast.service.ts:208`.** Already
  fail-closed by prior work: the `else if` chain at lines 221-237 rejects both
  "secret configured but no signature" and "no secret configured" whenever
  `enforceSignature()` holds, and it always holds in production
  (`!mockMode || NODE_ENV === "production"`). CodeQL flags the `if (signature
  && timestamp)` shape without following the else branches.
- **`js/remote-property-injection` ×2 — `user-preferences.service.ts:33,35`.**
  Rated high, **measured not exploitable**: `result = { ...target }` builds a
  fresh object every call, so `result["__proto__"] = x` rebinds only that
  object. `Object.prototype` was verified unpolluted for `{"__proto__":…}`,
  `{"constructor":{"prototype":…}}` and the nested form. Hardened anyway
  (the safety is an accident of one line), but the *alert* is a false positive
  and is recorded as such rather than claimed as a fix.
- **`py/clear-text-logging` ×4 — `demo_weekly_report.py`.** Prints the
  operator's own phone number in an SMS *preview*; showing the destination
  before sending is the feature.
- **`py/clear-text-logging` — `seed_demo_user.py:98`.** Prints the hardcoded
  literal `demo123`, which is already in the source two lines above. No env
  input, no disclosure.
- **`py/clear-text-logging` — `image_collector.py:176`.** The "sensitive" value
  is an image URL.
- **`js/loop-bound-injection` — `scan-parser.service.ts:184`.** Bound is the
  chunk count from `splitPdfIfLarge`, derived from document structure and
  already capped by `MAX_SPLIT_DEPTH = 3`.
- **`js/identity-replacement` — `x12.spec.ts:280`.** Test fixture.
- **`py/bad-tag-filter` — `test_docgen.py:358`.** Test script.
- **`js/log-injection` / `js/reflected-xss` accounting note:** both
  `gmail-reauth.js` findings were *fixed*, not dismissed, despite being a
  local dev script — the fix was two lines.

### Left open (5) — named, not silently dropped

- **`js/polynomial-redos` ×3** — `inbound-address.service.ts:39`,
  `sender-reputation.service.ts:26`, `procurement.service.ts:2971`. Same class
  as the ones fixed above and probably real (all three parse
  attacker-supplied email addresses or vendor strings), but each needs its own
  regex rewritten and its own behaviour test, and this change is already large.
  These are the highest-value remaining items.
- **`js/xss` — `gmail.service.ts:692`** (`html: options.html`). The taint is
  real — AI-drafted vendor replies flow into outbound email HTML — but the
  "fix" is a product decision, not a code one: our own outbound HTML is
  *supposed* to be HTML, so closing this means deciding what a vendor-facing
  draft is allowed to contain and sanitising against that allowlist. Needs the
  founder.
- **`py/stack-trace-exposure` — `scan_routes.py:1117`.** The returned object is
  a structured improvement-cycle result dict, not a trace. Whether its
  internals should be public is a judgement call about that endpoint's
  audience.

Alert accounting reconciles exactly: **36 fixed + 16 dismissed + 5 open = 57**.

### Four more dismissals, on alerts this branch's own fixes raised

CodeQL re-scanned the PR and flagged the fixes themselves. Three were fair and
were fixed in code (see the follow-up commit); four were the guard being
mistaken for the hole, and are dismissed:

- **`py/full-ssrf` — `safe_fetch.py`.** The sink inside the SSRF guard.
  `assert_url_is_safe` runs on the line above it and again on every redirect
  hop; a fetch helper necessarily contains a fetch.
- **`py/clear-text-logging` ×3 — `seed_database.py`.** After the restructure the
  only value that can reach `print` is a hardcoded literal already declared in
  the same file. Measured with `SEED_DEMO_PASSWORD` and `SEED_MANAGER_PASSWORD`
  set to sentinel values: neither sentinel appears in stdout. Same ground as the
  `seed_demo_user.py` dismissal above.

Running total on GitHub: **20 alerts dismissed with a written reason**, each one
individually, none in bulk.

## Dependabot: 9 criticals, 2 real first-party, 7 transitive

| Package | Scope | Imported here? | Verdict |
|---|---|---|---|
| `jspdf` | runtime | **Yes** — `tableExport.ts:215`, `exportHelpers.ts:45` | PR #22 bumps 4.0.0 → 4.2.1, patch. Recommend merge. |
| `vitest` | dev/test | **Yes** — 78 files | Test runner; CVE needs `vitest --ui` exposed. |
| `form-data` | transitive | No | via deprecated `request@2.88.2`; `form-data@2.3.3` is the vulnerable copy, `4.0.5` also present and patched. |
| `shell-quote` | transitive | No | 1.8.3 in lock. |
| `tar` | transitive | No | both `6.2.1` and `7.5.2` are ≤ 7.5.18. |
| `handlebars` | transitive (dev) | No | 4.7.8. |
| `basic-ftp` | transitive (dev) | No | 5.1.0, via `get-uri` → proxy-agent chain. |
| `@xhmikosr/decompress` | transitive (dev) | No | build tooling. |

**Methodology caveat, recorded because it produced two wrong answers before it
produced right ones.** ADR 0087's "is it actually imported?" test is only as
good as the grep. A first pass reported `jspdf` and `prometheus-client` as
phantoms. Both were wrong:

- `jspdf` is loaded with `await import('jspdf')` — a **dynamic** import, which
  a `from|require` pattern misses.
- `prometheus-client` is imported inside a `try:` with a multi-line
  parenthesised name list in `core/observability.py:37`, which a single-line
  `from X import Y` pattern misses.

Any future application of the 0087 test must search dynamic imports and
multi-line/guarded imports, or it will manufacture phantoms. **Absence of a
grep hit is not absence of a dependency** — the same failure shape as
[[0089-absence-reported-as-health]].

### Dependabot PRs — 19 open

**Recommended merge (8), deliberately NOT executed.** Merging to `main`
auto-deploys to Railway production. A production deployment is a human
decision; this pass stops at recommending, with the evidence attached to each
PR. The eight are listed so acting on them is a single pass, not a re-triage.

`#22` jspdf (critical fix, real dep, patch) · `#166` `@types/google.maps`
(types only) · `#6` sqlalchemy 2.0.25 → 2.0.49 (**patch within 2.0, not a
major — the brief listed it as breaking; it is not**) · `#9`
prometheus-client 0.19 → 0.25 (real, try/except-guarded) · `#8` pytest-mock ·
`#87` python-dotenv (self-evolution only) · `#88` scikit-learn 1.4 → 1.5
(self-evolution only) · `#168` `@tanstack/react-query` (minor within v5).

Each of these carries an analysis comment on the PR itself, so the reasoning
survives where the decision gets made rather than only here.

**Closed with reason (4) — done, not proposed.**

- `#165` **express 4.22.1 → 5.2.1** — the gateway runs `@nestjs/core` and
  `@nestjs/platform-express` `^10.3.0`. Express 5 support arrived in NestJS 11.
  Merging this breaks routing in production.
- `#171` `@typescript-eslint/eslint-plugin` 6 → 7 and `#28`
  `@typescript-eslint/parser` 6 → **8** — mismatched majors. The plugin and
  parser must share a major; merging either alone breaks linting.
- `#16` `@storybook/addon-viewport` 8 → 9 — already `CONFLICTING`/`DIRTY`, and
  the viewport addon folded into Storybook core in v9, so the standalone
  package is superseded rather than upgradable.

**Left open, needing verification this worktree cannot do (6+1).**
`#170` framer-motion 10 → 13 (renamed to `motion` in v11+) · `#169` zustand
4 → 5 (**call sites checked: all 8 use `import { create }` + `zustand/middleware`
and none passes the removed `equalityFn` second argument — likely compatible,
but unverified at runtime across web *and* mobile**) · `#167` class-validator
0.14 → 0.15 (1,600+ decorators gate every request DTO; 0.x minors are breaking
by convention) · `#89` pillow 10.2 → 12.3 (touches `requirements.prod.txt`; no
`ANTIALIAS`/`textsize` usage and `Image.LANCZOS` is still valid, so likely fine)
· `#21` sentence-transformers 2 → 5 (**does not touch `requirements.prod.txt`**,
so not production-facing) · `#20` pytest-cov 4 → 7 (test-only) · `#2`
pnpm/action-setup 2 → 6 (changes the pnpm major CI validates the lockfile with).

### The class that will not be fixed — and the one that already was

The brief named `ecdsa` `GHSA-wj6h-64fc-37mp` as a known unfixable advisory
here. **It is not present in any state.** Measured: zero `ecdsa` alerts (open,
fixed or dismissed), zero occurrences of that GHSA id, and `ecdsa` is not
pinned in any requirements file.

The reason is that **ADR 0087 already fixed it, and the fact was carried
forward past its own fix.** `ecdsa` reached this repo only as a transitive of
`python-jose`; 0087 deleted `python-jose` as a phantom dependency, and all four
of its advisories now read `fixed`. `requirements.prod.txt:52-57` still carries
0087's note explaining the upstream-wontfix issue as the *reason* it was
removed — which is exactly the sentence that got re-read as a live problem.
This is the "numbers get re-measured, never copied forward" rule (CLAUDE.md
§5b) catching a stale claim in the brief that commissioned the audit.

The genuinely unpatchable set is **5 open advisories with no
`first_patched_version` at all**:

| Package | GHSA | Severity | Note |
|---|---|---|---|
| `image-size` | `GHSA-5p2g-fcmc-qvqq` | high | transitive |
| `image-size` | `GHSA-w3rx-r6r6-pgpr` | high | transitive |
| `react-router-dom` | `GHSA-jjmj-jmhj-qwj2` | medium | **direct dependency of `apps/web`** |
| `request` | `GHSA-p8p7-x288-28g6` | medium | SSRF; `request` is deprecated/EOL, so no patch will come |
| `dompurify` | `GHSA-x4vx-rjvf-j5p4` | low | transitive |

`request` is worth naming twice: it is EOL, it is unpatchable, **and** it is the
package pulling in the vulnerable `form-data@2.3.3` that accounts for one of the
nine criticals. Removing whatever depends on `request` closes two advisories at
once and is the highest-leverage dependency work available. It was not attempted
here because it needs a lockfile regeneration this worktree cannot verify.

## Clean-environment verification

This change modifies **no** requirements file and **no** `package.json`, so
there is no dependency delta to install-verify. The ADR 0087 bar was applied to
the production file as it stands instead, in a fresh venv, because the fixes
must work in the dependency set the Dockerfile actually installs
(`Dockerfile:25-26` installs `requirements.prod.txt`, not `requirements.txt`):

```
pip install -r services/agent-orchestrator/requirements.prod.txt   exit 0
pip check                                        No broken requirements found.
import jwt        -> venvprod/.../jwt/__init__.py
distribution      -> PyJWT 2.13.0
python-jose       -> absent
ecdsa             -> ABSENT
starkbank-ecdsa   -> 2.3.1  (a different package; not the advisory subject)
```

`ecdsa` being absent from a clean production install is the direct measurement
behind the correction above: the advisory the brief asked to be reported has no
carrier left in this repo.

Both new security primitives were then exercised **inside that prod-only
environment**, not just the dev one:

```
SandboxedEnvironment + __class__ walk   -> SecurityError
sandbox renders an ordinary template    -> "Hi Vine Quarter"
assert_url_is_safe(169.254.169.254)     -> SsrfBlocked
assert_url_is_safe(https://example.com) -> allowed
fetch_image_bytes(metadata URL)         -> SsrfBlocked before any socket opens
```

## Consequences

- Easier: four whole vulnerability classes are gone at the root rather than
  per-site — SSRF (one guarded fetch helper, 4 call sites), regex HTML parsing
  (one scanner, 2 call sites, 8 alerts), SSTI (sandbox), unescaped chat HTML.
- Harder: `htmlToText` output is no longer byte-identical to either old chain
  (paragraphs are now separated by a blank line). All 1,894 gateway tests and
  1,195 orchestrator tests pass, including the existing vendor-page-extraction
  suite, so no caller depended on the old spacing — but a snapshot added later
  could.
- Given up: `assert_url_is_safe` validates the addresses a host resolves to at
  call time, which leaves a DNS-rebinding window. Closing it needs connection
  pinning to the validated IP, which httpx cannot express per-request. Stated
  here rather than implied by silence.
- Revisit when: the orchestrator gains authentication on `scan_routes` (the
  SSRF guard stops being the only control), or when NestJS moves to 11 (PR #165
  becomes mergeable).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
