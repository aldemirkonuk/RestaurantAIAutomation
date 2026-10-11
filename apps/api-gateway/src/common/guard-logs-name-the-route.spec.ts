import { Logger, NotFoundException } from "@nestjs/common";
import { TenantGuard } from "./tenant/tenant.guard";
import { NonProductionGuard } from "../communications/guards/non-production.guard";
import { logRoute } from "./log-mask";

/**
 * F-1261: a guard's log line names the route PATTERN, never the URL.
 *
 * TenantGuard's no-user warning fires on every authenticated request (it is an
 * APP_GUARD and runs before JwtAuthGuard), so whatever it prints lands in the
 * host's log store once per call. `request.url` put live invite codes and push
 * tokens there -- undoing F-514, which kept the invite code out of the
 * controller's own line.
 */

const INVITE_CODE = "INV-9f3c2a7d1e";
const PUSH_TOKEN = "ExponentPushToken[abcDEF123]";
const QUERY_SECRET = "s3cr3t-query-value";

const requestFor = (url: string, pattern: string) => ({
  method: "POST",
  url,
  originalUrl: url,
  route: { path: pattern },
  params: {},
  query: {},
  body: {},
});

const ctx = (request: any) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "class",
  }) as any;

const cases = [
  requestFor(
    `/api/v1/auth/invite/${INVITE_CODE}/accept?ref=${QUERY_SECRET}`,
    "/api/v1/auth/invite/:code/accept",
  ),
  requestFor(
    `/api/v1/mobile/devices/${encodeURIComponent(PUSH_TOKEN)}`,
    "/api/v1/mobile/devices/:token",
  ),
];

const SECRETS = [
  INVITE_CODE,
  PUSH_TOKEN,
  encodeURIComponent(PUSH_TOKEN),
  QUERY_SECRET,
];

describe("F-1261: guard log lines carry no path-param or query value", () => {
  let lines: string[];
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    lines = [];
    spies = (["log", "warn", "error", "debug", "verbose"] as const).map((m) =>
      jest
        .spyOn(Logger.prototype, m)
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        }),
    );
  });

  afterEach(() => spies.forEach((s) => s.mockRestore()));

  const expectNoSecret = () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of SECRETS) expect(line).not.toContain(secret);
    }
  };

  it.each(cases)(
    "TenantGuard names $route.path, not the URL that was called",
    (request) => {
      const guard = new TenantGuard({
        getAllAndOverride: () => undefined,
      } as any);
      expect(guard.canActivate(ctx(request))).toBe(true);
      expectNoSecret();
      expect(lines.join("\n")).toContain(request.route.path);
    },
  );

  it.each(cases)(
    "NonProductionGuard names $route.path, not the URL that was called",
    (request) => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(() =>
          new NonProductionGuard().canActivate(ctx(request)),
        ).toThrow(NotFoundException);
      } finally {
        process.env.NODE_ENV = prev;
      }
      expectNoSecret();
      expect(lines.join("\n")).toContain(request.route.path);
    },
  );

  it("with no matched route, says so rather than falling back to the URL", () => {
    expect(logRoute({ route: undefined })).toBe("(no matched route)");
    expect(logRoute({ route: { path: "" } })).toBe("(no matched route)");
  });
});
