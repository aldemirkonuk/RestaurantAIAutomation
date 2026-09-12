import {
  EXCLUDED_CONFUSABLES,
  INVITE_CHARSET,
  INVITE_CODE_LENGTH,
  describeInviteRejection,
  inviteCodeError,
  isCompleteInviteCode,
  normalizeInviteCode,
} from "@/auth/inviteCode";

const VALID = "ABCD2345";

describe("normalizeInviteCode", () => {
  it("uppercases", () => {
    expect(normalizeInviteCode("abcd2345")).toBe(VALID);
  });

  it("drops the separators people add when reading a code aloud", () => {
    expect(normalizeInviteCode("ABCD-2345")).toBe(VALID);
    expect(normalizeInviteCode("ABCD 2345")).toBe(VALID);
    expect(normalizeInviteCode("ABCD_2345")).toBe(VALID);
    expect(normalizeInviteCode("  abcd 23 45 ")).toBe(VALID);
  });

  it("leaves characters it cannot fix alone, so the error can name them", () => {
    expect(normalizeInviteCode("abcd23i5")).toBe("ABCD23I5");
  });
});

describe("inviteCodeError", () => {
  it("accepts a well-formed code", () => {
    expect(inviteCodeError(VALID)).toBeNull();
    expect(inviteCodeError("abcd-2345")).toBeNull();
    expect(isCompleteInviteCode("abcd 2345")).toBe(true);
  });

  it("accepts every character the server can actually mint", () => {
    // Walk the charset in 8-character windows: nothing the mint produces may
    // be refused by the keyboard that has to retype it.
    for (let i = 0; i + INVITE_CODE_LENGTH <= INVITE_CHARSET.length; i++) {
      const code = INVITE_CHARSET.slice(i, i + INVITE_CODE_LENGTH);
      expect(inviteCodeError(code)).toBeNull();
    }
  });

  it("asks for the code when nothing has been typed", () => {
    expect(inviteCodeError("")).toMatch(/8-character/);
    expect(inviteCodeError("   ")).toMatch(/8-character/);
  });

  it.each(EXCLUDED_CONFUSABLES)(
    "explains that %s is never in a code rather than just failing",
    (char) => {
      const message = inviteCodeError(`ABCD234${char}`);
      // The server strips I/O/0/1 from the charset so codes cannot be misread.
      // A user staring at handwriting needs to be told that, not told "invalid".
      expect(message).toContain(char);
      expect(message).toMatch(/never contain/);
    },
  );

  it("names an ordinary bad character", () => {
    expect(inviteCodeError("ABCD234!")).toContain('"!"');
  });

  it("reports length only once the characters are all legal", () => {
    expect(inviteCodeError("ABCD234")).toMatch(/8 characters — that one is 7/);
    expect(inviteCodeError("ABCD23456")).toMatch(/that one is 9/);
  });

  it("prefers the confusable explanation over the length one", () => {
    // "ABCDO" is both too short and contains an excluded letter; the letter is
    // the actionable half.
    expect(inviteCodeError("ABCDO")).toMatch(/never contain/);
  });
});

describe("describeInviteRejection", () => {
  it.each([
    ["used", /already been used/],
    ["expired", /expired/],
    ["not_found", /don't recognise/],
  ])("turns the gateway reason %s into copy", (reason, pattern) => {
    expect(describeInviteRejection(reason)).toMatch(pattern);
  });

  it("has a sentence for a reason it has never seen", () => {
    // getInvitePreview returns { valid:false, reason } — a new reason string
    // must not render as "undefined".
    expect(describeInviteRejection("revoked")).toMatch(/can't be used/);
    expect(describeInviteRejection(undefined)).toMatch(/can't be used/);
  });
});
