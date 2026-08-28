import {
  ENUMERATION_SAFE_SENT_MESSAGE,
  authErrorMessage,
  describeAuthFailure,
  forgotPasswordOutcome,
  routeAfterSignIn,
  routeAfterVerification,
  statusOf,
} from "@/auth/outcomes";

describe("forgotPasswordOutcome", () => {
  /**
   * `forgot-password.md` §1a: "always answers success — deliberately
   * enumeration-resistant" and "Rate-limit (429) and server-error states;
   * everything else looks like success by design."
   */
  it.each([200, 201, 204, 400, 401, 403, 404, 409, 422])(
    "shows success for %s so the screen cannot leak whether the account exists",
    (status) => {
      expect(forgotPasswordOutcome(status)).toBe("sent");
    },
  );

  it("shows the rate-limit state for 429", () => {
    expect(forgotPasswordOutcome(429)).toBe("rateLimited");
  });

  it.each([500, 502, 503])("shows the server-error state for %s", (status) => {
    expect(forgotPasswordOutcome(status)).toBe("serverError");
  });

  it("treats no response at all as a server error, not a success", () => {
    // Saying "check your mail" when the request never left the phone sends
    // the user off to wait for something that is not coming.
    expect(forgotPasswordOutcome(null)).toBe("serverError");
  });

  it("says nothing about the account in its success copy", () => {
    expect(ENUMERATION_SAFE_SENT_MESSAGE).toMatch(/If that address has an account/);
    expect(ENUMERATION_SAFE_SENT_MESSAGE).not.toMatch(/\bwe (sent|found)\b/i);
  });
});

describe("describeAuthFailure", () => {
  it("blames the connection, not the server, when there was no response", () => {
    expect(describeAuthFailure(null)).toMatch(/Check your connection/);
  });

  it("does not repeat the server's wording for a 401", () => {
    // A login 401 must read the same whether the address exists or not.
    expect(describeAuthFailure(401, "No user with that email")).toMatch(
      /don't match an account/,
    );
    expect(describeAuthFailure(401, "No user with that email")).not.toMatch(
      /No user/,
    );
  });

  it("does not repeat the server's wording for a 429", () => {
    expect(describeAuthFailure(429, "Too many requests from 10.0.0.1")).not.toMatch(
      /10\.0\.0\.1/,
    );
  });

  it("prefers the server's message where the server knows more", () => {
    expect(describeAuthFailure(400, "City is required")).toBe("City is required");
    expect(describeAuthFailure(409, "That invite was already used")).toBe(
      "That invite was already used",
    );
  });

  it("falls back to its own sentence when the server sent none", () => {
    expect(describeAuthFailure(400)).toMatch(/Check the details/);
    expect(describeAuthFailure(404)).toMatch(/couldn't find/);
  });

  it("has a sentence for every 5xx", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(describeAuthFailure(status, "Internal error")).toMatch(/our side/);
    }
  });
});

describe("statusOf / messageOf", () => {
  it("reads an ApiError-shaped throw", () => {
    const error = Object.assign(new Error("Nope"), { status: 403 });
    expect(statusOf(error)).toBe(403);
    // The message is read through the sentence it produces: a 403 is one of
    // the statuses where the server's own wording is preferred.
    expect(authErrorMessage(error)).toBe("Nope");
  });

  it("returns null for a plain Error, which is what session.signIn throws", () => {
    expect(statusOf(new Error("Sign-in failed."))).toBeNull();
  });

  it("returns null for a TypeError, which is what a dead network throws", () => {
    expect(statusOf(new TypeError("Network request failed"))).toBeNull();
    expect(authErrorMessage(new TypeError("Network request failed"))).toMatch(
      /Check your connection/,
    );
  });

  it("does not treat a non-numeric status as a status", () => {
    expect(statusOf({ status: "500" })).toBeNull();
    expect(statusOf(null)).toBeNull();
    expect(statusOf(undefined)).toBeNull();
  });

  it("ignores a blank message", () => {
    // A whitespace-only server message must not render as an empty error row.
    expect(authErrorMessage({ status: 403, message: "   " })).toMatch(
      /don't have access/,
    );
    expect(authErrorMessage({ status: 403 })).toMatch(/don't have access/);
  });
});

describe("routeAfterVerification", () => {
  it("skips the guide when a menu already exists", () => {
    // Mirrors VerifyEmail.tsx:41-43 — `progress?.menu_uploaded ? '/' : '/get-started'`.
    expect(routeAfterVerification({ menu_uploaded: true })).toBe("/");
  });

  it("shows the guide when nothing has been imported", () => {
    expect(routeAfterVerification({ menu_uploaded: false })).toBe("/get-started");
    expect(routeAfterVerification({})).toBe("/get-started");
  });

  it("shows the guide when progress could not be read at all", () => {
    // Landing an un-onboarded owner on an empty dashboard is the worse of the
    // two mistakes: there is nothing there and no explanation why.
    expect(routeAfterVerification(null)).toBe("/get-started");
    expect(routeAfterVerification({ menu_uploaded: null })).toBe("/get-started");
  });
});

describe("routeAfterSignIn", () => {
  it("returns you where you were", () => {
    expect(routeAfterSignIn("/inventory")).toBe("/inventory");
  });

  it("lands home when there is nowhere to return to", () => {
    expect(routeAfterSignIn(null)).toBe("/");
  });
});
