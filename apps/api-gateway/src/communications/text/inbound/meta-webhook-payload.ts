/**
 * Reading a WhatsApp webhook body, without asserting a shape.
 *
 * SOURCE
 * ------
 * `developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`,
 * fetched 2026-09-06. The envelope, verbatim:
 *
 *   { "object": "whatsapp_business_account",
 *     "entry": [ { "id": "<WABA id>",
 *                  "changes": [ { "field": "messages",
 *                                 "value": {
 *                                   "messaging_product": "whatsapp",
 *                                   "metadata": { "display_phone_number": "…",
 *                                                 "phone_number_id": "…" },
 *                                   "contacts": [ { "profile": { "name": "…" },
 *                                                   "wa_id": "…" } ],
 *                                   "messages": [ { "from": "…",
 *                                                   "id": "wamid.…",
 *                                                   "timestamp": "1749416383",
 *                                                   "type": "text",
 *                                                   "text": { "body": "…" } } ]
 *                                 } } ] } ] }
 *
 * WHY EVERY FIELD IS READ AND NOT CAST
 * ------------------------------------
 * This body arrives off a public network. An `as WhatsAppWebhook` would turn a
 * field Meta renames into `undefined` flowing on as though it were data — and
 * the row it produced would be a conversation entry with a blank message in a
 * house's own book. So every read goes through a narrowing helper and anything
 * that does not narrow is reported as skipped WITH ITS REASON, never dropped.
 *
 * A STATUS CALLBACK IS NOT A MESSAGE
 * ----------------------------------
 * The same `messages` field also carries `statuses` (sent/delivered/read/
 * failed) and `errors`. Those are not inbound messages and must not become
 * conversation rows. They are read into their own list, and
 * `WhatsAppInboundService.applyStatus` writes each onto the house's OWN
 * outbound row for that `wamid` — so an asynchronous failure Meta reports
 * after accepting a message reaches the house's book instead of being counted
 * and dropped. The shape, from the same payload-examples page:
 *
 *   "statuses": [ { "id": "wamid.…", "status": "failed",
 *                   "timestamp": "1750263773", "recipient_id": "…",
 *                   "errors": [ { "code": 131047,
 *                                 "title": "Re-engagement message", … } ] } ]
 */

export interface InboundWhatsAppMessage {
  /** The WABA id from `entry[].id`. */
  wabaId: string | null;
  /** `value.metadata.phone_number_id` — which of OUR senders it arrived at. */
  phoneNumberId: string;
  /** `value.metadata.display_phone_number`, as shown to the sender. */
  displayPhoneNumber: string | null;
  /** `messages[].from` — the sender's wa_id, digits, no leading `+`. */
  fromWaId: string;
  /** `messages[].id` — the `wamid.…`. The idempotency key. */
  wamid: string;
  /** Unix seconds as Meta sent them, verbatim. */
  timestamp: string | null;
  /** `messages[].type`. */
  type: string;
  /**
   * The text, when the message carries one. NULL for every non-text type —
   * an image or a document has no body and inventing one would put a sentence
   * in a vendor's mouth.
   */
  text: string | null;
  /** `contacts[].profile.name`, when present. */
  profileName: string | null;
}

/** One delivery-status callback on a message the house sent. */
export interface WhatsAppStatusCallback {
  /** `value.metadata.phone_number_id` — which of OUR senders sent it. */
  phoneNumberId: string;
  /** `statuses[].id` — the `wamid` Meta returned when it accepted the send. */
  wamid: string;
  /** `statuses[].status`, verbatim: `sent`, `delivered`, `read`, `failed`, … */
  status: string;
  /** Unix seconds as Meta sent them, verbatim, or null. */
  timestamp: string | null;
  /** `statuses[].recipient_id`, when present. */
  recipientId: string | null;
  /** The first `errors[]` entry's code and title, for a `failed` status. */
  errorCode: string | null;
  errorTitle: string | null;
}

export interface ParsedWhatsAppWebhook {
  /** Messages this build can thread. */
  messages: InboundWhatsAppMessage[];
  /**
   * Delivery-status callbacks this build can read. Never threaded as
   * messages; applied to the house's own outbound rows.
   */
  statuses: WhatsAppStatusCallback[];
  /** Every status entry seen, readable or not. */
  statusCount: number;
  /**
   * Entries the parser could not read, each with why. NEVER silently dropped:
   * a webhook that ignored what it did not understand would under-report a
   * house's conversation and nothing would say so.
   */
  skipped: { why: string }[];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The one object type Meta sends for WhatsApp. Anything else is not ours. */
export const WHATSAPP_WEBHOOK_OBJECT = "whatsapp_business_account";

export function parseWhatsAppWebhook(body: unknown): ParsedWhatsAppWebhook {
  const out: ParsedWhatsAppWebhook = {
    messages: [],
    statuses: [],
    statusCount: 0,
    skipped: [],
  };

  const root = obj(body);
  if (!root) {
    out.skipped.push({ why: "The body was not a JSON object." });
    return out;
  }

  const objectField = str(root.object);
  if (objectField !== WHATSAPP_WEBHOOK_OBJECT) {
    out.skipped.push({
      why: `The body's "object" is ${objectField ? `"${objectField}"` : "absent"}, not "${WHATSAPP_WEBHOOK_OBJECT}". Nothing in it is a WhatsApp message.`,
    });
    return out;
  }

  for (const rawEntry of arr(root.entry)) {
    const entry = obj(rawEntry);
    if (!entry) {
      out.skipped.push({ why: "An entry was not an object." });
      continue;
    }
    const wabaId = str(entry.id);

    for (const rawChange of arr(entry.changes)) {
      const change = obj(rawChange);
      if (!change) {
        out.skipped.push({ why: "A change was not an object." });
        continue;
      }

      const field = str(change.field);
      const value = obj(change.value);
      if (!value) {
        out.skipped.push({
          why: `A change on field "${field ?? "unknown"}" carried no value object.`,
        });
        continue;
      }

      // Statuses first: they ride the same `messages` field and would otherwise
      // fall through to the "no messages" branch and read as nothing arriving.
      const statuses = arr(value.statuses);
      if (statuses.length > 0) out.statusCount += statuses.length;

      const metadata = obj(value.metadata);
      const phoneNumberId = str(metadata?.phone_number_id);

      if (statuses.length > 0) {
        if (!phoneNumberId) {
          // Without it we cannot say WHICH house's sender the message left
          // from, and a status written onto a guessed tenant's row is worse
          // than none.
          out.skipped.push({
            why: `A change carried ${statuses.length} status callback(s) but no metadata.phone_number_id, so which house's message they describe is unknown.`,
          });
        } else {
          for (const rawStatus of statuses) {
            const st = obj(rawStatus);
            const wamid = str(st?.id);
            const status = str(st?.status);
            if (!st || !wamid || !status) {
              out.skipped.push({
                why: `A status callback was missing ${!st ? "its object" : !wamid ? "its message id" : "its status"}, so it could not be applied.`,
              });
              continue;
            }
            const timestamp = str(st.timestamp);
            if (
              timestamp !== null &&
              (!/^\d+$/.test(timestamp) ||
                !Number.isFinite(new Date(Number(timestamp) * 1000).getTime()))
            ) {
              out.skipped.push({
                why: "A status callback carried an invalid timestamp, so it could not be applied.",
              });
              continue;
            }
            const firstError = obj(arr(st.errors)[0]);
            const code = firstError?.code;
            out.statuses.push({
              phoneNumberId,
              wamid,
              status,
              timestamp,
              recipientId: str(st.recipient_id),
              errorCode:
                typeof code === "number" || typeof code === "string"
                  ? String(code)
                  : null,
              errorTitle: str(firstError?.title),
            });
          }
        }
      }

      const messages = arr(value.messages);
      if (messages.length === 0) {
        if (statuses.length === 0) {
          out.skipped.push({
            why: `A change on field "${field ?? "unknown"}" carried neither messages nor statuses.`,
          });
        }
        continue;
      }

      if (!phoneNumberId) {
        // Without this we cannot say WHICH house's sender it arrived at, and a
        // conversation row written into a guessed tenant is worse than none.
        out.skipped.push({
          why: "A change carried messages but no metadata.phone_number_id, so which house's sender received them is unknown.",
        });
        continue;
      }
      const displayPhoneNumber = str(metadata?.display_phone_number);

      const namesByWaId = new Map<string, string>();
      for (const rawContact of arr(value.contacts)) {
        const contact = obj(rawContact);
        const waId = str(contact?.wa_id);
        const name = str(obj(contact?.profile)?.name);
        if (waId && name) namesByWaId.set(waId, name);
      }

      for (const rawMessage of messages) {
        const message = obj(rawMessage);
        if (!message) {
          out.skipped.push({ why: "A message was not an object." });
          continue;
        }
        const wamid = str(message.id);
        const from = str(message.from);
        const type = str(message.type);
        if (!wamid || !from || !type) {
          out.skipped.push({
            why: `A message was missing ${!wamid ? "its id" : !from ? "its sender" : "its type"}, so it could not be recorded.`,
          });
          continue;
        }

        const timestamp = str(message.timestamp);
        if (
          timestamp !== null &&
          (!/^\d+$/.test(timestamp) ||
            !Number.isFinite(new Date(Number(timestamp) * 1000).getTime()))
        ) {
          out.skipped.push({
            why: "A message carried an invalid timestamp, so it could not be recorded.",
          });
          continue;
        }
        out.messages.push({
          wabaId,
          phoneNumberId,
          displayPhoneNumber,
          fromWaId: from,
          wamid,
          timestamp,
          type,
          // Only a `text` message has a body. Every other type is threaded with
          // `text: null` and the store writes what it IS rather than a summary
          // it invented.
          text: type === "text" ? str(obj(message.text)?.body) : null,
          profileName: namesByWaId.get(from) ?? null,
        });
      }
    }
  }

  return out;
}

/**
 * Meta sends `from` as digits with no `+`. The book stores E.164 with one.
 * Exported because the match is the whole of "is this vendor in the book", and
 * a private helper would be untestable at the boundary that matters.
 */
export function digitsOf(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}
