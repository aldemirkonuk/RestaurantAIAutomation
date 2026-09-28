# Handoff: the merge queue and the page wave, 2026-09-12

The orchestrating Claude session (b3992196) wrote this on the founder's instruction:
*"finish the pages and put everything into documents for other LLMs to work with ...
finish (merge push main = live prod) all branches and sessions' work before the api
credit turns 0"*. It is updated as work lands; this file's git log is its history. When it
disagrees with the tree, the tree wins. Re-measure before acting on any line here
(CLAUDE.md section 5b).

**Why this exists now:** subagents hit the weekly Anthropic limit (it resets
2026-09-18 11:00 America/Detroit) twice today, in the middle of the work. Anything below
marked "agent died" has partial or no edits in its worktree. Inspect `git status` there
before continuing.

## 0b. Founder-authorized page finalization, 2026-09-13

This update supersedes older audit-only and queue-status instructions where they differ; it preserves their evidence below. The founder has now requested complete Wave Four and successor page finalization, thorough research, detailed documentation in the existing Obsidian vault, and the associated commits, pushes, merges and deployments. Work begins from main `60ed83a7`; PR373's endpoint repairs are already merged, so the older statement that they follow in another PR is historical.

The dated review and its final PDF are now indexed at [[MUDAVYM-TRANSITION-2026-09-13]]. Its findings remain tied to the audited SHA; completion of a later fix must be recorded with its own tests and commit. Current canonical host is `mudavym.com`, with `www` redirecting to it. New chat progress is three or four bracketed words; the detailed account belongs here and in the owning page/ADR.

Product choices already answered in ADR0143–0145 are carried forward. Genuine unresolved choices remain questions, not inferred permission: especially page-specific visibility/content, first Ask readings, notification recipient authority and remaining motion/overlay proposals. The broader execution authorization permits finishing decided work without repeatedly asking to commit or deploy; it does not turn historical scratch suggestions into founder decisions or authorize undisclosed vendor sends/charges during verification.

The vault import is complete. All seven public pages now have a shared-shell path behind the existing public switch; page dossiers record their behavior and remaining decisions. Isolated checks: 108 unique web tests (14 optional capture cases skipped), ten gateway tests and both TypeScript checks passed using the source checkout's installed dependencies through ignored local symlinks. No package lock or dependency version was changed. Actual browser coverage and its limits are recorded in [[handoff/evidence/public-pages-2026-09-13/IMPLEMENTATION-AND-VALIDATION]]. No production deployment has been performed by this group.

## 0a. Final state, 2026-09-13 (supersedes sections 0 and 3 wherever they differ)

**On main:** #363, #366, #361, and merge train 2 (#372). The train carried #367 parity,
#328 go-live docs, #365 ledger guard, #364 probe safety with its two sibling commits, #370
p4 after #289, #369 MCP port, and this handoff doc. Those PRs and train 1 (#371) are closed
as landed or superseded. The endpoint faults (ADR 0147) follow in their own PR.

**Still open, in priority order:**
1. **#368 text-sender port.** Its five ADR-0121 CLAIMS rows (P0-PUSH, P0-PHONE,
   P1-WEBHOOK, P1-WINDOW, P1-HTTP-CENSUS) hold locally but REGRESSED in CI's "Decision
   register matches reality" job. The likely cause is a verify command that depends on
   the local environment (node_modules or jest). Read those rows' `verify` fields
   against what that CI job installs.
2. **#362 security gate.** Rewrite the guard on PyYAML (brief in section 3).
3. **#349 nightly E2E.** Its merge of main is in progress in wt-e2e, with 6 conflicts.
4. **Ports:** calpush, ov0, ov1, ov2, motions (section 4). The founder chose to land all
   of them.
5. **The pages build** (section 5), and the open founder forks (section 6).

**Two findings that are fixed nowhere:**
- `GET /logs` correlationId reads across houses.
- No unique index on Meta phone number id.

## 0. Latest state (supersedes section 3 wherever they differ)

Written while API credit was down to its last $15. Subagents failed on the weekly limit on
every launch after the first wave. Re-measure everything below before acting on it.

**Merged to main today:**
- #363 (the audit gate waits only on gating checks), beb00db4
- #366 (Ask AI bounded, daily cap), b76243e9
- #361 (a stock write names its house), round 3

**In flight: the merge train.** Branch `train/2026-09-12`, worktree `wt-train`, script
`scratchpad/train.sh`, log `p4-scratch/train.out`. It merges the ready branches into one PR
so that strict main needs one CI cycle, not eight:
- docs/handoff-2026-09-12 (this file)
- #367 parity self-test
- #328 go-live docs
- #365 ledger guard
- #364 probe safety, with the two stacked sibling commits
- #370 p4 work since #289 (publicDesign, PublicShell, /login and /register, ADRs 0143-0145)
- #368 text-sender port
- #369 MCP port, with migration 20260912200000
- the endpoint-faults branch, ADR 0147, **only if** its verify_index run was green

Check the train PR. If CI is green, post the PASS marker on the founder's word, run
`gh pr merge <n> --squash` in a separate call, then close the individual PRs as landed. If
the train left a branch out, the log says why.

**Endpoint faults (wt-endpoint-faults), the one known risk.** The wine-search fix tripped
`check_read_columns_exist.py`: 3 unreadable reads against a shrink-only ceiling of 2. The
new unreadable site is the suggestions query in `apps/api-gateway/src/wines/wines.service.ts`
(getWineSuggestions). Several shapes were tried and the probe still counted it. The probe
that lists unreadable sites is `scratchpad/rc_probe.py`: copy it into scripts/ and run it.
If the train log says endpoint faults were left out, fix that one read (or split the fix
out), re-verify, commit, and land it alone.

**Not landed, and why:**
- **#362 (the security gate can fail).** The PyYAML rewrite of
  `scripts/check_security_gate_can_fail.py` was never done. The agent died twice, leaving 1
  changed file in wt-secgate; inspect it. The full brief is in section 3.
- **#349 (nightly E2E).** c1221a9f is pushed (trace off, gateway URL guard, loader). The
  merge of main is IN PROGRESS in wt-e2e with 6 conflicts:
  - e2e-prod.yml and conftest_prod.py (apply ADR 0137: waves D/E/G retired, their secrets
    removed)
  - EXISTING-TEST-INVENTORY.md
  - TECH-DEBT
  - README
  - CLAIMS

  `p4-scratch/e2e-merge.md` may hold a partial analysis.
- **Ports of the 2026-09-06 branches:** calpush, ov0, ov1, ov2 and motions. Their worktrees
  hold the 3-way apply with conflicts unresolved (section 4 lists what each needs). The
  founder chose to land all of them.
- **The pages build (section 5)** did not start, for lack of credit.
- **Dependabot:** left out by the founder.

**New findings from the ports, not fixed anywhere:**
- Main's `GET /logs` accepts a `correlationId` that reads `event_store` rows across houses
  for any signed-in user. The MCP port removed the same argument from its own tool; see
  p4-scratch/ports/mcp.md.
- The database allows two houses to hold the same Meta phone number id. The text-sender
  port refuses that case in code, but the unique index needs its own migration; see
  p4-scratch/ports/text.md.

## 1. Rules a continuing session must keep

- Read CLAUDE.md, then `.planning/decisions/README.md`, then this file.
- Production Supabase (`exzueerziesmczwlhomd`) is **read-only** unless the founder says
  otherwise in chat. Migrations **auto-apply to production on merge to main**.
- `main` is strict and requires five contexts: CI Complete, Beverage identity key,
  Guest merge policy, Fresh database equals remote, and Code queries only relations
  production has. Every merge makes every other PR BEHIND. Merge `origin/main` in, then
  wait about 9 minutes of CI. Never `--admin`, never force-push.
- The `require_pr_audit` hook blocks `gh pr merge <n>` until the PR has a comment
  `<!-- pr-audit-gate: pr=<n> sha=<7 chars> verdict=PASS -->` for the **current** head.
  Post the comment in one Bash call. Run `gh pr merge <n> --squash` in the next.
- **Founder decision, 2026-09-12: "Your word as PASS, no agents".** For today's queue a
  marker is posted on his word, with no audit agent. Each marker comment must say that
  no audit ran and list the CI and local verification behind it (see #361 and #366).
- Agents never run git state commands (add, commit, checkout, merge, push and the like).
  The parent session commits, with explicit paths.
- No emoji in code, docs or reports. Never read repo `.env` files.
- Verify an index before committing it:
  `bash /Users/aldemirkonuk/Projects/p4-scratch/verify_index.sh <worktree> <checks...>`.
  It archives `git write-tree`, so stage first. Checks include gw_tsc, gw_tsc_spec,
  gw_eslint:<paths>, jest:<paths>, web_tsc, web_eslint, vitest:<paths>, guard:<script>,
  claims, boots and prefixes. Counts reported anywhere come only from such a run.
- The shell is zsh: `for f in $list` does not word-split. Use arrays, or `bash -c`.
- **CLAIMS.jsonl merge trap:** a union resolution keeps BOTH halves of a correction.
  After resolving, drop every row that main removed since the merge base. #361 needed
  that (deb4544f): a stale ADR-0090 row turned CI Complete red.
- Vercel preview checks fail at 100 deployments per day on the free tier. They are not
  required. The CI-side "PR Audit Gate" job has no Anthropic credit and is red on every
  PR. It is not required either.

## 2. Founder decisions taken in session today (verbatim answers)

| Question | Answer | Recorded in |
|---|---|---|
| Audit depth for the merge queue | "Your word as PASS, no agents" | this file; each PR marker comment |
| Seven 2026-09-06 branches that never landed | "Triage each, then decide" | this file, section 4 |
| MCP server (ADR 0132, was Proposed) | "Lock 0132 and land it" | to record in ADR 0132 when ported |
| Text sender + calendar push | "Land both now" | ADR 0121 / 0111 review rows when ported |
| Overlay packets 0, 1, 2 (ADR 0112) | "Port all three now" | when ported |
| Motions doc (ADR 0134) | "Land it as Proposed" | when ported |
| #349 nightly E2E trace leak | "Fix trace, then land it" | ADR 0135 "Audit fixes" |
| Dependabot #339-#346 | "Leave all eight out" | this file |
| Ask AI spend cap | "A daily cap that really resets" | ADR 0146 Correction (PR #366) |
| Speech in the arrival | "On-device, keep only the rows" | ADR 0143 founder answers; 0113 Q6/Q7 |
| What the arrival's seal covers | "Only what Mudavym proposed waits" | ADR 0143; 0144:31 bracket |
| Auth email brand | "Rename the auth emails only" | ADR 0143; OD-27 bracket |

Earlier the same day, and already in ADRs 0143-0146:
- land my three PRs first, then build;
- the public design switch is cherry-picked onto p4;
- confirm is owner or manager;
- endpoint scope is what the pages need plus the named gaps;
- /sommelier redirects to /ask, and Ask reaches every house behind the switch;
- Haiku picks and Sonnet 5 answers, and the model's own knowledge is marked;
- the seal is over the order at approval;
- agent restart is for operators only; an operator has both a SQL-only flag and the Studio developer role;
- the flyleaf opens /get-started;
- /authorize uses a server challenge;
- home links to /login;
- the new CVE is handled by pinning the trivy DB.

## 3. The merge queue

| Item | Branch / worktree | State at writing | Next step |
|---|---|---|---|
| #363 gate waits only on gating checks | merged | **MERGED** beb00db4 | none |
| #366 Ask AI is bounded (daily cap) | `fix/ask-ai-is-gated` / `wt-askai` | de196d9d, 5/5 green, PASS marker posted | `gh pr merge 366 --squash`; after that every other PR is BEHIND |
| #361 a stock write names its house | `fix/a-stock-write-names-its-house` / `wt-tenantfix` | deb4544f, CI running | when 5/5: marker, merge. If BEHIND: merge main, drop removed claim rows, push |
| parity self-test stops crashing | `fix/parity-self-test-is-deterministic` / `.claude/worktrees/jolly-lovelace-bc70ef` | 41e2ded5; 300/300 self-test runs green; claims 311/311; PR opened | CI, marker, merge |
| endpoint faults (the pages' endpoints) | `fix/page-endpoints-tenant-faults` / `wt-endpoint-faults` | **uncommitted**; notifications now fully scoped; 5 old controller-spec expectations to update | fix specs, verify_index, commit, PR, merge |
| #349 nightly E2E, four states | `test/nightly-e2e-modernised` / `wt-e2e` | c1221a9f fixes trace (off), gateway URL guard and loader. **Merge of main in progress**, conflicts in 6 files (agent may have died) | resolve per ADR 0137 (D/E/G retired), verify, commit merge, push, marker, merge |
| #362 the security gate can fail | `fix/security-gate-can-fail` / `wt-secgate` | d278824e; round 3 OVERTURNED (line-parser guard). Round-4 agent launched (may have died) | rewrite the guard on `yaml.safe_load` with duplicate-key refusal (full spec: p4-scratch/secgate-round4 brief in this session's transcript); harness `/private/tmp/claude-501/.../scratchpad/harness.py`; bracket the false sentence at ADR 0142:190 |
| p4 work since #289 | `feat/mudavym-design-p4` / `wt-p4` | 11 commits a914b8cf..449342f0 not on main: publicDesign.ts switch, PublicShell, /login and /register behind the switch, ADRs 0143-0145 | new branch from main, cherry-pick those 11 (skip merges), verify, PR, merge. Pages stay dark behind flags (ADR 0131) |
| #364 probe assertions assume empty production | `fix/migration-probe-safety-two-live-migrations` | DIRTY; Fresh database red | merge main; decide whether to stack 1592b6a5 (worktree `objective-cohen-ed25a2`, unpushed) and aec15b07 (worktree `jolly-hofstadter-770fde`, branch `fix/migration-probe-safety-eight-literal-deletes`, unpushed). Both sit on 673989b7 and both edit `scripts/check_migration_probe_safety.py` |
| #365 ADR 0031 ledger guard | `claude/vigorous-hawking-2745a5` | DIRTY; Fresh database red | merge main, verify, marker, merge |
| #328 go-live ADR 0131 docs | `feat/mudavym-go-live` | BEHIND | merge main, marker, merge (scripts land; nothing runs them) |
| stranded docs commits | a37c6200 on `docs/modal-sketches` (sketch 103 canvas); 98229aeb local-only in `/private/tmp/claude-501/...vigilant-sammet.../scratchpad/wt-e2e-waves` (PR 354 audit report) | not on main | one docs PR |
| Dependabot #339-#346 | — | left out by the founder | none |

## 4. The seven 2026-09-06 branches: triage, and the founder's call

Each branch was cut from p4 before #289 squash-merged. None of their commits is an
ancestor of main or p4. The triage sampled added lines against main (script in this
session's scratchpad, `triage.sh`), and all seven are genuinely unlanded. Port
worktrees exist, created from main beb00db4. `git apply --3way` of
`git diff <base> origin/<branch>` is **already applied in each, with conflicts
unresolved**. The agents that were resolving them died on the weekly limit.

| Port worktree | Branch | Base | Conflicts at apply | Must also do |
|---|---|---|---|---|
| `wt-port-mcp` | feat/connect-mudavym-mcp-server | 161d92cc | 2 unmerged, 3 files with markers | Lock ADR 0132 (founder, today). Rename migration `20260906170000_a_house_gives_its_assistant_a_key.sql` to `20260912200000`. Confirm keys are hashed, reads are house-scoped, and a revoked key is refused. check_route_exposure |
| `wt-port-text` | feat/connect-text-sender | 161d92cc | 3 / 4 | The Meta webhook must verify X-Hub-Signature-256 on the raw body with a timing-safe compare. Main's text module has moved on, so reconcile. Add an ADR 0121 review row |
| `wt-port-calpush` | feat/connect-calendar-push | 161d92cc | 1 / 2 | Rename migration `20260906190000_...` to `20260912200100`. ADR 0111 stays Proposed |
| `wt-port-ov0` | feat/overlays-packet-0-primitive | 161d92cc | 3 / 4 | ONE Sheet: keep #359's Escape and focus-trap fixes. Add SheetStack, Denied and Stub on main's Sheet API. the OD number it files must not collide. Do not resurrect .planning/01-org files main deleted |
| `wt-port-ov1` | feat/overlays-packet-1 | 161d92cc | clean (1 file with marker-like text) | A clean apply is not proof: compare every touched file with what #289 rebuilt |
| `wt-port-ov2` | feat/overlays-packet-2 | 161d92cc | 4 / 5 | Sealed acts (drafted reply, approve from the bell): confirm auth, house scope and seal on each endpoint they call |
| `wt-port-motions` | docs/motions-and-overlays-per-page | 5443a0b8 | 4 / 5 (orders.md, receipts.md, CLAIMS) | ADR 0134 lands as Proposed, its 14 forks open |

The overlay packets do not import each other: 1 and 2 do not use packet 0's SheetStack,
Denied or Stub. They can land in any order, but they share .planning page notes and
CLAIMS rows.

## 5. Pages still to build

The goal is every page, plus every endpoint the pages call, working, authenticated,
validated and tenant-scoped. Sources: `/Users/aldemirkonuk/Projects/p4-scratch/wave/DIGEST.md`
(eight page dossiers: forks, verdicts, build tasks) and ADRs 0143, 0144 and 0145 on p4.

1. **The seven signed-out doors on PublicShell** (ADR 0143 section 1). The wordmark and
   "Published on Mudavym." link to /login. /login and /register are already improved
   behind the switch.
2. **/admin and /admin/health become one desk.** Agent restart and stop are for operators
   only. An operator has BOTH a platform flag that only SQL can set AND Studio's
   `developer` role. That needs a migration, a guard and a registry of the routes that
   require it. Today the restart and stop methods take only an agent name and no route
   reaches them (`orchestrator.py:497,525`).
3. **/get-started is C's book** (ADR 0143 section 4 and its founder answers; ADR 0144):
   - the flyleaf, five folios each carrying its own state, never a percentage;
   - speaking a folio uses on-device browser recognition and keeps only the rows, each
     marked `spoken`;
   - only what Mudavym proposed waits for one held seal; typed entries post at once.

   Build gaps named in the ADR: `config.propose_batch`, the `configuration_step_skipped`
   audit action, producers held one by one, and a vendor's usual currency on the terms
   DTO.
4. **/ask plus the /sommelier redirect** (ADR 0145): Haiku picks, Sonnet 5 answers within a
   60 s budget, and the model's own knowledge is marked as not from the house's books.
   It builds on /ask-ai (PR #366).
5. **/authorize** (ADR 0144): a server challenge redeemed at authorize. It is bound to the
   integration, the digest of the words shown and the retention, and the provider URL is
   bound to the sealing browser.
6. **/help, /vendor-prices, /promotions, /recommendations/catalog.** Their forks are still open (section 6).
7. **Auth emails renamed to Mudavym:** verification (`auth.service.ts:986,1011,1033`),
   reset (`auth.service.ts:2077`, `email-templates/password-reset.template.ts:49,54`) and
   invite (`email-templates/studio-invite.template.ts:19`). Nothing else is renamed (OD-27).

## 6. Open founder forks, not yet asked

- **Promotions:** the senders and prospects tabs; the window for "bought N".
- **Help:** waiting queues; the staff readiness line; contact channels.
- **Recommendations catalog:** is it actionable?
- **Public pages:**
  - how /privacy and /v/:slug are treated;
  - resending while signed out;
  - the invite preview;
  - Google Fonts.
- **Vendor prices:**
  - the status of ADR 0117 and 0124;
  - pooled prices vs price by class;
  - typed currency;
  - whether staff can read the log.
- **Arrival:** where the threshold lives.
- **Vendor intel:** public-register rows with no house. Options A-D, recommendation C,
  in `p4-scratch/endpoint-faults/vendor-intel-identity.md`.
- **OAuth:** who may disconnect an integration for a user with no tenant
  (`p4-scratch/endpoint-faults/integrations-oauth.md`).
- **Notifications:** who may notify whom. POST `/notifications/order-approval`,
  `low-stock`, `delivery`, `price-negotiation`, `system-alert` and `send-email` still send
  to any user id or email address the body names. They were not fixed because the rule
  is a product call.

## 7. Where the evidence is

- `p4-scratch/endpoint-faults/*.md`: per-module endpoint fault reports (8)
- `p4-scratch/wave/DIGEST.md`: the page dossiers
- `p4-scratch/ask-census/`: the /ask census (the catalogue stage never ran)
- `p4-scratch/ports/*.md`: port reports, if any agent finished
- `p4-scratch/verify-index-<pid>.log`: every verify_index run
- this session's transcript:
  `~/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/b3992196-3993-4dfd-b3d7-f5b7b880c747.jsonl`

*This document adds a file under `.planning/handoff/` without naming a document to
retire (CLAUDE.md section 4). The founder asked for it explicitly. That is named here as
the exception, not assumed.*


## 2026-09-13 — active page-finalization integration

The founder authorized the complete Wave Four/successor page implementation, commit/push/merge and deployment. The goal remains active; the deployed website has not yet been claimed updated. Canonical domain stays mudavym.com, www redirecting to it. Current branch is codex/page-finalization, based on main60ed83a7.

- Foundation commit6ab500a0 is pushed:19 files, shared overlay/keyboard/focus stack, loading/denied states and asynchronous approval receipts, plus the web's previously undeclared Tailwind plugin dependency.197 foundation/team tests passed in the root integration checkout. No production flag changed.
- Action integrity40 files and public entry/vault plus inventory overlay85 files are integrated but not committed at this checkpoint. Their source manifests and isolated test results are in the task's execution directory. The action tranche passed1,627 gateway tests and246 native tests; public entry passed108 web/10gateway tests, typechecks and build; foundation+inventory overlays passed2,840webtests and typecheck. Integrated checks are now running; those isolated numbers are not claims about an untested combined tree.
- The operations desk is implemented behind its false-by-default admin flag. It has SQL-only plus Studio-developer platform authority, a reviewed3-route registry, data-free shared health, pre-dispatch receipts and explicit unknown remote outcomes.19gateway,12Pythonhealth,5deskbehavior tests and isolatedPG17 migration checks passed. Independent review found pre-existing lifecycle restart/consumer cleanup defects, now being repaired before operator controls are eligible for rollout.
- The founder-supplied browser email matched one verified Mudavym manager account with no current Studio developer grant. No role or platform grant has been created. Support contact remains unanswered. All unfinished product decisions remain in OPEN-DECISIONS and the page notes.
- The public audit PDF and detailed reports are imported into the existing07-reference vault index. No second vault was created. New public pages use the shared shell and /login home link; Safari visual checks so far cover forgot-password at1080/375px, charcoal/paper, and missing-token reset at375px. Other visual cases remain to be checked.
- Arrival work continues in the public-pages worktree from the exact sketch104C: Currency; What we pour; Whom we buy from; What we hear about; The assistant. Backend folio/proposal persistence, seven-day undo and local-only speech constraints remain under implementation. Other new pages, full Ask readings, calendar/text/remaining overlay/motion/security/E2E ports, complete rollout and live verification remain required.

Local runner issue: unchanged files sometimes block in read/mmap after filesystem metadata-only ctime updates. No output timeout is called success. Two pending commits were interrupted and confirmed exit130 before retry. One old Obsidian metadata inode was preserved; exact base bytes were restored. Using Git's per-command core.trustctime=false retainedmtime/size and exact staged objects and allowed the regular commit to complete. No global setting, hook orCI gate was disabled. The evidence note is in the task execution directory and will be archived with the final rollout records.
