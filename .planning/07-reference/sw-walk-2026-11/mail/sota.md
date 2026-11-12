# Mail: state of the art for this job (2025-2026)

The job: a restaurant hears from vendors, staff and guests over email, WhatsApp and SMS. It needs
one place where every conversation is listed by person, where a reply is drafted for it, where a
person approves before anything goes out, and where no message is ever lost.

## What the leading products do

1. **Choco: one messenger for every supplier, whatever channel the supplier uses.** A restaurant
   orders and chats with all its suppliers in one app. Choco converts each order into the format
   that supplier prefers: email, WhatsApp, text, fax or ERP. Choco AI (Jan 2024) and Autopilot
   (2025, per a third-party timeline) turn inbound email and voicemail orders into structured
   orders.
   Lesson for Mudavym: the list is keyed by **counterpart**, not by channel. The channel is an
   attribute of each message.
   Sources: https://choco.com/restaurants, https://choco.com/uk/stories/suppliers/choco-ai,
   https://simplify.jobs/c/Choco-Communications
2. **Front: shared inbox, shared drafts, AI drafts reviewed by people.**
   - Drafts composed in a shared inbox are visible to everyone with access to it.
   - Copilot drafts for a human; it does not auto-send from the composer.
   - An admin "AI replies hub" lists every AI-generated draft and sent reply.
   - Front has no rigid approve/reject gate. Mudavym's sealed approval goes further than this.

   Lesson: one review surface lists every machine-written message, both sent and pending.
   Sources: https://help.front.com/en/articles/4610880,
   https://www.getmacha.com/blog/front-shared-drafts-explained,
   https://front.com/blog/front-unwrapped-2025
3. **7shifts: staff talk stays inside the restaurant account.** In June 2025 7shifts moved
   messaging to Stream Chat. It offers direct and group chat, announcements and a manager log
   book, so staff stop using personal texts and WhatsApp.
   Lesson: staff conversations are a first-class counterpart type, scoped by role.
   Sources: https://getstream.io/blog/7shifts/, https://kb.7shifts.com/hc/en-us/sections/15188032390547-Communication
4. **SevenRooms: guest messages hang off the guest profile.** Two-way SMS for reservations and the
   waitlist is linked to the guest record. A "private line" lets a manager choose which staff can
   see a VIP's conversation. Email is mostly outbound marketing.
   Lesson: guest threads attach to a guest record, and access to them is granted per person.
   Sources: https://sevenrooms.com/search-reservations/,
   https://platform.softwareone.com/product/private-line/PCP-0242-9751

## Plumbing patterns the products depend on

5. **Gmail push is a hint, not a delivery guarantee.**
   - Pub/Sub notifications can be delayed or dropped, so poll `history.list` as a fallback for
     quiet mailboxes.
   - Keep the last processed `historyId` durably, and advance it only after the changes are
     applied.
   - On a 404 (`startHistoryId` out of range), run a full sync from `messages.list`, then store a
     new baseline.
   - Re-arm `watch` before it expires. History can be valid for as little as a few hours.

   Sources: https://developers.google.com/gmail/api/guides/push,
   https://developers.google.com/gmail/api/guides/sync
6. **Inbound-parse webhooks retry only on failure, so a failure must look like one.** Postmark
   retries any non-200 response 10 times over about 10.5 hours, and a 403 stops retries. It can
   deliver duplicates even after a 200, so dedupe on MessageID plus recipient. Answer quickly and
   process asynchronously, but only after storing the payload durably.
   Sources: https://postmarkapp.com/support/article/understanding-inbound-webhook-retries-in-postmark,
   https://postmarkapp.com/blog/why-idempotency-is-important,
   https://hookdeck.com/webhooks/platforms/guide-to-postmark-webhooks-features-and-best-practices

## What this means for the Mudavym Mail tab

- **Counterpart-first list.** Rows are people (vendor, staff, guest, unknown sender). Each person
  has threads, and each thread has messages from any channel (Choco, SevenRooms).
- **One review list** for every machine-written draft and sent reply, with the sealed approval
  kept (Front, and Mudavym ADR 0175).
- **Durable intake before acknowledgement** on every path: Gmail push, the house reader and
  inbound parse. Dedupe on a provider message id, and add a fallback poll (Gmail and Postmark
  docs).
- **Staff and guest threads scoped by role and grant**, not visible to everyone in the house
  (7shifts, SevenRooms).

Caveat: most product sources above are vendor marketing or third-party listings. They describe
claimed features, not measured behaviour. The Gmail and Postmark docs are primary sources.
