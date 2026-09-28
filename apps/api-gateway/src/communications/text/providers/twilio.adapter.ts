/**
 * The Twilio adapter — SMS, and WhatsApp where a house is on Twilio rather than
 * on Meta directly.
 *
 * SOURCE OF EVERY SHAPE IN THIS FILE
 * ----------------------------------
 * `twilio.com/docs/messaging/api/message-resource`, retrieved through Twilio's
 * own documentation MCP server on 2026-09-05 (log rows M2, M8). The website was
 * NOT crawled: `www.twilio.com/robots.txt` publishes
 * `Content-Signal: ai-train=no, search=yes, ai-input=no`, and Twilio ships an
 * MCP server for agents, which is the sanctioned channel. The request is
 * form-encoded to `/2010-04-01/Accounts/{AccountSid}/Messages.json`; the
 * response fields, their nullability and the thirteen status values are the
 * ones the API description returns.
 *
 * THREE THINGS THIS ADAPTER KNOWS THAT THE OTHER ONE DOES NOT
 * -----------------------------------------------------------
 * 1. **The price is not known at send time.** `price` "is populated after the
 *    message has been sent/received, and may not be immediately available", and
 *    `num_segments` "is initially 0" when a Messaging Service is used "since a
 *    sender hasn't yet been assigned". So the ordinary successful outcome
 *    carries `cost.state = "not_reported_yet"`, and the meter row that follows
 *    it does too. Anything else would be a figure we made up about money.
 *
 * 2. **An alphanumeric sender is one-way and STOP does not work on it.**
 *    Twilio's own guidance: "Twilio's SMS STOP keyword does not work to
 *    automatically stop Alphanumeric Sender ID messaging. You must provide
 *    other instructions." A Türkiye sender is alphanumeric by construction, so
 *    the opt-out has to ride in the body and be honoured by us. This adapter
 *    refuses to build a message on an alphanumeric sender that carries no
 *    opt-out instruction, because the alternative is a message that is
 *    compliant nowhere and looks fine here.
 *
 * 3. **A message can be `accepted` and still fail.** `status` has thirteen
 *    values and only `delivered` and `read` mean a handset saw it. `queued`,
 *    `sending`, `accepted` and `scheduled` all mean Twilio has it. This adapter
 *    never maps any of them to "delivered".
 */

import {
  COST_NOT_REPORTED_YET,
  readString,
  type OutboundText,
  type TextTransport,
  type TransportCredential,
  type TransportCost,
  type TransportOutcome,
  type TransportRequest,
} from "./text-transport";

/**
 * The statuses that mean TWILIO HAS IT. Deliberately not called "sent": the
 * word `sent` is itself one of them and means something narrower.
 */
export const TWILIO_ACCEPTED_STATUSES = [
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
] as const;

/** The statuses that mean a handset saw it. */
export const TWILIO_DELIVERED_STATUSES = ["delivered", "read"] as const;

/** The statuses that mean it will not arrive. */
export const TWILIO_FAILED_STATUSES = [
  "failed",
  "undelivered",
  "canceled",
] as const;

/**
 * An alphanumeric sender ID: up to 11 characters, letters/digits/spaces, at
 * least one letter, and NOT an E.164 number. Twilio's own format rule.
 */
export function isAlphanumericSender(from: string): boolean {
  if (from.startsWith("+")) return false;
  return /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(from);
}

export class TwilioAdapter implements TextTransport {
  readonly provider = "twilio" as const;

  buildRequest(
    credential: TransportCredential,
    message: OutboundText,
  ): TransportRequest {
    if (credential.provider !== "twilio") {
      throw new Error(
        `TwilioAdapter was handed a ${credential.provider} credential; nothing was built and nothing was sent.`,
      );
    }
    if (!credential.accountRef) {
      throw new Error(
        "This sender has no Twilio account SID recorded, so no request could be addressed. Nothing was sent.",
      );
    }
    if (!credential.senderRef && !credential.serviceRef) {
      throw new Error(
        "This sender has neither a From value nor a Messaging Service SID recorded, so Twilio would have nothing to send it from. Nothing was sent.",
      );
    }
    if (credential.owner === "house" && !credential.accessToken) {
      throw new Error(
        "This house's Twilio credential is missing its key, so no request could be authorised. Nothing was sent.",
      );
    }

    const from = credential.senderRef ?? "";
    if (from && isAlphanumericSender(from) && !carriesOptOut(message.body)) {
      throw new Error(
        `"${from}" is an alphanumeric sender ID, which is one-way: the recipient cannot reply, and Twilio's automatic STOP handling does not apply to it. A message on this sender must carry its own opt-out instruction in the body. Nothing was sent.`,
      );
    }

    // Form-encoded, not JSON: the 2010-04-01 API takes
    // application/x-www-form-urlencoded. Getting this wrong yields a 400 that
    // reads like an authentication failure.
    const body: Record<string, string> = {
      To: message.toE164,
      Body: message.body,
    };
    if (credential.serviceRef) {
      // A Messaging Service, when there is one: Twilio's ISV guidance is one
      // subaccount and one Messaging Service per customer per use case, and
      // A2P 10DLC is incompatible with architectures that have no Messaging
      // Services at all (twilio.com/docs/messaging/compliance/a2p-10dlc/
      // onboarding-isv, via the docs MCP, 2026-09-05).
      body.MessagingServiceSid = credential.serviceRef;
    } else {
      body.From = from;
    }

    return {
      method: "POST",
      url: `https://api.twilio.com/2010-04-01/Accounts/${credential.accountRef}/Messages.json`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Basic auth over the account SID and the key. The token is never
        // logged and never returned; `dispatch` is the only place it is used.
        Authorization: `Basic ${basicAuth(credential.accountRef, credential.accessToken)}`,
      },
      encoding: "form",
      body,
    };
  }

  parseResponse(status: number, body: unknown): TransportOutcome {
    const root = (body ?? {}) as Record<string, unknown>;

    // Twilio's error envelope: { code, message, more_info, status }.
    const twilioCode =
      root.code !== undefined && root.code !== null && !root.sid
        ? String(root.code)
        : null;
    if (status >= 400 || twilioCode) {
      const said = readString(root.message);
      return {
        kind: "refused_by_provider",
        providerRef: null,
        providerStatus: null,
        errorCode: twilioCode ?? String(status),
        detail: said
          ? `Twilio refused it: ${said} (code ${twilioCode ?? status}). Nothing arrived and nothing is queued.`
          : `Twilio refused it with HTTP ${status} and no message. Nothing arrived and nothing is queued.`,
        cost: COST_NOT_REPORTED_YET,
        chargeable: false,
        chargeableReason:
          "The provider refused the message, so nothing is charged for it.",
      };
    }

    const sid = readString(root.sid);
    const messageStatus = readString(root.status);

    if (!sid) {
      return {
        kind: "unreadable",
        providerRef: null,
        providerStatus: messageStatus,
        errorCode: null,
        detail:
          "Twilio answered without refusing and without a message SID, so whether anything was accepted is unknown. It is recorded as unknown rather than as sent.",
        cost: COST_NOT_REPORTED_YET,
        chargeable: false,
        chargeableReason:
          "Whether the provider accepted this is unknown, so it is not counted against an allowance.",
      };
    }

    // A `status` that means it will NOT arrive, arriving on a 2xx. Twilio does
    // this: the resource is created, and its status is `failed`. Reading only
    // the HTTP code would file it as a send.
    if (
      messageStatus &&
      (TWILIO_FAILED_STATUSES as readonly string[]).includes(messageStatus)
    ) {
      const errCode =
        root.error_code !== undefined && root.error_code !== null
          ? String(root.error_code)
          : null;
      return {
        kind: "refused_by_provider",
        providerRef: sid,
        providerStatus: messageStatus,
        errorCode: errCode,
        detail: `Twilio created the message and immediately marked it ${messageStatus}${
          readString(root.error_message)
            ? `: ${String(root.error_message)}`
            : ""
        }. It will not arrive.`,
        cost: readCost(root),
        chargeable: readCost(root).state === "reported",
        chargeableReason:
          readCost(root).state === "reported"
            ? "Twilio reported a price for this message even though it did not arrive, so the cost is recorded as it was reported rather than zeroed."
            : "Twilio has not reported a price for this message, so nothing is charged for it yet.",
      };
    }

    return {
      kind: "accepted_by_provider",
      providerRef: sid,
      providerStatus: messageStatus,
      errorCode: null,
      detail: `Twilio accepted it${
        messageStatus ? ` and it is ${messageStatus}` : ""
      }. That is the provider holding it, not a handset showing it: only "delivered" and "read" mean a handset saw it, and those arrive later on a status callback this build does not have.`,
      cost: readCost(root),
      chargeable: true,
      chargeableReason:
        readCost(root).state === "reported"
          ? "Twilio reported a price with the response, so this message counts at the price it reported."
          : "An SMS is charged per segment. Twilio populates `price` after the send, so this message counts against the allowance now and its cost is recorded when the provider reports it.",
    };
  }
}

/**
 * Twilio's `price` and `price_unit`, read honestly.
 *
 * `price` arrives as a STRING and is negative in Twilio's own accounting
 * (an amount billed reads `-0.00750`). It is converted to positive minor units
 * here, and anything that does not parse yields `not_reported_yet` rather than
 * zero — a zero would be a claim that the message was free.
 */
function readCost(root: Record<string, unknown>): TransportCost {
  const rawPrice = root.price;
  const unit = readString(root.price_unit);
  if (rawPrice === null || rawPrice === undefined || !unit) {
    return COST_NOT_REPORTED_YET;
  }
  const parsed = Number(rawPrice);
  if (!Number.isFinite(parsed)) return COST_NOT_REPORTED_YET;

  // Minor units, rounded to the nearest whole unit. Twilio quotes prices to
  // more decimal places than a currency has (0.00750 USD), so the sub-cent
  // remainder is real and is NOT silently dropped: it is rounded, and the
  // rounding is stated here rather than discovered in a reconciliation.
  const minor = Math.round(Math.abs(parsed) * 100);
  return { state: "reported", minor, currency: unit.toUpperCase() };
}

/**
 * The opt-out instruction an alphanumeric sender must carry in its body.
 *
 * Matched loosely on purpose: the point is to refuse a body that carries NO
 * opt-out at all, not to police wording. A tight matcher would reject a valid
 * Turkish sentence and teach the caller to append an English word to get past
 * the check, which is worse than no check.
 */
function carriesOptOut(body: string): boolean {
  return /(stop|opt[\s-]?out|unsubscribe|iptal|çık|cik|abonelikten)/i.test(
    body,
  );
}

function basicAuth(accountSid: string, token: string | null): string {
  return Buffer.from(`${accountSid}:${token ?? ""}`).toString("base64");
}
