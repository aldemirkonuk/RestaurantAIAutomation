# 0174 — Email is a paper sheet, and the house signs it

- **Status:** Locked (founder, 2026-09-19). Answered in the comms-templates lane's AskUserQuestion batches 1–5 and by approving mocks 2a–2e. Nothing is built.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** email, design system, paper, ground, sheet, charcoal, dark mode, Gmail inversion, house brand, Sent through Mudavym, account mail, anti-phishing, notifications@mudavym.com, SPF, DKIM, DMARC, PAR, order-up-to, low-stock digest, reorder letter, weekly report, invoice, see original, password reset
- **Links:** **Exception to** [[0138-the-mudavym-ground-is-not-a-theme-and-the-rollout-starts-at-one-house]] D1 (as amended by [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 6), stated below. [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] D9 (the paper-sheet precedent), [[0170-a-vendor-email-body-is-text-never-markup]], ADR 0172 (outbound headers are encoded; PR #402, not yet on main), [[0173-communications-is-a-catalogue-with-slot-editing]], [[0118-the-house-writes-its-own-mail]] D1, [[0129-below-par-is-strictly-below-par]], [[0070-a-quantity-states-its-own-unit]], [[0020-no-fabricated-answers]]. Approved mockup: <https://claude.ai/artifact/F2u35LMP415GAmGcfjgnX6>, Version 5 (mocks 1c, 2a–2e). CLAIMS row `ADR-0174-RESET-MAIL-SAYS-ONE-HOUR`.

## Context

Mudavym's system mail is still WineOps mail: a burgundy banner and "WineOps AI" in the header and footer (`apps/api-gateway/src/communications/email-templates/template-config.ts:33-44`), and `From: WineOps AI` on every send (`gmail.service.ts:603,683`). Lane research on 2026-09-19 (the email design and architecture studies and their adversary) designed the replacement and found four points only the founder could settle.

- **The ground.** ADR 0138 D1, as amended by ADR 0149 row 6, makes Warm Charcoal the ground everywhere, with paper only "where a surface declares it". Email is not the app. Gmail ignores `prefers-color-scheme` in every client and applies its own inversion, fully on iOS (caniemail raw data, cited in the email adversary). A charcoal email would be inverted again in ways nobody controls. The founder and the one real tenant read mail in Gmail.
- **Whose name leads.** The founder: the house leads, and Mudavym is not at the top ("we don't charge for that service").
- **The PAR quantity.** The research first proposed ordering back to par. ADR 0129 defines par as the level below which you reorder, so an order that fills to par leaves the wine one pour from the next alert.
- **The password reset mail.** The mock said 30 minutes and named a city and a device. The code says otherwise, and it signs no other device out (see D8).

## Options considered

1. **Ground: charcoal, per ADR 0138 as written.** **Rejected:** it survives only in clients that honour `prefers-color-scheme` (Apple Mail; Outlook on Mac, iOS and the web). In Gmail the dark sheet is re-inverted unpredictably.
2. **Ground: paper declared as a sheet.** *Chosen.* A letter is paper, and ADR 0104 D9 already declares the canonical document a paper sheet. Clients that honour dark mode get a charcoal version. Gmail inverts a light sheet, which it does predictably.
3. **Mudavym at the top of every mail.** **Rejected by the founder.** The house is the sender in the reader's mind, and Mudavym does not charge for the mail.
4. **The house at the top of every mail, account mail included.** **Rejected:** a password reset that opens with a restaurant's name, from a Mudavym address, is the shape of a phishing mail. Account mail must be recognisably Mudavym's.
5. **Sender: keep the OAuth Gmail account and change only the display name.** **Rejected:** the founder chose a Mudavym address. A consumer Gmail sender also caps daily volume.
6. **PAR: order back to par.** **Rejected:** it re-triggers at the next pour (ADR 0129), so the house gets one order per sale.
7. **Do nothing.** Every house keeps getting mail branded for a product that no longer exists.

## Decision

1. **Email is a declared paper surface. This is an exception to ADR 0138 D1, and it is exactly this wide:** the body of every email Mudavym renders sits on a light paper sheet with one teal (the İznik seal) and no banners. Where a client honours `prefers-color-scheme`, the same mail renders on Warm Charcoal. The app is unchanged: it stays charcoal, and the in-app screens a mail opens (the invoice view, the seal sheet) are charcoal. 0138's rule still governs every surface inside the web and mobile apps. Email is added to the declared-paper list, beside the canonical document. ADR 0138's decisions are not edited; its Status line carries a dated bracket pointing here.
2. **The house leads operational mail.** Reports, reminders, PAR and stock mail open with the restaurant's name and a small logo slot. There is no per-house colour override. Mudavym appears once, as a discreet footer line, "Sent through Mudavym".
3. **Account and security mail keeps Mudavym at the top.** This covers password reset, verify email and invite, and any future security mail. It carries no house and no unsubscribe, and it is not editable (ADR 0173).
4. **The sender is `notifications@mudavym.com`**, with SPF, DKIM and DMARC aligned before the first send. Headers are encoded per ADR 0172. A vendor letter is a different object: it is plain, carries no sheet and no Mudavym line, and goes from the house's own mailbox (ADR 0118 D1; mock 2d).
5. **PAR mail covers every UI/UX aspect**: the staff low-stock alert, the daily digest, and the vendor reorder email (the phone side is ADR 0175). **The PAR quantity is an order-up-to level**, a new per-item setting above par. Its default is derived from the item's minimum (`threshold_min`), and the exact rule is set when the setting is built. A quantity always states its unit (ADR 0070). The engine's draft is grey and marked "Draft · not sent", and the button says "review", never "approve" (an email link cannot hold a seal). No mail says "Mudavym drafted an order" until an overnight drafter exists (ADR 0020).
6. **The weekly report carries the week's recap.** It gives four figures a person can act on, the top sellers, the wines tying up cash, what vendors changed, and three recommendations, each with its own destination. Margin is stated only over costed wines ("39 of 41 costed"). A figure that needs data not on record (a weekly budget, sales velocity) says so rather than guessing.
7. **"Open the invoice" (mock 2c) opens the vendor thread beside the formatted invoice**, and "See original" swaps in the uploaded PDF or e-invoice. The formatted view is a reading of the original: if the two disagree, the original wins and the line is flagged. The payment-due reminder is designed now and armed when due dates and a paid state exist. Until then its catalogue row shows it as off, with the reason.
8. **The password reset mail says what the code does.** The link lasts **1 hour** (`supabase/migrations/20260805115406_password_resets.sql:17`) and works once (`auth.service.ts:2168-2190`, `used_at`). The mail names **no place and no device**: only `requested_ip` is stored (`:19`) and no geo lookup exists.
   **Founder decision (2026-09-19, batch 5): a password reset revokes every other session and unenrolls every enrolled phone (ADR 0175 decision 2), and the reset mail says so.** Today it does neither: `resetPassword` deliberately revokes nothing, because nothing tracks the tokens issued to a user (`auth.service.ts:2216-2223`). This is filed as an OPEN defect in `v3.0-TECH-DEBT.md` (2026-09-19). [2026-09-25: built on `fix/password-change-revokes-sessions`, ADR 0225 — reset and change end every other session by a session version, and the reset mail now says "When you choose a new password, every device signed in to your account is signed out." Phone unenrollment has nothing to act on yet: enrollment does not exist.] The mail's sentence ships in the same change as the revocation, never before it (ADR 0020). **Founder decision (2026-09-19, batch 6):** the in-app password change (`changePassword`) follows the same rule. It signs out every other session and unenrolls every other phone, and the current device stays signed in. One rule covers both paths, as the code comment at `auth.service.ts:2216-2223` asks.

## Consequences

- **Easier.** One base layout for every family. The reader sees the house first, and the reset mail cannot be mistaken for a restaurant's marketing.
- **Harder.** The mudavym.com mailbox, its DNS and its sending reputation are new work on the send path. Clients differ, and without a rendering service verification is partial. The mail must say so rather than claim it was tested everywhere.
- **The dark version is not exact in Gmail.** A preview labelled "Dark" can match Apple Mail and Outlook, not Gmail. The preview pane must say that.
- **Build notes the research surfaced.** The weekly report that is actually sent is `communications.service.ts:274` `generateWeeklyReportHtml`, not `weekly-report.template.ts`. The rebuild replaces the live renderer, and its honesty test must assert on sent HTML. Every cron fires in New York time, so no mail may print a time until the house's zone is real.
- **Revisit when** Gmail honours `prefers-color-scheme`, or a house asks for its own colour in system mail.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md` (see ADR 0173's register note).

- **One-click unsubscribe on critical mail.** RFC 8058 one-click on PAR and critical categories can silence the only restock signal: the resolver falls back to silence or to a global address when the last recipient opts out. The choice is whether to offer it, and what happens when a house's last recipient leaves.
- **The From display name.** The mock shows "Meyhouse via Mudavym". It is not decided.
- **TR/EN locale.** This is shared with ADR 0173.
- **The sessions lane's review of the reset mail (2E)** against ADR 0164. That ADR is on the sessions branch, not on main, and the review is still owed. The verify-email and invite link lifetimes are unchecked too.
- **Also undecided:** which paper value the sheet uses (ADR 0042's `#FAF7F1` or the D9 sheet's `#fffdf8`, per ADR 0138's own note); whether to pay for a rendering service or accept partial verification; and web fonts in mail.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir (founder), batches 1–3 and mockup approval | Paper sheet declared; house leads, Mudavym in the footer; account mail keeps Mudavym at top; `notifications@mudavym.com`; PAR is every aspect; order-up-to; recap; invoice with see-original |
| 2026-09-19 | Claude (Opus 5) | Created; reset-mail facts re-read at `origin/main` `e066712bc` |
| 2026-09-19 | Aldemir (founder), batch 5 | A reset revokes every other session and unenrolls every phone, and the mail says so (D8) |
| 2026-09-19 | Aldemir (founder), batch 6 | An in-app password change revokes the same way; the current device stays (D8) |
| 2026-09-19 | PR #403 audit gate (3 angles, APPROVE WITH NOTES) | Status set to Locked; 0138 bracket added; reset CLAIMS row pins the expiry check and sweeps later migrations |
