# Split of PR #1918 (web taste card, 74K) - 2026-11-19
Base #1912 (feat/g2-inventory-quantities-carry-their-unit) -> S1 -> S2 -> S3 -> S4. All DRAFT. Original #1918 left open, body edited only.

| Slice | PR | Branch | Head | gh pr diff chars | Tests at head |
|---|---|---|---|---|---|
| S1 typed client | #1923 | feat/taste-c-card-s1-client | 2b3c192e7 | 17032 | taste.test 19 pass; web tsc clean |
| S2 words + TasteForm | #1924 | feat/taste-c-card-s2-words | 2cf05711e | 22362 | words 28 + taste 19 pass; tsc clean |
| S3 TasteCard + css | #1925 | feat/taste-c-card-s3-card | ed0c44edb | 28045 | TasteCard 22 + words 28 + taste 19 = 69 pass; tsc clean |
| S4 drawer mount | #1926 | feat/taste-c-card-s4-mount | d68eb4156 | 6829 | src/pages/inventory 35 files, 736 tests pass; tsc clean |

Notes: nothing cut. TasteForm has no test of its own; it is covered by S3's TasteCard tests, so it sits untested-in-slice (dead code) in S2. S4 tree == #1918 head (empty diff). Gateway untouched, so gateway tsc/jest not run. Browser checks owed are on the last slice (copied from #1918, 3-6 need lane B on local stack).
