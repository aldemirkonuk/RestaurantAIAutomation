/**
 * The house's mail setup page's service (founder /goal 2026-11-07): which
 * mailbox sends, the Mudavym address, the test letter, and who may change
 * them. No mail is sent by anything under test here: there is no sending path
 * in these files, and the fake database records every write so a stray one
 * would show.
 */

import { MailSetupService, mailtoFor, mayChangeHouseMail } from "./mail-setup.service";
import { HouseSenderService } from "../letters/house-sender.service";
import {
  CHEF,
  G_CHEF,
  G_MINE,
  G_REVOKED,
  HOUSE,
  ME,
  OTHER,
  TableSpec,
  fakeDb,
  grants,
} from "./fake-db.testing";

function build(
  tables: Record<string, TableSpec>,
  opts: { domain?: string | null; address?: string | null } = {},
) {
  const db = fakeDb({
    integration_oauth_connections: { rows: grants() },
    users: { rows: [{ user_id: CHEF, name: "Ayşe" }, { user_id: ME, name: "Deniz" }] },
    ...tables,
  });
  const config = { get: () => undefined } as any;
  const sender = new HouseSenderService(db as any, config);
  const domain = opts.domain === undefined ? "in.example.test" : opts.domain;
  const inbound = {
    domain: () => domain,
    addressFor: jest.fn(async () => (opts.address === undefined ? "r-1a2b3c4d@in.example.test" : opts.address)),
  };
  const service = new MailSetupService(db as any, inbound as any, sender);
  return { db, sender, inbound, service };
}

describe("who may change the house's mail", () => {
  it("owner and manager may; staff, an unknown role and no role may not", () => {
    expect(mayChangeHouseMail("owner")).toBe(true);
    expect(mayChangeHouseMail("Manager")).toBe(true);
    expect(mayChangeHouseMail("staff")).toBe(false);
    expect(mayChangeHouseMail("admin")).toBe(false);
    expect(mayChangeHouseMail(null)).toBe(false);
  });
});

describe("MailSetupService.read", () => {
  it("lists only this house's live sending grants, with who, which is mine, chosen and sending", async () => {
    const { service } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_CHEF }] },
    });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.canChange).toBe(true);
    expect(view.senders.failed).toBeNull();
    expect(view.senders.chosenConnectionId).toBe(G_CHEF);
    expect(view.senders.choices).toEqual([
      { connectionId: G_MINE, address: "me@house.test", personName: "Deniz", mine: true, chosen: false, sending: false },
      { connectionId: G_CHEF, address: "office@house.test", personName: "Ayşe", mine: false, chosen: true, sending: true },
    ]);
  });

  it("staff read the same page but may not change it", async () => {
    const { service } = build({});
    const view = await service.read(HOUSE, ME, "staff");
    expect(view.canChange).toBe(false);
    expect(view.senders.choices.map((c) => c.sending)).toEqual([true, false]);
  });

  it("a choice pointing at a grant that no longer sends is reported as no choice", async () => {
    const { service } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_REVOKED }] },
    });
    expect((await service.read(HOUSE, ME, "owner")).senders.chosenConnectionId).toBeNull();
  });

  it("a failed grants read says so in plain words and still answers the other two", async () => {
    const { service } = build({
      integration_oauth_connections: { error: { message: "invalid_grant: token expired" } },
    });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.senders).toEqual({
      failed: "Which mailboxes this house can send from could not be read.",
      choices: [],
      chosenConnectionId: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/invalid_grant/);
    expect(view.arrival.failed).toBeNull();
  });

  it("with no inbound domain, says mail cannot arrive by address and reads nothing for it", async () => {
    const { service, inbound } = build({}, { domain: null });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.arrival).toEqual({ domainReady: false, address: null, failed: null });
    expect(inbound.addressFor).not.toHaveBeenCalled();
  });

  it("reads this house's address without making one", async () => {
    const { service, inbound } = build({
      restaurant_inbound_addresses: {
        rows: [
          { restaurant_id: OTHER, address: "r-other@in.example.test", is_active: true },
          { restaurant_id: HOUSE, address: "r-mine@in.example.test", is_active: true },
        ],
      },
    });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.arrival).toEqual({ domainReady: true, address: "r-mine@in.example.test", failed: null });
    expect(inbound.addressFor).not.toHaveBeenCalled();
  });

  it("a failed address read says it failed, never 'no address'", async () => {
    const { service } = build({ restaurant_inbound_addresses: { error: { message: "boom" } } });
    expect((await service.read(HOUSE, ME, "owner")).arrival).toEqual({
      domainReady: true,
      address: null,
      failed: "The house's Mudavym address could not be read.",
    });
  });

  // The other house's check is listed first and is newer: a read that drops
  // its house filter returns it and fails here.
  it("shows this house's newest test letter with its mailto, and when it arrived", async () => {
    const { service } = build({
      mail_setup_checks: {
        rows: [
          { restaurant_id: OTHER, code: "ZZZZ-ZZZZ", address: "r-other@in.example.test", started_at: "2026-11-07T11:00:00Z", arrived_at: null, arrived_from: null },
          { restaurant_id: HOUSE, code: "K7QM-2RZD", address: "r-mine@in.example.test", started_at: "2026-11-07T10:00:00Z", arrived_at: "2026-11-07T10:02:00Z", arrived_from: "me@gmail.test" },
        ],
      },
    });
    const { testLetter } = await service.read(HOUSE, ME, "owner");
    expect(testLetter.failed).toBeNull();
    expect(testLetter.latest).toEqual({
      code: "K7QM-2RZD",
      subject: "Mudavym test letter K7QM-2RZD",
      address: "r-mine@in.example.test",
      mailto: mailtoFor("r-mine@in.example.test", "Mudavym test letter K7QM-2RZD"),
      startedAt: "2026-11-07T10:00:00Z",
      arrivedAt: "2026-11-07T10:02:00Z",
      arrivedFrom: "me@gmail.test",
    });
    expect(testLetter.latest!.mailto).toMatch(/^mailto:r-mine@in\.example\.test\?subject=Mudavym%20test%20letter%20K7QM-2RZD&body=/);
  });

  it("no test letter yet is null; a failed read says it failed", async () => {
    expect((await build({}).service.read(HOUSE, ME, "owner")).testLetter).toEqual({ failed: null, latest: null });
    const failed = await build({ mail_setup_checks: { error: { message: "x" } } }).service.read(HOUSE, ME, "owner");
    expect(failed.testLetter).toEqual({ failed: "Whether the test letter arrived could not be read.", latest: null });
  });
});
