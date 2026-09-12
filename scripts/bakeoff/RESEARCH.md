# OD-03 candidates — verified research appendix

Companion to [`README.md`](README.md). **This file records facts, not judgements.**
It contains no comparison, no ranking, and no recommendation; those would be a
pick, and OD-03 is open.

Every row below is a **rate row in the ADR 0016 sense**: a value, the URL it came
from, the date it was checked, and how many independent sources produced it. A
fact I could not verify is written `UNVERIFIED` with the attempt named. Nothing
here is filled from model memory.

That last sentence is not boilerplate. **OD-53** is this repo's own recorded
instance of a plausible-sounding capability claim that turned out to have no API
behind it, and disqualifier **D-7** voids any run whose Axis-5 score rests on a
fact this file does not carry with a URL and a date.

---

## 0. Method, and the caveat that applies to every row

All fetches went through a tool that retrieves a URL, converts it, and answers a
question against it **using a small summarising model**. That model can
paraphrase or transcribe wrongly. So the discipline used here is:

1. Prefer machine-readable endpoints (`api.github.com`, `registry.npmjs.org`,
   `pypi.org/pypi/.../json`) over rendered pages, because there is less for a
   summariser to interpret.
2. Cross-check every load-bearing value against a **second, independent**
   endpoint, and record the corroboration count in the row.
3. Where two sources disagree, **record both and reconcile nothing** (§A.1 has a
   live example).
4. A single-source row is marked `corroboration: 1` and, per Axis 5's evidence
   rule, **cannot raise a candidate's score**.

Checked: **2026-08-28**. Re-verify before the run; these are point-in-time.

---

## A. `NousResearch/hermes-agent`

### A.1 Identity and licence

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| repository exists | yes | `https://api.github.com/repos/NousResearch/hermes-agent` | 2026-08-28 | 2 |
| `full_name` | `NousResearch/hermes-agent` | same + `https://github.com/NousResearch/hermes-agent` | 2026-08-28 | 2 |
| `archived` / `fork` | `false` / `false` | API | 2026-08-28 | 1 |
| licence SPDX | **MIT** | API `license.spdx_id`; repo page; `https://pypi.org/pypi/hermes-agent/json` `info.license` | 2026-08-28 | 3 |
| API `description` | "The agent that grows with you" | API | 2026-08-28 | 1 |
| README tagline | "The self-improving AI agent built by Nous Research. It's the only agent with a built-in learning loop" | repo page | 2026-08-28 | 1 |
| PyPI `summary` | "The self-improving AI agent — creates skills from experience, improves them during use, and runs anywhere" | PyPI JSON | 2026-08-28 | 1 |

**Recorded discrepancy, not reconciled:** the three self-descriptions differ. That
is normal drift between a repo field and a README, and it is logged only so that
nobody later quotes one as *the* description and treats the others as errors.

> **Licence caveat.** "MIT" is verified as the declared SPDX identifier. Whether
> MIT permits our intended use unmodified is a **legal conclusion, not a fetched
> fact**, and Axis 5 must not score it until someone qualified says so. Recorded
> here as an open item, not as a green cell.

### A.2 Language and size

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| primary `language` | Python | API `language` field | 2026-08-28 | 2 |
| language byte counts | Python 76,096,199 · TypeScript 21,918,128 · JavaScript 1,905,723 · Shell 437,233 · TeX 434,546 · Rust 195,597 · (24 more, long tail) | `https://api.github.com/repos/NousResearch/hermes-agent/languages` | 2026-08-28 | 1 |

Python is the largest by a factor of ~3.5 over TypeScript, which corroborates the
`language` field independently. **This matters for Axis 2:** a Python reasoning
layer and a Python `BaseAgent` *may* share a process. Whether they actually can is
A.5, and it is unverified.

### A.3 Activity and maturity

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| `created_at` | 2025-07-22T22:22:28Z | API | 2026-08-28 | 1 |
| `pushed_at` | 2026-08-28T10:24:43Z (same day as this check) | API | 2026-08-28 | 1 |
| `open_issues_count` | 36,793 | API | 2026-08-28 | 1 |
| PyPI latest version | **0.19.0** | PyPI JSON `info.version` | 2026-08-28 | 1 |
| PyPI latest upload | 2026-07-20T18:37:26Z | PyPI JSON | 2026-08-28 | 1 |
| latest GitHub release / tag | **UNVERIFIED** — not stated on the repo page; the releases endpoint was not fetched | — | 2026-08-28 | 0 |
| stars | 237,527 (API) / "237.5k" (page) | both | 2026-08-28 | 2 |
| forks | "48.2k" | repo page | 2026-08-28 | 1 |

> **Stars and forks are recorded and EXCLUDED from scoring.** OD-03's own
> resolution path reads *"No pick from repute."* They appear here so that nobody
> has to go looking for them and accidentally weigh them.

Two facts *are* legitimately maturity-relevant and both are single-source:
version **0.19.0** is pre-1.0, and **36,793 open issues** is a number whose
meaning (backlog? triage practice? bot noise?) is not determinable from the count
alone — Axis 5's measurement asks for issue-*close* behaviour precisely because
the raw count says nothing.

### A.4 Architecture shape

Top-level layout (`https://api.github.com/repos/NousResearch/hermes-agent/contents/`,
2026-08-28, corroboration 1):

- Packaging both ways: `pyproject.toml`, `setup.py`, `uv.lock` **and**
  `package.json`, `package-lock.json`, `.nvmrc`
- Entry points at the root: `cli.py`, `run_agent.py`, `mcp_serve.py`,
  `batch_runner.py`, `hermes` (executable), `setup-hermes.sh`
- Directories: `agent/`, `providers/`, `tools/`, `toolsets.py`, `skills/`,
  `optional-skills/`, `plugins/`, `gateway/`, `tui_gateway/`, `ui-tui/`, `web/`,
  `cron/`, `evals/`, `tests/`, `tests-js/`, `acp_adapter/`, `optional-mcps/`,
  `docs/`, `native/`, `nix/`, `locales/`
- Ops files: `Dockerfile`, `docker-compose.yml`, `flake.nix`, `AGENTS.md`,
  `SECURITY.md`

Inside `agent/` (same endpoint, `/contents/agent`, 2026-08-28) — **the listing the
tool returned was explicitly labelled "selected entries", so this is a LOWER
BOUND, not the complete file list.** Modules directly relevant to the six axes:

| axis it bears on | modules observed |
|---|---|
| reasoning loop (Axis 1) | `conversation_loop.py`, `context_engine.py`, `prompt_builder.py`, `moa_loop.py`, `oneshot.py`, `iteration_budget.py`, `reasoning_effort.py`, `bounded_response.py` |
| provider abstraction (Axis 2) | `anthropic_adapter.py`, `bedrock_adapter.py`, `gemini_native_adapter.py`, `codex_responses_adapter.py`, `plugin_llm.py`, `relay_llm.py`, `provider_projection.py` |
| cost/telemetry (Axis 3, Axis 6) | `credits_tracker.py`, `billing_usage.py`, `account_usage.py`, `aux_accounting.py`, `rate_limit_tracker.py`, `monitoring/` |
| safety / stop (Axis 4) | `estop.py`, `file_safety.py`, `secret_scope.py`, `redact.py`, `kanban_stop.py`, `outbound_webhooks.py` |
| memory / learning | `memory_manager.py`, `memory_provider.py`, `learning_graph.py`, `learning_mutations.py`, `skill_bundles.py`, `curator.py` |

The project ships its own `evals/` directory (Axis 5 asks whether a candidate has
its own test/eval suite — for this candidate, `evals/`, `tests/` and `tests-js/`
all exist; **what they cover is UNVERIFIED**).

Model providers, per the README (repo page, 2026-08-28, corroboration 1):
*"Nous Portal, OpenRouter, OpenAI, your own endpoint, and many others"*.

Distribution and run (repo page, 2026-08-28, corroboration 1): a piped installer
(`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`, or the
PowerShell `iex (irm ...)` equivalent), then `hermes` (CLI), `hermes gateway`
(Telegram/Discord/Slack/WhatsApp/Signal), or `hermes setup` (wizard).

### A.5 The unverified fact that decides candidate A

| fact | status |
|---|---|
| Does hermes-agent expose a **stable, documented, embeddable API** — callable in-process from a `BaseAgent.process_message()`, no TTY, one turn in, one structured artifact out? | **UNVERIFIED** |

Attempts made (2026-08-28): the repo page and README (describe a CLI, a TUI, and
chat gateways — no embedding example); the PyPI metadata (gives version, licence,
summary; states no library entry point). What *is* verified is only compatible
with either answer: it publishes to PyPI, ships a `pyproject.toml`, and has an
importable-looking `agent/` package — none of which proves a supported embedding
contract, and none of which rules one out.

**Do not resolve this by reading more marketing.** It is Axis 2's first
measurement: write the adapter, count its lines, count the process boundaries.

---

## B. `deepseek-ai/deepseek-harness`

### B.1 Identity and licence

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| repository exists | yes | `https://api.github.com/repos/deepseek-ai/deepseek-harness` | 2026-08-28 | 2 |
| `full_name` | `deepseek-ai/deepseek-harness` | same + `https://github.com/deepseek-ai/deepseek-harness` | 2026-08-28 | 2 |
| `archived` / `fork` | `false` / `false` | API | 2026-08-28 | 1 |
| description | "DeepSeek Harness: Everything is a Plugin." | API + repo page (identical wording) | 2026-08-28 | 2 |
| licence SPDX | **MIT** | API `license.spdx_id`; repo page; `https://registry.npmjs.org/@deepseek-ai/dsh` | 2026-08-28 | 3 |

The same legal caveat as A.1 applies: MIT is the verified declared identifier;
"permits our use unmodified" is a conclusion nobody qualified has stated yet.

### B.2 Language — **FINDING F-1**

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| primary `language` | **TypeScript** | API `language` field | 2026-08-28 | 2 |
| language byte counts | TypeScript 30,293,967 · CSS 430,971 · **Python 217,854** · JavaScript 122,113 · Shell 17,261 · C 11,763 · C++ 4,737 · HTML 421 · PLpgSQL 7 | `https://api.github.com/repos/deepseek-ai/deepseek-harness/languages` | 2026-08-28 | 1 |
| npm package | `@deepseek-ai/dsh`, bin `dsh` → `lib/bin.js` | `https://registry.npmjs.org/@deepseek-ai/dsh` | 2026-08-28 | 1 |

TypeScript outweighs Python **139:1** by bytes. Our agent runtime
(`services/agent-orchestrator/core/`) is Python. **This is the single largest
structural difference between candidates A and B**, and it lands squarely on
Axis 2 (`process_boundaries`).

It is not a verdict, and there is a real counter-fact — see B.4: the repo carries
a `python/` tree containing `sdk` and `sdk-runtime`. What that tree actually
offers is **UNVERIFIED**; if it is a first-class Python client, the boundary may
be an import rather than a subprocess. Measure it; do not assume it in either
direction.

### B.3 Activity and maturity — **FINDING F-2**

| fact | value | source | checked | corrob. |
|---|---|---|---|---|
| `created_at` | **2026-08-13T11:56:32Z** (~15 days before this check) | API | 2026-08-28 | 1 |
| `pushed_at` | 2026-08-27T17:06:36Z | API | 2026-08-28 | 1 |
| `open_issues_count` | **0** | API | 2026-08-28 | 1 |
| npm `dist-tags.latest` | **`0.1.1-rc.2`** — a pre-1.0 release candidate | npm registry | 2026-08-28 | 1 |
| npm publish date of that version | 2026-08-21T12:42:19Z | npm registry | 2026-08-28 | 1 |
| npm `engines` | not declared on the latest version | npm registry | 2026-08-28 | 1 |
| latest GitHub release / tag | **UNVERIFIED** — not stated on the repo page; releases endpoint not fetched | — | 2026-08-28 | 0 |
| stars | 201,320 (API) / "201.3k" (page) | both | 2026-08-28 | 2 |
| forks | "23.1k" | repo page | 2026-08-28 | 1 |
| commits shown on the page | "14,226 Commits" | repo page | 2026-08-28 | 1 |

**Two things must be said plainly here.**

First: a **pre-1.0 release candidate, first published seven days before this
check, on a repository fifteen days old**, cannot be scored as operationally
mature. Axis 5's exclusion of star counts exists for exactly this row — 201k stars
and `0.1.1-rc.2` are both true, and only one of them is evidence about
operational maturity.

Second, flagged rather than resolved: **14,226 commits on a 15-day-old repository
is not organic history.** The likeliest benign explanation is an import from an
existing codebase (the README credits a plugin framework named *Cordis*, B.4),
but I did not verify that, and I am not going to assert it. Recorded as
**UNVERIFIED — provenance of commit history**. It matters for Axis 5: "release
cadence" computed over an imported history would be meaningless.

### B.4 Architecture shape

Top level (`/contents/`, 2026-08-28, corroboration 1) — a pnpm monorepo:

- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/`, `apps/`, `vendor/`,
  `patches/`, `snapshots/`
- TypeScript config split five ways (`tsconfig.base.json`, `.base.client.json`,
  `.client.json`, `.host.json`, `.json`), `tsdown.config.ts`
- **Nine** vitest configs (`vitest.config.ts`, `.e2e`, `.expected`, `.snapshot`,
  `.web`, `.web.perf`, `.web-stress`, `.shared`, plus the base) — Axis 5's "own
  test suite" question has a visible answer for this candidate, though **what
  those suites cover is UNVERIFIED**
- `python/`, `pytest.ini`
- `BENCHMARK.md`, `SAFETY.md`, `THIRD_PARTY_NOTICES.md`, `BRAND_GUIDELINES.md`,
  `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`
- `docs/`, `website/`, `native/`, `.gitlab-ci.yml` alongside `.github/`

`python/` (`/contents/python`, 2026-08-28, corroboration 1) contains exactly:
`sdk/`, `sdk-runtime/`, and README/development docs in three locales. **Whether
`python/sdk` is a supported client, a build tool, or a stub is UNVERIFIED** — and
it is the fact that decides how bad F-1 actually is.

Architecture per README (repo page, 2026-08-28, corroboration 1): an
*"everything-is-a-plugin architecture"* powered by **Cordis**. Specific tool
loops, planners, memory systems, or sandboxes are **NOT STATED** on the page.

Run (repo page, 2026-08-28, corroboration 1): `npx @deepseek-ai/dsh web` serves a
Web UI at `http://127.0.0.1:3080`; or clone, `pnpm install`, `pnpm run build`,
`pnpm dsh web`.

| fact | status |
|---|---|
| Which model providers deepseek-harness supports | **UNVERIFIED** — NOT STATED on the repo page. Directly relevant to OD-04 (external model roster), which depends on OD-03. |

---

## C. `reasoning-layer-on-BaseAgent` (in-house)

No external research applies. Its facts are **in-repo and measured**, and they
live in `README.md` §1 with `file:line` citations rather than being restated here
— one source of truth per fact.

The short version, all measured 2026-08-28: `core/base_agent.py` contains **one**
match for `anthropic|openai|completion|llm|prompt`, and it is a shutdown log line
(`:400`); the abstract surface is `initialize` / `process_message` /
`get_subscribed_routing_keys` (`:316-335`); everything else the file provides is
delivery machinery — retry, idempotency, DLQ, sagas, health.

This candidate therefore has **no reasoning layer to evaluate yet**. Its Axis 1
and Axis 6 numbers cannot exist until the spike is written, which is why its
scorecard reads `UNMEASURED` today and not "0".

---

## D. Facts this appendix does NOT contain

Named so that a later reader can tell a gap from an omission:

| gap | why it is open |
|---|---|
| Latest release/tag for either project | not stated on the pages fetched; the releases endpoints were not called |
| hermes-agent's embeddable-API contract (A.5) | not documented on the sources fetched; it is Axis 2's measurement, not a research question |
| deepseek-harness's model-provider list | NOT STATED on the repo page |
| What `python/sdk` and `python/sdk-runtime` actually provide | listing only; contents not fetched |
| Provenance of deepseek-harness's 14,226 commits | flagged in B.3; not investigated |
| What either project's test/eval suites cover | directory names only |
| Whether MIT permits our intended use unmodified | a legal conclusion, not a fetched fact |
| Any benchmark, latency, or cost figure for either project | **deliberately not researched.** Published benchmarks are repute. OD-03 says the resolution path is a scoped bake-off on *this repo's* workloads, and importing someone else's numbers would be the exact shortcut the open decision exists to prevent. |

---

*Checked 2026-08-28. Point-in-time: re-verify before the run and update the dates.
No fact above was written from memory; the ones I could not fetch say `UNVERIFIED`
and name the attempt. OD-03 remains OPEN.*
