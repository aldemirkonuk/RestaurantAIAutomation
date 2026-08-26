---
type: spec
title: Session plan — OD-77, OD-78, OD-79, OD-81
status: ready
updated: 2026-08-26
links: ["[[OPEN-DECISIONS]]", "[[0020-no-fabricated-answers]]", "[[STATE]]"]
---

# Session plan — OD-77 / 78 / 79 / 81

> Written 2026-08-26 for a **separate session**, at the founder's instruction.
> Branch: `docs/od-77-81-handoff` (or cut your own off `origin/main`).
> These four are grouped because **three of them chain**: 77 unblocks 78, and
> 79 and 81 are independent but share the same "decorative feature" shape.
>
> **Founder instruction that governs this whole plan:** for anything requiring
> a login, a signup, or a third-party console (Google Cloud, Google Admin,
> Gmail, Vercel, Railway), output **step-by-step instructions only** and stop.
> Do not attempt the action. Wait for "done", then continue and verify.

## Order of work

`OD-77 → OD-78` are sequential. `OD-79` and `OD-81` are independent and can run
in parallel agents alongside them.

---

## OD-77 — Google account migration (personal → company)

**Founder-deferred, but it blocks OD-78.** Everything Google-shaped currently
hangs off a personal account: the Gmail sender (`GMAIL_SENDER_EMAIL` is a
gmail.com address), the OAuth client, and the Vertex/Pub-Sub project
(`GMAIL_PUBSUB_TOPIC` → `projects/wineops-vertex-ai/...`).

**This is entirely a console task — instructions only, no agent work.** The
repo change afterwards is small: re-point `GMAIL_*` env vars on Railway and
verify inbound + outbound mail end to end.

Sequence it **before any customer onboarding** — migrating a live mail domain
under real vendor traffic is materially harder than doing it now.

**What the session does:** produce the step-by-step console sequence, wait,
then verify (send a test outbound, confirm an inbound lands, check the Pub/Sub
subscription is delivering) and update the env vars.

---

## OD-78 — Gmail push enforcement (blocked behind 77)

The verification code is **already built and merged** —
`apps/api-gateway/src/communications/gmail-push-auth.service.ts` does full
Google OIDC verification (RS256 against Google's certs, issuer, `exp`,
audience, service-account email claim).

It is **staged OPEN on purpose**, and the reasoning must not be lost:
production runs a live Gmail watch while `GMAIL_PUBSUB_AUDIENCE` and
`GMAIL_PUBSUB_SERVICE_ACCOUNT` are unset. Rejecting on unset config would not
have held a door shut — it would have **closed one that is open and carrying
traffic**, killing inbound email on deploy. Unconfigured accepts, loudly, and
counts every unverified push (`unverifiedPushes`).

**To close it:** the two values come from the Pub/Sub subscription's OIDC push
config and **cannot be derived from the repo**. Pull them (or re-create the
subscription under the company account per OD-77), set both, then set
`GMAIL_PUBSUB_REQUIRE_AUTH=true`, which fails closed regardless of the others.

**Verify after:** an unsigned POST to `/api/v1/communications/webhooks/gmail`
must return non-2xx, and real inbound mail must still arrive. Both, or it is
not done. There is an `open` claim in `CLAIMS.jsonl` that flips when an env
template carries the vars — it is the tripwire for this entry.

---

## OD-79 — Email verification is decorative — ✅ CLOSED 2026-08-26

**Resolved: enforced.** Founder chose enforce over deleting the pretence, on
measurement — 10 accounts, 4 unverified, all seed or personal, zero customers.
See [[0023-email-verification-is-enforced]]. One correction to the diagnosis
below: the strategy is at `auth/strategies/jwt.strategy.ts`, and the field was
never missing — `generateTokens` signed it into every token all along, and it
was discarded twice on the way out. The section is kept as written for the
record.

**Not a console task. Straight code work, and it is a real hole.**

- `GET /auth/me` never returns `emailVerified` (`auth.service.ts:1421-1430`).
- The single reader (`ProtectedRoute.tsx:42`) therefore compares
  `undefined === false`, which is false, so **the gate never fires**.
- `jwt.strategy.ts:33-39` drops the field too, so **no server-side check
  exists either**.
- Registration path B reaches the dashboard by *skipping* verification, not by
  passing it.

**The decision the session must put to the founder before building:** enforcing
this changes signup for every existing unverified account. Either
(a) enforce — surface the flag through `/auth/me` AND the JWT, and gate the
routes that matter, with a resend flow and a clear blocked state; or
(b) delete the pretence so nobody trusts a check that does not run.

**Do not half-build it.** A gate that exists in one layer is what produced this
entry. Whichever way it goes, it needs a test proving an unverified account is
actually blocked (or actually allowed, deliberately).

Adjacent, already known: `POST /auth/join` had an account-takeover closed on
2026-08-26 — read that fix before touching this file, the flows interact.

---

## OD-81 — Reports have no producer

`POST /reports/generate` inserts one row with `status: "pending"` and NULL file
urls (`reports.service.ts:42-67`) and is **the only writer** of
`generated_reports` in the repo. Nothing ever produces a file or advances the
status. Consequences already visible:

- `/documents-reports` — every View/Download/Print/Email takes its
  `alert("No file available")` branch (`DocumentsPage.tsx:317-366`).
- `scheduled_reports` (`reports.service.ts:147-179`) has **zero readers**.
- `/reports` Generate is currently **disabled and honest** (ADR 0020) rather
  than simulating success — do not re-enable it without a producer.

**This is a feature decision, not a fix.** The session's first job is to put
that to the founder: is report generation in scope this milestone? If yes, it
needs a generator (render → store → set status + url), and that is a phase, not
a patch. If no, the three surfaces should say so plainly and stop offering
buttons.

---

## Standing rules for this session

- **Verify before acting.** Every line number above was true on 2026-08-26 and
  this corpus drifts within days. See [[decision-register-rots]] in memory.
- **Prove a test fails before trusting it** (revert, run, restore).
- Commit with explicit paths (`git commit -- <paths>`) — the checkout is
  shared, and `git commit` otherwise takes the whole index.
- Add an executable claim to `.planning/decisions/CLAIMS.jsonl` for anything
  resolved, and anchor it on a **symbol or a definition**, never a bare name —
  a claim that greps for a word matches the comment explaining its removal.
- Run `bash scripts/check_decision_claims.sh` before pushing.
