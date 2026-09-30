# 0173 — /communications is a catalogue first, then slot editing per restaurant

- **Status:** Locked (founder, 2026-09-19). Every decision below was answered in the comms-templates lane's AskUserQuestion batches, or drawn in the mockup the founder approved, **except decision 3, which is the lane's research recommendation and stays proposed** until the founder answers it. Nothing is built.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** communications, templates, catalogue, slot editing, system mail, PAR, reminders, weekly report, versions, reset to default, preview, owner, manager, destinations, buttons, escaping, emailTemplateCategories, email-templates, template_engine, message_templates, communication_templates
- **Links:** **Amended by** [[0180-house-mail-is-a-composition-grammar]] (decision 2: slots → typed composition grammar; this file's D2 text is not rewritten). [[0170-a-vendor-email-body-is-text-never-markup]] (its step 2 is closed by this build), [[0174-email-is-a-paper-sheet-and-the-house-signs-it]] (how the mail looks), [[0175-one-tap-from-the-notification-is-staged]] (where a seal-needing destination lands), [[0118-the-house-writes-its-own-mail]] (vendor letters, D1 and D4), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (the legacy delete), [[0020-no-fabricated-answers]], [[0083-a-page-may-not-claim-a-write-it-never-makes]]. Approved mockup: <https://claude.ai/artifact/F2u35LMP415GAmGcfjgnX6>, Version 5 (mocks 1a–1d). CLAIMS row `ADR-0173-WEB-HOLDS-NO-TEMPLATE-CONTENT`.

## Context

The founder called the /communications template list old-fashioned and asked how the house will see the mail Mudavym sends for PARs, reminders and reports. Lane research on 2026-09-19 (census, templates-UX study, and an adversary pass) measured why he could not.

- **The house cannot see its system mail.** No screen lists, previews or edits the low-stock digest, the weekly report or the reminders. The rebuilt page's only template surface is the vendor-letter library, reached from "The house's letter templates" (`apps/web/src/pages/communications/next/CommunicationsNext.tsx:498`).
- **Template content lives in two unrelated sources, plus two more.** The web holds five canvas "templates" with invented figures that nothing sends (`apps/web/src/data/emailTemplateCategories.ts`, 586 lines). The gateway holds the mail that actually goes out (`apps/api-gateway/src/communications/email-templates/`, 15 template files, and `email-templates-legacy.ts`). The orchestrator has a third engine (`services/agent-orchestrator/services/template_engine.py`, over the `message_templates` table), and house letters use a fourth (`communication_templates`, `type='letter'`). They share no ids.
- **Nothing escapes its data.** ADR 0170 fixed the vendor path and left step 2 (the system-mail templates) open. Making a template editable without escaping would add an injection path.
- **No role gate.** The template routes check the signature only (`apps/api-gateway/src/restaurant-templates/restaurant-templates.controller.ts:24`, `JwtAuthGuard` alone).

## Options considered

1. **View-only for good (Stripe's model).** Every template is a toggle plus a preview, and the words stay Mudavym's. It is safe and cheap. **Rejected:** the founder's end state is "fully editable per restaurant". View-only is the first step, not the destination.
2. **Raw HTML or a template language per house (Shopify's model).** This is the most editable. **Rejected:** Shopify's own help pages say a customised template stops receiving Shopify's updates, and the fix is to revert and redo by hand. Raw markup also reopens the injection path that ADR 0170 closed, and lets a house break dark mode and the layout.
3. **Build the editor first, or both together.** **Rejected:** editing needs escaping, a registry, extracted builders, a send ledger and version tables. The read-only catalogue needs fewer of them, and on its own it answers "how will we see them".
4. **Keep the web's template data as a second source for previews.** **Rejected:** a browser render can differ from the send (locale, time zone, the house's overrides, the send-time data). The preview must be the gateway's own render.
5. **Let a template button take any URL.** **Rejected:** a typed link inside a genuine Mudavym mail is a phishing primitive, and a link can point at an approval that an email cannot seal.
6. **Do nothing.** The house keeps a list that shows invented figures and never shows what is actually sent.

## Decision

**/communications becomes one catalogue of everything Mudavym sends for the house. It ships read-only first. Full per-restaurant editing follows, with guardrails.**

1. **Read-only catalogue first** (mocks 1a–1c). One list, grouped by family (reports, reminders, PAR and stock, vendor letters, account). Each row states when the template goes out, in the zone it really fires in, who gets it (as the resolver actually decides), on which channels, whether it is armed (not just whether code calls it), when it last went out, and whether the house changed the words. A row opens a server-rendered preview (Desktop, Phone, Dark) and a test send to the signed-in person only. A template with no live trigger is not offered as if it sends (ADR 0083).
2. **Editing next: slots, per restaurant** (mock 1d). Every word a reader reads is an editable slot. The numbers, the tables, the layout, the footer and the unsubscribe and preference links stay Mudavym's. Account mail (password reset, verify email, invite) is view-only (see ADR 0174). The guardrails the founder named:
   - **Locked required content.** A required data block cannot be removed. Publishing is refused while a required field is missing, and an unresolved token blocks the send (ADR 0118 D5's rule, extended to system mail).
   - **Reset to default.** One action, recorded as a new version, so it can itself be undone.
   - **Version history.** Every publish is an immutable version with its author and time. Restoring creates a new draft; history is never overwritten.
   - **Preview before save.** Edits save as a draft. The published version keeps sending until an editor publishes, and publishing needs a rendered preview.
3. **One template source.** *Lane research recommendation, proposed, not a founder decision.* Defaults live once, in a registry in the gateway. The house's edits live in the database, and one module writes them. The web holds no template content: it reads the catalogue and asks the gateway for previews. `emailTemplateCategories.ts` and its builders are deleted with the legacy cut (ADR 0149). The orchestrator's `template_engine.py` / `message_templates` pair is retired or adopted by name when the registry is built, never left as a second editor.
4. **Editors are owner and manager.** Staff can view only. The gateway enforces this on the role in the house (ADR 0162), not the page.
5. **Buttons are picked from Mudavym destinations, never typed.** An editor adds a button by choosing a place in Mudavym (orders, this week's report, an invoice, a vendor thread, receiving, a cellar item, a settings page). The URL is computed. A destination that needs a seal opens onto the seal sheet (ADR 0175), so an email button can say "review" but never "approve". The computed URL carries only ids, resolved under the reader's own house-scoped session. It never carries a login, a bearer token or any other credential. Slot text cannot smuggle a link back in: it renders as escaped text, a URL typed into a slot is never linkified, and validation rejects it at save (bare domains too, since Gmail auto-links those), so a client's auto-linking cannot reopen the phishing path of option 5.
6. **Data put into a template is escaped.** Every value, and every word of slot text, is escaped by the one renderer. The house never edits HTML. **This build closes ADR 0170 step 2:** when it lands, CLAIMS row `ADR-0170-TEMPLATES-ESCAPE-DATA` flips to resolved and 0170's step-2 section is struck.

Why this answer: the slot model is the reading of "fully editable" that the research could defend against a dedicated adversary. It gives the house every sentence and keeps out the parts where an edit can only make the mail lie, break or phish.

## Consequences

- **Easier.** The founder's question gets an answer on the first ship. One source means the preview is what is sent. A house can make its mail sound like the house without being able to make it lie about its numbers.
- **Prerequisites the build owns.** A send ledger, so "last sent" is a fact and not a guess. It should unify `notification_deliveries` and `notifications.delivery_status` and store counts or user ids, never addresses (ADR 0040). The report builders must be extracted from the cron service, with `restaurantId` taken from the token only, because they read with the service role. Crons must fire in the house's own zone, or the row says "New York time" until they do.
- **Harder / given up.** Free-text slots can contradict state-dependent data (a "nothing urgent" intro above a critical table). The registry must mark which slots are state-independent. Raw HTML editing is given up for good.
- **Retired by this (retire-to-write).** `apps/web/src/data/emailTemplateCategories.ts`, `types/emailTemplates.ts`, the two legacy builders, and the dead templates in `email-templates-legacy.ts`, all under ADR 0149's manifest. CLAIMS row `ADR-0173-WEB-HOLDS-NO-TEMPLATE-CONTENT` stays `open` until the web file is gone.
- **Revisit when** a house asks for block-level editing (adding or removing sections), which the slot model does not give. **Triggered 2026-09-20:** [[0180-house-mail-is-a-composition-grammar]] amends D2.

## Open

Not decided here. Each is the founder's call, and none is in `OPEN-DECISIONS.md` (see the note at the end).

- **Drift policy.** When Mudavym improves a default: merge untouched slots automatically with a notice, show a notice only, or never touch an edited template.
- **TR/EN locale.** Whether overrides are keyed per locale from day one. The schema depends on it, so this must be answered before the version tables are migrated.
- **The SMS daily summary.** It goes out every day by SMS (`sendDailySMSSummary`). Is it a catalogue row, and does it stay SMS?
- **A second primary button.** May a template carry a second primary button, or only outlined secondary ones? The mock shows primary first and outlined after.
- **Also undecided, found in the research:** the renderer (hardened string templates or React Email); whether a house may hide an optional data block; whether vendor letters share the system-mail storage or only the list; whether an edit may be copied to a group's other houses; and whether the subject's urgency marker is locked.

*Register note:* these forks are listed here and not added to `OPEN-DECISIONS.md`. A new register row shifts line-anchored citations across the corpus, and a peer session may be allocating OD numbers now. The orchestrator files them in one pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir (founder), AskUserQuestion batches 1–4 and mockup approval | Catalogue first; fully editable per restaurant with the four guardrails; owner and manager edit; buttons from destinations only |
| 2026-09-19 | Claude (Opus 5) | Created from the lane research and the founder record; not yet reviewed |
| 2026-09-19 | PR #403 audit gate (3 angles, APPROVE WITH NOTES) | Status set to Locked with decision 3 labelled a recommendation; slot text may not carry a URL; destination URLs carry ids only |
| 2026-09-20 | Aldemir (founder) | D2 amended by 0180: house mail is a typed composition grammar, not slots-only |
