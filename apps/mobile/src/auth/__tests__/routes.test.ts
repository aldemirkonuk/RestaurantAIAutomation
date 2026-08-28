import fs from "fs";
import path from "path";
import {
  ALWAYS_PUBLIC,
  EITHER_SIDE,
  PUBLIC_ROUTES,
  SIGNED_OUT_ONLY,
  resolveAuthRedirect,
} from "@/auth/routes";
import {
  clearPendingRoute,
  peekPendingRoute,
  setPendingRoute,
} from "@/auth/pendingRoute";

const APP_DIR = path.resolve(__dirname, "../../../app");

describe("public route policy", () => {
  it("lists each route in exactly one bucket", () => {
    const all = [...ALWAYS_PUBLIC, ...SIGNED_OUT_ONLY, ...EITHER_SIDE];
    expect(new Set(all).size).toBe(all.length);
    expect(PUBLIC_ROUTES.length).toBe(all.length);
  });

  it.each(["(tabs)", "settings", "notifications", "lock"])(
    "does not treat /%s as public",
    (route) => {
      // Checked through the redirect rather than through the internal helper:
      // the helper is not the contract, the redirect is.
      expect(resolveAuthRedirect("signedOut", [route])).not.toBeNull();
    },
  );
});

describe("resolveAuthRedirect", () => {
  it("leaves a booting session where it is", () => {
    expect(resolveAuthRedirect("booting", [])).toBeNull();
    expect(resolveAuthRedirect("booting", ["(tabs)"])).toBeNull();
  });

  /**
   * The regression this whole module exists for. Before it, `_layout.tsx`
   * bounced every signed-out session that was not literally on `login`, so a
   * new public screen mounted and was replaced on the same frame.
   */
  it.each(PUBLIC_ROUTES)("lets a signed-out session sit on /%s", (route) => {
    expect(resolveAuthRedirect("signedOut", [route])).toBeNull();
  });

  it("still sends a signed-out session away from private routes", () => {
    expect(resolveAuthRedirect("signedOut", ["(tabs)"])).toBe("/login");
    expect(resolveAuthRedirect("signedOut", ["settings"])).toBe("/login");
    expect(resolveAuthRedirect("signedOut", [])).toBe("/login");
  });

  it("holds a locked session at the gate", () => {
    expect(resolveAuthRedirect("locked", ["lock"])).toBeNull();
    expect(resolveAuthRedirect("locked", ["(tabs)"])).toBe("/lock");
    expect(resolveAuthRedirect("locked", ["notifications"])).toBe("/lock");
  });

  it("does not let a locked session walk around the gate via a public route", () => {
    // Sign-up screens are not an escape hatch for a phone holding tokens.
    expect(resolveAuthRedirect("locked", ["register"])).toBe("/lock");
    expect(resolveAuthRedirect("locked", ["login"])).toBe("/lock");
    expect(resolveAuthRedirect("locked", ["invite"])).toBe("/lock");
  });

  it("still shows the privacy notice to a locked phone", () => {
    // Legal copy that becomes unreadable behind a biometric prompt is not a
    // notice. It is also the one screen that reveals nothing.
    expect(resolveAuthRedirect("locked", ["privacy"])).toBeNull();
  });

  it("sends a signed-in session off the sign-in screens", () => {
    for (const route of SIGNED_OUT_ONLY) {
      expect(resolveAuthRedirect("signedIn", [route])).toBe("/");
    }
    expect(resolveAuthRedirect("signedIn", ["lock"])).toBe("/");
  });

  it("lets a signed-in session accept an invite and read the notice", () => {
    // invite-landing.md §1a: "Signed in: one-tap 'Add {restaurant}' accept".
    // Bouncing a signed-in user home would delete that entire feature.
    expect(resolveAuthRedirect("signedIn", ["invite"])).toBeNull();
    expect(resolveAuthRedirect("signedIn", ["verify-email"])).toBeNull();
    expect(resolveAuthRedirect("signedIn", ["no-access"])).toBeNull();
    expect(resolveAuthRedirect("signedIn", ["privacy"])).toBeNull();
  });

  it("leaves a signed-in session alone inside the app", () => {
    expect(resolveAuthRedirect("signedIn", ["(tabs)"])).toBeNull();
    expect(resolveAuthRedirect("signedIn", ["settings"])).toBeNull();
  });
});

describe("landing somewhere other than home", () => {
  it("honours the target a screen left behind", () => {
    // `?redirect=` on /login, and /verify-email after Path B registration.
    expect(resolveAuthRedirect("signedIn", ["login"], "/inventory")).toBe(
      "/inventory",
    );
    expect(resolveAuthRedirect("signedIn", ["register"], "/verify-email")).toBe(
      "/verify-email",
    );
  });

  it("honours it coming off the lock screen too", () => {
    // A phone unlocked from a notification tap should land where the tap
    // pointed, not on the dashboard.
    expect(resolveAuthRedirect("signedIn", ["lock"], "/notifications")).toBe(
      "/notifications",
    );
  });

  it("falls back to home when no target was left", () => {
    for (const empty of [null, undefined]) {
      expect(resolveAuthRedirect("signedIn", ["login"], empty)).toBe("/");
    }
  });

  it("never uses the target to override a gate", () => {
    // A pending route must not be a way past the biometric prompt or a way to
    // stay on a private screen while signed out.
    expect(resolveAuthRedirect("locked", ["(tabs)"], "/inventory")).toBe("/lock");
    expect(resolveAuthRedirect("signedOut", ["(tabs)"], "/inventory")).toBe(
      "/login",
    );
    expect(resolveAuthRedirect("booting", ["(tabs)"], "/inventory")).toBeNull();
  });
});

describe("the pending-route handoff", () => {
  afterEach(clearPendingRoute);

  it("is empty until a screen sets it", () => {
    expect(peekPendingRoute()).toBeNull();
  });

  it("can be read more than once before it is consumed", () => {
    // The layout peeks to compute the target and only clears once it acts;
    // a read-and-clear accessor would lose the target on the first render.
    setPendingRoute("/inventory");
    expect(peekPendingRoute()).toBe("/inventory");
    expect(peekPendingRoute()).toBe("/inventory");
    clearPendingRoute();
    expect(peekPendingRoute()).toBeNull();
  });

  it("is cleared rather than left to fire on a later transition", () => {
    setPendingRoute("/inventory");
    clearPendingRoute();
    expect(resolveAuthRedirect("signedIn", ["login"], peekPendingRoute())).toBe(
      "/",
    );
  });
});

/**
 * Source-level guards. A route policy that the router does not consult, or a
 * policy entry with no screen behind it, are both "an export with no importer"
 * — the exact shape of three of the four defects P3.A found by measuring.
 * Types cannot catch either one, so they are checked here.
 */
describe("the router actually uses this policy", () => {
  const layout = fs.readFileSync(path.join(APP_DIR, "_layout.tsx"), "utf8");

  it("delegates the redirect decision to resolveAuthRedirect", () => {
    expect(layout).toContain("resolveAuthRedirect");
  });

  it("has no hand-rolled segment check left in the layout", () => {
    // The pre-fix line was:
    //   if (status === "signedOut" && segments[0] !== "login")
    // Any resurrection of that shape silently re-strands every public screen.
    expect(layout).not.toMatch(/segments\[0\]\s*!==\s*"login"/);
    expect(layout).not.toMatch(/segments\[0\]\s*===\s*"login"/);
  });

  it("is the only thing that navigates on a successful sign-in", () => {
    // Both the screen and this effect fire on the same session transition. If
    // a screen also replaced the route, whichever ran second would win — and
    // the loser is `?redirect=`, silently.
    const authScreens = ["login.tsx", "register.tsx"];
    for (const name of authScreens) {
      const source = fs.readFileSync(path.join(APP_DIR, name), "utf8");
      expect({ screen: name, leavesTarget: source.includes("setPendingRoute") }).toEqual(
        { screen: name, leavesTarget: true },
      );
      // No `router.replace(...)` inside the submit handler's success path.
      const submit = source.slice(
        source.indexOf("const submit"),
        source.indexOf("finally {"),
      );
      expect({ screen: name, navigates: /router\.replace/.test(submit) }).toEqual({
        screen: name,
        navigates: false,
      });
    }
  });

  it("consumes the pending route instead of leaving it armed", () => {
    expect(layout).toContain("clearPendingRoute");
    expect(layout).toContain("peekPendingRoute");
  });

  it("registers every public route as a Stack.Screen", () => {
    // expo-router renders file routes regardless, but an unregistered screen
    // gets the default presentation and animation — and, more to the point, a
    // route nobody listed is a route nobody reviewed.
    for (const route of PUBLIC_ROUTES) {
      expect(layout).toContain(`name="${route}"`);
    }
  });
});

describe("every public route has a screen", () => {
  it.each(PUBLIC_ROUTES)("/%s resolves to a file", (route) => {
    const asFile = path.join(APP_DIR, `${route}.tsx`);
    const asDir = path.join(APP_DIR, route);
    const exists =
      fs.existsSync(asFile) ||
      (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory());
    expect(exists).toBe(true);
  });
});
