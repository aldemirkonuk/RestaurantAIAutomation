/**
 * The house-name shape, at the HTTP seam (fix/tenant-guard-and-cross-house-runs).
 *
 * `assert-tenant-match.spec.ts` pins the comparison with hand-built request
 * objects. This file shows the hole was real and is closed where it lived: a
 * real Express app (Nest's platform-express with Express 4's qs query parser,
 * and Nest's default JSON and urlencoded body parsers; production configures
 * the same two parsers with its own size limits), the REAL `JwtAuthGuard` —
 * only passport is
 * stood in for, setting `request.user` as `JwtStrategy.validate` would — and a
 * probe controller that echoes the house it was handed, the way
 * `@Query("restaurantId") restaurantId?: string` does in
 * analytics.controller.ts and auth.controller.ts.
 *
 * On `origin/main` c47fd8a01 the nine array/object cases below answered 200
 * (GET) or 201 (POST), echoing back the value they sent; the public probe
 * shows why (Express 4 delivers `?restaurantId[]=B` as `["B"]`).
 */
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { Public } from "../../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../../auth/services/token-blacklist.service";

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";

@Controller("probe")
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get()
  read(
    @Query("restaurantId") a?: unknown,
    @Query("restaurant_id") b?: unknown,
  ) {
    return { named: a ?? b ?? null };
  }

  @Post()
  write(@Body() body: Record<string, unknown>) {
    return { named: body?.restaurantId ?? body?.restaurant_id ?? null };
  }

  /** No user, no tenant check: shows the shape the parser really delivers. */
  @Public()
  @Get("shape")
  shape(@Query("restaurantId") a?: unknown) {
    return { named: a ?? null };
  }
}

let app: INestApplication;
let base: string;

async function call(
  method: "GET" | "POST",
  path: string,
  body?: { json?: unknown; form?: string },
) {
  const headers: Record<string, string> = { authorization: "Bearer t" };
  let payload: string | undefined;
  if (body?.json !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body?.form !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = body.form;
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  // Stand in for passport only. JwtAuthGuard.canActivate calls
  // super.canActivate (the AuthGuard("jwt") mixin); everything after it — the
  // tenant comparison, the email and house checks — is the real code.
  const passport = Object.getPrototypeOf(JwtAuthGuard.prototype);
  jest.spyOn(passport, "canActivate").mockImplementation(async (ctx: any) => {
    ctx.switchToHttp().getRequest().user = {
      userId: "member-of-a",
      restaurantId: HOUSE_A,
      role: "owner",
      emailVerified: true,
    };
    return true;
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  // main.ts's options, so the pipeline in front of a handler is production's.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  jest.restoreAllMocks();
});

describe("the parser really hands the guard non-strings", () => {
  it("delivers ?restaurantId[]=B as an array (public probe, no tenant check)", async () => {
    const res = await call("GET", `/probe/shape?restaurantId[]=${HOUSE_B}`);
    expect(res.status).toBe(200);
    expect(res.body.named).toEqual([HOUSE_B]);
  });

  it("delivers a repeated key as an array (public probe)", async () => {
    const res = await call(
      "GET",
      `/probe/shape?restaurantId=${HOUSE_A}&restaurantId=${HOUSE_B}`,
    );
    expect(res.body.named).toEqual([HOUSE_A, HOUSE_B]);
  });
});

describe("a member of house A cannot name house B in a shape the guard skipped", () => {
  it.each([
    ["?restaurantId[]=B", `?restaurantId[]=${HOUSE_B}`],
    ["?restaurant_id[]=B", `?restaurant_id[]=${HOUSE_B}`],
    [
      "?restaurantId=A&restaurantId=B",
      `?restaurantId=${HOUSE_A}&restaurantId=${HOUSE_B}`,
    ],
    [
      "?restaurantId[]=A (own house, still not one string)",
      `?restaurantId[]=${HOUSE_A}`,
    ],
    ["?restaurant_id[x]=B", `?restaurant_id[x]=${HOUSE_B}`],
  ])("GET %s answers 403", async (_label, qs) => {
    const res = await call("GET", `/probe${qs}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Tenant isolation violation");
  });

  it.each([
    ["a JSON array", { json: { restaurantId: [HOUSE_B] } }],
    ["a JSON object", { json: { restaurantId: { id: HOUSE_B } } }],
    [
      "a JSON array under restaurant_id",
      { json: { restaurant_id: [HOUSE_B] } },
    ],
    ["a urlencoded array", { form: `restaurantId[]=${HOUSE_B}` }],
  ])("POST with %s answers 403", async (_label, body) => {
    const res = await call("POST", "/probe", body);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Tenant isolation violation");
  });
});

describe("single strings behave as before", () => {
  it("passes the caller's own house in the query and the body", async () => {
    expect(await call("GET", `/probe?restaurantId=${HOUSE_A}`)).toEqual({
      status: 200,
      body: { named: HOUSE_A },
    });
    expect(
      await call("POST", "/probe", { json: { restaurantId: HOUSE_A } }),
    ).toEqual({ status: 201, body: { named: HOUSE_A } });
  });

  it("refuses another house named as one string", async () => {
    expect((await call("GET", `/probe?restaurantId=${HOUSE_B}`)).status).toBe(
      403,
    );
  });

  it("passes a request that names no house, or names it null", async () => {
    expect((await call("GET", "/probe")).status).toBe(200);
    expect(
      (await call("POST", "/probe", { json: { restaurantId: null } })).status,
    ).toBe(201);
  });
});
