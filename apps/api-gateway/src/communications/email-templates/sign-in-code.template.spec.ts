import { signInCodeEmailTemplate } from "./sign-in-code.template";

describe("the emailed one-time code", () => {
  it("a sign-in code says it is for signing in", () => {
    const html = signInCodeEmailTemplate({
      name: "Mara Lind",
      code: "123456",
      purpose: "sign_in",
    });
    expect(html).toContain("Hi Mara, Use this code to sign in to Mudavym.");
    expect(html).toContain("123456");
  });

  // F-1356: the same code now guards deleting the account, a first password
  // and unlinking a sign-in (F-1347), not only adding a passkey.
  it("a confirm-it-is-you code names every change it guards, not only a passkey", () => {
    const html = signInCodeEmailTemplate({
      name: null,
      code: "654321",
      purpose: "step_up",
    });
    expect(html).toContain(
      "Use this code to confirm it is you before an important change to your account: adding a passkey, setting a password, unlinking a sign-in or deleting the account.",
    );
    expect(html).not.toContain("before a passkey is added");
    expect(html).toContain(
      "Someone signed in to your account is trying to change how it is protected.",
    );
    expect(html).not.toContain("is trying to add a passkey");
    expect(html).toContain("Your Mudavym confirmation code");
  });
});
