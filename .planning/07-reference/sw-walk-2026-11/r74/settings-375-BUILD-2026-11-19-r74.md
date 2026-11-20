# r74 settings-375 build (2026-11-19)
PR #1902 (draft), branch feat/r74-settings-375, base feat/r73-c3-connections-rail (#1900), head 7f25b0894.
Changed: SectionKit.tsx (Row flex-wrap, control max-width 100%, read-by line wraps/scrolls), DigestRow.tsx (select max-width 100%), connections-next.css (price-code inputs capped), 2 guard tests.
Tests: vitest settings+connections 374 passed; web tsc clean; vite build ok (SettingsNext 198.31 kB, ConnectionsNext js 73.34 kB, css 11.09 kB; delta under 1 kB, no baseline build taken).
Mutation: reverting the 3 fix files -> 5 of 34 guard tests fail.
Left: read-by is a scrolling line, not a styled pill; no pixel proof (jsdom).
Browser checks owed: see PR body (scrollWidth 375 on /settings groups and /connections price-code form; 1440 layout unchanged).
