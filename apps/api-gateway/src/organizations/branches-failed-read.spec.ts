import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { DatabaseService } from "../database/database.service";

/**
 * `GET /organizations/branches` refuses a read it could not make.
 *
 * WHAT WAS WRONG
 * --------------
 * `getBranchesForUser` makes up to four reads: the organisation's restaurants,
 * `user_restaurant_access`, and the legacy `users.restaurant_id` ->
 * `restaurants` fallback. supabase-js RESOLVES with `{ data, error }`. The
 * first two logged their error and carried on; the last two never looked at
 * it. So a failed read came back as "this user has no branches", or as a
 * partial list presented as the whole one. ADR 0133 routes an empty branch list
 * to /no-access, which makes "could not read" -> "you have no houses" a wrong
 * answer rather than a cosmetic one.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *  * Each of the four reads, failing alone, rejects with 503.
 *  * A failure after a successful read still rejects: a partial list is not
 *    served as complete.
 *  * The refusal does not carry the database's own error text.
 *  * A user who genuinely has no branch still gets `[]`, and the legacy
 *    fallback still resolves its one branch.
 */

type Answer = { data: unknown; error: { message: string } | null };

interface Script {
  /** `organization_members` list read inside `getUserOrgIds`. */
  orgMembers?: Answer;
  /** `restaurants` list read on the organisation path. */
  restaurants?: Answer;
  /** `user_restaurant_access` list read. */
  ura?: Answer;
  /** `users` `.maybeSingle()` read (helper fallback and branch fallback). */
  user?: Answer;
  /** `restaurants` `.maybeSingle()` read (helper fallback and branch fallback). */
  restaurantRow?: Answer;
}

const ok = (data: unknown): Answer => ({ data, error: null });
const DB_MESSAGE = 'relation "restaurants" is temporarily unavailable';
const failed: Answer = { data: null, error: { message: DB_MESSAGE } };

function makeService(script: Script): OrganizationsService {
  const from = (table: string) => {
    const list = (): Answer => {
      switch (table) {
        case "organization_members":
          return script.orgMembers ?? ok([]);
        case "restaurants":
          return script.restaurants ?? ok([]);
        case "user_restaurant_access":
          return script.ura ?? ok([]);
        default:
          return ok([]);
      }
    };
    const single = (): Answer => {
      switch (table) {
        case "users":
          return script.user ?? ok(null);
        case "restaurants":
          return script.restaurantRow ?? ok(null);
        default:
          return ok(null);
      }
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      upsert: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve(single()),
      single: () => Promise.resolve(single()),
      then: (resolve: (v: unknown) => unknown) => resolve(list()),
    };
    return builder;
  };
  const db = { supabase: { from } } as unknown as DatabaseService;
  return new OrganizationsService(db);
}

const ORG = ok([{ organization_id: "org-1" }]);

function branchRow(id: string, name: string) {
  return {
    id,
    name,
    city: null,
    chain_id: null,
    updated_at: null,
    restaurant_chains: null,
  };
}

async function refusal(service: OrganizationsService): Promise<unknown> {
  return service.getBranchesForUser("u1").then(
    (value) => ({ resolvedWith: value }),
    (error: unknown) => error,
  );
}

describe("getBranchesForUser refuses a failed read", () => {
  it("rejects when user_restaurant_access cannot be read", async () => {
    const err = await refusal(makeService({ ura: failed }));
    expect(err).toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not put the database's own error text in the refusal", async () => {
    const err = await refusal(makeService({ ura: failed }));
    expect(err).toBeInstanceOf(HttpException);
    expect(JSON.stringify((err as HttpException).getResponse())).not.toContain(DB_MESSAGE);
  });
});

/**
 * [ADR 0164, 2026-09-18, "Membership only": the list is the person's
 * memberships and nothing else. The organisation path and the users-row path
 * this suite used to pin (a failed organisation read, a failed legacy read,
 * the legacy single branch, the organisation-and-access merge) are gone, so
 * their tests are replaced by the three below.]
 */
describe("getBranchesForUser lists memberships only (ADR 0164)", () => {
  it("answers [] for a person with no membership, whatever their organisation and users row hold", async () => {
    await expect(
      makeService({
        orgMembers: ORG,
        restaurants: ok([branchRow("r1", "Moda"), branchRow("r2", "Kadikoy")]),
        user: ok({ restaurant_id: "r1" }),
        restaurantRow: ok({ ...branchRow("r1", "Moda"), organization_id: "org-1" }),
      }).getBranchesForUser("u1"),
    ).resolves.toEqual([]);
  });

  it("does not list the organisation's other houses beside the person's memberships", async () => {
    const branches = await makeService({
      orgMembers: ORG,
      restaurants: ok([branchRow("r1", "Moda"), branchRow("r3", "Sim Meyhouse")]),
      ura: ok([
        { restaurant_id: "r1", restaurants: branchRow("r1", "Moda") },
        { restaurant_id: "r2", restaurants: branchRow("r2", "Kadikoy") },
      ]),
    }).getBranchesForUser("u1");
    expect(branches.map((b) => b.id)).toEqual(["r1", "r2"]);
  });

  it("lists each house once", async () => {
    const branches = await makeService({
      ura: ok([
        { restaurant_id: "r1", restaurants: branchRow("r1", "Moda") },
        { restaurant_id: "r1", restaurants: branchRow("r1", "Moda") },
      ]),
    }).getBranchesForUser("u1");
    expect(branches.map((b) => b.id)).toEqual(["r1"]);
  });
});
