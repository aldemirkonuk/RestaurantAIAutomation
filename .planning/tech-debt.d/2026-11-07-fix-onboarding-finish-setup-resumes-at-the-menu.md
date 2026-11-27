## Finish setup resumes at the menu — CLOSED (web half) — 2026-11-07

Filed by `fix/onboarding-finish-setup-resumes-at-the-menu` (onboarding wave 4, lane 1) under the founder's /goal of 2026-11-07. Sibling `fix/onboarding-house-leads-to-the-desk` carries BL-2, H-1 and the nudge.

**Closes** proposal G1 (web half) and QA round 2 BL-1, B-1, B-12, B-14: `/get-started` picks its first step by session and role once auth loads, a 409 routes the same way (fork F8, ADR 0265 OPEN-2 bracket), an unread photo is said, the name fills late, and the 1.2 s pause is gone. Claims: `../decisions/claims.d/fix-onboarding-finish-setup-resumes-at-the-menu.jsonl`.

## What this half leaves open — OPEN — 2026-11-07

- **App.tsx guard (QA I-12).** `/get-started` is still a public route; App.tsx is held by #802, #760, #731.
- **#656** edits GetStarted and must rebase over this.
- **Menu 1e make-current** (G1 server half) is still unbuilt.
- **`saveYou`** still shows the gateway's message on a failed save.
