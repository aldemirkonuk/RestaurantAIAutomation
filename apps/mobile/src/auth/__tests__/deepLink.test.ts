import {
  inviteCodeFromPaste,
  parseLink,
  resetTokenFromPaste,
  safeRedirectTarget,
  verifyTokenFromPaste,
} from "@/auth/deepLink";

const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const WEB = "https://app.wineops.ai";

describe("parseLink", () => {
  it("reads an https link", () => {
    expect(parseLink(`${WEB}/reset-password?token=${TOKEN}`)).toEqual({
      path: "/reset-password",
      query: { token: TOKEN },
    });
  });

  it("reads the custom scheme in both spellings", () => {
    // expo-linking produces `wineops://path` on iOS and `wineops:///path`
    // depending on how the URL was built. Getting one right and the other
    // wrong is a bug that only shows on one platform.
    expect(parseLink(`wineops://reset-password?token=${TOKEN}`)?.path).toBe(
      "/reset-password",
    );
    expect(parseLink(`wineops:///reset-password?token=${TOKEN}`)?.path).toBe(
      "/reset-password",
    );
  });

  it("reads a bare path", () => {
    expect(parseLink("/invite/ABCD2345")?.path).toBe("/invite/ABCD2345");
    expect(parseLink("invite/ABCD2345")?.path).toBe("/invite/ABCD2345");
  });

  it("ignores a fragment", () => {
    expect(parseLink(`${WEB}/verify-email?token=abc#top`)?.query.token).toBe("abc");
  });

  it("decodes percent-encoding and plus signs", () => {
    expect(parseLink(`${WEB}/login?redirect=%2Finventory%3Ftab%3Dlow`)?.query.redirect).toBe(
      "/inventory?tab=low",
    );
    expect(parseLink(`${WEB}/x?q=a+b`)?.query.q).toBe("a b");
  });

  it("survives a malformed escape rather than throwing", () => {
    // decodeURIComponent throws on a lone %; a link someone pasted badly must
    // not crash the screen that is trying to help them.
    expect(() => parseLink(`${WEB}/verify-email?token=100%`)).not.toThrow();
    expect(parseLink(`${WEB}/verify-email?token=100%`)?.query.token).toBe("100%");
  });

  it("returns null for nothing", () => {
    expect(parseLink("")).toBeNull();
    expect(parseLink("   ")).toBeNull();
  });

  it("handles a valueless query key", () => {
    expect(parseLink(`${WEB}/register?type`)?.query).toEqual({ type: "" });
  });

  it("does not mistake the host for the path", () => {
    // The bug this guards: stripping everything up to the third slash works
    // for https and silently eats the first path segment of `wineops://`.
    expect(parseLink(`${WEB}/invite/ABCD2345`)?.path).toBe("/invite/ABCD2345");
    expect(parseLink("wineops://invite/ABCD2345")?.path).toBe("/invite/ABCD2345");
  });
});

describe("resetTokenFromPaste", () => {
  it("takes the whole emailed URL", () => {
    expect(resetTokenFromPaste(`${WEB}/reset-password?token=${TOKEN}`)).toBe(TOKEN);
  });

  it("takes a bare token", () => {
    expect(resetTokenFromPaste(TOKEN)).toBe(TOKEN);
    expect(resetTokenFromPaste(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("refuses a token that is not a token", () => {
    expect(resetTokenFromPaste("")).toBeNull();
    expect(resetTokenFromPaste("please reset my password")).toBeNull();
    expect(resetTokenFromPaste(`${WEB}/reset-password`)).toBeNull();
    expect(resetTokenFromPaste(`${WEB}/reset-password?token=nope`)).toBeNull();
  });
});

describe("verifyTokenFromPaste", () => {
  it("takes the URL or the bare token", () => {
    expect(verifyTokenFromPaste(`${WEB}/verify-email?token=abc123`)).toBe("abc123");
    expect(verifyTokenFromPaste("abc123")).toBe("abc123");
  });

  it("does not accept a sentence or a URL with no token", () => {
    // Verification tokens are not UUID-shaped, so shape cannot be checked;
    // what can be checked is that a URL we failed to read is a mistake.
    expect(verifyTokenFromPaste(`${WEB}/verify-email`)).toBeNull();
    expect(verifyTokenFromPaste("click here to verify")).toBeNull();
    expect(verifyTokenFromPaste("")).toBeNull();
  });
});

describe("inviteCodeFromPaste", () => {
  it("takes the eight characters on their own", () => {
    expect(inviteCodeFromPaste("abcd2345")).toBe("ABCD2345");
    expect(inviteCodeFromPaste("ABCD-2345")).toBe("ABCD2345");
  });

  it("takes the whole invite URL", () => {
    expect(inviteCodeFromPaste(`${WEB}/invite/abcd2345`)).toBe("ABCD2345");
  });

  it("takes a register link carrying the code", () => {
    expect(inviteCodeFromPaste(`${WEB}/register?invite=abcd2345`)).toBe("ABCD2345");
  });

  it("refuses anything that is not a well-formed code", () => {
    expect(inviteCodeFromPaste("")).toBeNull();
    expect(inviteCodeFromPaste("ABCD234")).toBeNull();
    expect(inviteCodeFromPaste(`${WEB}/invite/ABCD0000`)).toBeNull();
    expect(inviteCodeFromPaste(`${WEB}/dashboard`)).toBeNull();
  });
});

describe("safeRedirectTarget", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectTarget("/inventory")).toBe("/inventory");
    expect(safeRedirectTarget("/supply/abc?tab=items")).toBe("/supply/abc?tab=items");
  });

  it("drops an absolute URL", () => {
    // The classic open redirect. On a phone it would mean an emailed link can
    // bounce a freshly-authenticated session to an origin of the sender's
    // choosing.
    expect(safeRedirectTarget("https://evil.example")).toBeNull();
    expect(safeRedirectTarget("wineops://settings")).toBeNull();
  });

  it("drops a protocol-relative URL", () => {
    // `//evil.example` is a URL wearing a path's clothes: it starts with "/",
    // so a naive check passes it straight through.
    expect(safeRedirectTarget("//evil.example")).toBeNull();
    expect(safeRedirectTarget("//evil.example/inventory")).toBeNull();
  });

  it("drops a relative path and empties", () => {
    expect(safeRedirectTarget("inventory")).toBeNull();
    expect(safeRedirectTarget("")).toBeNull();
    expect(safeRedirectTarget(null)).toBeNull();
    expect(safeRedirectTarget(undefined)).toBeNull();
  });
});
