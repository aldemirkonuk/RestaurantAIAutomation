# Split of PR #1920 (taste profile schema + gateway, 54,081 chars, base main)
| Slice | PR | Branch | Head | Diff vs base | Contents |
|---|---|---|---|---|---|
| 1 | #1927 | feat/taste-split-1920-a | 1492671dd8a958037f768abd371d5051f5b68fb8 | 29,163 | migration + SQL test, taste-axes, taste-fusion + specs |
| 2 | #1928 | feat/taste-split-1920-b | 7fc3604b71ada0ead5379a1ca47bc0b469da5ef6 | 24,892 | service, controller, dto, module, app.module + specs |
Merge order: #1927 then #1928 (stacked). Then close #1920. Slice 2 tree == #1920 head.
Tests: slice 1 jest src/taste 24/24 (2 suites), slice 2 38/38 (4 suites); gateway tsc clean (TS2307 ignored); 4 migration guards OK (versions unique vs 200 open PRs; 20271203100000 held only by #1920).
Not run: SQL test file (no local Postgres run in this split; unchanged from #1920).
Browser checks owed: none in these PRs; lane C walker checks 3-6 after both merge.
