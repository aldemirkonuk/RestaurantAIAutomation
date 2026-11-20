# r72 c3-cocktail build (2026-11-19)
PR: #1885 (draft) feat/r72-c3-cocktail-opens, base feat/r61-c2-motion-collapse-toast (#1862). Merge order #1862, #1885, then #1864 (textual conflict in CocktailRegister.tsx, keep both).
Cause: Collapse opened only on requestAnimationFrame; hidden pane/tab never runs it, panel stays 0fr. Reproduced by a test stubbing rAF to a no-op (failed before the fix).
Fix: Collapse also opens on a 60 ms timer; onOpened focuses Name; 800 ms watchdog says the form did not open and nothing was saved.
Tests: CellarNext.test.tsx (+1), CocktailRegister.open.test.tsx (2). Mutations (timer, message, focus) each fail a test. tsc clean; vitest mudavym/cellar/inventory/styles 68 files 1193 pass. Build: CellarNext 129.88 -> 130.28 kB (gz 37.00 -> 37.19).
Left: N-09 /cocktails empty state (4 paragraphs under a bare search bar) not done.
Browser checks owed: /cocktails 1440 press Add a cocktail twice (opens ~260 ms, caret in Name); hidden then shown pane; close and save toast; reduced motion.
