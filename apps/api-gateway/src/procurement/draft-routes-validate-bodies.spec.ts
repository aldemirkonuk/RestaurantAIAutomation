/**
 * The three routes that send a drafted reply validate their bodies — proved at
 * the HTTP seam, through the real controller and a global ValidationPipe with
 * the options `main.ts` installs (`whitelist`, `forbidNonWhitelisted`,
 * `transform`).
 *
 * The fault this pins (measured 2026-09-17, lane E audit D1): the seal mint
 * typed its body inline and the sealed send typed its body as
 * `ApproveDraftDto & { to?: string | null }`. TypeScript records both as
 * `Object` in `design:paramtypes`, and Nest's ValidationPipe skips `Object`, so
 * both routes accepted a copy address carrying CRLF plus a `Bcc:` line, and a
 * 6,000-character letter (the limit is 5,000). `gmail.service.ts` joins copies
 * straight into the raw MIME `Cc:` header, so that is a header injection on the
 * Gmail path. The seal does not stop it: the same caller mints over the same
 * copies.
 *
 * Only JwtAuthGuard is replaced, by a stub that sets the `request.user` shape
 * `JwtStrategy.validate` returns. The service is a recorder: what is asserted
 * is whether the controller reached it, and with what. The server listens on
 * 127.0.0.1 inside this process; nothing leaves it.
 */
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

const service = {
  sendDraftedReply: jest.fn(),
  issueDraftSendSeal: jest.fn(),
  requestDraftSend: jest.fn(),
  manualReply: jest.fn(),
  issueManualReplySeal: jest.fn(),
  confirmDeal: jest.fn(),
  issueConfirmDealSeal: jest.fn(),
};

let app: INestApplication;
let base: string;

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/procurement/orders/${ORDER}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
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
    controllers: [ProcurementController],
    providers: [{ provide: ProcurementService, useValue: service }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = {
          userId: "manager-1",
          restaurantId: HOUSE,
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
  // No global prefix here: `main.ts` adds `api/v1`, which is not under test.
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  service.sendDraftedReply.mockResolvedValue({
    conversationId: "conv-1",
    sentAt: "2026-09-17T10:00:00.000Z",
  });
  service.issueDraftSendSeal.mockResolvedValue({
    challenge: "tok",
    expiresAt: "2026-09-17T10:05:00.000Z",
    act: "send_draft",
  });
});

const INJECTED_CC = "not-an-email\r\nBcc: someone@evil.example";
const TOO_LONG = "x".repeat(5001);

describe("the root cause: each draft route's @Body is a class the pipe can see", () => {
  it.each([
    "approveDraft",
    "sendDraftedReply",
    "issueDraftSendSeal",
    // The doors sealed on 2026-09-21 (ADR 0175 D9) and the staff request. The
    // manual reply and the deal were inline types, recorded as Object and
    // never validated, until they took a seal.
    "requestDraftSend",
    "manualReply",
    "issueManualReplySeal",
    "confirmDeal",
    "issueConfirmDealSeal",
  ])(
    "%s records its body type as a class, never Object",
    (handler) => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        ProcurementController,
        handler,
      ) as Record<string, { index: number }>;
      const bodyKey = Object.keys(args).find((k) =>
        k.startsWith(`${RouteParamtypes.BODY}:`),
      );
      expect(bodyKey).toBeDefined();
      const types = Reflect.getMetadata(
        "design:paramtypes",
        ProcurementController.prototype,
        handler,
      ) as unknown[];
      const bodyType = types[args[bodyKey as string].index];
      expect(bodyType).not.toBe(Object);
      expect(typeof bodyType).toBe("function");
    },
  );
});

describe("POST orders/:id/draft-seal-challenge", () => {
  const letter = {
    content: "Dear Hasan, we can take six cases.",
    to: "hasan@kavaklidere.example",
    ccEmails: ["ops@house.example"],
  };

  it("refuses a copy address carrying a header, and mints nothing", async () => {
    const res = await post("draft-seal-challenge", {
      ...letter,
      ccEmails: [INJECTED_CC],
    });
    expect(res.status).toBe(400);
    expect(service.issueDraftSendSeal).not.toHaveBeenCalled();
  });

  it("refuses a recipient that is not an address, and mints nothing", async () => {
    const res = await post("draft-seal-challenge", {
      ...letter,
      to: "hasan@kavaklidere.example\r\nBcc: someone@evil.example",
    });
    expect(res.status).toBe(400);
    expect(service.issueDraftSendSeal).not.toHaveBeenCalled();
  });

  it("refuses a letter over 5,000 characters, and mints nothing", async () => {
    const res = await post("draft-seal-challenge", {
      ...letter,
      content: TOO_LONG,
    });
    expect(res.status).toBe(400);
    expect(service.issueDraftSendSeal).not.toHaveBeenCalled();
  });

  it("refuses a field it does not know, and mints nothing", async () => {
    const res = await post("draft-seal-challenge", { ...letter, bcc: ["x@y.example"] });
    expect(res.status).toBe(400);
    expect(service.issueDraftSendSeal).not.toHaveBeenCalled();
  });

  it("mints over a well-formed letter, with the house and person from the token", async () => {
    const res = await post("draft-seal-challenge", letter);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      challenge: "tok",
      expiresAt: "2026-09-17T10:05:00.000Z",
      act: "send_draft",
    });
    expect(service.issueDraftSendSeal).toHaveBeenCalledWith(
      HOUSE,
      ORDER,
      "manager-1",
      { body: letter.content, to: letter.to, cc: letter.ccEmails },
    );
  });

  it("passes an absent recipient on as null, for the service to refuse in its own words", async () => {
    const res = await post("draft-seal-challenge", { content: letter.content, to: null });
    expect(res.status).toBe(201);
    expect(service.issueDraftSendSeal).toHaveBeenCalledWith(
      HOUSE,
      ORDER,
      "manager-1",
      { body: letter.content, to: null, cc: [] },
    );
  });
});

describe.each(["send-drafted-reply", "approve-draft"])(
  "POST orders/:id/%s",
  (route) => {
    const dto = {
      modifiedContent: "Dear Hasan, we can take six cases.",
      ccEmails: ["ops@house.example"],
    };

    it("refuses a copy address carrying a header, and sends nothing", async () => {
      const res = await post(
        route,
        { ...dto, ccEmails: [INJECTED_CC] },
        { "X-Seal-Challenge": "tok" },
      );
      expect(res.status).toBe(400);
      expect(service.sendDraftedReply).not.toHaveBeenCalled();
    });

    it("refuses a letter over 5,000 characters, and sends nothing", async () => {
      const res = await post(
        route,
        { ...dto, modifiedContent: TOO_LONG },
        { "X-Seal-Challenge": "tok" },
      );
      expect(res.status).toBe(400);
      expect(service.sendDraftedReply).not.toHaveBeenCalled();
    });

    it("refuses a caller-named recipient: the letter goes to the address on file", async () => {
      const res = await post(
        route,
        { ...dto, to: "someone@else.example" },
        { "X-Seal-Challenge": "tok" },
      );
      expect(res.status).toBe(400);
      expect(service.sendDraftedReply).not.toHaveBeenCalled();
    });

    it("hands a well-formed letter and its seal to the sealed send", async () => {
      const res = await post(route, dto, { "X-Seal-Challenge": "tok" });
      expect(res.status).toBe(201);
      expect(service.sendDraftedReply).toHaveBeenCalledWith(
        HOUSE,
        ORDER,
        "manager-1",
        expect.objectContaining(dto),
        "tok",
      );
    });
  },
);

describe("POST orders/:id/draft-send-request — a staff member's hold (founder, 2026-09-21)", () => {
  it("refuses a copy address carrying a header, and asks nothing", async () => {
    const res = await post("draft-send-request", { content: "Dear Hasan", ccEmails: [INJECTED_CC] });
    expect(res.status).toBe(400);
    expect(service.requestDraftSend).not.toHaveBeenCalled();
  });

  it("refuses a caller-named recipient: a request goes to the address on file too", async () => {
    const res = await post("draft-send-request", { content: "Dear Hasan", to: "someone@else.example" });
    expect(res.status).toBe(400);
    expect(service.requestDraftSend).not.toHaveBeenCalled();
  });

  it("hands the exact words, the copies and the caller from the token to the request", async () => {
    service.requestDraftSend.mockResolvedValue({ conversationId: "c", requestedAt: "t", told: 2, says: "Asked." });
    const res = await post("draft-send-request", { content: "Dear Hasan", ccEmails: ["ops@house.example"] });
    expect(res.status).toBe(201);
    expect(service.requestDraftSend).toHaveBeenCalledWith(HOUSE, ORDER, "manager-1", {
      content: "Dear Hasan",
      ccEmails: ["ops@house.example"],
    });
  });
});

describe("POST orders/:id/manual-reply — sealed since 2026-09-21 (ADR 0175 D9)", () => {
  it("refuses a copy address carrying a header, and sends nothing", async () => {
    const res = await post("manual-reply", { content: "Hi", ccEmails: [INJECTED_CC] }, { "X-Seal-Challenge": "tok" });
    expect(res.status).toBe(400);
    expect(service.manualReply).not.toHaveBeenCalled();
  });

  it("carries the actor from the token and the seal from the header into the send", async () => {
    service.manualReply.mockResolvedValue({ conversationId: "c", sentAt: "t" });
    const res = await post("manual-reply", { content: "Hi" }, { "X-Seal-Challenge": "tok" });
    expect(res.status).toBe(201);
    expect(service.manualReply).toHaveBeenCalledWith(HOUSE, ORDER, "manager-1", "Hi", undefined, "tok");
  });
});

describe("POST orders/:id/confirm-deal — sealed since 2026-09-21 (ADR 0175 D9)", () => {
  it("refuses a price that is not a number, and commits nothing", async () => {
    const res = await post("confirm-deal", { finalPrice: "twelve" }, { "X-Seal-Challenge": "tok" });
    expect(res.status).toBe(400);
    expect(service.confirmDeal).not.toHaveBeenCalled();
  });

  it("carries the actor from the token and the seal from the header into the confirmation", async () => {
    service.confirmDeal.mockResolvedValue({ confirmed: true, sentConfirmation: true });
    const res = await post("confirm-deal", { finalPrice: 12, quantity: 6 }, { "X-Seal-Challenge": "tok" });
    expect(res.status).toBe(201);
    expect(service.confirmDeal).toHaveBeenCalledWith(
      HOUSE,
      ORDER,
      "manager-1",
      { finalPrice: 12, quantity: 6, sendConfirmation: undefined },
      "tok",
    );
  });
});
