/**
 * The WhatsApp Business Platform (Cloud API) adapter.
 *
 * SOURCE OF EVERY SHAPE IN THIS FILE
 * ----------------------------------
 * `developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages`
 * and `.../pricing`, both fetched 2026-09-05 and logged in
 * `p4-scratch/p4bc-fetch-log.md` rows 14 and 16. The request body, the URL
 * shape, the 4096-character body limit and the response envelope are
 * transcribed from those pages, not remembered.
 *
 * THE PRICING RULE IS PART OF THE ADAPTER, NOT A BILLING DETAIL
 * -------------------------------------------------------------
 * Meta charges "only when a template message is delivered", and "All
 * non-template messages are free". A non-template message can ONLY be sent
 * inside an open 24-hour customer service window. So for the traffic this
 * product actually has — a vendor writes, the house answers — every message is
 * free-form, inside the window, and free.
 *
 * That makes the window state load-bearing twice over: it decides whether the
 * message may be sent at all, and whether it is charged. `windowOpen: null`
 * (we could not read it) is therefore NOT treated as `false`. A closed window
 * is a refusal the house can act on ("start with a template"); an unread window
 * is our ignorance, and pretending it is a closed window would put our fault in
 * the house's language.
 *
 * WHAT THIS ADAPTER DOES NOT DO
 * -----------------------------
 * Templates. ADR 0121 puts house-initiated template sends in P2, behind the
 * seal, because a template is the only outbound that can arrive unprompted and
 * it is the only one that is charged. `buildRequest` refuses to build one
 * rather than building an untested shape that would work.
 */

import {
  COST_NOT_REPORTED_YET,
  readString,
  type OutboundText,
  type TextTransport,
  type TransportCredential,
  type TransportOutcome,
  type TransportRequest,
} from "./text-transport";

/**
 * The Graph API version this adapter builds against.
 *
 * Pinned, and read from the credential when the credential names one, because a
 * token minted against one version and used against another is the failure that
 * looks like a permissions problem. `v25.0` is the version Meta's own examples
 * use on the pages fetched 2026-09-05.
 */
export const META_DEFAULT_API_VERSION = "v25.0";

/** Meta's stated maximum for a text body. Enforced here, not discovered later. */
export const META_MAX_BODY_CHARS = 4096;

export class MetaCloudAdapter implements TextTransport {
  readonly provider = "meta_cloud" as const;

  buildRequest(
    credential: TransportCredential,
    message: OutboundText,
  ): TransportRequest {
    if (credential.provider !== "meta_cloud") {
      throw new Error(
        `MetaCloudAdapter was handed a ${credential.provider} credential; nothing was built and nothing was sent.`,
      );
    }
    if (!credential.senderRef) {
      throw new Error(
        "This sender has no WhatsApp business phone number id recorded, so no request could be addressed. Nothing was sent.",
      );
    }
    if (credential.owner === "house" && !credential.accessToken) {
      throw new Error(
        "This house's WhatsApp credential is missing its token, so no request could be authorised. Nothing was sent.",
      );
    }
    if (message.windowOpen !== true) {
      // Deliberately one refusal for two different facts, with two different
      // sentences: see the header. Building a free-form message for a closed
      // window would produce a request Meta refuses at error time, after the
      // send path has already told a manager it went.
      throw new Error(
        message.windowOpen === false
          ? "This conversation's 24-hour window is closed, so a free-form WhatsApp message cannot be sent. Nothing was sent, and nothing was queued. Reaching this person again needs an approved template, which this build does not have."
          : "Whether this conversation's 24-hour window is open could not be read, so nothing was attempted. That is not the same as the window being closed.",
      );
    }
    if (message.body.length > META_MAX_BODY_CHARS) {
      throw new Error(
        `This message is ${message.body.length} characters and WhatsApp's limit is ${META_MAX_BODY_CHARS}. Nothing was sent and nothing was truncated: a silently shortened message is a message the house did not write.`,
      );
    }

    const version = credential.apiVersion ?? META_DEFAULT_API_VERSION;
    return {
      method: "POST",
      url: `https://graph.facebook.com/${version}/${credential.senderRef}/messages`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.accessToken ?? "{platform}"}`,
      },
      encoding: "json",
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.toE164,
        type: "text",
        text: {
          // FALSE, and it is a decision. Meta renders a clickable link either
          // way; a preview card fetches the URL's page and shows it to the
          // recipient, which is a third party being handed the house's link.
          // More concretely: from 2026-04-01 a company without a local Turkish
          // entity may not put a URL in a message to a Turkish number at all
          // (help.twilio.com/articles/4416881468187, via Twilio's docs MCP,
          // 2026-09-05), so a product that decorates URLs is a product that
          // makes that rule easier to break.
          preview_url: false,
          body: message.body,
        },
      },
    };
  }

  parseResponse(status: number, body: unknown): TransportOutcome {
    const root = (body ?? {}) as Record<string, unknown>;

    // Meta's error envelope: { error: { message, type, code, error_subcode,
    // fbtrace_id } }. Checked FIRST, because a 200 carrying an error object is
    // a shape providers do ship and a status-only check would call it success.
    const error = root.error as Record<string, unknown> | undefined;
    if (error || status >= 400) {
      const code =
        error && error.code !== undefined && error.code !== null
          ? String(error.code)
          : String(status);
      const said = readString(error?.message);
      return {
        kind: "refused_by_provider",
        providerRef: null,
        providerStatus: null,
        errorCode: code,
        detail: said
          ? `WhatsApp refused it: ${said} (code ${code}). Nothing arrived and nothing is queued.`
          : `WhatsApp refused it with HTTP ${status} and no message. Nothing arrived and nothing is queued.`,
        cost: COST_NOT_REPORTED_YET,
        chargeable: false,
        chargeableReason:
          "The provider refused the message, so nothing is charged for it.",
      };
    }

    const messages = Array.isArray(root.messages) ? root.messages : [];
    const first = (messages[0] ?? {}) as Record<string, unknown>;
    const wamid = readString(first.id);

    if (!wamid) {
      // A 2xx with no id. NOT reported as success with a made-up reference —
      // that is precisely the `mockSendSms` fabrication ADR 0084 deleted.
      return {
        kind: "unreadable",
        providerRef: null,
        providerStatus: null,
        errorCode: null,
        detail:
          "WhatsApp answered without refusing and without a message id, so whether anything was accepted is unknown. It is recorded as unknown rather than as sent.",
        cost: COST_NOT_REPORTED_YET,
        chargeable: false,
        chargeableReason:
          "Whether the provider accepted this is unknown, so it is not counted against an allowance. An uncounted message is recoverable; a wrongly counted one is a bill.",
      };
    }

    return {
      kind: "accepted_by_provider",
      providerRef: wamid,
      // Meta's create response carries no per-message status; the delivery
      // status arrives later on a webhook. Saying `null` here rather than
      // "sent" keeps "Meta has it" apart from "a handset showed it", the same
      // distinction `team_note_deliveries` draws between accepted_by_service
      // and delivered.
      providerStatus: null,
      errorCode: null,
      detail:
        "WhatsApp accepted it and returned a message id. That is the provider holding it, not a handset showing it; a delivery status arrives later on a webhook this build does not have.",
      cost: COST_NOT_REPORTED_YET,
      // Free by RULE, and the rule is quotable: this adapter only ever builds a
      // non-template message inside an open window, and "All non-template
      // messages are free" (Meta pricing, fetched 2026-09-05).
      chargeable: false,
      chargeableReason:
        "A non-template WhatsApp message inside an open 24-hour customer service window is free on Meta's own rate card, so it does not count against this house's allowance.",
    };
  }
}
