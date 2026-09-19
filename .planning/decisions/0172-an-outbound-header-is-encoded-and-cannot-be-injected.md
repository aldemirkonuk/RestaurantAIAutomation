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

## Options considered

1. **Encode and sanitize in one small pure module, used by both builders.** This is `mime-headers.ts`. It appeals because it keeps the Gmail API path, the thread id and the pre-minted Message-ID contract exactly as they are, and leaves one place to test. The cost is ~290 lines that we own.
2. **Build the message with nodemailer's `MailComposer` and hand its output to the Gmail API.** Nodemailer already encodes correctly (measured above). The costs:
   - It depends on nodemailer internals (`nodemailer/lib/mail-composer`) that are not public API.
   - It replaces our Message-ID and Date handling with nodemailer's.
   - It would have to be threaded through `sendThroughGrant` too.
   - It is a larger behaviour change than a header fix needs.
3. **Refuse any message whose subject has CR/LF.** This is simpler, but a vendor could then stop the house from replying on their own thread by putting a line break in their subject. Rejected for free text. It is kept for addresses and message ids (see the Decision).
4. **Do nothing.** Turkish letters keep arriving as mojibake, and a vendor can add recipients to the house's replies.

## Decision

Take option 1. Every header in both hand-built messages goes through `mime-headers.ts`, and both bodies are base64.

- **Free text (Subject, display names).** CR, LF, the other C0 controls and DEL collapse to one space. This matches what nodemailer does on the fallback path, so both paths give the same result.
  - Plain printable ASCII stays readable and unfolded.
  - Anything else is written as `=?UTF-8?B?…?=` encoded-words. So is ASCII that contains `=?`, which a reader would otherwise decode.
  - The encoded-words are sized to the space left on each line and split only between whole code points (surrogate pairs stay together).
  - Every line holding an encoded-word is at most 76 characters (RFC 2047 §2). That one limit also caps each word at 75, because a folded line is one space followed by the word.
- **Addresses and message ids** (To, Cc, Bcc, Reply-To, Message-ID, In-Reply-To, References): a control character is **refused**. An address with a line break in it is corrupt data, and "repairing" it sends mail to an address nobody chose.
  - The refusal throws inside `sendEmail`'s `try`, so the caller gets `{ success: false }` and Gmail is never called.
  - In the letters cron it lands in the existing catch, which marks the letter `FAILED` with the reason.
- **Display names in address lists.** `Name <addr>` entries are split without a regex and the name is encoded as needed. The address itself is never put inside an encoded-word.
- **The From brand.** "WineOps AI" is left as it is, because it is renamed in a separate lane. It now goes through `mailboxHeader`, so any non-ASCII rename will be encoded.
- **Bodies.** `Content-Transfer-Encoding: base64` in lines of at most 76 characters (RFC 2045 §6.8). base64 is 7-bit safe for the Gmail `raw` field. Its alphabet has no `_`, so the `boundary_…` delimiter can never occur inside a part.
- **`raw`.** The whole message is still base64url (`Buffer.from(message).toString("base64url")`). The spec checks this byte for byte.

## Evidence

- **`mime-headers.spec.ts` (24 tests).** It reads messages with its own decoder, not the encoder under test:
  - It unfolds the header block and splits it on *any* line break (a lenient receiver's view).
  - It decodes each encoded-word on its own with a fatal UTF-8 decoder, so a split character throws.
  - It base64-decodes each part.

  It sends through `GmailService.sendEmail` with a fake `gmail.users.messages.send`, and through `sendThroughGrant` with a fake `fetch`. It covers:
  - exact round-trip of both example subjects;
  - an ASCII subject left as-is;
  - four CRLF/CR/LF injection subjects, each giving exactly `from,to,message-id,subject,mime-version,content-type`;
  - refusal of a line break in In-Reply-To, References, Reply-To, Message-ID, To and Cc, with no send;
  - body parts decoding to the exact UTF-8 text;
  - long, emoji and `=?` subjects.
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

  A first version kept a separate 75-character word cap. Mutating it to 200 stayed green, because the 76-character line limit already implies it. The cap was deleted rather than left as a guard nothing tests.
- **CLAIMS row `ADR-0172-MIME-HEADERS-ENCODED`.** Its static verify holds on this branch. It fails (exit 1) on the `origin/main` `apps/api-gateway/src` tree, and fails in this worktree when only `gmail.service.ts` is swapped for `origin/main`'s. The file was then restored and checked identical with `cmp`.

## Consequences

- Turkish and ₺ subjects and letters reach inboxes readable. A vendor's subject can no longer add a header to the house's reply.
- A send whose recipient or message id carries a control character now fails loudly with `success: false`. Before, it went out with a broken header block.
- **Not covered:**
  - **Non-ASCII bare addresses** (SMTPUTF8 or IDN) are passed through as they are. They are not punycoded or refused, because no caller produces them today.
  - **`sendEmail`'s log line `Subject: ${options.subject}`** can still split a log line. That is log forging, not mail, and it is out of scope.
  - **The Python sender with a non-ASCII `from_name`.** It would encode the whole `Name <addr>` string as one encoded-word, hiding the address. Its default `"WineOps AI"` is ASCII, so this is latent. It becomes live if the rename lane gives it non-ASCII text.
- **Revisit when:**
  - a third hand-built MIME message appears (the CLAIMS row's template-literal sweep fails the build);
  - the From brand rename lands (check that it goes through `mailboxHeader`);
  - attachments are added to `createMimeMessage`, which would need multipart/mixed and filename encoding (RFC 2231).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Claude (agent) | Created, Proposed; built on `fix/mime-header-encoding` |
