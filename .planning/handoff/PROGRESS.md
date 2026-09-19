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

## 0-2026-09-19. Lane handoff after the finish-goal day (supersedes every older section where they differ)

Written by the orchestrating session (7d72f5cf) on 2026-09-19, before a session
limit, so any session can pick up. Re-measure before acting (CLAUDE.md §5b).

**Safety rules for whoever continues:** never use `git stash` (one stack for every
worktree; sync with `p4-scratch/lane_sync.sh`); commit only through
`p4-scratch/verify_index.sh` via `p4-scratch/heavy.sh`, with explicit paths; never
`--admin`; gate-owned files (ci.yml, decisions/README.md, CLAUDE.md, `.claude/`, gate
scripts) merge only on the founder's word; production is read with SELECT only.

**Main** is `15e7ac3a0` (it includes #396 trust-counter, #397 login endpaper, #398 login
Easter egg, and #399-#401 from other sessions). ADR numbers taken today: 0164 sessions,
0165 promotions sizing, 0166 register retirement, 0167 receiving RBAC (peer), 0168 three
Codex lanes dropped, 0169 white theme; others reached 0176, so the guard's next free is
0177. OD numbers: lane C = OD-124 (pushed); receiving OD-125..127; gate OD-128; sessions
OD-129..131; OD-132 is in #391's fix. The register retirement's decide rows come after
all of these.

**PR #391 (train/finish-2, worktree `wt-finish-train2`).** The audit at 22ad1b3a1 said
BLOCK on records (report in the PR comment, and `audits/391-22ad1b3.md` on
`wip/2026-09-19/handoff-data`). The fix is committed and pushed as `311968205`. Next:
1. Merge origin/main into the train. The last try conflicted on CLAIMS.jsonl and
   v3.0-TECH-DEBT.md and was aborted. Resolve CLAIMS by (id, verify) union, keep both
   register texts, and validate on the merged tree.
2. Put the M5 sentence from `results/fix391-final.json` (`pr_body_m5_sentence`) into the
   PR body.
3. Once CI is green, run `/pr-audit-gate 391` again. It is gate-owned, so it merges only
   on the founder's word.

**Branches pushed and ready for a PR** (each committed through verify_index):
`feat/page-help` adb7773cb, `feat/finish-relay` bf99fd87d (round-4 follow-up is on wip),
`feat/finish-public-doors` 0b9b719cb (lane C), `feat/finish-authorize-consent` c2ebb9a6b
(KL; round-4 follow-up is on wip), `feat/finish-admin-desk` 7537e6685 (IJ),
`feat/finish-arrival` 06eadb328 (C2), `docs/retire-tech-debt` 9c6bdc0be (ADR 0166 and its
dry-run tool; EXECUTE it only after the trains land, using the placement plan).

**Every lane after round 4.** A `wip/2026-09-19/<lane>` branch is a snapshot of that
worktree's uncommitted state. It is NOT for merge. Its commit message carries the Opus
last-call verdict, the must-fix list and the open founder questions. The live worktree
still holds the same files. Full data is in `results/r4-result.json` on
`wip/2026-09-19/handoff-data`.

| Lane | Worktree | Intended branch | State | WIP snapshot | Must fix | Founder Qs |
|---|---|---|---|---|---|---|
| settings | `wt-pg-settings` | `feat/page-settings` | NOT READY | `wip/2026-09-19/settings` 376071448 | 7 | 0 |
| help | `wt-pg-help` | `feat/page-help` | READY, committed + pushed adb7773cb | - | 0 | 1 |
| vprices | `wt-pg-vprices` | `feat/page-vprices` | NOT READY | `wip/2026-09-19/vprices` e2031a3eb | 3 | 1 |
| promos | `wt-pg-promos` | `feat/page-promos` | NOT READY | `wip/2026-09-19/promos` 923483407 | 5 | 1 |
| receiving | `wt-pg-receiving` | `feat/page-receiving` | NOT READY | `wip/2026-09-19/receiving` 8baa58110 | 7 | 2 |
| recs | `wt-pg-recs` | `feat/page-recs` | NOT READY | `wip/2026-09-19/recs` 18e53d4ff | 9 | 0 |
| cellar | `wt-pg-cellar` | `feat/page-cellar` | NOT READY | `wip/2026-09-19/cellar` e7afb2ce7 | 3 | 1 |
| live | `wt-fin-live` | `feat/finish-live` | NOT READY | `wip/2026-09-19/live` fe696d6d7 | 3 | 0 |
| links | `wt-fin-links` | `feat/finish-links` | NOT READY | `wip/2026-09-19/links` 27b6629c7 | 2 | 0 |
| notify | `wt-fin-notify` | `feat/finish-notify` | NOT READY | `wip/2026-09-19/notify` 7c26a3843 | 4 | 0 |
| IJ | `wt-fin-IJ` | `feat/finish-admin-desk` | READY, committed + pushed 7537e6685 | - | 0 | 0 |
| C2 | `wt-fin-C2` | `feat/finish-arrival` | READY, committed + pushed 06eadb328 | - | 0 | 0 |
| E | `wt-fin-E` | `feat/finish-action-integrity` | NOT READY | `wip/2026-09-19/E` 7205330cb | 6 | 4 |
| sessions | `wt-sessions` | `fix/sessions-follow-membership` | NOT READY | `wip/2026-09-19/sessions` b0b73913b | 6 | 0 |
| gate | `wt-gate-rule` | `feat/gate-owned-by-diff` | NOT READY | `wip/2026-09-19/gate` 6cf192b3d | 6 | 0 |
| adr0163 | `wt-wine-ml` | `docs/wine-ml-foundations` | NOT READY | `wip/2026-09-19/adr0163` b77b18779 | 4 | 4 |
| drops | `wt-drops` | `docs/codex-lanes-dropped` | NOT READY | `wip/2026-09-19/drops` ab0f94030 | 5 | 0 |
| placement | `/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/7d72f5cf-5e60-4e61-8521-469276f54e7f/scratchpad/review-0919/placement` | `docs/retire-tech-debt` | scratch only; data in wip/2026-09-19/handoff-data placement/ | - | 5 | 1 |
| theme | `wt-theme` | `feat/theme-white-default` | NOT READY | `wip/2026-09-19/theme` f50e08535 | 2 | 2 |
| recs-sketch | `wt-recs-sketch` | `docs/sketch-recommendations-goals` | NOT READY | `wip/2026-09-19/recs-sketch` 2a1d36a23 | 8 | 4 |
| relay | `wt-fin-relay` | `feat/finish-relay` | NOT READY | `wip/2026-09-19/relay` cb0e241d4 | 2 | 1 |
| KL | `wt-fin-KL` | `feat/finish-authorize-consent` | NOT READY | `wip/2026-09-19/KL` 1e083800c | 6 | 1 |

**Other sessions' uncommitted work (snapshotted 2026-09-19 ~17:40Z, worktrees untouched).**
Of 124 worktrees, 58 held uncommitted files or commits that had never been pushed.
- 18 are this session's lanes, snapshotted above.
- 35 more are pushed as `wip/2026-09-19/others/<worktree-name>`. These are peer Claude
  sessions, Codex and Cursor worktrees, the `wt-port-*` and `wt-p4*` lanes, and the main
  checkout. Two of them held a commit that was never pushed: jolly-hofstadter (aec15b075,
  the eight-file probe sweep) and objective-cohen (1592b6a5a).
- 5 are kept as LOCAL refs only (`refs/snapshots/others/<name>/20260919T1700`). A
  secret-pattern scan matched their diffs, so they are not pushed: page-finalization,
  public-pages and token-efficiency-ci (Codex), wt-e2e (Playwright artifacts; see the
  credential-leak note in memory), and wt-finish. Read these before pushing any of them.
- Every snapshot excludes node_modules, dist, coverage, test results, build output and
  .env files. None is for merge; the session that owns each worktree decides what to do
  with it.
- **[Updated 2026-09-19 ~18:00Z]** Every hit in those 5 was checked and is a false positive:
  "ask-the-sommelier" prose, `github_pat_` or `sk_live_` named inside code and docs, the
  env.example placeholders, and a spec's placeholder JWT (`signature-placeholder`). All 5
  are now pushed as `wip/2026-09-19/others/<name>`. Also pushed: the 4 local branches whose
  only commit was never pushed, as `wip/2026-09-19/branches/<name>`
  (fix/frontend-url-comma-list-in-links, fix/e2e-legacy-waves-schema-rot-gated,
  fix/current-user-has-no-id-field, fix/apps-web-e2e-tsconfig-types-node), and the 5 git
  stash entries, as `wip/2026-09-19/stash/0..4`. The only thing kept local on purpose is
  `reserve/adr-0164-0167`: a set of ADR-number placeholders that must never reach a remote.
  If CI's number guard saw them, it would report a collision.
- **[Cleaned 2026-09-19 ~18:30Z, on the founder's word "whichever are not valuable anymore delete them ... be careful"]**
  Deleted only what was proven redundant:
  - **Four lane-sync stashes** (C, notify, relay, receiving). Over 99% of their added lines
    are in the lanes today. The rest are later renumberings; receiving's migration moved to
    20260919170000.
  - **`fix/e2e-legacy-waves-schema-rot-gated`**. PR #354 is merged. Its only other commit
    was a local copy of the audit report, whose PASS marker is on the PR.
  - **`reserve/adr-0164-0167`**. Every real ADR 0164-0169 is now on a pushed ref.
  - **Remote copies of the above**, and one stale worktree registration.
  Each deleted object keeps a local backup ref under `refs/snapshots/deleted-2026-09-19/`.
  Kept:
  - three unlanded fix branches: frontend-url-comma-list, current-user-has-no-id-field and
    apps-web-e2e-tsconfig; their new files are not on main;
  - the May 2026 `gsd/v1.0-archive` stash, whose value is unclear;
  - the five flagged worktrees, all holding work not landed anywhere. Measured: 358 to
    38,820 of their added lines are in no landed or lane ref.

**Ordering constraints recorded today:**
- The promos cut merges only after the comms branch `claude/wizardly-knuth-31d531`
  (a peer's senders desk) lands and the founder flips `mudavym_design_communications`
  on. Its red CLAIMS row `ADR-0160-PROMOTIONS-OFFERS-ONLY` is deliberate.
- The cellar goes live only after the sketch-121 beside-the-list layout is built.
- /vendor-prices goes behind a flag.
- /recommendations stays dark until sketch 122 is reviewed.
- The register (v3.0-TECH-DEBT.md) is deleted last, by ADR 0166, after the trains.

**Founder answers taken 2026-09-19 (verbatim where quoted; these are the source until
each lands in its ADR):**

- **2026-09-19 ~04:00Z answers:** sketch 118 (login/register flyleaf) = **B, the endpaper** (NOT the README's
  recommended A): permanent wax-seal pattern panel left with the mark (house name once known), working page right;
  same fields and flow. Tech-debt register: he wants v3.0-TECH-DEBT.md DELETED ("delete all that tech debt.md that
  messes with our head"); survivors live **split by kind** (checkable defects -> CLAIMS rows, his decisions ->
  OPEN-DECISIONS, paperwork -> owning ADR). His per-item TECH-DEBT marks are in artifact TvfJKKnkhe5pVZnqLDunPX (db: marks/*)
  - that artifact holds NO sketch-118 mark (checked 2026-09-19 04:30Z); the 118 = B source is his AskUserQuestion answer
  "B, the endpaper" in orchestrator session local_0b0fd291 ("Session continuation"); build = its workflow wf_9301ea03-3e6 in wt-login.
- **118 build (2026-09-19 ~05:00Z, session 366a7a, PR #397):** Google also on /login's FIRST page (ADR 0149 row 35 / 0143
  bracket); his 9 build directions + "The mark draws" logo motion live in sketch 118 README; 4 more signature moments
  offered -> "if we don't need it then don't" (none). **Easter egg** (click endpaper -> front matter poem; sketch
  118/front-matter.html): "Book is great", REMOVE the dog-ear hint ("not intrigued by that" - nothing should invite the
  click), "you decide rest" -> builder chose Direction 1 (turn back to the front matter), own PR AFTER #397; record the
  pick in sketch 118 README in that PR. **#397 MERGED 2026-09-19 14:32Z as 1fba79f57**, deploy verified (bundle has the
  endpaper; gateway MATCH cb756083e); shipped DARK - prod visitors still get today's page (VITE_MUDAVYM_PUBLIC off), the
  flip is his keystroke. **Easter egg (Direction 1, no dog-ear) MERGED as PR #398 = 08c04100e (2026-09-19 16:03Z)**,
  /login house path only, verified live with the override (dark for visitors); pick bracketed in ADR 0149 row 35.
  Open follow-up chip "Endpaper follow-ups" (underline 2.3:1 -> 3:1, CSS-scope static guard, StrictMode draw test,
  phaseNow ref, optional One Tap cancel while the front matter is open).
  Earlier the same night: "do what the optimal scenario would do, no we can do this later or second plan" and "all
  actions full power ... sonnet 5 high-max, opus last call".
- **Sessions (ADR 0164) answers 2026-09-19:** F1 last house remembered "Per device (Recommended)"; F2 return window "7 days
  (Recommended)"; F3 one house left after removal -> "Show the chooser (Recommended)"; F5 a house grant never makes an
  organisation owner -> "Never via a house (Recommended)"; F4 the chooser sits in the sketch-118 B endpaper shell.

**ADR 0163 wine-library answers (AskUserQuestion, 2026-09-19 ~05:50Z), 12 of 12:**
1 publish gate = keep both human gates (per-field pilot of ~60 cells + a human look at real houses' wines);
2 legal review = "Ship now, fix later" (AGAINST the recommended Turkish-lawyer-first gate; he saw the cost: trained
models are not retrained, so a mistake cannot be undone); 3 market price k = 5, guards (a)-(g) as drafted;
4 claim checker = his own words "we're gonna use JEV and it's already inside the repo" = TypeSafe AI's Jev
(jev-1.13, hosted API, DPA/MCA, no training on customer data), researched in the UNTRACKED
.planning/07-reference/TYPESAFE_AI_OVERVIEW.md + its INDEX.md row in the main checkout (commit them with 0163;
language coverage beyond English is not stated in that record - check); 5 seat = Max 20x $200/mo; 6 wine type =
colour x style {still, sparkling, fortified}, sweetness separate; 7 reviewer floor = Wilson lower bound;
8 menu PDFs = keep until superseded; 9 sommelier pay = rewards now, rate parked on OD-23; 10 EU = opt-in for EU
houses; 11 six houses = confirm both groups (Gullit's Tavern, Yaren's Fine Dine, Meyhouse Palo Alto, YARDOM are
not real; Chez Community + The Old House Pub are real); 12 sommelier adds = own-voice notes only, facts need a citation.

**19-lane blocking answers (AskUserQuestion, 2026-09-19 ~09:20Z):** vendor-prices = behind a flag (vendor_prices
mudavym_design_* column migration, he flips it; NOT live on merge); ADR 0165 promotions = LOCK AS WRITTEN (fixed 180-day
comparison age, largest-single-order volume); cellar = build the sketch-121 beside-the-list layout FIRST, then go live for
every house; low-stock = add 'email' to low_stock_channels column DEFAULT (small additive migration in the notify PR).
**Lane answers batch 2 (~09:30Z):** settings tally = ship the counted sentence now (from data, labelled 'computed
here'), 'Waiting on you' rail later; settings digest = correct the dossier to the per-house control that shipped;
vendor-prices conditional quote = never seal now + follow-up lane for structured terms (min qty/unit/valid-until; seal =
lowest price the house gets at its usual order size, ADR 0165 basis; unparsed terms never seal); badge words = keep
landed/agreed; promos bundle line with no comparison = keep excluding; promos draft-order panel = /orders, own lane.
**Lane answers batch 3 (~09:45Z):** promos source-email link = "build it later, document it" (record as a named
follow-up); promos grade window = keep trailing 540 days; THEME (cross-cutting, his words): "I realized all pages will
be charcoal however I don't want it, I prefer the white look to be honest. People should have the option to choose" ->
default ground = white/paper, with a per-person choice of charcoal; this revises ADR 0149 row 6 (charcoal default) and
needs its own ADR (next free 0169) + a lane. RECOMMENDATIONS (sketch 120 feedback, long spoken answer; he said only the
first part is a requirement, the rest is brainstorming): KEEP the days rail on top; SHOW THE HOUSE'S DECIDED GOALS ON
TOP ("whatever the restaurant has decided ... on top as the goal"); recommendations must be brief/punchy with how to act,
plus a goals chart where we recommend setting a goal; apply ONE-TAP ACTIONS that approve automatically ("get back to
work"). Purpose: where an owner/manager looks when stuck, to see what they could have done, or to predict the future and
prepare early. Picks: 1A over 1B; side sheet liked (unsure); 2B: wants to see how the mail looks; a newspaper-style
digest "maybe another software" (brainstorm); 3 subject-account side sheet good if it shows more than the table; 3B
inline dismissal with a real day, no overlay = maybe; "definitely not the fifth one"; "sixth one is all right".
Recs stays dark; next = a new recs sketch round with goals + one-tap actions (the 5 remaining recs lane Qs fold into it).
**Lane answers batch 4 (~10:00Z):** cellar bottle price (his words): "Our library price will be just the average price
that will be updating daily ... However, we're going to add a per house bottle price. That's a huge thing ... gotta be
dynamic" -> add a dynamic per-house menu_price_bottle; the library price = a market average refreshed daily; relay 4xx =
split by code (400/403/422 final, 401 parks); channel-default standing rule = untouched rows follow a widened default,
customised rows never touched; stuck Arrival batch = only the sealing manager resumes; /ask roles (his words): "do not
give money or sensitive incentives like sales etc to the staff, maybe we should exclude staff from this equation" ->
money/sales readings owner+manager only (firm), leaning to no /ask for staff at all (confirm with the /ask sketch);
provider grant = tab scope OK; /ask = cell picker confirmed; /ask dates = decide with the /ask sketch; /authorize
frames: "do what's needed, not short term" -> give /authorize + /authorize/complete a proper signed-in frame that honours
the design flag and public-door switch; consent receipts = delete with the account; ADR 0164 org owner with no house =
keeps the org role but opening a location needs an active house membership; chain create/rename/delete = measure the 3
routes, decide in its own ADR, no change now; settings digest email = drop the free field when #391 lands + add a
per-person "send me the digest" opt-in on Settings; gate pytest-config ownership: DELEGATED ("do what the best approach
for long term, quality, sota, scalability") -> own exactly what can influence the gate's test run (conftest under
scripts/, the confcutdir, and the ci.yml flags `-c /dev/null --confcutdir=scripts`, pinned by a test), not every depth.
**Digest builder's choices in #391 (asked ~11:20Z, owed before migration 20260917010100 merges):** (a) per-person
subscriptions table = already his round-11 answer ("ship now"); (c) recipient_email never mailed = answered batch 4 (drop
field + per-person opt-in); (b) category gate: DELEGATED ("do the most sota, quality, scalability with right architecture
structure") -> the subscription alone is the consent/gate; remove the legacy categories.ai check; if the digest ever gets
a second channel it joins OD-121's per-category channel vocabulary as its own category; (d) late limit = up to 12 hours
(as built; past it the period is expired, never sent stale); (e) a new subscription or a house switching on within 12 h
after a due time is served at the next sweep (as built).
**WhatsApp reply seal (asked ~11:35Z, #391 audit M4), his words:** "as long as they click on the send button nothing to
worry, they should be able to delete their messages as well, think about it as -> house built framed but all whatsapp
features just like how you open on web" -> AMENDS locked ADR 0112 F10 for WhatsApp messages a person sends by clicking
Send (the click is the consent; no hold-to-approve seal). New requirements: people can delete their messages; the
product is WhatsApp-Web-like messaging inside the house frame. Feasibility of delete-for-everyone on Meta's Cloud API must
be checked before promising it (record honestly).

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
