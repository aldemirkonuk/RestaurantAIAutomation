/**
 * ADR 0099 — the vendor-email route had two faults on the same call.
 *
 * F1 (401). `fdaa7fa0` (2026-08-25) put a class-level `@UseGuards(JwtAuthGuard)`
 *     on CommunicationsController. The only caller of `POST /communications/email`
 *     is `services/agent-orchestrator/services/email_composer_service.py`, which
 *     sends no `Authorization` header. From that commit on, the call was refused
 *     before the handler ran.
 *
 * F2 (400, even with a token). `main.ts:51-57` installs a global ValidationPipe
 *     with `forbidNonWhitelisted: true`. `SendEmailDto` declared none of the four
 *     threading fields the Python caller sends when replying (`replyTo`,
 *     `threadId`, `inReplyTo`, `references`), so a threaded reply was rejected on
 *     validation even once authenticated.
 *
 * F3 (silent, found while fixing F2). The handler never forwarded the threading
 *     fields to `GmailService` and never returned `threadId`, so even a accepted
 *     send produced no thread state for the caller to persist. `EmailOptions` and
 *     `EmailResult` (gmail.service.ts:36-56) have carried all of them since long
 *     before the DTO existed — the caller was not inventing fields, the DTO and
 *     the handler were dropping them.
 *
 * The guard is loaded with `require` INSIDE each test rather than imported at the
 * top, so that on the pre-fix tree these fail one by one with a nameable reason
 * instead of taking the whole suite down with a module-resolution error.
 */
import "reflect-metadata";
import { ValidationPipe, UnauthorizedException } from "@nestjs/common";
import { PATH_METADATA, GUARDS_METADATA } from "@nestjs/common/constants";
import { CommunicationsController } from "./communications.controller";
import { SendEmailDto } from "./dto/communication.dto";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";

const GUARD_PATH = "../auth/guards/service-key.guard";

function loadServiceKeyGuard(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(GUARD_PATH).ServiceKeyGuard;
}

function ctxWith(headers: Record<string, string>): any {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  };
}

// A ConfigService stand-in: the guard must consult config AND process.env, the
// same fallback every other secret read in this app uses.
function config(values: Record<string, string | undefined>): any {
  return { get: (k: string, d?: string) => values[k] ?? d };
}

describe("F1 — the vendor-email route authenticates its service caller", () => {
  const ORIGINAL = process.env.ADMIN_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = ORIGINAL;
  });

  it("POST /communications/email carries ServiceKeyGuard", () => {
    const ServiceKeyGuard = loadServiceKeyGuard();
    const guards =
      Reflect.getMetadata(
        GUARDS_METADATA,
        (CommunicationsController.prototype as any).sendEmail,
      ) ?? [];
    expect(guards).toContain(ServiceKeyGuard);
  });

  it("is @Public() so the class-level JwtAuthGuard short-circuits to the service guard", () => {
    // Nest runs class guards before method guards and requires ALL to pass, so a
    // method-level service guard cannot override JwtAuthGuard — it can only add
    // to it. @Public() is how this controller already expresses "authenticated,
    // but not by a user JWT" (see /webhooks/gmail, ADR 0019 D3).
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        (CommunicationsController.prototype as any).sendEmail,
      ),
    ).toBe(true);
    // and the route is still where the caller points
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        (CommunicationsController.prototype as any).sendEmail,
      ),
    ).toBe("email");
  });

  it("FAILS CLOSED: an unset ADMIN_API_KEY denies, it does not allow", () => {
    const ServiceKeyGuard = loadServiceKeyGuard();
    delete process.env.ADMIN_API_KEY;
    const guard = new ServiceKeyGuard(config({}));
    // The dangerous shape is `header === expected` with both empty: a missing
    // secret must never mean "allow", and must not be satisfiable by sending
    // an empty header either.
    expect(() => guard.canActivate(ctxWith({ "x-admin-key": "" }))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(ctxWith({ "x-admin-key": "anything" })),
    ).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctxWith({}))).toThrow(UnauthorizedException);
  });

  it("denies a missing or mismatched header when the key IS set", () => {
    const ServiceKeyGuard = loadServiceKeyGuard();
    const guard = new ServiceKeyGuard(
      config({ ADMIN_API_KEY: "s3cret-value" }),
    );
    expect(() => guard.canActivate(ctxWith({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctxWith({ "x-admin-key": "" }))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(ctxWith({ "x-admin-key": "wrong" })),
    ).toThrow(UnauthorizedException);
    // a prefix must not pass a length-insensitive comparison
    expect(() =>
      guard.canActivate(ctxWith({ "x-admin-key": "s3cret" })),
    ).toThrow(UnauthorizedException);
  });

  it("admits the matching key, from config or from process.env", () => {
    const ServiceKeyGuard = loadServiceKeyGuard();
    expect(
      new ServiceKeyGuard(
        config({ ADMIN_API_KEY: "s3cret-value" }),
      ).canActivate(ctxWith({ "x-admin-key": "s3cret-value" })),
    ).toBe(true);

    process.env.ADMIN_API_KEY = "from-env";
    expect(
      new ServiceKeyGuard(config({})).canActivate(
        ctxWith({ "x-admin-key": "from-env" }),
      ),
    ).toBe(true);
  });
});

describe("F2 — a threaded reply survives forbidNonWhitelisted", () => {
  // Same pipe options as main.ts:51-57. If they drift apart this test is
  // measuring nothing, so assert the shape the app actually installs.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = { type: "body" as const, metatype: SendEmailDto };

  const threadedReply = {
    to: ["vendor@example.com"],
    subject: "Re: your wines",
    bodyHtml: "<p>hello</p>",
    bodyText: "hello",
    // exactly the four the Python caller adds when replying
    // (email_composer_service.py:345-352)
    replyTo: "orders@mudavym.com",
    threadId: "19f365aac4e6",
    inReplyTo: "<wineops-123@wineops.ai>",
    references: "<a@x> <b@y>",
  };

  it("accepts every threading field the caller sends", async () => {
    await expect(pipe.transform(threadedReply, meta)).resolves.toMatchObject({
      replyTo: "orders@mudavym.com",
      threadId: "19f365aac4e6",
      inReplyTo: "<wineops-123@wineops.ai>",
      references: "<a@x> <b@y>",
    });
  });

  it("rejects ONLY the field the contract does not define", async () => {
    // The fix must widen the contract to what GmailService already supports —
    // not switch whitelisting off. So the complaint list must name `smuggled`
    // and nothing else. Pre-fix it names the four threading fields too, which
    // is the 400 the orchestrator was getting.
    //
    // BadRequestException.message is the literal "Bad Request Exception"; the
    // per-property detail is on getResponse().
    expect.assertions(2);
    try {
      await pipe.transform({ ...threadedReply, smuggled: "x" }, meta);
    } catch (e: any) {
      const messages: string[] = [].concat(e.getResponse().message);
      expect(messages.join(" | ")).toMatch(/smuggled/);
      expect(messages).toHaveLength(1);
    }
  });

  it("keeps threading optional — a first contact has no thread", async () => {
    await expect(
      pipe.transform(
        {
          to: ["vendor@example.com"],
          subject: "hello",
          bodyHtml: "<p>hi</p>",
        },
        meta,
      ),
    ).resolves.toBeDefined();
  });
});

describe("F3 — threading reaches Gmail and thread state comes back", () => {
  function controllerWithSpy() {
    const sendEmail = jest.fn().mockResolvedValue({
      success: true,
      messageId: "gmail-msg-1",
      threadId: "gmail-thread-1",
    });
    const c = new CommunicationsController(
      {} as any,
      { sendEmail } as any,
      {} as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    return { c, sendEmail };
  }

  it("forwards replyTo/threadId/inReplyTo/references to GmailService", async () => {
    const { c, sendEmail } = controllerWithSpy();
    await c.sendEmail({
      to: ["vendor@example.com"],
      subject: "Re: your wines",
      bodyHtml: "<p>hello</p>",
      replyTo: "orders@mudavym.com",
      threadId: "19f365aac4e6",
      inReplyTo: "<wineops-123@wineops.ai>",
      references: "<a@x> <b@y>",
    } as any);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: "orders@mudavym.com",
        threadId: "19f365aac4e6",
        inReplyTo: "<wineops-123@wineops.ai>",
        references: "<a@x> <b@y>",
      }),
    );
  });

  it("returns threadId, which the caller persists as gmail_thread_id", async () => {
    // provider_conversation_agent.py:3090 stores `send_result["thread_id"]`,
    // which email_composer_service.py:370 reads from `result["threadId"]`.
    // Without it every reply starts a new Gmail thread.
    const { c } = controllerWithSpy();
    const result = await c.sendEmail({
      to: ["vendor@example.com"],
      subject: "s",
      bodyHtml: "<p>h</p>",
    } as any);
    expect(result).toMatchObject({
      success: true,
      messageId: "gmail-msg-1",
      threadId: "gmail-thread-1",
      channel: "email",
    });
  });
});
