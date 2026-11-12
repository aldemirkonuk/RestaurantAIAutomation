/**
 * The house's mail setup page's service (founder /goal 2026-11-07): which
 * mailbox sends, the Mudavym address, the test letter, and who may change
 * them. No mail is sent by anything under test here: there is no sending path
 * in these files, and the fake database records every write so a stray one
 * would show.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MailSetupService, mailtoFor, mayChangeHouseMail } from "./mail-setup.service";
import { HouseSenderService } from "../letters/house-sender.service";
import {
  CHEF,
  G_CHEF,
  G_DRIVE,
  G_MINE,
  G_OTHER,
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
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_CHEF, chosen_by: CHEF }] },
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

  it("a colleague's mailbox chosen by someone else is not a choice: the plain rule sends", async () => {
    // QA round 26, #973 defect 2: only the person who connected a mailbox may
    // make it the house's. A row that says otherwise is not obeyed.
    const { service } = build({
      house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_CHEF, chosen_by: ME }] },
    });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.senders.chosenConnectionId).toBeNull();
    expect(view.senders.choices.map((c) => [c.connectionId, c.chosen, c.sending])).toEqual([
      [G_MINE, false, true],
      [G_CHEF, false, false],
    ]);
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

  it("a failed read of the stored choice says so, never 'no choice' (QA round 26, #975 M11)", async () => {
    const { service } = build({
      house_mail_sender_choice: { error: { message: "invalid_grant: relation unavailable" } },
    });
    const view = await service.read(HOUSE, ME, "owner");
    expect(view.senders).toEqual({
      failed: "The house's chosen mailbox could not be read.",
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
    expect(testLetter.lastArrival).toEqual({
      code: "K7QM-2RZD",
      arrivedAt: "2026-11-07T10:02:00Z",
      arrivedFrom: "me@gmail.test",
    });
    expect(testLetter.latest!.mailto).toMatch(/^mailto:r-mine@in\.example\.test\?subject=Mudavym%20test%20letter%20K7QM-2RZD&body=/);
  });

  it("no test letter yet is null; a failed read says it failed", async () => {
    expect((await build({}).service.read(HOUSE, ME, "owner")).testLetter).toEqual({
      failed: null,
      latest: null,
      lastArrival: null,
    });
    const failed = await build({ mail_setup_checks: { error: { message: "x" } } }).service.read(HOUSE, ME, "owner");
    expect(failed.testLetter).toEqual({
      failed: "Whether the test letter arrived could not be read.",
      latest: null,
      lastArrival: null,
    });
  });

  it("an earlier check's arrival is shown while a newer check is still open", async () => {
    // QA round 26, #974 defect 2 (probe B6-older-arrives): test A started,
    // then B before A landed; A arrives. The page read only the newest check
    // and said "not arrived" while mail was in fact arriving.
    const { service } = build({
      mail_setup_checks: {
        rows: [
          { restaurant_id: HOUSE, code: "AAAA-AAAA", address: "r-mine@in.example.test", started_at: "2026-11-07T10:00:00Z", arrived_at: "2026-11-07T10:05:00Z", arrived_from: "me@gmail.test" },
          { restaurant_id: HOUSE, code: "BBBB-BBBB", address: "r-mine@in.example.test", started_at: "2026-11-07T10:01:00Z", arrived_at: null, arrived_from: null },
          { restaurant_id: OTHER, code: "ZZZZ-ZZZZ", address: "r-other@in.example.test", started_at: "2026-11-07T09:00:00Z", arrived_at: "2026-11-07T11:00:00Z", arrived_from: "them@x.test" },
        ],
      },
    });
    const { testLetter } = await service.read(HOUSE, ME, "owner");
    expect(testLetter.latest?.code).toBe("BBBB-BBBB");
    expect(testLetter.latest?.arrivedAt).toBeNull();
    expect(testLetter.lastArrival).toEqual({ code: "AAAA-AAAA", arrivedAt: "2026-11-07T10:05:00Z", arrivedFrom: "me@gmail.test" });
  });
});

describe("MailSetupService.chooseSender", () => {
  it("staff may not choose; nothing is written", async () => {
    const { service, db } = build({});
    await expect(service.chooseSender(HOUSE, ME, "staff", G_CHEF)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes).toEqual([]);
  });

  it.each([
    ["another house's grant", G_OTHER],
    ["a file-only grant", G_DRIVE],
    ["a revoked grant", G_REVOKED],
    ["a grant that does not exist", "c0000000-0000-4000-8000-0000000000ff"],
  ])("refuses %s in plain words; nothing is written", async (_l, id) => {
    const { service, db } = build({});
    await expect(service.chooseSender(HOUSE, ME, "manager", id)).rejects.toThrow(
      new BadRequestException("That mailbox is not one this house can send from any more. Nothing was changed."),
    );
    expect(db.writes).toEqual([]);
  });

  it("saves the choice of the chooser's own mailbox, naming who chose", async () => {
    const { service, db } = build({});
    await service.chooseSender(HOUSE, ME, "manager", G_MINE);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({
      table: "house_mail_sender_choice",
      op: "upsert",
      payload: { restaurant_id: HOUSE, connection_id: G_MINE, chosen_by: ME },
    });
  });

  it.each(["manager", "owner"])(
    "a %s may not choose a colleague's mailbox: only the person who connected it may; nothing is written",
    async (role) => {
      // QA round 26, #973 defect 2 (probe B2-colleague-grant).
      const { service, db } = build({});
      const refused = service.chooseSender(HOUSE, ME, role, G_CHEF);
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.chooseSender(HOUSE, ME, role, G_CHEF)).rejects.toThrow(
        /Only the person who connected that mailbox can choose it/,
      );
      expect(db.writes).toEqual([]);
    },
  );

  it("the person who connected a mailbox may choose it", async () => {
    const { service, db } = build({});
    await service.chooseSender(HOUSE, CHEF, "manager", G_CHEF);
    expect(db.writes[0]).toMatchObject({ op: "upsert", payload: { connection_id: G_CHEF, chosen_by: CHEF } });
  });

  it("null clears this house's choice only", async () => {
    const { service, db } = build({});
    await service.chooseSender(HOUSE, ME, "owner", null);
    expect(db.writes).toEqual([
      { table: "house_mail_sender_choice", op: "delete", payload: undefined, filters: [["eq", "restaurant_id", HOUSE]] },
    ]);
  });

  it("a failed save says nothing was changed", async () => {
    const { service } = build({ house_mail_sender_choice: { writeErrors: [{ message: "x" }] } });
    await expect(service.chooseSender(HOUSE, ME, "owner", G_MINE)).rejects.toThrow(
      new ServiceUnavailableException("The choice could not be saved. Nothing was changed; try again."),
    );
  });
});

describe("MailSetupService.startTestLetter and makeAddress", () => {
  it("staff may not start one", async () => {
    const { service, db, inbound } = build({});
    await expect(service.startTestLetter(HOUSE, ME, "staff")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.makeAddress(HOUSE, ME, "staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes).toEqual([]);
    expect(inbound.addressFor).not.toHaveBeenCalled();
  });

  it("with no inbound domain, says so in plain words", async () => {
    const { service } = build({}, { domain: null });
    await expect(service.startTestLetter(HOUSE, ME, "owner")).rejects.toBeInstanceOf(ConflictException);
  });

  it("makes the address, then writes one check for this house with a typed code", async () => {
    const { service, db, inbound } = build({});
    await service.startTestLetter(HOUSE, ME, "owner");
    expect(inbound.addressFor).toHaveBeenCalledWith(HOUSE);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].table).toBe("mail_setup_checks");
    expect(db.writes[0].payload).toMatchObject({ restaurant_id: HOUSE, address: "r-1a2b3c4d@in.example.test", started_by: ME });
    expect(db.writes[0].payload.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("draws a new code on a clash, and says it failed on any other error", async () => {
    const clash = build({ mail_setup_checks: { writeErrors: [{ message: "dup", code: "23505" }, null] } });
    await clash.service.startTestLetter(HOUSE, ME, "owner");
    expect(clash.db.writes).toHaveLength(2);

    const broken = build({ mail_setup_checks: { writeErrors: [{ message: "nope", code: "42501" }] } });
    await expect(broken.service.startTestLetter(HOUSE, ME, "owner")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(broken.db.writes).toHaveLength(1);
  });

  it("an address that could not be made says so, and writes no check", async () => {
    const { service, db } = build({}, { address: null });
    await expect(service.makeAddress(HOUSE, ME, "owner")).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.startTestLetter(HOUSE, ME, "owner")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.writes).toEqual([]);
  });
});

