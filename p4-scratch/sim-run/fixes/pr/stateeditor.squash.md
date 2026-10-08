An owner sets the house's state and country in the location editor (A-052, ADR 0289).

**Why:** on Tuzlu Rüzgar the market index told the owner to "set the state in Settings", and no page could. `UpdateLocationDto` declared neither field, so the whitelist pipe stripped both and answered 200; the only editor sent chain, name and city. Four messages pointed at a control that did not exist.

**What changed**
- `PATCH /organizations/locations/:id` takes `country` and `stateProvince` (no new route). Sending either needs an owner of this house, read strictly; a manager or staff member gets 403, an unreadable role 503, and a mixed PATCH is refused whole.
- The pair is checked together against the one country table: US needs a state, written as its two-letter code; UK and Turkey take blank, a nation or a province; any other country takes free text, refused only when it resolves to another country. Every refusal ends "Nothing was changed."
- One UPDATE, then one `system_audit_log` row (`house_state_country_changed`, only the fields that moved). A log failure keeps the change and says so. A location-read outage now answers 503, not 404.
- The settings log reads every register back by name through a `Record<SettingsRegister, true>`, so the seven newer registers no longer read as null.
- `EditLocationChainDialog` shows the state and country fields to owners (the dialog reads the caller's role for this house from the location read; the gateway refuses anyone else). The index messages that say "set it in Settings" are unchanged; they now have a control to point at.

**Decisions:** ADR 0289, locked as built by the founder 2026-10-07 12:54:16Z ("Keep all, as built"); territories "Every ISO country code" (14:41:21Z); R3 superseded at 19:48:13Z ("Keep it, read inside the country") and no-country "Ask for the country". This PR's code is unchanged by those and still refuses as locked; the readers PR, then a superseding ADR plus the editor change, follow.

**Evidence:** ADR 0090 audit PASSED at `c5f27f7a8` and on delta re-audit at `50c9f69fb` (comment 6046648975). Decision claims 928/928; lane guards clean; files 15.

**Owed:** the readers country-first PR, the R3-superseding ADR + editor PR (Italy label), the ISO country table with CD and CI, the tech-debt fragment named in ADR 0289, and the Georgia/US-GA misreads recorded there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
