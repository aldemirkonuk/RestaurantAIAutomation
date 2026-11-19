# BUILD split-1917 r79 (2026-11-19)

#1917 (head 0de8fce42, 80,138 chars) split into 5 stacked DRAFT slices off main. Last slice tree == #1917 head (git diff empty).

| # | branch | base | diff chars | head |
|---|---|---|---|---|
| #1933 | feat/mail-gw-split-1-grant-and-scope | main | 25,467 | 7fea5760e |
| #1934 | feat/mail-gw-split-2-kind-from-to-on-stored-rows | #1933 | 13,442 | b2be3d4cb |
| #1935 | feat/mail-gw-split-3-revoke-deletes-non-vendor-mail | #1934 | 8,941 | e3169ddcc |
| #1936 | feat/mail-gw-split-4-wide-reader | #1935 | 27,942 | 76110c18b |
| #1937 | feat/mail-gw-split-5-wide-reader-guarantees | #1936 | 4,869 | 10b688835 |

Behaviour per slice: 1 grant id + consent words + migration + conversation reads withhold non-vendor; 2 bridge writes kind/from/to, team/guest filed plain, addressesInHeader; 3 retention + revoke delete team/guest whole; 4 wide reader (listing, classify, publish); 5 spec-only guarantees (old grant never widened, cursor oldest-tail, supersede).
Slice 4 carries only the first half of house-inbox-reads-all.spec.ts (lines 1-268); slice 5 appends the rest, so the cursor/old-grant/supersede behaviour is in 4 but pinned in 5.

Proof: each slice tsc --noEmit (only TS2307 simplewebauthn ignored) + jest on its touched dirs green; full gateway jest on the final tree: 651 suites passed, 12005 tests passed, 14 skipped. Mutants (slice-5 tree, each failed a test): listSinceAll oldest-tail, classifySender order, stranger attachment fetch, retention guest delete, bridge grant-required refusal, list-read WITHHOLD_NON_VENDOR.
Migration guards: check_migration_order OK, check_migration_versions_unique OK (against 200 open PRs), probe_safety and single_home OK. definer_functions_closed and migration_ledger CANNOT CHECK locally (need a DB URL; not run, prod not queried).
#1917 body edited only (prepended split note). #1917 head untouched.
Known gaps: (1) the single-conversation read site (conversations.service ~:946 WITHHOLD_NON_VENDOR) has no test; removing it left all 110 conversations tests green (pre-existing in #1917, tree kept identical). (2) The migration version 20271202100000 is claimed by #1917 and slice 1 simultaneously: the uniqueness guard passed locally but may flag CI until #1917 is closed.
Worktree wt/split-1917 removed after push.
