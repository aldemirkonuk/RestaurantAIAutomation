/**
 * F-543: `countUnattributed` returned 0 when either of its reads failed, and
 * /connections shows the "live grants with no recorded restaurant" warning only
 * when the count is above 0 — so a failed read removed the one warning about
 * grants that still work and sit on nobody's page. Its sibling
 * `houseRevocations` already treats a failed read as fatal; this now does too.
 */
import { InternalServerErrorException } from "@nestjs/common";
import { IntegrationsOauthService } from "./integrations-oauth.service";

type Answer = {
  data?: unknown;
  count?: number | null;
  error: { message: string } | null;
};

function service(answers: Record<string, Answer>) {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is"]) b[m] = () => b;
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(answers[table] ?? { data: [], error: null }).then(
        resolve,
        reject,
      );
    return b;
  };
  const db = { client: { from } };
  const svc = new IntegrationsOauthService(
    db as never,
    { get: () => undefined } as never,
    {} as never,
  );
  return (
    svc as unknown as { countUnattributed: (r: string) => Promise<number> }
  ).countUnattributed("r-1");
}

describe("countUnattributed (F-543)", () => {
  it("fails, rather than answering 0, when the member read fails", async () => {
    await expect(
      service({
        user_restaurant_access: { data: null, error: { message: "boom" } },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("fails, rather than answering 0, when the grant count fails", async () => {
    await expect(
      service({
        user_restaurant_access: { data: [{ user_id: "u-1" }], error: null },
        integration_oauth_connections: {
          count: null,
          error: { message: "boom" },
        },
      }),
    ).rejects.toThrow(/could not be counted/);
  });

  it("still answers 0 for a house with no active members", async () => {
    await expect(
      service({ user_restaurant_access: { data: [], error: null } }),
    ).resolves.toBe(0);
  });

  it("answers the count when both reads land", async () => {
    await expect(
      service({
        user_restaurant_access: { data: [{ user_id: "u-1" }], error: null },
        integration_oauth_connections: { count: 2, error: null },
      }),
    ).resolves.toBe(2);
  });
});
