> **[2026-10-07 04:20Z, coordinator, push]** Pushed head **`c8b7761ce`**. It builds on the audited PASS head `64e967fc4` with these commits:
> - `39fd1b98c` merges origin/main `5c07cfb23` (#622). The merge was clean (`git merge-tree` exit 0).
> - `b0b15893d` writes the records the PASS at `64e967fc4` said were owed. ADR 0304's Context and option 27 now name the real tenant (Meyhouse Palo Alto) and say its missing zone is inferred, not re-read. Decision 7 now says PR-5 must file the address move under its own audit action, or the witness rule (Decision 6) filters on the source the row records. Docs only.
> - `0779feb2e` merges origin/main `42fe1252b` (#651). The merge was clean.
> - `c8b7761ce` quotes the founder's F1 answer (below) in ADR 0304 and confirms Reading 3. Docs only.
>
> Across this PR's 15 files, only ADR 0304 and the ADR index README differ from `64e967fc4`, and the README change is main's own row. No code, migration or test changed.
>
> At this head:
> - The fast guards all exit 0: migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers.
> - The branch is 15 files against origin/main `42fe1252b`.
> - Gate ownership is `[]`.
> - Decision claims PASS, 918 of 918 holding. They were run with Python 3.11, because `/usr/bin/python3` here is 3.9 and cannot run ADR 0224's host check.
>
> This head is not audited. A delta re-audit against the PASS at `64e967fc4` is owed before merge.
>
> **Founder answer on F1, 2026-10-07 04:15:17Z (AskUserQuestion), for PR-2's device-derived zone:** verbatim pick *`"from the device" (Recommended)`*. Settings names the device the house was created on. *`"from your device"`* and *`"from {name}'s device"`* are rejected; ADR 0304 records them as options 29 and 30. **F2** (confirm Readings 1 and 2) has not been asked yet. It binds only PR-2.
