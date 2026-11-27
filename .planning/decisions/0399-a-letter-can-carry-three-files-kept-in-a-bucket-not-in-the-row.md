# 0399 — A letter can carry up to three files; the files live in a bucket, not in the row

- **Status:** Proposed
- **Date:** 2026-11-24
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent. This one was made under the standing delegation (r106), and is Proposed until the founder reads it.
- **Keywords:** mail, attachments, multipart/mixed, composer, bucket, owner, manager
- **Links:** DD-r104-25 / DD-r105-6 g6; `apps/api-gateway/src/communications/mime-attachments.ts`; `gmail.service.ts` `createMimeMessage`; `letters/house-letters.service.ts` `sendThroughGrant`. (Numbered 0399: the brief named 0397, which `0397-a-drink-can-use-something-the-house-makes` already holds on a remote branch, and 0398 is taken too.)

## Context

A letter from Mail could carry words only. Both senders hand-build MIME, and both built a body with no place for a file. A vendor often needs a file back (a corrected price list, a photographed invoice). The founder's answer (DD-r104-25) was: three files, 5 MB in all, uploaded files only, owner and manager only.

## Options considered (the store, g6b)

1. **Bucket.** The row keeps the file's name, type, size and bucket key; the bytes sit in a private bucket under the house's own folder. Chosen.
2. **Row.** The bytes as base64 in the queued letter's row. Rejected: 5 MB becomes about 6.7 MB of text in a row that every list and thread read already selects from; the row is copied through the undo window and the release; and a failed read of a row that big is the same failure as a failed read of the letter.
3. **Re-read the file from its source at send time.** Rejected: "uploaded files only" means there is no source to read; a URL or path field would let a letter name a file on the gateway.

## Decision

- g6a (built in this PR): one builder, `mime-attachments.ts`, used by both senders. Files make the message `multipart/mixed` with the text (or the text and html alternative) as the first part. At most 3 files and 5 MB in all (the raw bytes); a fourth file, an empty file or an over-size set is **refused**, never trimmed. Only an owner or a manager may attach: `assertMayAttach(role, files)` is the one function that returns a `CheckedAttachments`, and both builders take nothing else (a type, and a run-time check for a caller that casts around it). Staff may still write plain letters. The g6b caller must call it with the role the gateway resolved.
- g6b (not built here): files are stored in a private bucket, keyed by house and letter, and the queued letter's row holds only name, type, size, key and a sha-256. The send reads the bytes back by key. The release seal must bind the sha-256 of each file, so a released letter cannot carry a file other than the one the manager saw. The seal binding is an auth rule and needs its own review before it is written.

## Consequences

- No caller can send a fourth file or a staff member's file by forgetting a check: a builder refuses any set `assertMayAttach` did not return, and asks the limits again.
- Not verified: both senders post the message as JSON `raw` (base64url), so 5 MiB of files is about 9.6 million characters on the wire. Google's send reference and upload guide state no size limit for that path, so a refusal (413) is possible and would surface as a failed letter. The safe alternative, the upload endpoint with `message/rfc822`, cannot carry a thread id without a multipart upload and was not built unproven. Check against a real send before g6b.
- A file name cannot start a header or name a path (control characters, quotes and slashes are cut; the value is RFC 2047 encoded by the same encoder as every other header).
- Revisit if staff are to attach after a manager approves, or if the cap moves.

## Review trail

- r106 mail-fix: built g6a; the g6b store fork recorded here; the gateway half of g6b (DTO field, bucket write, seal binding, send read-back) is the next stacked PR.
