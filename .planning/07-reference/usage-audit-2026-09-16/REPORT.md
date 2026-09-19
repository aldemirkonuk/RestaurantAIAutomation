# Mudavym token usage audit and reduction plan

Date: 2026-09-16. Status: measured diagnosis; revised to preserve unlimited research and parallel Workflow research. A separate isolated CI patch removes provider-specific URL configuration; other optimizations remain proposals.

Founder clarification: keep uncapped research depth, parallel research, and targeted-reading rules. The revised plan optimizes model assignment, evidence transfer, repeated reading, and writing. It replaces the initial recommendation to restrict research branching or default all research to one agent.

This report supersedes the earlier chat-only hypothesis that poor cache reuse or large tracked binary files were the primary cause. It does not supersede product decisions or authorize changes to account settings. Findings use local Codex request records, the founder's Claude usage export, and repository evidence at `6ab500a0b83e4f67f568c76097a2edc45cb13e3a`.

## Finding

The strongest demonstrated cause is repeated processing of large conversation contexts across many agent requests, amplified by parallel research and expensive model/reasoning choices. Cache reuse is high. The repository's research instructions actively encourage expanding investigation, even while requiring short final messages. Short chat replies do not constrain the underlying work.

The recent heavy workload is measurable; the change from the beginning of the paid subscription is not. Local Codex records cover September 10-16, not a year of historical use. A change in allowance, promotion, billing policy, or account entitlement cannot be established from these records.

## Measured Codex usage

Read 56 local rollout files, of which 49 contained request usage records. The fixed cutoff is `2026-09-16T13:33:00Z`, before this audit's requests. Observed request range: `2026-09-10T14:44:08.322Z` through `2026-09-16T12:41:55.978Z`. Dates below are UTC unless otherwise stated.

| Scope | Requests | Input tokens | Cached input | Cache reuse |
|---|---:|---:|---:|---:|
| All local records, including automatic approval review | 2,864 | 356,239,533 | 342,155,776 | 96.05% |
| Mudavym working-directory records, including automatic review | 1,651 | 221,556,347 | 211,995,136 | 95.68% |
| Mudavym model requests, excluding automatic approval review | 1,525 | 209,245,695 | 202,153,984 | 96.61% |
| Other working directories, without detected project references | 1,190 | 132,838,163 | 128,598,912 | 96.81% |

Another 23 requests mention the project from other working directories. Folder/reference classification is a useful attribution estimate, not a billing boundary. Other projects account for approximately 37.3% of all observed input volume; they share the account allowance but their token fraction is not necessarily their allowance fraction.

Across all records, output was 1,597,229 tokens, including 451,827 reasoning tokens. Input already includes cached input; output already includes reasoning. Adding those subcategories again would overcount.

The median request contained 121,870 input tokens; the 90th percentile was 205,413. There were 1,754 requests above 100,000 input tokens and 365 above 200,000. Maximum observed request input was 254,647 tokens. No observed request exceeded 272,000 input tokens: the earlier suggestion of a surcharge above that threshold is not supported by this sample.

### The concentrated September 13 run

From approximately 13:55 to 17:18 America/Detroit, one coordinator and three audit workers made 1,504 model requests. All were attributed by turn context to GPT-6 Astra with `ultra` reasoning.

| Role inferred from spawn order | Request thread ID | Requests | Input tokens |
|---|---|---:|---:|
| Coordinator | `01a09be9-033f-7230-9e4e-9505b56c104b` | 353 | 45,748,133 |
| Product/code worker | `01a09be9-6e30-71f3-b257-e052189b79a8` | 381 | 53,212,350 |
| Infrastructure worker | `01a09be9-81b5-7a60-bc6f-4fb21dc03d39` | 369 | 50,355,067 |
| Handoff/corpus worker | `01a09be9-9385-7390-954c-28f9f9008d93` | 401 | 58,499,473 |
| Total | | 1,504 | 207,815,023 |

The coordinator explicitly spawned `product_code_audit`, `infrastructure_audit`, and `handoff_corpus`; worker start times match those calls. Some copied session metadata carries the parent's ID, so usage attribution uses the request record's `thread_id`, not that metadata.

These four logs contain 270 `send_message` calls and 19 compaction events. Coordination calls are not individually proven wasteful, and compaction can save tokens. Together with the request totals, they establish a substantial, sustained multi-agent workflow. Parallel execution compresses wall-clock time while multiple conversations consume usage.

Across all recorded requests, 92.7% of input volume was associated with `ultra` reasoning. Astra and Sol together represented 94.2% of input volume. The historical workload therefore differs materially from the current default setting of Sol/high. Reasoning effort has no universal fixed token multiplier; the sample does not isolate how much of the spend it caused independently of task complexity.

Current configuration at `~/.codex/config.toml:2-4` specifies Sol, high reasoning, and `service_tier = "priority"`. Recorded thread settings also contain `priority`. This proves the requested setting, not the effective billing tier of every response. Confirm Standard/Fast in the app; do not automatically equate this legacy/internal value with a verified 2.5x charge. Official documentation says Fast mode increases credit use, including 2.5x for the supported models discussed here. [OpenAI speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed).

One recorded weekly window rose from 0% at `2026-09-13T20:07:24.345Z` to 100% at `20:51:36.798Z`, about 44 minutes. Multiple reset epochs occur in the records. This corroborates rapid depletion but does not establish why resets happened or permit summing percentages across windows. The live account check during this audit showed 87% weekly usage. The returned `prolite` identifier is not enough to infer the user's purchased plan or a downgrade.

## Claude report supplied by the founder

Export timestamp: `2026-09-16T13:36:05.638Z`. These figures are user-supplied and were not independently recomputed from Claude request logs.

| Model label in export | Ordinary input | Output | Cache read | Cache write |
|---|---:|---:|---:|---:|
| Fable 5.1 | 75.8k | 3.4M | 680.3M | 9.5M |
| Opus 5 | 24.4k | 1.9M | approximately 1B | 25.7M |
| Combined | 100.2k | 5.3M | approximately 1.6803B | 35.2M |

Unlike the Codex fields above, Claude's ordinary input, cache write, and cache read are separate categories. Approximate input cache reuse is `1,680.3 / (1,680.3 + 35.2 + 0.1002) = 97.94%`. This is the fraction of input tokens read from cache, not the percentage of requests with a cache hit.

At a hypothetical 10% cache-read price, 1.6803 billion reads alone represent the input-price equivalent of 168.03 million ordinary input tokens. This is an illustration, not a model-specific dollar estimate or subscription allowance formula. Cache writes and 5.3 million output tokens are additional work. [Claude caching documentation](https://code.claude.com/docs/en/prompt-caching).

The report also shows 17,921 requests over seven days, session API time of 1,115 minutes versus 86 minutes wall time, and weekly-all usage at 100%. If the time measures cover the same work, their approximately 13:1 ratio is consistent with overlapping/aggregated agent work, not proof of exactly 13 agents. The session token totals and seven-day request total have different labels; do not divide one by the other as though their windows were verified identical. Zero local requests in the last 24 hours does not undo earlier weekly usage.

The displayed $545.96 session cost is not evidence of a $545.96 subscription charge. Anthropic explicitly distinguishes the Session API-cost display from subscription billing. [Claude cost documentation](https://code.claude.com/docs/en/costs).

## Repository drivers

1. **Expanding research is explicitly required.** `CLAUDE.md:31` calls research depth uncapped; `:88` says the branching factor should grow with depth; `:91` mandates parallel Workflow research; `:101` discourages stopping branches early. These are a direct behavioral incentive to multiply requests. The Codex workflow above independently demonstrates parallel audit expansion; the logs do not prove that CLAUDE.md caused every Codex action.
2. **Short answers coexist with expensive hidden work.** `CLAUDE.md` already has sensible targeted-reading rules at `:63`, but its research mandate works against a bounded workload. Writing a long report to a file still requires model output tokens. A two-sentence final answer does not make the whole session cheap.
3. **Default orientation can become very large.** `CLAUDE.md:52-54` routes sessions through the decisions index. At the inspected commit, `.planning/decisions/README.md` is 299,122 bytes, and the tech-debt register is 284,359 bytes. These need compact routing and excerpts, not complete reads at startup.
4. **The Codex instructions also broaden exploration.** Workspace and worktree `AGENTS.md` ask for thorough cross-layer tracing and durable documentation. Those remain valuable for risky changes; routine tasks need explicit risk-based boundaries and completion criteria.
5. **There is substantial material available for accidental broad reads.** The commit has 5,399 tracked files: 1,641 planning files totaling 56.6 MB, and 656 dataset files totaling 63.3 MB. Disk bytes are not prompt tokens. The tracked model weights and images are not automatically read or billed as text merely because they are in Git.
6. **Large modules make targeted work harder.** The committed procurement service is 322,451 bytes and Orders.tsx is 172,053 bytes. These warrant symbol-focused reads and gradual decomposition where code maintenance justifies it, not an immediate project-wide refactor for token savings.
7. **Planning is partly coupled to executable checks.** `apps/api-gateway/src/distributor-feed/feed-request-letter.spec.ts:20` constructs a path into `.planning/07-reference/`; the test reads that document and deliberately fails if it is missing. CI also invokes decision-claim checks. Moving the entire vault without dependency work would break checks.

The earlier recommendation to move all planning and datasets immediately was too broad. The earlier suggestion that tracked image paths were malformed was also unproven; a path resolving to a directory can be a legitimate symlink. Neither is used as a cause in this report.

## Reduction plan, in priority order

### 1. Define each worker's job while preserving research depth

Research can expand as far as necessary. Every branch should name its question, relevant evidence, assigned model, and what would resolve the question. Further unanswered questions can create further branches. Repeating a completed investigation of unchanged evidence should require a reason.

Use scripts for exact counts, paths, hashes, dependency lists, and known checks. Use Haiku for locating likely files and classifying evidence; use Sonnet for tracing ordinary behavior and checking proposals; use Opus for ambiguous architecture, conflicting decisions, and consequential judgment. These are proposed starting assignments, with escalation for uncertainty or failed verification, not claims that any model guarantees a correct answer.

The existing ADR 0050 already routes mechanically checkable enumeration to Sonnet and splits cheap discovery from difficult decisions. It forces Opus for production, authorization, migrations, ADR changes, and several other consequences. Extend that existing policy with a Haiku discovery tier rather than introducing a competing policy. Keep final autonomous-merge authority unchanged until a revised policy is tested and recorded.

Claude supports explicit per-agent model selection; implicit inheritance can keep exploratory workers on the parent's expensive model. Verify the model actually assigned in the running task. Do not force every worker to Haiku globally. [Claude subagent documentation](https://code.claude.com/docs/en/subagents).

Suggested instruction:

> Keep research depth uncapped and use parallel Workflow research. Give each worker one clear question and avoid duplicate ownership. Use the least expensive suitable model, escalating when evidence is incomplete, conflicting, or consequential. Return findings with source revision, exact locations, verification, and open questions. Reuse unchanged evidence; retain independent review where judgment matters.

### Benefits and tradeoffs

| Change | Benefit | Tradeoff and protection |
|---|---|---|
| Compact orientation | Every task avoids loading the full decision/history log | An incomplete index can hide a relevant rule. Generate entries from all ADRs and support targeted follow-up reads. |
| Versioned planning briefs | Implementation starts with decisions and acceptance criteria | A brief can become stale. Record source revision and evidence-file hashes; invalidate affected sections when decisions or dependencies change. |
| Smaller evidence handoffs | Opus avoids repeating discovery already verified by other workers | Summaries can omit facts. Include exact source excerpts, links and uncertainty; Opus checks pivotal evidence and contradictory claims. |
| Less repeated coordination | Fewer status-only requests and copied reports | Workers can drift. Coordinate on changed assumptions, conflicts, milestones and completion. |
| Selective physical separation | Search results stay focused and large generated data stays out of normal exploration | Broken paths or lost provenance. Check inbound references, tests and recovery paths before moving anything. |

### Does Opus need to reread everything?

No. A discovery worker should deliver a short evidence packet: question; source revision and file hashes; candidate files and symbols; exact supporting excerpts; checks performed; exceptions and unresolved points. Opus reads that packet and the source needed for the decision. It can reopen a whole dependency chain when the evidence demands it, but does not have to repeat a complete repository search. A Haiku summary alone is not sufficient evidence for a production or security approval.

For example, Haiku can find the order submission handler, endpoint, service method, applicable decision and tests. Sonnet can trace their interaction. Opus can investigate an ambiguous transaction boundary using those exact locations. Missing evidence and surprising test results trigger escalation; low model confidence alone is not the only signal.

### How AGENTS.md and large files fit

Keep stable shared rules in the root instructions: identity, source of truth, research depth, evidence discipline and preservation of unrelated work. Move page-finalization-specific delivery permissions, rollout history and communication rules into the page-finalization brief. Keep targeted layer instructions close to the code. This reduces irrelevant context and stops historical task instructions from shaping unrelated tasks.

Cross-layer tracing remains required where behavior crosses layers. A button-label change usually needs its component, localization and rendering/accessibility checks. A change to who can submit an order needs UI permissions, API authorization, tenant isolation, database effects and tests. Discovery may reveal that an apparently small task belongs in the second category; expand immediately when it does.

For the large procurement service and Orders page, begin with symbol names, imports, callers and directly used state. Reading a bounded method without its relevant callers is not sufficient. Extract cohesive components or services when ordinary maintenance warrants it, with behavior-preserving tests. A mass refactor to save prompt tokens would itself consume considerable work and introduce regression risk.

### Reduce writing

- Generate indexes, counts and inventories with scripts rather than model prose.
- Update the affected section of an existing record. Avoid rewriting the whole report or copying it into multiple handoffs.
- Workers report findings and evidence, not an essay describing every inspected file. A clean review can state coverage, unresolved limits and its verdict briefly.
- Keep one canonical decision and link to it. A short chat reply plus three duplicated written reports still costs substantial output tokens.
- Ask for concise review text independently of the reasoning budget. The CI audit's 16,000-token ceiling is a maximum, not measured output; lowering it blindly can truncate the required verdict and cause retry loops.

### 2. Separate planning from execution through small, versioned briefs

Keep `.planning/` canonical. Refresh the existing navigation rather than create another competing index. `.planning/00-index/DECISION-INDEX.md` is approximately 12.5 KB but still advertises 31 ADRs, while the inspected tree has 139 numbered ADR files. Generate its decision links/status from actual documents, and use a compact entry view to route tasks to relevant code roots, active decisions and tests. The 299 KB decisions README remains available as history; it is not the default full read.

| Task category | Initial context | Deferred context |
|---|---|---|
| Planning/product decision | Relevant page/spec, applicable decisions, named question | Source outside feasibility checks; unrelated historical ADRs |
| Web implementation | Task brief, target page/components, direct API contract | Entire organization corpus, all sketches, unrelated pages |
| Backend/domain change | Target module, contracts, relevant authorization/data constraints | Unrelated UI and domain modules |
| Database change | Relevant schema/migrations, callers, necessary security checks | Full production baseline dump unless required |
| Deployment/verification | Diff, exact revision, affected checks and deployment runbook | Repeated product research |
| Data/model pipeline | Pipeline code, manifest, small fixture | Full corpora, weights, training outputs |

The planning task writes a 500-1,000-word approved implementation brief under the existing specs area. It names the decision, exact entry files, constraints, acceptance criteria, verification commands, unresolved issues, and source revision. The implementation task starts with that brief and loads linked evidence as needed. Do not fork the entire planning conversation solely to transfer its conclusions.

Classify documents as active contract, reference evidence, historical/superseded, or generated artifact in the router and existing metadata conventions. Preserve each document's authority and provenance. Recheck only facts whose relevant code, configuration, or external source may have changed.

### 3. Reduce repeated context and coordination

- Continue the same task for related iterations. Start a fresh task with a concise handoff when the deliverable changes; restarting after every prompt would lose useful cache/context reuse.
- Search the named code root, return filenames or symbols, then read bounded excerpts. Typical tool output should be a few thousand tokens; keep complete test logs on disk and return the relevant result/error.
- Coordinate workers at milestones or on blockers. Send a delta and exact artifact path rather than repeatedly exchanging entire reports. Batch independent checks where practical.
- Select only needed plugins/tools for the task and keep that set stable during it. The baseline already includes significant app/tool instructions, but this audit does not quantify each plugin's contribution.
- Treat 60-80k median request input on focused implementation work as an initial measurement target, not a hard correctness constraint. Avoid forced compaction loops just to improve a displayed cache percentage.

OpenAI documents prompt-prefix reuse and the tradeoff that compaction can reduce cache hits while still saving total input. Optimize total work per completed task rather than cache percentage alone. [OpenAI caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

### 4. Move only material that benefits from physical separation

After the workflow changes, inventory executable references before moving anything. Keep active contracts, required decision records, tested reference documents, small fixtures, and manifests in the source repository. Move model weights, raw corpora, generated reports, and obsolete design exports to an appropriate separately managed store when their consumers and recovery paths are understood.

For each move: record the original and destination paths, update consumers and links, preserve provenance/recovery, and run affected checks. Preserve the vault's existing retirement policy unless the founder explicitly changes it. `.gitignore` does not untrack existing files and is not a universal model-context firewall. Storage cleanup helps search hygiene; it has no guaranteed token saving unless it changes what agents read.

Archive review candidates: explicitly superseded sketch variants, closed audit transcripts whose unique findings have been integrated, reproducible generated HTML/JSON indexes, and obsolete duplicate exports. Keep active ADRs, open decisions, current specifications and executable-test references. Age alone is not evidence that a document is obsolete. First generate a candidate manifest with replacement, inbound references and recovery commit. Haiku can classify candidates; ambiguous retirement and loss of unique rationale need review. ADR 0032 currently specifies delete-plus-tombstone recovery from Git rather than another in-tree archive directory; no files were retired in this task.

### 5. Measure waste while the product changes

The founder is correct that evolving tasks cannot support a clean before/after comparison of raw daily spend. Use concrete operational measures instead: startup context size; repeated reads of unchanged evidence; model assigned to mechanically checkable discovery; output spent restating existing records; review calls repeated against identical inputs; escalation and rework after cheaper-model results.

Key evidence by the relevant files' content hashes, applicable decisions, tests, model and prompt versions. A new feature elsewhere should not automatically invalidate every result, but a changed shared dependency or decision must invalidate affected conclusions. Source hashes do not freeze external production state; live claims also need a timestamp and freshness condition.

Use occasional fixed historical snapshots to evaluate a proposed routing change before adoption. This supplements ordinary work; do not rerun every task twice. Track escaped defects and rework alongside reduced input/output. No fixed percentage saving is promised across changing scope.

## CI findings and approved Vercel change

Further inspection covered `.github/workflows/{ci,deploy,e2e-prod,pr-audit-gate}.yml`, `scripts/pr_audit_gate.py`, the two PR-review agent definitions, and ADRs 0032/0050/0090. The existing worktree has unrelated CI and gate edits, which were preserved. Current GitHub main was verified as `60ed83a7e6d5eb8b8e0e631783a598cd0f562bff`; the isolated patch starts there.

### Separate spending sources

Normal build, lint, schema and test jobs consume runner resources. The PR audit explicitly uses `ANTHROPIC_API_KEY`, so its model calls are API activity; they must not be presented as proven consumption of the user's Claude subscription allowance. Exact CI spend is unknown without API usage records.

`scripts/pr_audit_gate.py:61` hardcodes Opus. Lines 583-598 call it for three independent review angles, sequentially in CI. If they approve, line 622 calls Opus again with the previous reports plus the original bundle. Each call allows up to 16,000 output tokens and each angle gets the diff, check state, and full CLAUDE.md. The caller has no explicit cache-control configuration and discards response usage; this does not establish actual cache misses, but prevents verifying cache savings from the gate's own records. Local agent definitions also specify Opus and describe three parallel reviewers, so local and CI execution paths need separate accounting.

The workflow runs on opened, synchronize, reopened and ready-for-review events; its only job condition checks author association, not draft status. Concurrency cancels older in-progress jobs, but does not reclaim tokens already used. There is no observed result reuse keyed to unchanged review inputs. Gate-owned-file and oversized-diff escalation are enforced after model reviews, so work can be spent before a deterministic block that was knowable earlier.

Recommended sequence, preserving adversarial review:

1. Record input, cache-read/write, output, model, effort and stop reason for every audit call.
2. Run deterministic eligibility checks before paid calls. For changes already requiring manual handling, report the reason without pretending a review passed.
3. Suppress paid audits while a PR is draft, then audit its ready-for-review revision. Preserve deterministic CI throughout.
4. Route evidence collection to scripts/Haiku and ordinary analysis to Sonnet where policy permits. Retain Opus for final consequential decisions under the current policy.
5. Reuse review evidence only when head, base, affected dependencies, decision/rule content, prompt/model versions and relevant check state match. Always recheck the current merge SHA and required checks. Never trust an arbitrary PR comment as a reusable approval.
6. For API caching, design a stable shared input prefix and measure actual cache tokens; changing the system prompt and putting the focus angle before the shared diff can limit reuse. Merely adding a cache flag is not proof of savings.

Update after the founder's next clarification: these gate changes and the one-Opus-planner/two-Sonnet-reviewer policy are now implemented locally in the isolated optimization worktree, not deployed. See `/Users/aldemirkonuk/Documents/ChatGPT/Mudavym/worktrees/token-efficiency-ci/.planning/07-reference/usage-audit-2026-09-16/IMPLEMENTATION.md` for validation and the remaining integration boundary. AGENTS.md was not changed. Correction to the earlier count: 139 numbered files included three evidence notes; main contains 136 top-level ADRs. The regenerated index covers actual ADRs, not supporting evidence notes.

### Vercel removal implemented locally

The founder selected provider-neutral checks with build, health and E2E retained. Branch `codex/token-efficiency-ci-20260916`, worktree `worktrees/token-efficiency-ci`, changes two workflows:

- `deploy.yml` now reads `vars.APP_PRODUCTION_URL`, defaulting to canonical `https://mudavym.com`, for smoke checks and dispatch metadata. The smoke check always has a URL and has a 30-second request timeout.
- `e2e-prod.yml` uses the same expression for `E2E_BASE_URL`; descriptions and setup messages no longer depend on Vercel. `deploy_url` remains metadata, preserving the existing separation from the E2E target.
- Frontend build, production smoke and Playwright E2E steps remain. Hosting configuration such as `vercel.json` was not removed.

Live read-only GitHub checks: classic main branch protection requires five non-Vercel contexts; the effective rules endpoint returned no additional required-status-check rules. The gate's fallback already excludes Vercel-prefixed checks. There is therefore no observed Vercel quota gate to remove from branch protection. The hosting app may still publish informational statuses; it was not disconnected.

Validation: both YAML files parsed with PyYAML; assertions checked matching neutral URL expressions, retained build/smoke/E2E steps and absence of Vercel references in the two modified workflows; `git diff --check` passed. The smoke command also passed mocked-curl checks for the canonical URL and an override with a trailing slash, without network calls. `actionlint` is unavailable. Production tests and workflow execution were not triggered. The patch is uncommitted, not pushed, merged or deployed. Rollback is the inverse of these two workflow diffs.

## Evidence, method and limitations

- [Machine-readable aggregates](metrics.json) and [reproducible parser](audit.cjs). The parser reads local rollout JSONL, deduplicates by response ID, takes per-request usage rather than cumulative snapshots, and attributes the latest preceding model/effort context. No repeated response IDs or malformed records were found in this sample. All requests used explicit usage records; fallback handling was not needed.
- Accounting assertions verify cached input is within input, reasoning is within output, and input plus output equals total for every retained request. Automatic approval-review records remain separately labeled; their chargeability was not established and they are excluded from the core Mudavym model total.
- Some rollout metadata is inherited. Task attribution uses request-level IDs, while folder classification is approximate. Local logs do not prove complete account, cloud, other-device, or historical coverage. This audit does not attribute every token to a particular repo file or every quota percentage to a particular request.
- The full working-tree status and a broad filesystem search were slow and interrupted. Relevant tracked-file status, committed object inspection, targeted instruction reads, and reference-test inspection were completed. The inspected source commit is not asserted to be current production.
- Initial audit: no application tests or source changes. Follow-up: the two workflow edits and their static validation are documented above. No instruction/settings changes, archive deletions, paid model experiments, deployment, external messages or purchases were made. Existing worktree edits were preserved.

Reproduce the fixed snapshot from the workspace root:

```sh
node worktrees/page-finalization/.planning/07-reference/usage-audit-2026-09-16/audit.cjs 2026-09-16T13:33:00.000Z /tmp/mudavym-audit-metrics.json
```

The parser keeps a detailed metadata-only intermediate in `/tmp/mudavym-usage-summary.json`; it does not export prompts, code contents, tool-result contents, or credential values. The raw Claude export remains in the conversation; the normalized figures above retain its approximate precision.

Additional official reference: [OpenAI pricing and usage guidance](https://learn.chatgpt.com/docs/pricing), consulted September 16, 2026. Published credit rates are not used here to infer the user's invoice or undocumented subscription limits.
