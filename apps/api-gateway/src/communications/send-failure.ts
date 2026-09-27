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
export function httpStatus(e: Record<string, any>): number | undefined {
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

/**
 * The Gmail API statuses that close a RELAY draft (founder, 2026-09-27, merge-
 * train item 66, verbatim "Close it (RELAY_REFUSED)"; rejected "Reopen via a
 * new signal" and "Keep 'not confirmed'"). The ruling names Gmail 403 and 404
 * reached through the relay path, and nothing else — so this set is exactly
 * those two, and it is read only from `EmailResult.gmailApiStatus`, which
 * `GmailService.sendEmail` sets on its Gmail API branch alone.
 *
 * NOT covered, and deliberately left as they were before item 66 (a 200
 * `success:false` that the orchestrator classifies on its own):
 *   - Gmail 400 — in `GMAIL_REJECTED_STATUSES`, but not in the ruling;
 *   - the SMTP fallback's EENVELOPE and SMTP 5xx — `kind: "rejected"` too, but
 *     a different transport the ruling never covered (PR #429 audit at
 *     d8be79ab2 found the first cut of item 66 closed on all of these).
 * Widening this set is a founder call, not an implementation detail.
 *
 * Narrowed by item 69 (below): a 403 whose Gmail reason says the SENDING
 * mailbox is out of quota or switched off parks instead of closing.
 */
export const RELAY_CLOSING_GMAIL_STATUSES: ReadonlySet<number> = new Set([
  403, 404,
]);

/**
 * The Gmail error reasons that PARK a relay draft instead of closing it
 * (founder, 2026-09-27, merge-train item 69 / OD-174 (b), verbatim "Park
 * quota/delegation 403 (Recommended)"; rejected: keep closing every 403 as
 * item 66 built it). Each one is a fault of the one shared deployment mailbox
 * the relay sends from, not of the draft — so closing on it would close EVERY
 * relay draft sent while the fault lasts, each for good.
 *
 * Source: Gmail API "Resolve errors" (developers.google.com/workspace/gmail/
 * api/guides/handle-errors, read 2026-09-27) documents 403 with
 * `errors[].reason` = `dailyLimitExceeded`, `userRateLimitExceeded`,
 * `rateLimitExceeded` and `domainPolicy` ("The domain administrators have
 * disabled Gmail apps"). Google's shared API errors add `quotaExceeded` and
 * `accessNotConfigured` (the Gmail API is disabled in the Cloud project), and
 * the AIP-193 `google.rpc.ErrorInfo` detail carries the same two facts as
 * `RATE_LIMIT_EXCEEDED` and `SERVICE_DISABLED`.
 *
 * Delegation has NO reason of its own: Gmail's "Delegation denied for <user>"
 * arrives as `reason: "forbidden"`, `domain: "global"` — the same typed fields
 * as any other forbidden request — so it cannot be told apart without reading
 * the message, which this module never does. It also cannot arise on this
 * transport as a send 403: `GmailService` sends as `userId: "me"` with the
 * mailbox's own OAuth refresh token, so a grant or delegation fault surfaces
 * at the token endpoint (`invalid_grant` / `unauthorized_client`, kind
 * `"credentials"`), which never closed a relay draft. `forbidden` therefore
 * stays in the closing bucket, as do `insufficientPermissions` and a 403 that
 * carries no reason at all ("every other 403 ... still closes", item 69).
 */
export const RELAY_PARKING_GMAIL_REASONS: ReadonlySet<string> = new Set([
  // Gmail API errors[].reason (the v1 JSON error body)
  "dailyLimitExceeded",
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
  "domainPolicy",
  "accessNotConfigured",
  // AIP-193 google.rpc.ErrorInfo reasons for the same two facts
  "RATE_LIMIT_EXCEEDED",
  "SERVICE_DISABLED",
]);

const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

/**
 * The Gmail API's machine-readable error reasons for this failure, read from
 * TYPED fields only: `response.data.error.errors[].reason` (the v1 JSON error
 * body gaxios keeps on `response.data`), the same array when a googleapis
 * version copies it onto the error as `errors`, and the `reason` of every
 * `google.rpc.ErrorInfo` in `response.data.error.details`. Never `message`,
 * never any free-text field. Non-string entries are ignored.
 */
export function gmailErrorReasons(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const e = error as Record<string, any>;
  const body = e.response?.data?.error;
  const reasons: string[] = [];
  const read = (list: unknown, onlyErrorInfo: boolean) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      if (onlyErrorInfo && entry["@type"] !== ERROR_INFO_TYPE) continue;
      if (typeof entry.reason === "string" && !reasons.includes(entry.reason)) {
        reasons.push(entry.reason);
      }
    }
  };
  if (body && typeof body === "object") {
    read(body.errors, false);
    read(body.details, true);
  }
  read(e.errors, false);
  return reasons;
}

/**
 * Does this failed send PARK a relay draft under item 69? Only a Gmail API
 * (never SMTP) refusal whose typed status is 403 AND whose typed reasons name
 * a sending-mailbox fault (`RELAY_PARKING_GMAIL_REASONS`). A 404 never parks,
 * whatever its reason; neither does a 403 with no reason or another reason.
 */
export function gmailRefusalParksRelayDraft(result: {
  refusal?: SendRefusal;
  gmailApiStatus?: number;
  gmailApiReasons?: readonly string[];
}): boolean {
  return (
    result.refusal?.kind === "rejected" &&
    result.gmailApiStatus === 403 &&
    (result.gmailApiReasons ?? []).some((r) =>
      RELAY_PARKING_GMAIL_REASONS.has(r),
    )
  );
}

/**
 * Does this failed send close a relay draft under item 66? Only a Gmail API
 * (never SMTP) refusal whose typed HTTP status is 403 or 404 — and, since item
 * 69, not a 403 that `gmailRefusalParksRelayDraft` parks instead.
 */
export function gmailRefusalClosesRelayDraft(result: {
  refusal?: SendRefusal;
  gmailApiStatus?: number;
  gmailApiReasons?: readonly string[];
}): boolean {
  return (
    result.refusal?.kind === "rejected" &&
    result.gmailApiStatus !== undefined &&
    RELAY_CLOSING_GMAIL_STATUSES.has(result.gmailApiStatus) &&
    !gmailRefusalParksRelayDraft(result)
  );
}

/**
 * Carries an item-66 refusal (`gmailRefusalClosesRelayDraft` above: a Gmail
 * API 403/404) across the throw/catch boundary inside
 * `RelayEmailService.dispatch()`, the way `MimeHeaderError` already does for
 * `kind: "header"`.
 *
 * Founder, 2026-09-27 (item 66, "Close it (RELAY_REFUSED)", rejecting "Reopen
 * via a new signal" and "Keep not confirmed"): a Gmail 403/404 reached
 * through the RELAY path — `RelayEmailService.sendThroughDeploymentMailbox`,
 * the orchestrator's transport — closes the draft as `RELAY_REFUSED`, no
 * retry. PR #405's ruling for the SAME Gmail statuses on the DIRECT-SEND path
 * (`ProcurementService.sendVendorEmail`) reopens the draft to
 * `PENDING_APPROVAL` instead — the two paths now deliberately disagree, and
 * this class exists so the relay path's own dispatch loop, not the shared
 * classifier, is what encodes that disagreement. Gmail 400, the SMTP
 * fallback's rejections, `"credentials"` (401/OAuth) and `"no-transport"` are
 * NOT covered: they stay exactly as before on the relay path.
 */
export class RelayRejectedByProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayRejectedByProviderError";
  }
}

/**
 * Carries an item-69 park (`gmailRefusalParksRelayDraft` above: a Gmail API
 * 403 whose reason is quota, rate limit, a domain policy or the API switched
 * off on the SHARED sending mailbox) across the throw/catch boundary inside
 * `RelayEmailService.dispatch()`.
 *
 * Founder, 2026-09-27 (item 69, "Park quota/delegation 403 (Recommended)"):
 * such a 403 parks the draft the way ADR 0099's relay 401 parks it, instead
 * of closing it `RELAY_REFUSED`. `sendAsOrchestrator` answers 503 for it,
 * which the orchestrator's `_is_definite_send_refusal` reads as a gateway 5xx
 * FIRST, before any other pattern — ambiguous, parked `SEND_UNCONFIRMED`, not
 * raised, so the bus does not retry it and no person-less loop re-sends it.
 */
export class RelaySendingMailboxUnavailableError extends Error {
  readonly reasons: readonly string[];
  constructor(message: string, reasons: readonly string[]) {
    super(message);
    this.name = "RelaySendingMailboxUnavailableError";
    this.reasons = [...reasons];
  }
}
