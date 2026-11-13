import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

// QA round 23 (beside #952): the invite's team-row match used `ilike`, so `_`
// and `%` in the joiner's address were wildcards. john_smith@ joining took
// over john.smith@'s row (user_id, email and name overwritten).

const HOUSE = "house-1";

function service(team: any[]) {
  const db = makeStubDb({ team_members: team });
  const svc = new AuthService(
    {} as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {} as any,
    {} as any,
  );
  return { svc: svc as any, db };
}

const colleague = () => ({
  id: "tm-colleague",
  restaurant_id: HOUSE,
  user_id: "colleague",
  email: "john.smith@bistro.com",
  display_name: "John Smith",
  invite_id: null,
});

describe("the invite's team row is matched exactly (QA round 23)", () => {
  it("john_smith@ joining does not claim john.smith@'s row", async () => {
    const { svc, db } = service([colleague()]);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "inv-9",
      userId: "joiner",
      email: "john_smith@bistro.com",
      name: "Joiner",
      role: "staff",
    });
    const row = db.tables.team_members.find((r: any) => r.id === "tm-colleague");
    expect(row).toMatchObject({ user_id: "colleague", email: "john.smith@bistro.com", display_name: "John Smith" });
    expect(db.tables.team_members).toHaveLength(2);
  });

  it("%@ invited does not mark a colleague's row as that invite's", async () => {
    const { svc, db } = service([{ ...colleague(), user_id: null }]);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "inv-9",
      email: "%@bistro.com",
      role: "staff",
    });
    expect(db.tables.team_members.find((r: any) => r.id === "tm-colleague").invite_id).toBeNull();
  });

  it("the same address in another case still claims its own row", async () => {
    const { svc, db } = service([{ ...colleague(), user_id: null }]);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "inv-9",
      userId: "john",
      email: "John.Smith@bistro.com",
      role: "staff",
    });
    expect(db.tables.team_members).toHaveLength(1);
    expect(db.tables.team_members[0].user_id).toBe("john");
  });
});
