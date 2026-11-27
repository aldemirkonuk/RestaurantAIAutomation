import { DocumentsController } from "./documents.controller";

/**
 * The web shows the verified-CSV link only on this answer (r108, DD-r108-22),
 * so the rule is the gateway's `holdsHouseMoney` and nowhere else. Fails if
 * the answer stops following the money row of ROLE_POLICY.
 */
function controller(): DocumentsController {
  const Ctor = DocumentsController as any;
  return new Ctor({}, {}, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
}
const as = (role: string | undefined) => ({ userId: "u1", restaurantId: "rest-1", role }) as any;

describe("DocumentsController.exportVerifiedAllowed", () => {
  it.each([
    ["owner", true],
    ["manager", true],
    ["admin", true],
    ["staff", false],
    ["waiter", false],
    [undefined, false],
  ])("role %s -> allowed %s", (role, allowed) => {
    expect(controller().exportVerifiedAllowed(as(role))).toEqual({ allowed });
  });

  it("agrees with the export's own refusal for staff", async () => {
    await expect(controller().exportVerified(as("staff"))).rejects.toMatchObject({ status: 403 });
  });
});
