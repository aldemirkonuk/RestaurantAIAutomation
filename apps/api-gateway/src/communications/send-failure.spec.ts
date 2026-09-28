/**
 * classifySendFailure (ADR 0172 addendum): "the recipient provably did not get
 * this" is read from typed fields on the error object — HTTP status, OAuth
 * error code, nodemailer code / responseCode — and from nothing else. The
 * error MESSAGE is never consulted: procurement wraps it with the vendor's
 * contact address, which a vendor controls.
 *
 * Run: cd apps/api-gateway && npx jest --testPathPattern send-failure --runInBand
 */

import {
  RELAY_PARKING_GMAIL_REASONS,
  classifySendFailure,
  gmailErrorReasons,
  gmailRefusalClosesRelayDraft,
  gmailRefusalParksRelayDraft,
} from "./send-failure";
import { MimeHeaderError } from "./mime-headers";

/** A googleapis / gaxios failure: status lives on `response`, text on `message`. */
function gaxios(
  status: number,
  data: unknown = {},
  message = "Request failed",
) {
  return Object.assign(new Error(message), {
    code: String(status),
    response: { status, data },
  });
}

/** A nodemailer failure. */
function smtp(fields: Record<string, unknown>, message = "smtp failed") {
  return Object.assign(new Error(message), fields);
}

describe("classifySendFailure — definite refusals", () => {
  it.each([
    ["a MimeHeaderError", new MimeHeaderError("bad To"), "header"],
    [
      "an OAuth invalid_grant",
      gaxios(400, { error: "invalid_grant", error_description: "Bad" }),
      "credentials",
    ],
    [
      "an OAuth invalid_client",
      gaxios(401, { error: "invalid_client" }),
      "credentials",
    ],
    [
      "an OAuth unauthorized_client",
      gaxios(400, { error: "unauthorized_client" }),
      "credentials",
    ],
    ["a Gmail API 401", gaxios(401, { error: { code: 401 } }), "credentials"],
    [
      "a nodemailer EAUTH",
      smtp({ code: "EAUTH", responseCode: 535 }),
      "credentials",
    ],
    ["a Gmail API 400", gaxios(400, { error: { code: 400 } }), "rejected"],
    ["a Gmail API 403", gaxios(403), "rejected"],
    ["a Gmail API 404", gaxios(404), "rejected"],
    ["a nodemailer EENVELOPE", smtp({ code: "EENVELOPE" }), "rejected"],
    [
      "an SMTP 550 reply",
      smtp({ code: "EENVELOPE", responseCode: 550, command: "RCPT TO" }),
      "rejected",
    ],
    [
      "an SMTP 5xx at end of DATA",
      smtp({ code: "EMESSAGE", responseCode: 554 }),
      "rejected",
    ],
  ])("%s is definite", (_n, error, kind) => {
    expect(classifySendFailure(error)).toEqual({ kind });
  });
});

describe("classifySendFailure — everything else is ambiguous", () => {
  it.each([
    [
      "a socket hang-up",
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    ],
    ["a timeout", Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })],
    ["a Gmail API 500", gaxios(500)],
    ["a Gmail API 503", gaxios(503)],
    ["a Gmail API 504", gaxios(504)],
    ["a Gmail API 429", gaxios(429)],
    ["an SMTP 451 (transient)", smtp({ code: "EMESSAGE", responseCode: 451 })],
    ["an SMTP connection failure", smtp({ code: "ECONNECTION" })],
    ["a nodemailer ESOCKET", smtp({ code: "ESOCKET" })],
    ["a bare Error", new Error("boom")],
    ["null", null],
    ["a string", "invalid_grant"],
  ])("%s is ambiguous", (_n, error) => {
    expect(classifySendFailure(error)).toBeUndefined();
  });

  // The whole point: text is never read. Every phrase the old regexes matched,
  // in message AND in every other free-text field, changes nothing.
  const PHRASES = [
    "invalid_grant",
    "invalid_client",
    "unauthorized_client",
    "authentication failed",
    "invalid credentials",
    "Username and Password not accepted",
    "No email delivery method available",
    "550 5.1.1 user unknown",
    "Suite 500 - Orders",
    "5.7.1",
    "no such user",
    "recipient address rejected",
    "mailbox unavailable",
    "address rejected",
    "does not exist",
    "invalid recipient",
    "no recipients defined",
    "invalid to header",
  ];
  it.each(PHRASES)(
    "does not treat %j in the message or response text as a refusal",
    (phrase) => {
      const ambiguous = Object.assign(
        new Error(`Email could not be delivered to ${phrase}: x`),
        {
          code: "ECONNRESET",
          command: phrase,
          response: { data: { error: { message: phrase } } },
        },
      );
      expect(classifySendFailure(ambiguous)).toBeUndefined();
    },
  );

  it("does not treat a number-shaped message as an HTTP or SMTP status", () => {
    expect(
      classifySendFailure(new Error("503 Service Unavailable")),
    ).toBeUndefined();
    expect(classifySendFailure(new Error("550 no such user"))).toBeUndefined();
  });
});

/**
 * Founder, 2026-09-27, merge-train item 69 / OD-174 (b), verbatim "Park
 * quota/delegation 403 (Recommended)": a Gmail 403 whose REASON is a fault of
 * the shared sending mailbox parks a relay draft; every other 403 and every
 * 404 still closes it RELAY_REFUSED (item 66). The reason is read from typed
 * fields of the Gmail error body, never from its message.
 * Founder item 76 (2026-09-27, verbatim "Park it (Recommended)") adds
 * `insufficientPermissions` to the parking reasons.
 */
describe("gmailErrorReasons — typed fields only", () => {
  /** Gmail's v1 JSON error body, as gaxios keeps it on `response.data`. */
  function gmailBody(status: number, reason: string, message = "Forbidden") {
    return gaxios(
      status,
      {
        error: {
          code: status,
          message,
          errors: [{ domain: "usageLimits", reason, message }],
          status: "PERMISSION_DENIED",
        },
      },
      message,
    );
  }

  it("reads errors[].reason from the response body", () => {
    expect(gmailErrorReasons(gmailBody(403, "dailyLimitExceeded"))).toEqual([
      "dailyLimitExceeded",
    ]);
  });

  it("reads an AIP-193 ErrorInfo reason from details, and only ErrorInfo", () => {
    const err = gaxios(403, {
      error: {
        code: 403,
        message: "Gmail API has not been used in project 1 before or it is disabled.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "SERVICE_DISABLED",
            domain: "googleapis.com",
          },
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            reason: "quotaExceeded",
          },
        ],
      },
    });
    expect(gmailErrorReasons(err)).toEqual(["SERVICE_DISABLED"]);
  });

  it("reads an errors array a googleapis version copies onto the error itself", () => {
    const err = Object.assign(new Error("Rate Limit Exceeded"), {
      status: 403,
      errors: [{ reason: "rateLimitExceeded" }],
    });
    expect(gmailErrorReasons(err)).toEqual(["rateLimitExceeded"]);
  });

  it("never reads the message: quota words in text, no typed reason, give nothing", () => {
    const err = gaxios(
      403,
      { error: { code: 403, message: "Daily Limit Exceeded quotaExceeded" } },
      "Daily Limit Exceeded rateLimitExceeded userRateLimitExceeded",
    );
    expect(gmailErrorReasons(err)).toEqual([]);
  });

  it("ignores non-string reasons and non-object entries", () => {
    const err = gaxios(403, {
      error: { errors: [null, "dailyLimitExceeded", { reason: 7 }, {}] },
    });
    expect(gmailErrorReasons(err)).toEqual([]);
    expect(gmailErrorReasons(null)).toEqual([]);
    expect(gmailErrorReasons("dailyLimitExceeded")).toEqual([]);
  });
});

describe("item 69 — which relay refusals park and which close", () => {
  const rejected = { kind: "rejected" as const };

  it("parks on exactly the documented sending-mailbox reasons", () => {
    expect([...RELAY_PARKING_GMAIL_REASONS].sort()).toEqual(
      [
        "RATE_LIMIT_EXCEEDED",
        "SERVICE_DISABLED",
        "accessNotConfigured",
        "dailyLimitExceeded",
        "domainPolicy",
        "insufficientPermissions",
        "quotaExceeded",
        "rateLimitExceeded",
        "userRateLimitExceeded",
      ].sort(),
    );
  });

  it.each([...RELAY_PARKING_GMAIL_REASONS])(
    "a Gmail 403 with reason %s parks and does not close",
    (reason) => {
      const result = {
        refusal: rejected,
        gmailApiStatus: 403,
        gmailApiReasons: [reason],
      };
      expect(gmailRefusalParksRelayDraft(result)).toBe(true);
      expect(gmailRefusalClosesRelayDraft(result)).toBe(false);
    },
  );

  it.each([
    ["forbidden (how Gmail types 'Delegation denied')", ["forbidden"]],
    ["no reason at all", []],
    ["an unknown reason", ["somethingNew"]],
    ["the reason in the wrong case", ["DAILYLIMITEXCEEDED"]],
  ])("a Gmail 403 with %s still closes", (_label, reasons) => {
    const result = {
      refusal: rejected,
      gmailApiStatus: 403,
      gmailApiReasons: reasons,
    };
    expect(gmailRefusalParksRelayDraft(result)).toBe(false);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(true);
  });

  // Founder item 76 (2026-09-27, verbatim "Park it (Recommended)"): a send
  // 403 `insufficientPermissions` (the shared mailbox's grant lacks the send
  // scope) parks like the quota/delegation 403s instead of closing.
  it("a Gmail 403 insufficientPermissions parks and does not close (item 76)", () => {
    const result = {
      refusal: rejected,
      gmailApiStatus: 403,
      gmailApiReasons: ["insufficientPermissions"],
    };
    expect(gmailRefusalParksRelayDraft(result)).toBe(true);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(false);
  });

  it("a Gmail 404 carrying insufficientPermissions still closes — 403 only parks (item 76)", () => {
    const result = {
      refusal: rejected,
      gmailApiStatus: 404,
      gmailApiReasons: ["insufficientPermissions"],
    };
    expect(gmailRefusalParksRelayDraft(result)).toBe(false);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(true);
  });

  it("a Gmail 404 closes even when it carries a quota reason — 403 only parks", () => {
    const result = {
      refusal: rejected,
      gmailApiStatus: 404,
      gmailApiReasons: ["dailyLimitExceeded"],
    };
    expect(gmailRefusalParksRelayDraft(result)).toBe(false);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(true);
  });

  it("parks when a parking reason sits beside another one", () => {
    const result = {
      refusal: rejected,
      gmailApiStatus: 403,
      gmailApiReasons: ["forbidden", "userRateLimitExceeded"],
    };
    expect(gmailRefusalParksRelayDraft(result)).toBe(true);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(false);
  });

  it.each([
    ["a Gmail 429", { refusal: undefined, gmailApiStatus: 429 }],
    ["a Gmail 400", { refusal: rejected, gmailApiStatus: 400 }],
    ["the SMTP fallback (no Gmail status)", { refusal: rejected }],
    ["a credentials refusal", { refusal: { kind: "credentials" as const }, gmailApiStatus: 401 }],
  ])("%s with a quota reason neither parks nor closes", (_label, base) => {
    const result = { ...base, gmailApiReasons: ["dailyLimitExceeded"] };
    expect(gmailRefusalParksRelayDraft(result)).toBe(false);
    expect(gmailRefusalClosesRelayDraft(result)).toBe(false);
  });
});
