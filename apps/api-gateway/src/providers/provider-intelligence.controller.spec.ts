import { ProviderIntelligenceController } from "./provider-intelligence.controller";

/**
 * REGRESSION (found 2026-09-17 by the nightly E2E walk): `verifyKnowledge`
 * read `user.id`, which `JwtStrategy.validate` never sets (only `userId`,
 * auth/strategies/jwt.strategy.ts) — `@CurrentUser()` hands the object over
 * untyped, so `{ id: string }` compiled and the actor was `undefined` on
 * every call. `provider_knowledge.verified_by` is a nullable UUID column with
 * no NOT NULL guard, so the write silently succeeded with `verified: true`
 * and `verified_by` left NULL rather than erroring — a row that says
 * "verified" and names nobody.
 */
describe("ProviderIntelligenceController.verifyKnowledge — actor identity", () => {
  const user = { userId: "u1" } as any;

  function build() {
    const calls: any[] = [];
    const intelligenceService: any = {
      verifyKnowledge: async (knowledgeId: string, userId: string) => {
        calls.push({ knowledgeId, userId });
        return { id: knowledgeId, verified: true, verified_by: userId };
      },
    };
    const databaseService: any = {};
    const controller = new ProviderIntelligenceController(
      intelligenceService,
      databaseService,
    );
    return { controller, calls };
  }

  it("passes the caller's userId, never undefined", async () => {
    const { controller, calls } = build();

    const result = await controller.verifyKnowledge("k1", user);

    expect(calls).toEqual([{ knowledgeId: "k1", userId: "u1" }]);
    expect(result.verified_by).toBe("u1");
  });

  it("a session with no `id` field still names a real actor", async () => {
    const bareUser = { userId: "u1" } as any;
    expect("id" in bareUser).toBe(false);
    const { controller, calls } = build();

    await controller.verifyKnowledge("k1", bareUser);

    expect(calls[0].userId).toBe("u1");
    expect(calls[0].userId).not.toBeUndefined();
  });
});
