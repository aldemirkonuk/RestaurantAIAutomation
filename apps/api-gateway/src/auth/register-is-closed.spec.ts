import { GoneException } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * `POST /auth/register` is closed, and nothing can write a house from a body.
 *
 * Until 2026-09-18 the route took `restaurantId` and `role` from the request
 * body, inserted a user carrying both, and returned a token scoped to that
 * house in that role. `generateTokens` keeps `users.role` when no
 * `user_restaurant_access` row exists, and `JwtAuthGuard` re-checks no
 * membership, so knowing a house's id was enough to become its owner. No web
 * or mobile surface called the route.
 *
 * Pinned three ways, so removing any one defence fails a test: the route still
 * exists and answers 410 (a stale client is told where to go, not left with a
 * 404); it answers without touching the service at all; and the service has
 * no `register` writer left to call.
 */
describe("POST /auth/register is closed", () => {
  function controllerWithSpyService() {
    const touched: string[] = [];
    const service = new Proxy(
      {},
      {
        get: (_t, prop) => {
          touched.push(String(prop));
          return () => {
            throw new Error(`the closed route reached AuthService.${String(prop)}`);
          };
        },
      },
    ) as unknown as AuthService;
    return { controller: new AuthController(service), touched };
  }

  // Awaited, so a handler that is async (as the old one was) fails the
  // assertion below instead of escaping as an unhandled rejection.
  async function thrownBy(controller: AuthController, body: unknown) {
    try {
      await (controller as any).register(body);
      return undefined;
    } catch (e) {
      return e;
    }
  }

  it("is still routed as POST register, so a stale client gets an answer, not a 404", () => {
    const handler = AuthController.prototype.register;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("register");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it("answers 410 Gone and names the two doors that remain", async () => {
    const { controller } = controllerWithSpyService();
    const thrown = await thrownBy(controller, {
      email: "someone@example.test",
      password: "long-enough-password",
      name: "Someone",
      restaurantId: "550e8400-e29b-41d4-a716-446655440000",
      role: "owner",
    });
    expect(thrown).toBeInstanceOf(GoneException);
    expect((thrown as GoneException).getStatus()).toBe(410);
    const message = String((thrown as GoneException).message);
    expect(message).toContain("/auth/register/restaurant");
    expect(message).toContain("invitation");
  });

  it("refuses before the service is touched, whatever the body names", async () => {
    const { controller, touched } = controllerWithSpyService();
    const thrown = await thrownBy(controller, { restaurantId: "any-house", role: "owner" });
    expect(thrown).toBeInstanceOf(GoneException);
    expect(touched).toEqual([]);
  });

  it("leaves no writer behind: AuthService has no register method", () => {
    expect((AuthService.prototype as any).register).toBeUndefined();
  });
});
