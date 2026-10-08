> **[2026-10-07 04:16Z, coordinator, push; updated 04:32Z]** Pushed head **`be073f594`**. It builds on this body's last-call head `d14e8f1cd` (the branch was at `d9fd02b9f` before this push) with these commits:
> - `7ff9cb737` merges origin/main `5c07cfb23` (#622). Its one conflict was the ADR index README, resolved by keeping both rows. Against main, the README gains only this PR's row.
> - `8e80e296c` renumbers the migration from `20261222190000` to **`20261223040000`**. It is a rename only, with no content change.
> - `5c286489a` quotes the founder's answer on the back-dating floor in ADR 0286 follow-up 7 and closes its register entry. Docs only.
> - `75a4ad9ba` quotes the founder's answer on the backfill in ADR 0286 follow-up 3 and closes its register entry. Docs only.
> - `4b1dd3910` merges origin/main `42fe1252b` (#651). This merge was clean (`git merge-tree` exit 0).
> - `be073f594` quotes the founder's answers on follow-ups 4 and 6 (below) in ADR 0286 and closes follow-up 6's register entry. Docs only.
>
> The renumber is the merge-step renumber that the body below asks for. Every `20261222190000` below is the old version, and the other in-flight versions it lists are stale too. The current versions are, all prefixed 20261223: #650 `…000000`, #617 `…010000`, #618 `…020000`, #620 `…030000`, and this PR `…040000`.
>
> At this head:
> - The fast guards all exit 0: migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers.
> - The branch is 15 files against origin/main `42fe1252b`.
> - Gate ownership is `[]`.
> - Decision claims PASS, 920 of 920 holding. They were run with Python 3.11, because `/usr/bin/python3` here is 3.9 and cannot run ADR 0224's host check.
> - Local Postgres was run at `8e80e296c`; the migration and tests are unchanged since. The result is in the coordinator's `audits/612-local-pg.txt`: every `[fix]` line PASS, every `[ctl]` line FAIL.
>
> This head is not audited. The BLOCK at `d9fd02b9f` stands until a fresh full audit of this head.
>
> **Founder answers to the "Forks deferred" below, all by AskUserQuestion:**
> - **Back-dating floor**, 2026-10-06 ~15:10Z: verbatim pick *"No floor (Recommended)"*. The build stands as it is.
> - **Backfill of door rows written before the 72-hour rule**, 2026-10-06 19:52Z: verbatim pick *"Forward-only (Recommended)"*. The data migration that would re-date rows within 72 hours, and the variant that also re-dates older rows, are both rejected. No backfill migration and no production write follow. Rows recorded before this rule keep their entry date.
> - **A late sync onto an order whose status refuses the receipt**, 2026-10-07 04:29:14Z: verbatim pick *"Leave it, logged (Recommended)"*. This is as built: the order's `delivered_at` stays as it was, and the refusal is logged. *"Write it forward-only"* is rejected.
> - **Late-sync surfaces**, 2026-10-07 04:29:14Z: verbatim pick *"Door screen + bell (Recommended)"*. This is as built. A sync notice and a "taken X, dated Y" line stay possible follow-ups; neither is owed.
>
> No fork is left open on this branch.
