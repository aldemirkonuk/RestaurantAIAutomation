/**
 * F-624 — the mobile Settings screen offers only switches something reads.
 *
 * The screen is a React Native component and this runner does not render
 * those (see jest.config.js), so the guard reads the screen's source, the
 * way `auth/__tests__/routes.test.ts` reads the app directory.
 */
import fs from "fs";
import path from "path";

const SCREEN = fs.readFileSync(path.resolve(__dirname, "../../../app/settings.tsx"), "utf8");

describe("mobile Settings — Services & permissions", () => {
  it.each(["email", "web", "privacy_analytics", "privacy_sharing"])(
    "draws no switch for %s, which nothing reads",
    (key) => {
      expect(SCREEN).not.toContain(`["${key}"`);
      expect(SCREEN).not.toMatch(new RegExp(`setServicePermission\\(\\s*"${key}"`));
    },
  );

  it("says why those four are not switches, in the web consent panel's words", () => {
    expect(SCREEN).toContain("Nothing in Mudavym reads any of them");
  });

  it("keeps the push switch, which registers this phone for alerts", () => {
    expect(SCREEN).toMatch(/registerPush\(\)/);
  });

  it("does not name a product called Wine Agent", () => {
    expect(SCREEN).not.toMatch(/Wine Agent/);
  });
});
