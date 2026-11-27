import { buildSetupReminderLetter } from "./setup-reminder.template";

const letter = (over: Partial<Parameters<typeof buildSetupReminderLetter>[0]> = {}) =>
  buildSetupReminderLetter({
    houseName: "Meyhane",
    ownerName: "Selin Kaya",
    getStartedUrl: "https://app.example/get-started",
    unsubscribeUrl: "https://api.example/api/v1/house/setup-reminder/unsubscribe/abc",
    ...over,
  });

describe("the setup reminder letter", () => {
  it("names the first missing step and links straight to /get-started", () => {
    const l = letter();
    expect(l.html).toContain("Your menu is not read yet");
    expect(l.html).toContain('href="https://app.example/get-started"');
    expect(l.text).toContain("Read the menu: https://app.example/get-started");
    expect(l.subject).toBe("Meyhane is waiting at its menu");
  });

  it("escapes the house name everywhere it is written", () => {
    const l = letter({ houseName: `<script>alert("x")</script> & 'Co'`, ownerName: "<b>Ali</b>" });
    expect(l.html).not.toContain("<script>");
    expect(l.html).not.toContain("<b>Ali</b>");
    expect(l.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Co&#39;");
  });

  it("carries its unsubscribe link in both parts, and a header-safe subject", () => {
    const l = letter({ houseName: "Kaleiçi\r\nBcc: x@y.z" });
    expect(l.html).toContain('href="https://api.example/api/v1/house/setup-reminder/unsubscribe/abc"');
    expect(l.text).toContain("https://api.example/api/v1/house/setup-reminder/unsubscribe/abc");
    expect(l.subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(l.subject).not.toMatch(/[\r\n]/);
  });
});
