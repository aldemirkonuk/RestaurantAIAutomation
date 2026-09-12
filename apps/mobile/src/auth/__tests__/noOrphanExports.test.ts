import fs from "fs";
import path from "path";

/**
 * The repo's signature defect, made mechanical.
 *
 * `connectSocket` had no caller anywhere in the app. So did
 * `attachPushListeners`, and so did `routeForNotification`. Three exports,
 * fully written, shipped as dependencies, imported by nobody — and all three
 * typechecked perfectly for as long as they existed, because TypeScript has no
 * opinion about whether anything uses a function.
 *
 * This session nearly added a fourth. `routeForAuthLink` was written, tested
 * fifteen ways, and wired into a `Linking` listener in `app/_layout.tsx` — a
 * listener that turned out to duplicate what expo-router already does
 * (`expo-router/build/getLinkingConfig.js:52-68`). Removing the duplicate left
 * the function with no caller at all, which is how it came out of the tree.
 *
 * The rule: every **runtime** export from the auth modules is either called
 * from outside its own module, or is named below with a reason. Types are not
 * checked — a dead type cannot be an export-with-no-importer in the sense that
 * matters, and TypeScript's own unused checks cover them.
 *
 * The scope is deliberately narrow: the modules this milestone added, not the
 * whole app. A repo-wide version needs a real dead-code tool and an allowlist
 * nobody will maintain, and a guard nobody can keep green gets deleted.
 * Widening it is the right follow-up, not a reason to skip the narrow one.
 */

const MOBILE = path.resolve(__dirname, "../../..");

const WATCHED = [
  "src/auth/routes.ts",
  "src/auth/pendingRoute.ts",
  "src/auth/inviteCode.ts",
  "src/auth/credentials.ts",
  "src/auth/deepLink.ts",
  "src/auth/outcomes.ts",
  "src/api/authEndpoints.ts",
  "src/api/auth.ts",
];

/**
 * Constants that exist to be **pinned to an external source of truth** by a
 * guard. The app does not read them; `authContract.test.ts` and
 * `routes.test.ts` do, comparing them against the gateway source and against
 * `app/`. Calling them dead would be exactly backwards — checking them is
 * their whole job.
 */
const PINNED_BY_A_GUARD: Record<string, string> = {
  AUTH_ENDPOINTS: "authContract: every path exists on the gateway",
  INVITE_CHARSET: "authContract: matches AuthService#generateInvite's CHARSET",
  INVITE_CODE_LENGTH: "authContract: matches @Length(8,8) on JoinViaInviteDto",
  MIN_PASSWORD_LENGTH: "authContract: matches @MinLength on every auth DTO",
  PUBLIC_ROUTES: "routes: every public route has a screen and is registered",
  ALWAYS_PUBLIC: "routes: bucket membership is the policy under test",
  SIGNED_OUT_ONLY: "routes: bucket membership is the policy under test",
  EITHER_SIDE: "routes: bucket membership is the policy under test",
  LOCK_ROUTE: "routes: the gate segment the policy is written against",
};

/**
 * Helpers that are internal to their module but exported so their own
 * edge cases can be tested directly. Each is called from inside its module —
 * these are not dead, they are just not part of the module's outward surface.
 * A short list; if it grows, the modules need splitting instead.
 */
const INTERNAL_BUT_TESTED: Record<string, string> = {
  parseLink:
    "deepLink: the scheme and malformed-escape cases are not reachable through the paste helpers",
  EXCLUDED_CONFUSABLES:
    "inviteCode: the I/O/0/1 error copy is asserted character by character",
  describeAuthFailure:
    "outcomes: the status-to-copy table is worth testing without constructing throwables",
};

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(MOBILE, "app"));
  walk(path.join(MOBILE, "src"));
  return out;
}

/** Top-level runtime exports. Types and interfaces are out of scope. */
function runtimeExports(source: string): string[] {
  const names = new Set<string>();
  const re =
    /^export\s+(?:async\s+)?(?:function|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]);
  return [...names];
}

describe("no orphan exports in the auth modules", () => {
  const files = sourceFiles();

  it("finds the app source (a guard that reads nothing passes everything)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(WATCHED)("%s", (rel) => {
    const abs = path.join(MOBILE, rel);
    expect(fs.existsSync(abs)).toBe(true);
    const names = runtimeExports(fs.readFileSync(abs, "utf8"));
    expect(names.length).toBeGreaterThan(0);

    const others = files
      .filter((f) => f !== abs)
      .map((f) => fs.readFileSync(f, "utf8"));

    const orphans = names.filter((name) => {
      if (PINNED_BY_A_GUARD[name] || INTERNAL_BUT_TESTED[name]) return false;
      const used = new RegExp(`\\b${name}\\b`);
      return !others.some((source) => used.test(source));
    });

    expect({ module: rel, orphans }).toEqual({ module: rel, orphans: [] });
  });

  it("every allowlisted name still exists somewhere it is allowed", () => {
    // An allowlist that outlives the thing it excuses is how a guard rots into
    // a rubber stamp.
    const watched = WATCHED.map((rel) =>
      fs.readFileSync(path.join(MOBILE, rel), "utf8"),
    );
    const stale = [
      ...Object.keys(PINNED_BY_A_GUARD),
      ...Object.keys(INTERNAL_BUT_TESTED),
    ].filter((name) => {
      const declared = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|enum)\\s+${name}\\b`, "m");
      return !watched.some((source) => declared.test(source));
    });
    expect(stale).toEqual([]);
  });

  it("every allowlisted name carries a reason", () => {
    for (const [name, reason] of [
      ...Object.entries(PINNED_BY_A_GUARD),
      ...Object.entries(INTERNAL_BUT_TESTED),
    ]) {
      expect({ name, hasReason: reason.trim().length > 10 }).toEqual({
        name,
        hasReason: true,
      });
    }
  });
});
