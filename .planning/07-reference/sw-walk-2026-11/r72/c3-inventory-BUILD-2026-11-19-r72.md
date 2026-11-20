# r72 c3-inventory build (2026-11-19)
PR: #1888 (draft), branch feat/r72-c3-inventory-phone-filter, head a89c7def8, base feat/r71-n18-inventory-register-type (#1880). 10 files, +858/-177.
Items: critic round 3 P0-2 (phone card, one Filter button, "no target set" once), P0-3 (Insights card + chips on tokens, 24 px custom check, accent-color), P1-13 (staff phone count mode with sticky 56 px Count bar).
Tests: tsc clean; vitest src/pages/inventory + src/components/insights 33 files / 680 passed; new PhoneBook.test.tsx (12) + 5 phone tests in InventoryNext.test.tsx. Mutation: 6 of 6 caught (hideNoTarget, staff mode, chips on phone, Filter 44px, bg-white, nextToCount).
Build: ok; entry js +3.50 kB raw (+1.03 gz); index.css +5.19 kB raw (+1.50 gz).
Left: brief named --mdv-surface-1 (absent), used --paper-*/--ink-*; Insights moved below the list on phone; selects inside the sheet (popover over sheet) unverified; Firefox ::after on appearance:none checkbox unverified.
Browser checks owed: see PR body (375 owner light+charcoal: first row < y=520, sheet, dark Insights, 24 px tick 120 ms, reduced motion; staff 375: Count bar opens Count for the never-counted good; 1440 unchanged).
