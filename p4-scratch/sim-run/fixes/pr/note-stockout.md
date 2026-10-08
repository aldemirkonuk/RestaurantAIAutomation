> **[2026-10-06 ~17:03Z, coordinator, push]** Pushed head **`8a2c0f7e9`**: this body's head `1f3b821d3` plus one merge of origin/main `5c07cfb23` (#622). The merge was clean (`git merge-tree` exit 0). At this head:
> - fast guards (migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers) all exit 0;
> - 15 files against origin/main;
> - gate ownership `[]` by origin/main's classifier;
> - decision claims PASS, 916 of 916 holding (run with Python 3.11: `/usr/bin/python3` here is 3.9, which cannot run ADR 0224's host check).
>
> This head is not audited. The BLOCK at `b93e67183` stands until a fresh full audit of this head checks that its blocker is fixed.
>
> **Founder ruling, 2026-10-06 ~16:55Z (AskUserQuestion), on the gap the last audit raised (a wine with fewer than 14 dated sale days gets no risk, so the "Tonight" card stays silent even at 0 bottles):** verbatim pick *"Fire on an empty shelf (Recommended)"*. A wine at 0 bottles that sold in the window gets the card, citing its last sale and its days of cover, with no percentage. That is built in a follow-up PR (rule, test, and an ADR 0299 amendment quoting the pick); this PR merges as built.
