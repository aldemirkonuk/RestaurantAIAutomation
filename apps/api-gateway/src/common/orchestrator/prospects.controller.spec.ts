/**
 * /prospects at the HTTP seam: who may turn a prospect into a vendor.
 *
 * POST /prospects/:id/promote inserts a `providers` row, i.e. it creates a
 * vendor for the house. The house draws that line at owner or manager (ADR 0124
 * treats a vendor relationship as owner/manager; ADR 0146 set owner-or-manager
 * for Ask AI's write). Reading, dismissing and restoring a prospect stay open
 * to any member, and this file pins that the gate did not widen to them.
 *
 * The app below runs the real RolesGuard. Only JwtAuthGuard is replaced, by a
 * stub that sets the request.user shape JwtStrategy.validate returns. The
 * server listens on 127.0.0.1 inside this process; nothing leaves it.
 */
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { ProspectsController } from "./prospects.controller";
import { ProspectsService } from "./prospects.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PROSPECT = "33333333-3333-4333-8333-333333333333";

const prospects = {
  list: jest.fn(),
  listAcross: jest.fn(),
  accessibleRestaurantIds: jest.fn(),
  listUnattributed: jest.fn(),
  attachmentsFor: jest.fn(),
  promote: jest.fn(),
  dismiss: jest.fn(),
  restore: jest.fn(),
  fileHeldLetter: jest.fn(),
};

let app: INestApplication;
let base: string;

async function call(
  method: "GET" | "POST",
  path: string,
  role: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-role": role },
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProspectsController],
    providers: [
      { provide: ProspectsService, useValue: prospects },
      { provide: ConfigService, useValue: { get: () => "" } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: "user-1",
          restaurantId: HOUSE,
          role: req.headers["x-test-role"],
        };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  prospects.list.mockResolvedValue([]);
  prospects.promote.mockResolvedValue({
    promoted: true,
    providerId: "p-1",
    reused: false,
  });
  prospects.dismiss.mockResolvedValue({ dismissed: true });
  prospects.restore.mockResolvedValue({ restored: true });
  prospects.fileHeldLetter.mockResolvedValue({
    filed: true,
    conversationId: "c-1",
    threadKey: "gm:t-1",
    providerId: "p-1",
    providerName: "Quiet Dairy",
    alreadyStored: false,
  });
});

describe("who may add a prospect as a vendor", () => {
  it("refuses a staff member POST /prospects/:id/promote with 403 and creates no vendor", async () => {
    const res = await call("POST", `/prospects/${PROSPECT}/promote`, "staff");
    expect(res.status).toBe(403);
    expect(prospects.promote).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])(
    "admits %s, promoting inside the token's house",
    async (role) => {
      const res = await call("POST", `/prospects/${PROSPECT}/promote`, role);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        promoted: true,
        providerId: "p-1",
        reused: false,
      });
      expect(prospects.promote).toHaveBeenCalledWith(HOUSE, PROSPECT);
    },
  );

  it("runs RolesGuard after JwtAuthGuard on promote, asking for owner or manager", () => {
    const handler = ProspectsController.prototype.promote;
    const chain: unknown[] = [
      ...(Reflect.getMetadata("__guards__", ProspectsController) ?? []),
      ...(Reflect.getMetadata("__guards__", handler) ?? []),
    ];
    expect(chain[0]).toBe(JwtAuthGuard);
    expect(chain.indexOf(RolesGuard)).toBeGreaterThan(0);
    expect(
      Reflect.getMetadata(ROLES_KEY, handler) ??
        Reflect.getMetadata(ROLES_KEY, ProspectsController),
    ).toEqual(["owner", "manager"]);
  });

  it("surfaces a promote that could not be checked as 503, not a generic 500", async () => {
    prospects.promote.mockRejectedValue(
      new ServiceUnavailableException("providers read failed"),
    );
    const res = await call("POST", `/prospects/${PROSPECT}/promote`, "owner");
    expect(res.status).toBe(503);
  });
});

describe("the gate did not widen past promote", () => {
  it("still lets a staff member read, dismiss and restore prospects", async () => {
    expect((await call("GET", "/prospects", "staff")).status).toBe(200);
    expect(
      (await call("POST", `/prospects/${PROSPECT}/dismiss`, "staff")).status,
    ).toBe(201);
    expect(
      (await call("POST", `/prospects/${PROSPECT}/restore`, "staff")).status,
    ).toBe(201);
    expect(prospects.list).toHaveBeenCalledWith(HOUSE);
    expect(prospects.dismiss).toHaveBeenCalledWith(HOUSE, PROSPECT);
    expect(prospects.restore).toHaveBeenCalledWith(HOUSE, PROSPECT);
  });
});

describe("who may file a held letter under a vendor (r35 mail, gap 9)", () => {
  const path = `/prospects/${PROSPECT}/file-under-vendor`;

  it("refuses a staff member with 403 and files nothing", async () => {
    const res = await call("POST", path, "staff");
    expect(res.status).toBe(403);
    expect(prospects.fileHeldLetter).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])(
    "admits %s, filing inside the token's house and naming who vouched",
    async (role) => {
      const res = await call("POST", path, role);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ filed: true, providerName: "Quiet Dairy", threadKey: "gm:t-1" });
      expect(prospects.fileHeldLetter).toHaveBeenCalledWith(HOUSE, PROSPECT, "user-1");
    },
  );

  it("keeps a refusal's status and words", async () => {
    prospects.fileHeldLetter.mockRejectedValue(
      new ConflictException("That letter is already filed under a vendor."),
    );
    const res = await call("POST", path, "owner");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("That letter is already filed under a vendor.");
  });

  it("answers an unexpected throw as 503 that says the letter is still held", async () => {
    prospects.fileHeldLetter.mockRejectedValue(new Error("socket hang up"));
    const res = await call("POST", path, "manager");
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("The letter could not be filed just now; it is still held.");
  });
});
