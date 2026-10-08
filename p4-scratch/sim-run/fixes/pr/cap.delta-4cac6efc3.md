# PR #609 body delta for head 4cac6efc3 (lane cap, fork-3 rework)

This file feeds a `gh pr edit` of #609's body. Text is matched by quote, not by line number. The body today names `e31e95baa` as head; the PR is at `c05c41f4c`, and this delta moves it to `4cac6efc3` (one commit on `c05c41f4c`, not pushed by the lane).

## A. Insert a new first line, above the 2026-10-06 ~00:33Z coordinator line (keep that line as history)

**[2026-10-06, lane cap] Head `4cac6efc3`.** Its parent `c05c41f4c` merges `origin/main` `54f833e4b` (#627). On top sits one commit, which carries the founder's 2026-10-06 answers to ADR 0292's forks 1–4. Forks 1, 2 and 4 ratify what was built. Fork 3, *"Say 'could not be read' (Recommended)"*, changes it: `analytics.service.ts` `loadConsumption` no longer turns a refused or failed page into `[]`. The refusal propagates, so the financial summary, risk profile, inventory science and 120-day forecast refuse whole instead of computing as if nothing was poured. ADR 0292 is **Locked**, with all four answers quoted verbatim. The PR is still **15 files** and adds no SQL. **origin/main has since moved to `4528b9689` (#621), and that is not merged in.** `git merge-tree` of HEAD and `4528b9689` is clean. #621 touches `analytics.controller.ts` and `table-analytics.service.ts`, but it changes no constructor and adds no read of `pos_checks` or `wine_consumption_log`.

## B. Replace the row in "What changed and why"

Replace:

> | `analytics.service.ts` `loadConsumption` (Wine 360 forecast, financial summary, risk, inventory science) | A-033 | Logged loudly and degraded to `[]` (fork 3) |

with:

> | `analytics.service.ts` `loadConsumption` (Wine 360 forecast, financial summary, risk, inventory science) | A-033 | **Propagates (fork 3, founder 2026-10-06).** Each consumer already had a "could not be read" path, so no web file changes:<br>• the `financial`, `inventory-science`, `risk` and `forecast` routes answer a 500 carrying the sentence (their own catch), and /reports prints its failure line;<br>• the overview holds the three lenses `null`;<br>• /recommendations names them in `sourcesUnread` ("could not read 3 of its sources");<br>• a `days_of_inventory` goal is `unreadable`;<br>• Wine 360 refuses;<br>• an export is "Not written";<br>• the MCP `financial` tool answers `isError`;<br>• the consultants' evidence carries `null`. |

Replace:

> | `insight-generator.service.ts` `loadBundle`, both window reads | A-004 | That insight family stays silent rather than partial (fork 3) |

with:

> | `insight-generator.service.ts` `loadBundle`, both window reads | A-004 | Logged as rejected. The slice reads `[]` inside the bundle, and every family that reads it is gated on it, so the family is not generated and states no figure. `generate()` still answers, so /recommendations does not name `insights` in `sourcesUnread`. This was already so on main for a failed slice. It is kept on the coordinator's reading of fork 3 (see Forks deferred). |

## C. Prepend to "Tests and guards" (keep the 12d1d9e6f lines as history, under a "Earlier rounds" sub-heading)

**At 4cac6efc3:**

- **Jest, the three named specs:** `env LC_ALL=C npx jest src/common/read-whole-window.spec.ts src/analytics/insights/insight-rankings-significance.spec.ts src/beverages/beverages.service.spec.ts --runInBand --forceExit` gives **3 suites, 86/86 passed**.
- **Jest, lane set:** `… src/common/read-whole-window.spec.ts src/analytics src/reports/exports src/mcp-server src/beverages/beverages.service.spec.ts src/calendar src/dashboard …` gives **83 suites, 1,373/1,373 passed**.
- **Red/green for fork 3:** `read-whole-window.spec.ts`'s old "refused page 2 degrades to `[]`" case is replaced by eleven cases:
  - a refused page 2 throws;
  - each of the four lenses refuses with the sentence;
  - the four routes answer it with no 200;
  - the overview holds three nulls;
  - /recommendations names the three in `sourcesUnread`;
  - a `days_of_inventory` goal is refused.

  The file was run with `c05c41f4c`'s `analytics.service.ts` swapped in: **9 failed, 35 passed of 44**. The old file answered inventory value 240, COGS 500 and DIO 175.2 with no pours, and `sourcesUnread` held only `["price advice","price locks"]`. The file was restored (cmp-verified), and the run gave **44/44**.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.spec.json` gives 0 errors apart from the existing `@simplewebauthn/server` ones.
- **Lint:** `npx eslint` on the 2 touched .ts files gives 0 errors and 1 warning. The warning is prettier at `analytics.service.ts:454`. It predates this branch: it is at `:439` on `54f833e4b`.
- **Claims:** `env LC_ALL=C bash scripts/check_decision_claims.sh` gives **896 checked, 896 holding**.
  - New row: `ADR-0292-F3-A-REFUSED-POUR-READ-IS-NOT-EMPTY`.
  - Its verify was mutation-tested. It passes on HEAD. It fails on `c05c41f4c`'s copy (`no catch`, `no empty`) and on `origin/main`'s copy (`whole`). It also fails on a call-site `.catch(() => [])` and on an `= []` inside the body.
- **Guards:**
  - `check_adr_numbers_unique.py` and its `--self-test`: OK, 0292 introduced, 1,729 refs.
  - The other 43 `scripts/check_*.py` that `ci.yml` names all exit 0. `check_migration_order.py` was run with `--self-test` only, because it needs the CI `--event`.
- **`ownership_between(wt, merge-base 54f833e4b, HEAD)`:** `[]`.
- **Local Postgres:** not run. The lane adds no SQL.

## D. Replace "ADR / CLAIMS touched" bullet 1 and the tech-debt bullet

- **ADR 0292** is new and now **Locked**, on the founder's answers of 2026-10-06, quoted verbatim under "Founder answers (2026-10-06)", which replaces "Open forks". The sentences fork 3 made false are bracket-corrected and dated 2026-10-06: the Decision's two-degrades sentence, both readers-table rows, and the Consequences exception. It adds:
  - the lens-level withholding (Consequences);
  - the after-merge latency measurement (fork 2);
  - RPC/set-returning reads in "does not catch", naming #627's `readTillPages`;
  - re-pointed cites: `recommendations.service.ts` `getRecommendations` `:319` (was `:187`), and `pos-mapping-review.service.ts` `loadObservedPrices` `:501` / `:564` and `listNeedingSaleUnit` `:404` (was `:448`).
- The README row for 0292 says Locked, with the four picks.
- **New claim:** `ADR-0292-F3-A-REFUSED-POUR-READ-IS-NOT-EMPTY` (resolved, 2026-10-06).
- **Tech-debt note:**
  - Cites re-pointed: `pos-hub.service.ts` `getStatus` `:1854`, with the read at `:1858` (was about `:1285`); `pos-mapping-review` `:501` / `:404` / `:564` and `dto:64` (were `:385` / `:448` / `dto:75`); `getRecommendations` `:319`.
  - "Degrades kept on purpose" is rewritten as "Fork 3, after the founder's answer".
  - The owed follow-ups are added.

## E. Replace the "Founder answers" section

Asked by AskUserQuestion about 04:13Z and answered by 04:16Z, 2026-10-06. Verbatim:

1. **Q:** "#609 makes the till and pour reads take the whole date range instead of silently stopping at 1,000 rows. If a range holds more than 100,000 rows (about 4.6× a year of Tuzlu's checks), what should the page do?" **A:** "Refuse and say so (Recommended)". Option text: "As built. The figure says it could not be read: too many rows. A partial figure is never shown. No extra work." Rejected: "Show a labelled partial".
2. **Q:** "A year-long range is read about 70 pages at a time (roughly 4 seconds, estimated, not measured). Keep that, or build database-side totals now?" **A:** "Keep page by page (Recommended)". Option text: "As built. Measure the real time after merge, and build database totals only if it is slow. No extra work now." Rejected: "Database totals now".
3. **Q:** "If the pour read is refused (a timeout or past the ceiling), the financial summary, risk, stock science and 120-day forecast currently compute as if nothing was poured. Only a server log notes it. What should the owner see?" **A:** "Say 'could not be read' (Recommended)". Option text: "Those figures say they could not be read instead of showing numbers that leave out pours, matching 'an unknown is not a zero'. Rare in practice. It is a small change to #609 and one more audit." Rejected: "Keep as built" ("Figures show without pours and the page does not say so; a matching insight family stays silent. No extra work, but the page can show a wrong number with nothing to warn the owner.").
4. **Q:** "Seven older reads are still capped, held in a list that CI checks. When a PR fixes one of them but leaves its row on the list, should CI fail or just warn?" **A:** "Fail CI (Recommended)". Option text: "As built (in the guard's PR). The PR that fixes a capped read must also remove it from the list, so the list never claims a read is capped when it is not." Rejected: "Warn only".

## F. Replace "Forks deferred"

Forks 1–4 are answered (above). Two are left open by the fork-3 build:

1. **Lens-level or field-level refusal.**
   - **What happens now:** a refused pour read withholds whole lenses. That includes figures that need no pours: inventory value, COGS, ratios, days of stock (so a `days_of_inventory` goal), and vendor HHI and SKU Gini.
   - **Option (a), keep as built.** This is the founder's "small change to #609", and it is how every other reader here refuses.
   - **Option (b), split each lens.** Pour figures would be null with a reason, and pour-free figures would stand. That is a larger change, with wording on every page.
   - **Recommendation:** (a).
2. **The insight bundle's silent family.**
   - The rejected option named it ("a matching insight family stays silent"), so the pick can be read as rejecting that silence as well.
   - **As built:** it stays silent. It states no wrong figure. But /recommendations can still say every source answered when only a bundle slice was refused. That was already so on main.
   - **Option (b), build now:** name `insights` in `sourcesUnread` when a bundle slice is refused. It is small, but it is a new behaviour on /recommendations.
   - **Recommendation:** keep as built in #609, and do (b) as a follow-up.

## G. Merge-order notes: add

- **`analytics.service.ts` is touched by #626, #624, #619, #617 and #616.**
  - **#626** is stacked on this branch. Its `loadConsumption` hunk has `data = [];` as context, which this commit removes, so it will conflict textually. Resolve it by taking this branch's propagating read and re-applying #626's own lines.
  - **#624, #619, #617 and #616** edit other hunks.
- **`analytics.controller.ts`** is not touched here. #625, #616 and #564 touch it, and the 500-vs-503 follow-up belongs with them.
- **origin/main `4528b9689` (#621)** is not merged in. The merge-tree is clean.

## H. "Not covered (CLAUDE.md §0.5)": replace the first bullet and add

- **4cac6efc3 is not independently verified.** Only the lane ran the tests and guards above.
- **The four routes answer 500, not 503.** Their own catch wraps every error. The sentence is in the body, and /reports prints axios's status line either way. Owed to a controller PR.
- **Owed to the cellar lane: #627's `readTillPages`** (`beverages.service.ts:1147-1175`).
  - It pages the set-returning RPCs `house_till_names` and `house_till_lines` with `TILL_PAGE_ROWS = 1000`, and it stops at the first short page with no exact count.
  - That is whole only while 1000 is at or under `max_rows`. The guard does not scan RPCs.
  - Not fixed here.
- **The fork-3 refusal was not rendered in a browser.** The web paths were read from code (`rp-format.ts` `failureLine`, the /recommendations quiet tier, goals `unreadable`). No web file changed.
- **Latency is still unmeasured.** On the founder's fork 2 answer, measure after merge.
- **The stacked guard was not re-run** over this head.
