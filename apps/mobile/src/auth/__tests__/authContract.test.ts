import fs from "fs";
import path from "path";
import { AUTH_ENDPOINTS } from "@/api/authEndpoints";
import { INVITE_CHARSET, INVITE_CODE_LENGTH } from "@/auth/inviteCode";
import { MIN_PASSWORD_LENGTH, isValidResetToken } from "@/auth/credentials";

/**
 * The gateway is the source of truth. This reads it.
 *
 * P3.A's measurement pass found `connectSocket` subscribing to `order:updated`
 * and `order_change` — two event names the gateway has never emitted. Both
 * typechecked forever, because a wrong string is still a string. The fix was a
 * test that parses the server source instead of restating it.
 *
 * The auth screens are the same hazard with higher stakes: a wrong path here
 * does not mute a notification, it makes account recovery 404 for someone
 * locked out. So every route, every validation constant and every code shape
 * the phone assumes is pinned to the file that defines it.
 */

const GATEWAY_SRC = path.resolve(__dirname, "../../../../api-gateway/src");
const AUTH_CONTROLLER = path.join(GATEWAY_SRC, "auth/auth.controller.ts");
const AUTH_SERVICE = path.join(GATEWAY_SRC, "auth/auth.service.ts");
const JOIN_DTO = path.join(GATEWAY_SRC, "auth/dto/join-via-invite.dto.ts");
const RESET_DTO = path.join(GATEWAY_SRC, "auth/dto/password-reset.dto.ts");
const RESTAURANT_DTO = path.join(
  GATEWAY_SRC,
  "auth/dto/register-restaurant.dto.ts",
);

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** `@Post("join")` / `@Get("invite/:code")` → `POST join` / `GET invite/:code`. */
function declaredRoutes(source: string): Set<string> {
  const routes = new Set<string>();
  const re = /@(Get|Post|Patch|Put|Delete)\(\s*"([^"]*)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return routes;
}

describe("gateway sources are where this test thinks they are", () => {
  it.each([
    ["auth controller", AUTH_CONTROLLER],
    ["auth service", AUTH_SERVICE],
    ["join DTO", JOIN_DTO],
    ["reset DTO", RESET_DTO],
    ["register-restaurant DTO", RESTAURANT_DTO],
  ])("%s exists (a guard that cannot read is not a guard)", (_label, file) => {
    expect(fs.existsSync(file)).toBe(true);
  });

  it("parses a plausible number of routes out of the controller", () => {
    expect(declaredRoutes(read(AUTH_CONTROLLER)).size).toBeGreaterThan(15);
  });
});

describe("every /auth endpoint the phone calls exists on the gateway", () => {
  const routes = declaredRoutes(read(AUTH_CONTROLLER));

  it.each(Object.entries(AUTH_ENDPOINTS))(
    "%s",
    (_name, endpoint) => {
      const key = `${endpoint.method} ${endpoint.path}`;
      // Named so a failure says which screen breaks, not just which string.
      expect({ endpoint: key, usedBy: endpoint.usedBy }).toEqual({
        endpoint: routes.has(key) ? key : `MISSING: ${key}`,
        usedBy: endpoint.usedBy,
      });
    },
  );
});

describe("the table describes the calls the app really makes", () => {
  // A table nobody calls is decoration, and decoration cannot catch a rename.
  // This reads the wrapper module and checks each declared path is actually
  // requested — with `:param` segments relaxed to a template hole.
  const wrappers = read(path.resolve(__dirname, "../../api/auth.ts"));

  it.each(Object.entries(AUTH_ENDPOINTS))("%s is called", (_name, endpoint) => {
    // `invite/:code/accept` → /auth/invite/${…}/accept, so the fixed
    // fragments must appear in order with a template hole between them.
    const pattern = new RegExp(
      "/auth/" +
        endpoint.path
          .split(/:[A-Za-z]+/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\$\\{[^}]*\\}"),
    );
    expect({ path: endpoint.path, called: pattern.test(wrappers) }).toEqual({
      path: endpoint.path,
      called: true,
    });
  });

  it("declares every /auth path the wrappers request", () => {
    const requested = [...wrappers.matchAll(/"\/auth\/([^"`]+)"/g)]
      .map((m) => m[1])
      .concat(
        [...wrappers.matchAll(/`\/auth\/([^`]+)`/g)].map((m) =>
          m[1].replace(/\$\{[^}]*\}/g, ":code"),
        ),
      )
      // check-email carries its argument in the query string.
      .map((p) => p.split("?")[0]);

    const declared = new Set(
      Object.values(AUTH_ENDPOINTS).map((e) => e.path.replace(/:[A-Za-z]+/g, ":code")),
    );
    const undeclared = requested.filter((p) => !declared.has(p));
    expect(undeclared).toEqual([]);
  });
});

describe("the endpoints are reachable without a session", () => {
  const source = read(AUTH_CONTROLLER);

  /** The decorator block immediately above a given `@Post("x")`. */
  function decoratorsFor(method: string, route: string): string {
    const at = source.indexOf(`@${method}("${route}")`);
    expect(at).toBeGreaterThan(-1);
    const end = source.indexOf("async ", at);
    return source.slice(at, end);
  }

  it.each([
    ["Post", "join"],
    ["Post", "register/restaurant"],
    ["Post", "request-password-reset"],
    ["Post", "reset-password"],
    ["Post", "sign-in-methods"],
    ["Get", "invite/:code"],
    ["Get", "check-email"],
  ])(
    "%s %s carries no JwtAuthGuard — it is used before sign-in",
    (method, route) => {
      // A guard added to any of these strands exactly the users who cannot
      // sign in, which is the entire audience for these screens.
      expect(decoratorsFor(method, route)).not.toContain("JwtAuthGuard");
    },
  );

  it("resend-verification is guarded but explicitly allows unverified", () => {
    // It requires a token (you must be someone) but must not require being
    // verified (that is the thing you are trying to become).
    const decorators = decoratorsFor("Post", "resend-verification");
    expect(decorators).toContain("JwtAuthGuard");
    expect(decorators).toContain("AllowUnverified");
  });
});

describe("validation constants match the server's", () => {
  it("invite codes are still 8 characters", () => {
    const dto = read(JOIN_DTO);
    const m = /@Length\((\d+),\s*(\d+)\)/.exec(dto);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(INVITE_CODE_LENGTH);
    expect(Number(m![2])).toBe(INVITE_CODE_LENGTH);
  });

  it("mirrors the exact charset the server mints codes from", () => {
    const service = read(AUTH_SERVICE);
    const m = /const CHARSET = "([^"]+)";/.exec(service);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(INVITE_CHARSET);
  });

  it("keeps the password minimum in step with every auth DTO", () => {
    // If the server tightens to 12 and the client keeps saying 8, the client
    // is promising a submit it knows will be rejected.
    for (const file of [JOIN_DTO, RESET_DTO, RESTAURANT_DTO]) {
      const mins = [...read(file).matchAll(/@MinLength\((\d+)/g)].map((x) =>
        Number(x[1]),
      );
      expect(mins.length).toBeGreaterThan(0);
      for (const min of mins) expect(min).toBe(MIN_PASSWORD_LENGTH);
    }
  });

  it("reset tokens are still UUIDs", () => {
    // `resetTokenError` refuses a mangled paste before spending the token,
    // which is single-use — a wasted attempt costs a whole new email.
    const dto = read(RESET_DTO);
    expect(dto).toMatch(/token:\s*string/);
    expect(dto).toContain("@IsUUID(");
    expect(isValidResetToken("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("register/restaurant still requires the fields the form collects", () => {
    const dto = read(RESTAURANT_DTO);
    for (const field of [
      "name",
      "email",
      "password",
      "restaurantName",
      "address",
      "city",
      "country",
    ]) {
      expect(dto).toMatch(new RegExp(`${field}[?]?:\\s*string`));
    }
    // These are the ones the mobile form leaves out; if any becomes required
    // the form starts failing on submit and this says so first.
    for (const optional of ["stateProvince", "postalCode", "phone"]) {
      const line = dto
        .split("\n")
        .find((l) => l.includes(`${optional}?:`) || l.includes(`${optional}:`));
      expect(line).toBeDefined();
      expect(line).toContain("@IsOptional()");
    }
  });
});

describe("the emailed links still point where the parser expects", () => {
  const service = read(AUTH_SERVICE);

  it.each([
    ["reset-password", "/reset-password"],
    ["verify-email", "/verify-email"],
    ["invite", "/invite/"],
  ])(
    "%s links are minted against the frontend origin",
    (_label, pathFragment) => {
      // The parser matches on path, never host, precisely because these are
      // built from FRONTEND_URL — which the phone does not know. If the paths
      // move, the paste box stops recognising the link people paste.
      expect(service).toContain(pathFragment);
    },
  );

  it("the links are web URLs, which is why mobile has a paste box", () => {
    // Recorded as a blocker, not a bug: intercepting these needs Universal
    // Links, whose server half (apple-app-site-association) lives outside
    // apps/mobile. If that ever changes, this test is where to start.
    expect(service).toMatch(/FRONTEND_URL|frontendUrl|frontend_url/i);
  });
});
