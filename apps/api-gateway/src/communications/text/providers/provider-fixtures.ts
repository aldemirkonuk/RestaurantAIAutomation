/**
 * Provider request and response shapes, transcribed from the providers' own
 * documentation. NOTHING HERE WAS CAPTURED FROM A LIVE CALL.
 *
 * WHY FIXTURES AND NOT A LIVE TEST
 * --------------------------------
 * ADR 0121's rule is that nothing sends. A test that hit Meta or Twilio would be
 * a test that could pass because the network was down, and it would be the first
 * thing in this repository to send a message. So every shape below is copied
 * from a published page, each one carrying the URL and the date it was read, and
 * the specs feed them to `parseResponse` directly.
 *
 * A fixture with no provenance line is not a fixture, it is a guess with braces
 * around it. Every export below says where it came from.
 */

/**
 * SOURCE: developers.facebook.com/documentation/business-messaging/whatsapp/
 * messages/text-messages, "Example response", fetched 2026-09-05
 * (p4-scratch/p4bc-fetch-log.md row 16). Copied verbatim, including the
 * `contacts` array the adapter does not read.
 */
export const META_ACCEPTED_BODY = {
  messaging_product: "whatsapp",
  contacts: [{ input: "+16505551234", wa_id: "16505551234" }],
  messages: [
    { id: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA" },
  ],
};

/**
 * SOURCE: Meta's Graph API error envelope, as documented across the WhatsApp
 * Cloud API pages fetched 2026-09-05. `code: 131047` is the "message failed to
 * send because more than 24 hours have passed since the customer last replied"
 * error — the one this product will meet most, because every message it builds
 * is free-form and free-form requires an open window.
 *
 * NOT captured from a call. The envelope's field names are Meta's; the
 * `error_data.details` sentence is representative rather than quoted, and it is
 * marked as such here rather than passed off as verbatim.
 */
export const META_WINDOW_CLOSED_BODY = {
  error: {
    message: "(#131047) Re-engagement message",
    type: "OAuthException",
    code: 131047,
    error_data: {
      messaging_product: "whatsapp",
      details:
        "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
    },
    fbtrace_id: "Az8bWQx1yZ0",
  },
};

/**
 * A 200 with no `messages` array. SOURCE: none — this is the shape the adapter
 * must survive rather than one Meta documents, and it is here because
 * `parseResponse` has to answer "unknown" for it instead of inventing an id.
 * ADR 0084 deleted `mockSendSms` for returning a fabricated `messageId`; this
 * fixture is the regression test for that class of fault.
 */
export const META_EMPTY_200_BODY = { messaging_product: "whatsapp" };

/**
 * SOURCE: twilio.com/docs/messaging/api/message-resource, the `CreateMessage`
 * response schema retrieved through Twilio's docs MCP server on 2026-09-05
 * (log row M8). Field names, types and nullability are the API's; the values are
 * illustrative.
 *
 * THE TWO FIELDS THAT MATTER MOST ARE THE NULL ONES. `price` and `price_unit`
 * are null on a fresh create — the schema says `price` "is populated after the
 * message has been sent/received, and may not be immediately available" — and
 * `num_segments` is "initially 0" when a Messaging Service is used "since a
 * sender hasn't yet been assigned". Both are the reason
 * `house_message_meter.provider_cost_state` exists.
 */
export const TWILIO_QUEUED_BODY = {
  account_sid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  api_version: "2010-04-01",
  body: "Tomorrow's delivery is confirmed for 09:00. Reply STOP to opt out.",
  date_created: "Fri, 05 Sep 2026 10:00:00 +0000",
  date_sent: null,
  date_updated: "Fri, 05 Sep 2026 10:00:00 +0000",
  direction: "outbound-api",
  error_code: null,
  error_message: null,
  from: "+15005550006",
  messaging_service_sid: "MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  num_media: "0",
  num_segments: "0",
  price: null,
  price_unit: null,
  sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  status: "queued",
  to: "+905551112233",
  uri: "/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages/SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
};

/**
 * The same resource once Twilio has reported a price. SOURCE: the same schema —
 * `price` is a string, `price_unit` an ISO 4217 code, and Twilio quotes the
 * amount NEGATIVE because it is an amount billed. The adapter takes the absolute
 * value and says so in `readCost`.
 */
export const TWILIO_PRICED_BODY = {
  ...TWILIO_QUEUED_BODY,
  status: "sent",
  num_segments: "1",
  price: "-0.00750",
  price_unit: "USD",
  date_sent: "Fri, 05 Sep 2026 10:00:02 +0000",
};

/**
 * A resource created and immediately failed. SOURCE: the schema's `status` enum
 * (thirteen values, `failed` and `undelivered` among them) plus `error_code` /
 * `error_message`, which the schema says are populated "if the Message `status`
 * is `failed` or `undelivered`". Error 30041 is Twilio's "Sender is restricted
 * or unregistered in a country requiring registration" (twilio.com/docs/api/
 * errors/30041, via the docs MCP, 2026-09-05) — the error a Türkiye sender hits
 * before its paperwork clears.
 */
export const TWILIO_FAILED_BODY = {
  ...TWILIO_QUEUED_BODY,
  status: "failed",
  error_code: 30041,
  error_message:
    "Sender is restricted or unregistered in a country requiring registration",
};

/**
 * Twilio's error envelope for a rejected REQUEST (as opposed to a created
 * message that failed). SOURCE: the standard `{ code, message, more_info,
 * status }` body Twilio returns on a 4xx, documented across
 * twilio.com/docs/api/errors. 21657 is "The Sender ID is invalid".
 */
export const TWILIO_REQUEST_REFUSED_BODY = {
  code: 21657,
  message: "The Sender ID is invalid",
  more_info: "https://www.twilio.com/docs/errors/21657",
  status: 400,
};
