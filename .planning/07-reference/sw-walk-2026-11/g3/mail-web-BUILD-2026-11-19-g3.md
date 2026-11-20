# g3 mail-web build, 2026-11-19

PR: #1916 (DRAFT), base fix/r59-mail-list-holds-height (#1834). Branch feat/g3-mail-web-all-conversations, commit 23af65b6a.

Gap verified real at #1834 tip: no kind/fromAddress/toAddresses/gmail_read_all anywhere in apps/web; MailPersonRow.kind was literal 'vendor'; MailThread was statically imported.

Built: kind filter (All/Vendors/Team/Guests, sent as ?kind= and held to client-side), From/To line per letter, MailThread lazy chunk with "Opening the letters..." fallback, ReadScope (offer, full consent text, POST/DELETE /mail/consent, vendor-only line, honest line when the read failed, owner/manager only).

Contract guesses to align with the gateway lane: POST /mail/consent {scope:'gmail_read_all'}; DELETE /mail/consent?scope=gmail_read_all; accepted state at reader.readAll {accepted, acceptedAt?, text?} on GET /communications/letters/sender; /mail/people ?kind=; letter fields kind, fromAddress, toAddresses. Web ships its own consent text, prefers reader.readAll.text.

Tests: MailTab.all-conversations.test.tsx (13). Mutations (10) each failed a test: kind param, client filter, absent kind, address line, fallback, truncated text, no POST, accepted misread, failed-read claim, staff offer. tsc clean; vitest src/pages/communications 29 files/561 pass; vite build ok (MailThread own 12 kB chunk).

Left: gateway half (parallel lane); storedKindsLine still driven by gateway storedKinds; PersonThreads/MailThread inbound label still uses the person's name; no kind chip on a letter. Page-level sheet for intake (IntakeHealthSheet) not made lazy (owned by #1803).

Browser checks owed: see PR #1916 body (6 checks).
