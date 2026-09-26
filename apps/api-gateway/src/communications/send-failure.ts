/**
 * Did this send failure PROVE the recipient did not get the message?
 *
 * Only a positively-identified refusal proves it. A timeout, a connection
 * reset or a hang-up can all land after the remote server accepted the message,
 * and an SMTP 4xx or an HTTP 5xx is a "try later" that may still have been
 * relayed. So this is a deliberate allow-list, and anything it does not name is
 * ambiguous: guessing wrong that way sends a vendor a second purchase order.
 *
 * It reads TYPED FIELDS off the error object — HTTP status, the OAuth error
 * code, nodemailer's `code` / `responseCode` — and never `error.message`. The
 * caller wraps that message with the vendor's contact address, which the vendor
 * controls, so a phrase matched in text can be planted (ADR 0172 addendum).
 */

import { MimeHeaderError } from "./mime-headers";

export type SendRefusalKind =
  /** mime-headers.ts refused to build the message; Gmail was never called. */
  | "header"
  /** Neither the Gmail API nor SMTP was configured; nothing was attempted. */
  | "no-transport"
  /** The provider refused our credentials; the request never became a message. */
  | "credentials"
  /** The provider rejected the request or the envelope outright (Gmail 4xx, SMTP 5xx). */
  | "rejected";

export interface SendRefusal {
  kind: SendRefusalKind;
}

/** OAuth token-endpoint error codes (RFC 6749 §5.2) that mean "credentials refused". */
const OAUTH_CREDENTIAL_ERRORS = new Set([
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
]);

/**
 * Gmail API statuses whose documented meaning is "request not processed": bad
 * request, unauthorised, forbidden/quota, not found. 429 and every 5xx are
 * deliberately absent — a gateway or backend error can follow a message that
 * was already accepted.
 */
const GMAIL_REJECTED_STATUSES = new Set([400, 403, 404]);

function isStatus(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

/** The HTTP status of a googleapis / gaxios failure, from typed fields only. */
function httpStatus(e: Record<string, any>): number | undefined {
  if (isStatus(e.response?.status)) return e.response.status;
  if (isStatus(e.status)) return e.status;
  // Some gaxios versions carry the status as a numeric string in `code`.
  if (typeof e.code === "string" && /^\d{3}$/.test(e.code)) {
    return Number(e.code);
  }
  return undefined;
}

/**
 * The refusal this failure PROVES, or undefined when it is ambiguous.
 * Never inspects `message`, `stack`, or any free-text field.
 */
export function classifySendFailure(error: unknown): SendRefusal | undefined {
  if (error instanceof MimeHeaderError) return { kind: "header" };
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, any>;

  // Google's token endpoint answers { error: "invalid_grant", … } — a string.
  const oauth = e.response?.data?.error;
  if (typeof oauth === "string" && OAUTH_CREDENTIAL_ERRORS.has(oauth)) {
    return { kind: "credentials" };
  }

  // nodemailer: authentication precedes the message; EENVELOPE is thrown
  // before DATA (no recipients, or the server refused every recipient).
  if (e.code === "EAUTH") return { kind: "credentials" };
  if (e.code === "EENVELOPE") return { kind: "rejected" };

  // An SMTP 5xx is a permanent failure. 4xx is transient and may still have
  // been queued, so it is NOT here.
  if (
    isStatus(e.responseCode) &&
    e.responseCode >= 500 &&
    e.responseCode <= 599
  ) {
    return { kind: "rejected" };
  }

  const status = httpStatus(e);
  if (status === 401) return { kind: "credentials" };
  if (status !== undefined && GMAIL_REJECTED_STATUSES.has(status)) {
    return { kind: "rejected" };
  }

  return undefined;
}
