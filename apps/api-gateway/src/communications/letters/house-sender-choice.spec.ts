/**
 * HouseSenderService.resolve honours the house's chosen sender (founder /goal
 * 2026-11-07, "which email do we select"). The choice wins over the asker's
 * own grant; a choice of another house, or of a grant that no longer sends,
 * is not obeyed; and a choice that could not be read makes the sender unknown
 * rather than quietly falling back to the old rule.
 */

import { HouseSenderService } from "./house-sender.service";
import { CHEF, G_CHEF, G_MINE, G_REVOKED, HOUSE, ME, OTHER, TableSpec, fakeDb, grants } from "../mail-setup/fake-db.testing";

function build(tables: Record<string, TableSpec>) {
  const db = fakeDb({
    integration_oauth_connections: { rows: grants() },
    users: { rows: [{ user_id: CHEF, name: "Ayşe" }, { user_id: ME, name: "Deniz" }] },
    ...tables,
  });
  return { sender: new HouseSenderService(db as any, { get: () => undefined } as any) };
}

describe("HouseSenderService.resolve honours the house's choice", () => {
  it("with no choice, the asker's own grant sends (the old rule, unchanged)", async () => {
    const { sender } = build({});
    const id = await sender.resolve(HOUSE, ME);
    expect(id.grant?.connectionId).toBe(G_MINE);
  });

  it("the house's choice wins over the asker's own grant", async () => {
    const { sender } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_CHEF }] },
    });
    const id = await sender.resolve(HOUSE, ME);
    expect(id.kind).toBe("house_mailbox");
    expect(id.grant?.connectionId).toBe(G_CHEF);
    expect(id.address).toBe("office@house.test");
  });

  it("another house's choice row is never read for this house", async () => {
    const { sender } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: OTHER, connection_id: G_CHEF }] },
    });
    expect((await sender.resolve(HOUSE, ME)).grant?.connectionId).toBe(G_MINE);
  });

  it("a choice pointing at a revoked grant is ignored, not obeyed", async () => {
    const { sender } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_REVOKED }] },
    });
    expect((await sender.resolve(HOUSE, ME)).grant?.connectionId).toBe(G_MINE);
  });

  it("a choice that could not be read makes the sender unknown, never the old rule", async () => {
    const { sender } = build({
      house_mail_sender_choice: { error: { message: "permission denied" } },
    });
    const id = await sender.resolve(HOUSE, ME);
    expect(id.kind).toBe("unknown");
    expect(id.sendable).toBe(false);
    expect(id.grant).toBeNull();
  });
});
