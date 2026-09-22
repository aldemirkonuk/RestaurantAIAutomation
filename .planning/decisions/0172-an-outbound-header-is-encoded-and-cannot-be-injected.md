# 0172 — An outbound header is encoded and cannot be injected

- **Status:** Proposed 2026-09-19. Built on `fix/mime-header-encoding`; not locked until the founder says so.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** MIME, RFC 2047, RFC 2045, encoded-word, header injection, CRLF, Bcc injection, Subject, display name, Content-Transfer-Encoding, base64, mojibake, Turkish, ₺, createMimeMessage, sendThroughGrant, mime-headers.ts, Gmail API raw, nodemailer, email.mime
- **Links:** `apps/api-gateway/src/communications/mime-headers.ts` (+ `.spec.ts`), `gmail.service.ts` `createMimeMessage`, `letters/house-letters.service.ts` `sendThroughGrant`, `common/orchestrator/inbound-responder.service.ts` `normalizeReplySubject`, CLAIMS row `ADR-0172-MIME-HEADERS-ENCODED`

**Index row:** not added to `decisions/README.md` here. That file is gate-owned (see ADR 0162's note); its row goes in a separate PR.

**Number:** 0172, from `check_adr_numbers_unique.py`'s `next_free`, plus a sweep of `wt-*` and `.claude/worktrees/*` for uncommitted `017x` files (none found; 0170 and 0171 exist only in the main checkout).

## Context

Two places in `apps/api-gateway` build a raw RFC 5322 message by hand for the Gmail API `raw` field. On `origin/main` `08c04100e` both put every value straight into the header text:

- `gmail.service.ts:603-611`: `From: WineOps AI <${this.senderEmail}>`, `To: ${options.to.join(", ")}`, Cc, Bcc, Reply-To, Message-ID, In-Reply-To, References and `Subject: ${options.subject}`.
- `letters/house-letters.service.ts:932-935`: `From`, `To` and `Subject` the same way.

That caused three defects:

1. **Mojibake.** A subject such as "₺12,300 to Trakya Direct is due Monday — Meyhouse" or "Şarap siparişi · İstanbul" went out as bare UTF-8 bytes in a header. RFC 5322 does not allow that, and receivers render it by guesswork. The Turkish house letters are hit on every send.
2. **Header injection.** A reply's subject comes from the vendor's inbound subject. `normalizeReplySubject` (`inbound-responder.service.ts:1392-1405`) only `.trim()`s it, and the LLM-drafted subject gets the same treatment. So a vendor subject carrying `\r\nBcc: someone@else` became a real `Bcc` header on the house's reply.
3. **8-bit bodies.** Both parts declared `charset="UTF-8"` but no `Content-Transfer-Encoding`. With no CTE declared, 7bit is assumed, so the ₺ and Turkish letters in the bodies broke that declaration.

The other outbound paths were checked. They are not changed here:

- **The nodemailer SMTP fallback** (`gmail.service.ts` `smtpSendEmail`). This was measured on nodemailer 8.0.1 through a stream transport. Subjects came out as `=?UTF-8?Q?…?=` words. CR/LF in the Subject and In-Reply-To was flattened to a space, so no header was created. Both parts were base64 and no byte on the wire was above 0x7f.
- **The Python sender** (`services/agent-orchestrator/services/email_client.py:175-236` `_send_via_gmail`). It uses `MIMEMultipart` and `MIMEText` (compat32) and sends with `aiosmtplib`, whose `flatten_message` uses `BytesGenerator` with `policy.compat32`. This was measured on Python 3.11 and aiosmtplib 5.1.2:
  - Both test subjects round-trip through `email.header.decode_header`.
  - Both parts are base64 and the wire is 7-bit.
  - `Subject = "hi\r\nBcc: x"` raises `HeaderParseError: header value appears to contain an embedded header` at flatten, so the message is refused.
- **Two more Python senders**, both manager-only cap alerts sent with `smtplib` and `msg.as_string()` (compat32): `services/agent-orchestrator/api/onboarding_routes.py:164-179` (subject embeds `restaurant_id[:8]`, which is `request.restaurant_id` verbatim on the admin-key path) and `services/agent-orchestrator/jobs/spend_tasks.py:107-122` (provider name and month). Both subjects are a fixed shape containing "—", so compat32 writes the whole subject as `=?utf-8?q?…?=` words. Measured on Python 3.11.0: an id of `"\nBcc:e@x"` came out inside an encoded-word on a folded line, with no `Bcc` header. Recipients are the configured manager address only. Recorded in `v3.0-TECH-DEBT.md`, not changed here.

## Options considered

1. **Encode and sanitize in one small pure module, used by both builders.** This is `mime-headers.ts`. It appeals because it keeps the Gmail API path, the thread id and the pre-minted Message-ID contract exactly as they are, and leaves one place to test. The cost is ~290 lines that we own.
2. **Build the message with nodemailer's `MailComposer` and hand its output to the Gmail API.** Nodemailer already encodes correctly (measured above). The costs:
   - It depends on nodemailer internals (`nodemailer/lib/mail-composer`) that are not public API.
   - It replaces our Message-ID and Date handling with nodemailer's.
   - It would have to be threaded through `sendThroughGrant` too.
   - It is a larger behaviour change than a header fix needs.
3. **Refuse any message whose subject has CR/LF.** This is simpler, but a vendor could then stop the house from replying on their own thread by putting a line break in their subject. Rejected for free text and for the vendor's threading values. It is kept for addresses and our own Message-ID (see the Decision).
4. **Do nothing.** Turkish letters keep arriving as mojibake, and a vendor can add recipients to the house's replies.

## Decision

Take option 1. Every header in both hand-built messages goes through `mime-headers.ts`, and both bodies are base64.

- **Free text (Subject, display names).** CR, LF, the other C0 controls and DEL collapse to one space. This matches what nodemailer does on the fallback path, so both paths give the same result.
  - Plain printable ASCII stays readable and unfolded.
  - Anything else is written as `=?UTF-8?B?…?=` encoded-words. So is ASCII that contains `=?`, which a reader would otherwise decode.
  - The encoded-words are sized to the space left on each line and split only between whole code points (surrogate pairs stay together).
  - Every line holding an encoded-word is at most 76 characters (RFC 2047 §2). That one limit also caps each word at 75, because a folded line is one space followed by the word.
- **Addresses** (To, Cc, Bcc, Reply-To, both Froms): surrounding whitespace is trimmed first — a contact saved as `"a@b\n"` or `"a@b\t"` is not corrupt — and then an interior control character is **refused**. An address with a line break inside it is corrupt data, and "repairing" it sends mail to an address nobody chose. A **named** entry (one ending in `<addr>`) must hold exactly one mailbox, because splitting it at the last `<` would demote every earlier mailbox to display text and silently drop it as a recipient. So these are **refused, never collapsed**: a quoted name that is not exactly one quoted-string (`"A" <a@x>, "B" <b@x>`), and an unquoted name containing `<`, `>`, `@` or `,` (`A <a@x>, B <b@x>`, `a@x, B <b@x>`). One quoted name may hold any of those (`"Doe, Jane" <j@x>`). A **bare** entry with no `<…>` (`a@x, b@y`) is written as it is, as on `origin/main`: both recipients get it.
- **Our own Message-ID**: refused on a control character. We mint it, so a control character in it is a bug, not input.
- **The vendor's threading values** (In-Reply-To, References) are **rebuilt, not refused** — the same reasoning as the Subject. They are copied from the vendor's own mail (`communications.controller.ts`, `inbound-email.controller.ts`, `rabbitmq-bridge.service.ts`, `inbound-responder.service.ts` `buildReferences`), where RFC 5322 folding (CRLF + TAB) is legal. The first version of this ADR refused them, so a folded References stored from a vendor made every approve or auto-send on that thread fail, forever, with an error blaming `GMAIL_REFRESH_TOKEN`. `threadingHeader` keeps only `<msg-id>` tokens of printable ASCII without `<` or `>`, one space apart; folding, stray text and non-ASCII are dropped, so CR/LF cannot reach the header block. An id too long for `Name: <id>` to fit RFC 5322's 998-character line is dropped too (it cannot be folded). No id left means no header: the reply loses threading but is still sent.
- **What a refusal does.** It throws inside `sendEmail`'s `try`, so the caller gets `{ success: false, refusedBeforeSend: true }` and Gmail is never called.
  - `procurement.service.ts` `sendProviderEmail` turns `refusedBeforeSend` into a `SendRefusedBeforeSendError`, and `isDefiniteSendRefusal` recognises it by `instanceof` — **never by text**, because the error text embeds the vendor's contact address, and an address containing "Refusing to write the To header:" plus an ambiguous Gmail failure would otherwise be classed definite, re-approved, and sent twice. So `approveDraft` releases a refused draft instead of parking it as `SEND_UNCONFIRMED` ("may or may not have reached the vendor", which would be false). The error names the header problem and no longer tells anyone to re-auth Gmail for it.
  - In the letters cron it lands in the existing catch, which marks the letter `FAILED` with the reason.
- **Display names in address lists.** `Name <addr>` entries are split without a regex and the name is encoded as needed. The address itself is never put inside an encoded-word.
- **The From brand.** "WineOps AI" is left as it is, because it is renamed in a separate lane. It now goes through `mailboxHeader`, so any non-ASCII rename will be encoded.
- **Bodies.** `Content-Transfer-Encoding: base64` in lines of at most 76 characters (RFC 2045 §6.8). base64 is 7-bit safe for the Gmail `raw` field. Its alphabet has no `_`, so the `boundary_…` delimiter can never occur inside a part.
- **`raw`.** The whole message is still base64url (`Buffer.from(message).toString("base64url")`). The spec checks this byte for byte.

## Evidence

- **`mime-headers.spec.ts` (50 tests).** It reads messages with its own decoder, not the encoder under test:
  - It unfolds the header block and splits it on *any* line break (a lenient receiver's view).
  - It decodes each encoded-word on its own with a fatal UTF-8 decoder, so a split character throws.
  - It base64-decodes each part.

  It sends through `GmailService.sendEmail` with a fake `gmail.users.messages.send`, and through `sendThroughGrant` with a fake `fetch`. It covers:
  - exact round-trip of both example subjects;
  - an ASCII subject left as-is;
  - four CRLF/CR/LF injection subjects, each giving exactly `from,to,message-id,subject,mime-version,content-type`;
  - refusal of a line break in Reply-To, Message-ID, Bcc, To and Cc, with no send; an interior CRLF in To refused while a trailing `\n`, `\t` or `\r\n` is trimmed and sent; a two-mailbox To entry refused;
  - In-Reply-To and References rebuilt, for each of: `<a@x>\r\n\t<b@y>`, `<a@x>\t<b@y>`, `<a@x>\r\n <b@y>`, a non-ASCII id (dropped) and `<a@x>\r\nBcc: evil@x` (only `<a@x>` survives, no `Bcc`); whitespace-only, id-less and only-non-ASCII values omit the header and the reply still goes out;
  - `sendThroughGrant`'s From: a non-ASCII display name round-trips with the address outside the encoded-word, and an empty grant address writes no From;
  - body parts decoding to the exact UTF-8 text;
  - the three two-mailbox entry shapes refused, one quoted name with `<>`, commas and escaped quotes kept, and a bare `a@x, b@y` list written as before;
  - a threading id at exactly the 998-character bound kept and one character over dropped, per header name;
  - long, emoji and `=?` subjects.
- **Three `approveDraft` cases** in `procurement/tests/approve-draft-concurrency.spec.ts`. Two drive the real `GmailService.sendEmail`: a To with an interior CRLF is released as `PENDING_APPROVAL` as a `SendRefusedBeforeSendError`, with Gmail never called and an error naming the header, not `GMAIL_REFRESH_TOKEN`; a To with only a trailing newline is sent. The third puts `"Refusing to write the To header:" <v@x.example>` in the contact address and returns an ambiguous Gmail failure: the draft is parked `SEND_UNCONFIRMED`, not released.
- **An independent parser.** Python's `email` with `policy.default` parsed six produced messages (five from `createMimeMessage` and one from `sendThroughGrant`). Every subject was exact, there was no `Bcc`, there were no parse defects, display names and addresses were exact, and the bodies were byte-exact.
- **Mutation.** Each mutant was run by copying the file to a scratch snapshot, mutating it, running the spec, copying the snapshot back and checking with `cmp`. All 13 went red and every restore was identical:

| Mutant | Result |
|---|---|
| M1: CR/LF not collapsed | 5 red |
| M2: non-ASCII not encoded | 9 red |
| M3: `=?` not encoded | 1 red |
| M4: split on UTF-16 units | 2 red |
| M5: line limit 998 | 5 red |
| M6: fold budget ignores the leading space | 4 red |
| M7: structured CR/LF not refused | 6 red |
| M8: base64 not wrapped | 1 red |
| M9–M12: `origin/main`'s raw Subject, To, In-Reply-To and 8-bit text part put back in `gmail.service.ts` | 9, 2, 1 and 1 red |
| M13: `origin/main`'s raw letters Subject | 3 red |

  Second round, after the pre-merge audit (same snapshot → mutate → run → restore → `cmp` procedure, run over `mime-headers.spec.ts` + `approve-draft-concurrency.spec.ts`, 64 tests); all 10 red, every restore identical:

| Mutant | Result |
|---|---|
| J1: letters From written raw | 1 red |
| J2: `origin/main`'s raw Bcc ternary | 1 red |
| J3, J4: In-Reply-To / References back to strict `messageIdHeader` | 8 and 8 red |
| J5: threading token regex `<[^>]+>` (admits CR/LF) | 5 red |
| J6, J7: address / list entry refused before trimming | 1 and 2 red |
| J8: two-mailbox entry not refused | 2 red |
| J9: header refusal not classified definite in `isDefiniteSendRefusal` | 1 red |
| J10: header refusal message falls back to the GMAIL_REFRESH_TOKEN text | 1 red |

  Third round, after the round-2 audit notes (same procedure, same two specs, 69 tests); all 6 red, and each also turned the CLAIMS row red; every restore identical:

| Mutant | Result |
|---|---|
| K1: quoted name accepted without the single-quoted-string check | 1 red |
| K2: unquoted name refused only on `<`/`>` (not `@`/`,`) | 1 red |
| K3: threading id length bound removed | 1 red |
| K4: `instanceof` classification removed | 1 red |
| K5: header refusal classified by the old text regex instead | 1 red |
| K6: `sendProviderEmail` throws a plain `BadRequestException` | 1 red |

  A first version kept a separate 75-character word cap. Mutating it to 200 stayed green, because the 76-character line limit already implies it. The cap was deleted rather than left as a guard nothing tests.
- **CLAIMS row `ADR-0172-MIME-HEADERS-ENCODED`.** Its static verify holds on this branch. It fails (exit 1) on the `origin/main` `apps/api-gateway/src` tree, and fails in this worktree when only `gmail.service.ts` is swapped for `origin/main`'s. The file was then restored and checked identical with `cmp`.
  - **What the verify catches, exactly.** (1) A sweep for a *line-leading* header template literal (`` `Subject: ${ `` at the start of a line) in any non-spec `.ts` under `apps/api-gateway/src`. It does not see one mid-line, e.g. inside a ternary, and it cannot be widened to any position because `sendEmail` logs `` `Subject: ${options.subject}` ``. (2) A `grep -Fq` pin on each of the 12 header calls — createMimeMessage's From, To, Cc, Bcc, Reply-To, Message-ID, In-Reply-To, References, Subject and sendThroughGrant's From, To, Subject — which is what catches a mid-line raw header. Each pin was mutated to `origin/main`'s raw form (the mid-line ternaries included): the full row and the pins alone both went red (exit 1) for all 12, every restore `cmp`-identical.

## Consequences

- Turkish and ₺ subjects and letters reach inboxes readable. A vendor's subject can no longer add a header to the house's reply.
- A send whose recipient or message id carries a control character now fails loudly with `success: false`. Before, it went out with a broken header block.
- A header refusal is a *definite* refusal: the draft goes back to `PENDING_APPROVAL` and the manager is told which header is wrong.
- **Not covered** (tracked in `v3.0-TECH-DEBT.md`, "Outbound MIME: what ADR 0172 does not cover"):
  - **Non-ASCII bare addresses** (SMTPUTF8 or IDN) are passed through as they are. They are not punycoded or refused, because no caller produces them today.
  - **`sendEmail`'s log line `Subject: ${options.subject}`** can still split a log line. That is log forging, not mail, and it is out of scope.
  - **The Python sender with a non-ASCII `from_name`.** It would encode the whole `Name <addr>` string as one encoded-word, hiding the address. Its default `"WineOps AI"` is ASCII, so this is latent. It becomes live if the rename lane gives it non-ASCII text.
  - **The two Python cap-alert senders** (`onboarding_routes.py`, `spend_tasks.py`), measured safe today only because their fixed subjects contain "—" (see Context).
- **Revisit when:**
  - a third hand-built MIME message appears. The build fails on it only if it writes a header template literal at the **start of a line**; one written mid-line (a ternary, an array spread) is invisible to the sweep, and only the 12 pins guard the two existing builders — so a new builder needs its own pins in the CLAIMS row;
  - the From brand rename lands (check that it goes through `mailboxHeader`);
  - attachments are added to `createMimeMessage`, which would need multipart/mixed and filename encoding (RFC 2231).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Claude (agent) | Created, Proposed; built on `fix/mime-header-encoding` |
| 2026-09-19 | pre-merge audit gate (PR #402) | BLOCK on three angles: folded vendor References/In-Reply-To refused forever; CLAIMS row pinned 4 of 12 header calls and overstated its sweep; addresses refused on surrounding whitespace, header refusal parked as SEND_UNCONFIRMED, letters From untested, two-mailbox entry silently dropped a recipient |
| 2026-09-19 | Claude (agent) | Fixed all of the above in place (threading rebuilt, trim-then-refuse, two-mailbox refusal, definite-refusal classification, 12 pins mutation-proven); still Proposed |
| 2026-09-19 | pre-merge audit gate, round 2 | APPROVE WITH NOTES: quoted/bare-then-named entries still dropped a recipient; refusal classified on vendor-controlled text; a single long threading id exceeded 998; two wording defects |
| 2026-09-19 | Claude (agent) | Fixed the notes: every named multi-mailbox shape refused, `SendRefusedBeforeSendError` + `instanceof`, 998-bound id filter; still Proposed |
| 2026-09-20 | Claude (agent) | **The "From brand rename" revisit trigger fired** — PR #391 merged main into `train/finish-2` and the two changes met in `createMimeMessage`. Resolved so the brand goes THROUGH `mailboxHeader`: the hard-coded `"WineOps AI"` becomes `const fromName = options.fromName?.trim() \|\| "Mudavym"` (ADR 0149) handed to the encoder **raw**, so `mailboxPieces` escapes `"` and `\` rather than `safeFromName` deleting them. The CLAIMS pin moved with it and is mutation-proven against both bypassing the encoder and dropping the default. Two tests added: the encoder seam for a caller-supplied name, and quote-escaping (which `fromDisplayName` cannot pass). `fromDisplayName` is now unused by the Gmail path but stays exported and unit-tested — retiring it is a follow-up, not a merge-time change. |
