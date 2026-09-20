# 0178 — Phase 0 is all of it, then Phase 1; the tap is never the pitch

- **Status:** Locked (founder, 2026-09-20). Adopted with the endpoint-universe brief. Nothing in this record is built.
- **Date:** 2026-09-20
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** Phase 0, Phase 1, one-tap, seal sheet, swipe, unsealed send, IDOR, send-email, push title, subject, lock screen
- **Links:** Plan of record: [`../07-reference/ENDPOINT-UNIVERSE-PLAN.md`](../07-reference/ENDPOINT-UNIVERSE-PLAN.md). [[0175-one-tap-from-the-notification-is-staged]], [[0176-amend-0112-swipe-is-the-phone-intent-gesture]], [[0179-unmounted-python-http-is-deleted-not-mounted]], [[0180-house-mail-is-a-composition-grammar]], [[0181-guests-are-reserved-in-the-tree-not-built]], [[0112-one-modal-policy-three-shapes-one-primitive]]. Census at `origin/main` `79dfea023`.

## Context

The 2026-09-19/20 lane compared 888 of our routes/surfaces with 1,559 benchmark capabilities and wrote a six-part plan (scratchpad `plan/synth/S1`–`S8`). The adversary verdict on that draft was **BREAKS**: S5 scheduled the phone swipe sheet (OT-18) in Phase 1 while mobile approve (the pitch's headline act) sat in Phase 0 and returns 403 today because it carries no seal (`seal-challenge.service.ts:162,166`; mobile callers at `apps/mobile/app/(tabs)/supply/[id].tsx:42-50` and `src/components/today/DecisionCard.tsx:177`). A second critical (S4-024) let a click mint a seal, which contradicts 0175 OT-02.

The founder was asked whether Phase 0 defects must finish before any Phase 1 surface, or whether Phase 1 could start in parallel on unaffected surfaces. Answer: **all**.

A separate founder answer the same day: the push title is **not** the email subject.

## Options considered

1. **Phase 1 in parallel on surfaces that do not send.** Catalogue UI, HTML mail blocks, a push that only opens a page. **Rejected by the founder:** "all". An unsealed vendor send and a 403 approve are the pitch. Shipping the catalogue beside them would present a product that cannot do the act it is selling.
2. **Skip a Phase 0 item that looks unrelated (Python orphans, `sw.js`).** **Rejected by the founder:** no skipping a defect.
3. **Keep the email subject as the push title.** Cheap, one field. **Rejected by the founder:** lock-screen fields and a house-edited subject are different jobs (0175 D3 already forbids amounts on a locked Android; a house-written subject is not lock-safe).
4. **Do nothing.** Mobile approve stays 403; four vendor sends stay unsealed; `POST notifications/send-email` stays an arbitrary-HTML sender.

## Decision

**D1. Every Phase 0 defect lands before any Phase 1 surface.** Phase 1 is the pitch without native code (push tap opens the seal sheet; `/communications` catalogue; compositional mail). It does not start while an unsealed send, an open HTML sender, a tenant leak, or a 403 approve is live. Each Phase 0 item is its own branch.

Phase 0, as adopted (adversary criticals applied *in the plan*):

- Tenant leaks: `GET providers/:id/{orders,performance,contacts}`; `GET/PUT users/:userId/preferences`.
- `POST notifications/send-email` (arbitrary HTML from the Mudavym domain).
- Four vendor sends take a seal (0175 D9; CLAIMS `ADR-0175-VENDOR-SENDS-ARE-SEALED`).
- Mobile approve carries a seal (0175 D8). **The phone swipe sheet (OT-18) moves into Phase 0** so this is not shipped without the gesture 0176 named.
- `approveOrder` always needs authority (0175 D7).
- Vendor auto-send retired (0175 D5).
- `sw.js` push actions that post missing routes with no credential.
- Unmounted Python HTTP deleted (ADR 0179).
- **S4-024 is killed.** A click must not mint a seal; OT-02's negative test is the bar.

**D2. The push title is composed from lock-safe fields. The house edits the email subject separately.** They never share a string. Locked-Android and fail-closed-iOS payloads stay on 0175 D3's locked set (event, house, order number, count). A house-written subject does not ride there.

**D3. The brief at [`ENDPOINT-UNIVERSE-PLAN.md`](../07-reference/ENDPOINT-UNIVERSE-PLAN.md) is the readable plan of record for this lane.** Long form stays in the session scratchpad. Numbers in the brief were measured at `79dfea023`; they are not recopied as law.

## Consequences

- **Easier.** The pitch cannot ship on top of a 403. The lock screen cannot leak a house-edited subject.
- **Harder.** Catalogue and mail-editor work wait. That is the cost the founder accepted.
- **Revisit when** a Phase 0 item is shown not to be a live hole (cite a test, not a guess), or when native shade (0175 Phase 2) is the next fork.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md` (see ADR 0173's register note).

- **F10 undo-after set** (research rec: acknowledge, claim an open shift, snooze, done, a spot count corrected by a recount; not money, not a send).
- **Send window after a vendor-letter seal** (research rec: 2 minutes with Cancel).
- **Studio promote / queue writes:** product surface or ops-only (research rec: ops-only behind a service key).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | Aldemir (founder) | Phase 0 all, then Phase 1; push title decoupled from email subject; brief adopted |
| 2026-09-20 | Cursor Grok 4.6 | Recorded from the adopted brief; S4-024 killed and OT-18 moved in the plan, not yet in S1–S6 item text |
