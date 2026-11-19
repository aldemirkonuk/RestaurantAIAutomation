# r73 c3-settings build (need 8: Settings and Connections as grouped pages)

PRs (draft): #1896 feat/r73-c3-settings-rail (on #1884), #1900 feat/r73-c3-connections-rail (on #1896, head e579ef25e).
New: apps/web/src/components/mudavym/GroupRail.tsx + group-rail.css (rail, select under 900, 44 px sticky head, 0fr->1fr body, inert when closed).
Tests: SettingsNext.test.tsx +7, GroupRail.test.ts (css contract), ConnectionsNext.test.tsx +5. vitest settings+connections+mudavym+__tests__ 62 files 870 passed; tsc clean.
Mutation: inert removed + deep-link open removed -> 3 Settings cases fail; fragment open removed -> 1 Connections case fails.
Chunks: SettingsNext 199.76->200.69 kB (+0.93, gz +0.63) alone; Connections 72.23->73.34 kB (gz +0.51); main +0.04 kB; +3.09 kB shared css.
Decisions: Settings rail = 7 interview groups + Connections link (eight). Closed bodies stay mounted (drafts survive). Own collapse, not #1833 Collapse (not on base).
Left: swap to Collapse after #1833; sticky head offset under shell header (--gr-top = 0); browser checks listed in each PR body.
