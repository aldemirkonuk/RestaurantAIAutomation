# SPLIT #1919 (kind-aware exports, 37.8K)
Stack: #1912 -> #1921 -> #1922. Original #1919 left open (body edited only); tip of #1922 tree == #1919 head.
| slice | PR | branch | head | diff vs base |
|---|---|---|---|---|
| 1 Kind/Unit/Vendor columns, count-sheet order, staff cost filter | #1921 | feat/taste-a-kind-aware-exports-1-columns | 01b710d85 | 29,047 |
| 2 dropEmptyDetail, bottle size blank for non-drinks, forHouse removed | #1922 | feat/taste-a-kind-aware-exports-2-drink-columns | 354781977 | 20,971 |
Tests at each head: `vitest run src/pages/inventory` 34 files; slice1 699 pass, slice2 705 pass; `tsc --noEmit -p apps/web/tsconfig.json` clean both.
Browser checks owed: see each PR body (not run; no stack/browser per rules).
