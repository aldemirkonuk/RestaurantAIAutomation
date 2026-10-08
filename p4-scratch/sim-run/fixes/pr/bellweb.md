Title: fix(bell): a "Point of sale" register for a till's refused checks, two mail notes under Connections, and Connections counted on the rail

## What was wrong for the owner

Since #603 (ADR 0281, merged as `2b6782291`), an import refuses a check whose closing time it cannot read: no sale, no stock, and only the caller of the import is told. ADR 0281's 2026-10-05 amendment (#644, `fix/pos-import-refusals-ring-the-bell`, head `a3b623203`) closes that gap with one owner/manager bell note per till per hour, type `pos_import_refused`. The note is titled like "3 checks not imported: date not readable", links to `/connections` ("Open Connections"), and carries `metadata.till`.

The web bell had no register for that type. `kindOf` fell back to "Other" (`nt-format.ts:122-123` on `main`), so Tuzlu Rüzgar's owner would have found a refused-checks warning filed among unclassified lines, under the Other inbox mark.

Two other gateway notes that link to `/connections` had the same fault on `main`: `mail_grant_absent` ("The house's mail reading is on, and nothing is backing it", `mail-grant-absent.producer.ts:202`, link `:206`) and `mail_retention_deleted` ("Mirrored mail deleted", `raw-mail-retention.service.ts:896`, link `:900`). Both fell to Other.

A further defect turned up, also on `main`. The rail's "On this page" tally counts only the registers in `KIND_ORDER` (`registerTally`, `NotificationsNext.tsx:253-262`), and `KIND_ORDER` had no *Connections*. So `grant_suspended` and `mcp_tool_added` lines (in Connections since #289) were drawn but never counted. A book holding only such lines said "The book is open and empty." (`NotificationsNext.tsx:735-737`).

This lane has no A-id of its own. It is F7 of ADR 0281's amendment, which follows #603 (A-007, A-009, A-029). Nothing in this lane was measured on Tuzlu's production data (no production reads), so this body does not claim how many refused-check, mail or Connections notes Tuzlu has.

## The founder's answers (2026-10-05, AskUserQuestion), verbatim

**F7, a group of its own.**

- Question: "F7: the web bell has no group for this note, so it shows under "Other". Give it its own group?"
- Answer: **"Own group, small web PR (Recommended)"**. Option text: "Add a register for pos_import_refused in nt-format.ts, a one-file follow-up with its own audit."
- The other option was "Leave it under Other" ("The title and message still read as written.").
- Source: the coordinator's session record of the question. ADR 0281 on #644 (`a3b623203`, line 201) quotes the same answer and option text.

**The group's name.**

- Question: "The bell's new group for refused till checks (your F7 "Own group"): what should it be called?" Options: "Till (Recommended)", "Point of sale", "Till imports".
- The founder typed, verbatim: **"do the most user like answer"**.
- Under that delegation the coordinator chose **"Point of sale"**. It is the title of the row the note's link opens on the Connections page (`ConnectionsNext.tsx:453`, `title="Point of sale"`). The founder's own word for it elsewhere is "POS": "Learn from the POS (Recommended)" (AW25+AW30) and "Own row, POS field (Recommended)" (AW24), both options he picked on 2026-10-03. Those two answers are in the coordinator's record and not yet in an ADR.

**The two mail notes.**

- Question: "Two other bell notes, "mail access missing" and "mail retention deleted", link to Connections but still fall under "Other". Which group should they join?"
- Answer: **"Connections"**.

This branch builds each answer as worded. *Point of sale* is a register of its own in `nt-format.ts`, not a seat in the shared Connections register. The two mail notes join Connections.

## What changed

`apps/web/src/pages/notifications/next/nt-format.ts` is the one source file:

1. **`pos_import_refused: 'Point of sale'`** in `KIND_BY_TYPE`.
2. **`mail_grant_absent: 'Connections'`** and **`mail_retention_deleted: 'Connections'`** in `KIND_BY_TYPE`. These are the exact type strings the gateway writes (`grep -rn` over `apps/api-gateway/src`: `mail-grant-absent.producer.ts:202`, `raw-mail-retention.service.ts:896`).
3. **`'Point of sale': Store`** in `ICON_BY_KIND`. `Store` is the mark the Connections page draws on its "Point of sale" row (`ConnectionsNext.tsx:452`). So the line, its register's name and the row its link opens all agree. No other register uses `Store`.
4. **`'Connections'` and `'Point of sale'` in `KIND_ORDER`**, in that order, between Market and System (`ICON_BY_KIND`'s order).
   - Point of sale needs this to be counted at all.
   - Connections is the adjacent fix above. It goes beyond F7's one register, but without it the rule this branch adds ("every register a line can land in is counted") would fail on `main` as it stands.
5. **`KIND_BY_TYPE` is exported** (typed `Readonly`) so the test can walk every register the map names.

A two-word register name is safe where a kind is used. It is a React `key` and drawn text on the rail (`NotificationsNext.tsx:720-723`), the chip's text (`BookRow.tsx`), and a search term (`nt-book.ts:193`). Nowhere is it a CSS class or a test id.

Docs:

- `.planning/06-pages/notifications.md`, the page note:
  - A dated paragraph records the Point of sale register. It quotes F7 and the naming answer, and says the coordinator picked the name under the founder's delegation.
  - A dated paragraph records that the two mail notes joined Connections, quoting the answer.
  - The "drawn and tallied correctly" sentence about Connections is corrected in place. It was drawn, not tallied.
  - The rail-tally list gets a dated bracket naming `KIND_ORDER` as the rule.
  - §13 Roadmap items 31 and 33 ("`grant_suspended` / `mcp_tool_added` has no register") are struck and closed: #289 (`941d9cb40`) added both Connections rows.
- `.planning/tech-debt.d/2026-10-05-fix-bell-files-refused-checks.md`: one entry, **CLOSED on this branch**. It records the two mail notes falling to Other, quotes the founder's "Connections", and names the tests that pin the fix.

There is no ADR edit. ADR 0281 (on #644) is cited, not changed. The register was decided by the founder's F7 answer, and its name by the coordinator under the founder's delegation, both quoted above. No CLAIMS row, no SQL, no migration.

## Tests

- `nt-format.test.ts` (24 cases):
  - `pos_import_refused` files under Point of sale and draws its mark. It does not file under, or draw the mark of, Other, Connections, Sales or System.
  - `grant_suspended` and `mcp_tool_added` stay in Connections.
  - `mail_grant_absent` and `mail_retention_deleted` each file under Connections (not Other, not Vendor mail) and draw the Connections plug, not the inbox. That is four cases.
  - Every register `KIND_BY_TYPE` names is in `KIND_ORDER` and draws its own mark.
  - No two registers in `KIND_ORDER` draw the same mark.
  - A non-empty-map case keeps the loops from passing vacuously.
- `NotificationsNext.test.tsx`, four new render cases (37 in the file):
  - One `pos_import_refused` line makes the rail read `Point of sale 1 / 1` (`/^Point of sale\s*1\s*\/\s*1$/`). It reads neither Other nor Connections, and the page does not say "open and empty".
  - The line's chip and the rail row both draw `svg.lucide-store`. Neither draws the inbox or the plug.
  - One `grant_suspended` line makes the rail read `Connections 1 / 1`.
  - One `mail_grant_absent` and one `mail_retention_deleted` line make the rail read `Connections 2 / 2`, with no Other and no Vendor mail row.
  - Rows are cast to `Notification['type']` because the web's `NotificationType` union lists none of these types.

Results, all at `23e530233`:

- `vitest run src/pages/notifications`: **9 files, 184 passed**.
- **Fail without the fix.** The two test files run against `main`'s `nt-format.ts` with only `export` added: **13 failed, 48 passed** (61). Against the previous head `6281ca478` (register named "Till", no mail rows): **11 failed, 50 passed**. At this head: 61 passed. Each time the file was restored from a copy and confirmed with `cmp`.
- **Mutations**, one change each, restored and confirmed with `cmp`, re-run at this head:

  | Mutation | Failed (of 61) |
  |---|---|
  | `pos_import_refused` mapped to `'Other'` | 6 |
  | the `pos_import_refused` row removed | 5 |
  | `pos_import_refused` mapped to `'Connections'` | 5 |
  | `pos_import_refused` mapped to `'Sales'` | 5 |
  | `pos_import_refused` mapped back to `'Till'` (map only) | 7 |
  | `'Point of sale'` out of `KIND_ORDER` | 4 |
  | `'Point of sale': Store` removed | 4 |
  | Point of sale given the `Plug` mark | 3 |
  | `mail_grant_absent` row removed | 3 |
  | `mail_retention_deleted` row removed | 3 |
  | both mail rows mapped to `'Vendor mail'` | 5 |
  | `'Connections'` out of `KIND_ORDER` | 3 |

- Web `tsc --noEmit -p apps/web`: only the pre-existing `@simplewebauthn/browser` error in `passkeys.ts`.
- eslint on the three web files: clean, exit 0. It ran with `--resolve-plugins-relative-to p4-scratch/web-lint`, because `eslint-plugin-jsx-a11y` is not in the checkout's `node_modules`.
- **Guards**: every `scripts/check_*.py` that CI runs (44) exits 0. These ran on the working tree before the commit. After the commit, `check_adr_numbers_unique.py` (no ADR introduced) and `check_decision_claims.sh` (**869 checked, 869 holding**) were run again.
- `git diff --check`: clean.
- **No local Postgres run**: no SQL changed.

## Forks deferred

None. The register's name and the two mail notes' register were the two forks this PR left open at `6281ca478`. Both are answered above and built.

## Merge order

- **Independent of #644** (`fix/pos-import-refusals-ring-the-bell`, `a3b623203`). They share no file, and `git merge-tree --write-tree` of this head with #644's head is clean, so either can merge first. Until #644 merges, nothing writes `pos_import_refused`, so the Point of sale row is inert. The Connections half of `KIND_ORDER` and the two mail rows matter on `main` today.
- **Overlap:** only #582 (`fix/phone-feed-no-money-for-staff`, `1c8c93581`) also touches `nt-format.ts` and `nt-format.test.ts`. It adds `team_member_own_wage_set: 'System'` and one test row near `system_alert`. This branch's hunks are elsewhere. `git merge-tree --write-tree` of this head with #582's head is clean.
- No other open PR touches any of the five files: `gh pr list --state open --limit 200` filtered on their paths returns only #582 (swept 2026-10-05, at this head).
- Built on `origin/main` `2b6782291`, with no stacking.

## History note (for the squash)

Four commits. Use this body as the squash message, not the concatenated commit bodies, which contradict each other:

- `2eab78d83` filed the type under the shared Connections register and said "No new register is invented".
- `c77bfd570` built F7 as worded, under the builder's name "Till". Its body wrongly said no source on disk carries the F7 option text that `2eab78d83` quoted. That text is in the coordinator's session record, and ADR 0281 on #644 quotes it word for word.
- `6281ca478` did the page-note docs pass and recorded that correction.
- `23e530233` renames the register to "Point of sale" (the founder's delegation, the coordinator's pick) and files the two mail notes under Connections (the founder's answer).

## Files (5)

- `apps/web/src/pages/notifications/next/nt-format.ts`
- `apps/web/src/pages/notifications/next/nt-format.test.ts`
- `apps/web/src/pages/notifications/next/NotificationsNext.test.tsx`
- `.planning/06-pages/notifications.md`
- `.planning/tech-debt.d/2026-10-05-fix-bell-files-refused-checks.md`

## Not covered

- **Not rendered in the Browser pane.** A local `/notifications` needs the web dev server, a signed-in house and a gateway. The rail and chip are evidenced only by the committed jsdom render cases. Nothing user-visible was looked at in a real browser.
- **No end-to-end run with #644.** The note's fields (type, link, `metadata.till`) were read from `refused-checks-note.ts` on that branch. No gateway-written row was fed through this page.
- **No Point of sale filter pill.** Most registers have one in `TYPE_CHOICES` (`nt-book.ts:241-254`), the 2026-09-03 five included. Payments and Connections do not, so the two mail notes get none either. Point of sale gets none yet because nothing on `main` writes the type. `nt-book.test.ts` names that rule ("does not offer a filter for a type nothing writes") but pins it only for `ai_suggestion`. Adding the pill once #644 merges is a follow-up.
- **The detail panel** shows Priority and Written for the refused-checks note. It does not list the till, the count or the check ids as separate facts; the message carries all three.
- **The legacy header** (`components/layout/Header.tsx`) and the shell's `HouseBell` draw no per-type register; unchanged.
- **The page note's rail-tally list** is corrected by a dated bracket appended to its line, not rewritten. The list it corrects had already been missing Deliveries, Invoices, Sales, Goals and Market before this branch.
- **The naming rationale's "POS" quotes** (AW24, AW25+AW30) come from the coordinator's record of the 2026-10-03 answers. No ADR on `main` carries them yet.

> [2026-10-05, coordinator: "this head" in the text above means `23e530233`. The merged head `1281f9113` only adds a merge of `origin/main` `eaa479c93` (#608), which touches none of the five files. CI at `1281f9113`: 40 green and 1 skipped. ADR 0090 audit at `1281f9113`: PASS (both reviews APPROVE WITH NOTES, final HOLDS), report at `p4-scratch/sim-run/fixes/audits/645-1281f9113/report.md`. Owed from the audit notes: an ADR record of the "Point of sale" group and of the two mail notes joining Connections; an `Object.hasOwn` guard in `kindOf`.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
