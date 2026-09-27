/**
 * classifySendFailure (ADR 0172 addendum): "the recipient provably did not get
 * this" is read from typed fields on the error object — HTTP status, OAuth
 * error code, nodemailer code / responseCode — and from nothing else. The
 * error MESSAGE is never consulted: procurement wraps it with the vendor's
 * contact address, which a vendor controls.
 *
 * Run: cd apps/api-gateway && npx jest --testPathPattern send-failure --runInBand
 */

import { classifySendFailure } from "./send-failure";
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
