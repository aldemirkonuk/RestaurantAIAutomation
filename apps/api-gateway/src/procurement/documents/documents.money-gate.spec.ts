import { HttpException, HttpStatus } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import {
  DOOR_ECHO_DOCUMENT_KEYS,
  DOOR_ECHO_LINE_KEYS,
  doorEchoOf,
  holdsHouseMoney,
} from "./document-money-gate";

/**
 * THE DOOR STAYS OPEN TO STAFF; THE DOCUMENT'S MONEY DOES NOT.
 *
 * `DocumentsController` carried `JwtAuthGuard` and nothing else, and
 * `SealChallengeService` leaves the role to its caller — so a staff token could
 * mint its own seal and rewrite a unit price, verify a transcription, run the
 * match or fill an unread invoice. And the upload, which staff use at the
 * delivery door, answered every caller with the whole parse: prices, totals,
 * tax, the printed figures.
 *
 * ONE FIXTURE, BOTH SIDES. Every case runs the same call with a staff token
 * and with an owner's or a manager's, against the same collaborators. Those
 * collaborators THROW when touched and record that they were, so "refused" is
 * proven to mean refused before any seal, read or write — and "admitted" is
 * proven to mean the call got past the gate to the work, not that a stub was
 * quiet.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const DOC = "44444444-4444-4444-8444-444444444444";
const LINE = "55555555-5555-4555-8555-555555555555";

const as = (role: string | null | undefined) => ({
  userId: PERSON,
  restaurantId: HOUSE,
  role,
});
const staff = as("staff");
const HOLDERS = [as("owner"), as("manager"), as("admin")];
const NON_HOLDERS = [staff, as(null), as(undefined), as(""), as("sommelier")];

/** Collaborators that record a touch and then throw, in constructor order. */
function harness(intakeOverride?: Record<string, unknown>) {
  const reached: string[] = [];
  const tripwire = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          reached.push(`${name}.${String(prop)}`);
          throw new Error(`REACHED ${name}.${String(prop)}`);
        },
      },
    ) as never;
  const controller = new DocumentsController(
    (intakeOverride ?? tripwire("DocumentIntakeService")) as never,
    tripwire("DatabaseService"),
    tripwire("CanonicalDocumentService"),
    tripwire("DeliverySpineService"),
    tripwire("DocumentCorrectionService"),
    tripwire("CatalogIngestService"),
    tripwire("OrganizationsService"),
    tripwire("DeliveryService"),
    tripwire("DeliveryStockService"),
    tripwire("LineMappingService"),
    tripwire("SealChallengeService"),
  );
  return { controller, reached };
}

type User = ReturnType<typeof as>;
type Act = [string, (c: DocumentsController, u: User) => Promise<unknown>];

/** Every route that writes the document's money, and the seals they take. */
const MONEY_ACTS: Act[] = [
  [
    "POST :id/corrections-seal-challenge",
    (c, u) =>
      c.mintFieldCorrectSeal(
        DOC,
        { path: "documentNumber", value: "INV-2" } as never,
        u as never,
      ),
  ],
  [
    "POST :id/corrections",
    (c, u) =>
      c.correctField(
        DOC,
        { path: "documentNumber", value: "INV-2" } as never,
        u as never,
        "a-seal",
      ),
  ],
  [
    "POST :id/fields/verify-seal-challenge",
    (c, u) =>
      c.mintFieldVerifySeal(
        DOC,
        { path: "documentNumber" } as never,
        u as never,
      ),
  ],
  [
    "POST :id/fields/verify",
    (c, u) =>
      c.verifyFieldTick(
        DOC,
        { path: "documentNumber" } as never,
        u as never,
        "a-seal",
      ),
  ],
  [
    "POST :id/extraction",
    (c, u) =>
      c.applyExtraction(
        DOC,
        { rawText: "{}", model: "m" } as never,
        u as never,
      ),
  ],
  ["POST :id/match", (c, u) => c.match(DOC, u as never)],
  [
    "POST :id/lines/:lineId/link",
    (c, u) => c.linkLine(DOC, LINE, { orderLineId: null }, u as never),
  ],
  [
    "POST :id/lines/:lineId/edit-seal-challenge",
    (c, u) => c.mintLineEditSeal(DOC, LINE, { unitPrice: 1 }, u as never),
  ],
  [
    "PATCH :id/lines/:lineId",
    (c, u) => c.editLine(DOC, LINE, { unitPrice: 1 }, u as never, "a-seal"),
  ],
  [
    "POST :id/verify-seal-challenge",
    (c, u) => c.mintVerifySeal(DOC, u as never),
  ],
  ["POST :id/verify", (c, u) => c.verify(DOC, u as never, "a-seal")],
];

const settle = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );

describe("document money writes go to the people who hold the house's money", () => {
  it("reads one table for who holds money: owner, manager and admin do; nobody else does", () => {
    for (const u of HOLDERS) expect(holdsHouseMoney(u.role)).toBe(true);
    for (const u of NON_HOLDERS) expect(holdsHouseMoney(u.role)).toBe(false);
    expect(holdsHouseMoney("Manager")).toBe(true);
  });

  describe.each(MONEY_ACTS)("%s", (_route, call) => {
    it("refuses a staff token in words, before any seal, read or write", async () => {
      const h = harness();
      const r = await settle(call(h.controller, staff));
      expect(r.ok).toBe(false);
      const err = (r as { e: unknown }).e;
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      const said = String((err as Error).message);
      expect(said).toMatch(/owner's or a manager's act/);
      expect(said).toMatch(/signed in as staff/);
      expect(said).toMatch(/nothing was sealed and nothing was changed/);
      expect(h.reached).toEqual([]);
    });

    it("refuses a session with no role, an empty role and an unknown role the same way", async () => {
      for (const u of NON_HOLDERS.slice(1)) {
        const h = harness();
        const r = await settle(call(h.controller, u));
        expect((r as { e: HttpException }).e.getStatus()).toBe(
          HttpStatus.FORBIDDEN,
        );
        expect(h.reached).toEqual([]);
      }
      const h = harness();
      const r = await settle(call(h.controller, as(null)));
      const said = String((r as { e: Error }).e.message);
      expect(said).toMatch(/could not be shown to hold any role at this house/);
      // A session with no role may have no house either, so the door is not
      // promised to it; a staff member at the house is told the door is open.
      expect(said).not.toMatch(/still go through/);
      const staff = await settle(call(harness().controller, NON_HOLDERS[0]));
      expect(String((staff as { e: Error }).e.message)).toMatch(
        /The photograph and the door count still go through for you/,
      );
    });

    it("lets an owner, a manager and an admin past the gate to the work", async () => {
      for (const u of HOLDERS) {
        const h = harness();
        const r = await settle(call(h.controller, u));
        // The collaborators throw, so the call fails -- but AFTER the gate,
        // having reached the seal service, the document read or the write.
        const err = (r as { e: unknown }).e;
        if (err instanceof HttpException)
          expect(err.getStatus()).not.toBe(HttpStatus.FORBIDDEN);
        expect(h.reached.length).toBeGreaterThan(0);
      }
    });
  });

  it("keeps the uuid check first on the line routes, so a bad id is still a 400 for anyone", async () => {
    const h = harness();
    for (const call of [
      () =>
        h.controller.linkLine(
          DOC,
          "nope",
          { orderLineId: null },
          staff as never,
        ),
      () => h.controller.editLine(DOC, "nope", { qty: 1 }, staff as never),
    ]) {
      const r = await settle(call());
      expect((r as { e: HttpException }).e.getStatus()).toBe(
        HttpStatus.BAD_REQUEST,
      );
    }
    expect(h.reached).toEqual([]);
  });
});

describe("the door stays open to staff", () => {
  it("lets staff name a shelf for a line (link-item stays open; its cost steering is filed OPEN)", async () => {
    const h = harness();
    const r = await settle(
      h.controller.linkLineToItem(
        DOC,
        LINE,
        { inventoryId: null },
        staff as never,
      ),
    );
    const err = (r as { e: unknown }).e;
    if (err instanceof HttpException)
      expect(err.getStatus()).not.toBe(HttpStatus.FORBIDDEN);
    expect(h.reached).toEqual(["LineMappingService.linkLineToItem"]);
  });

  it("lets staff record a door count", async () => {
    const h = harness();
    await settle(
      h.controller.doorCount(
        { lines: [{ lineNo: 1, qty: 2, uom: "case" }] } as never,
        staff as never,
      ),
    );
    expect(h.reached).toEqual(["DocumentIntakeService.recordDoorCount"]);
  });
});

/**
 * A parse with money in every place money can sit: line prices, a printed
 * literal, document totals, a VAT row, a tie-out, and a warning that prints the
 * figures it compared. Figures are distinctive so a leak is findable by value.
 */
const PARSE = {
  docType: "invoice",
  docNumber: "INV-7",
  docDate: "2026-10-01",
  vendorName: "SYNTHETIC Vendor",
  currency: "TRY",
  currencyFiledFrom: "the house's stated currency",
  subtotal: 987.65,
  tax: 197.53,
  total: 1185.18,
  taxBreakdown: [{ category: "S", rate: 20, base: 987.65, amount: 197.53 }],
  computedLinesTotal: 987.65,
  tieOutDelta: 0,
  tiesOut: true,
  confidence: 0.91,
  warnings: [
    "Lines plus charges come to 987.65 but the document states 1185.18",
  ],
  printed: { total: "1.185,18" },
  moneyWithheld: null,
  lines: [
    {
      lineNo: 1,
      vendorSku: "KY-21",
      description: "SYNTHETIC Yakut",
      qty: 2,
      uom: "case",
      packSize: 6,
      qtyBottles: 12,
      freeGoodsQty: 0,
      unitPrice: 493.825,
      lineTotal: 987.65,
      allowance: 0,
      deposit: null,
      priceBaseQty: null,
      priceBaseUom: null,
      printed: { unitPrice: "493,83" },
    },
  ],
};
const VENDOR = {
  state: "unresolved",
  providerId: null,
  source: null,
  identity: null,
  reason: "SYNTHETIC: no seller identity was read.",
};

function uploadHarness(parsed: unknown = PARSE) {
  const ingest = jest.fn(async () => ({
    documentId: DOC,
    duplicate: parsed === null,
    parsed,
    vendor: VENDOR,
  }));
  return harness({ ingest });
}
const PHOTO = {
  contentBase64: Buffer.from("SYNTHETIC photograph bytes").toString("base64"),
  filename: "door.jpg",
  mimeType: "image/jpeg",
  source: "photo",
};

describe("POST /procurement/documents answers a non-holder without the money", () => {
  it("still stores the paper for staff, and returns only the keys the door reads", async () => {
    const h = uploadHarness();
    const res = (await h.controller.upload(
      PHOTO as never,
      staff as never,
    )) as Record<string, any>;
    expect(res.documentId).toBe(DOC);
    expect(res.amountsWithheld).toBe(true);
    expect(res.vendor).toEqual(VENDOR);
    expect(Object.keys(res.document).sort()).toEqual(
      [...DOOR_ECHO_DOCUMENT_KEYS].sort(),
    );
    expect(Object.keys(res.document.lines[0]).sort()).toEqual(
      [...DOOR_ECHO_LINE_KEYS].sort(),
    );
    // What the door counts from is all there.
    expect(res.document).toEqual({
      docType: "invoice",
      docNumber: "INV-7",
      lines: [{ lineNo: 1, qty: 2, uom: "case", packSize: 6, qtyBottles: 12 }],
    });
    // And no figure survives anywhere in the answer, by key or by value.
    const wire = JSON.stringify(res);
    for (const leak of [
      "unitPrice",
      "lineTotal",
      "subtotal",
      "total",
      "tax",
      "printed",
      "warnings",
      "tieOut",
      "987.65",
      "1185.18",
      "493",
      "197.53",
      "1.185,18",
    ])
      expect(wire).not.toContain(leak);
  });

  // OPEN, pinned as it stands rather than as wanted: the upload hands a staff
  // caller's orderId to intake unchanged, and intake's linkAndMatch links the
  // paper to that order and persists exact-SKU pairings. The gate on
  // POST :id/match does not reach this path. See the class doc and the
  // tech-debt fragment's upload-pairing entry. When that entry is fixed, this
  // test is meant to change.
  it("still forwards a staff caller's orderId to intake (OPEN)", async () => {
    const ORDER = "66666666-6666-4666-8666-666666666666";
    const ingest = jest.fn(async (_input: Record<string, unknown>) => ({
      documentId: DOC,
      duplicate: false,
      parsed: PARSE,
      vendor: VENDOR,
    }));
    const h = harness({ ingest });
    const res = (await h.controller.upload(
      { ...PHOTO, orderId: ORDER } as never,
      staff as never,
    )) as Record<string, any>;
    expect(res.amountsWithheld).toBe(true);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0]).toMatchObject({
      restaurantId: HOUSE,
      orderId: ORDER,
    });
  });

  it("withholds the same way for a session with no role, an empty role or an unknown one", async () => {
    for (const u of NON_HOLDERS.slice(1)) {
      const h = uploadHarness();
      const res = (await h.controller.upload(
        PHOTO as never,
        u as never,
      )) as Record<string, any>;
      expect(res.amountsWithheld).toBe(true);
      expect(JSON.stringify(res)).not.toContain("1185.18");
    }
  });

  it("gives an owner, a manager and an admin the whole parse, with no withheld marker", async () => {
    for (const u of HOLDERS) {
      const h = uploadHarness();
      const res = (await h.controller.upload(
        PHOTO as never,
        u as never,
      )) as Record<string, any>;
      expect(res.document).toEqual(PARSE);
      expect("amountsWithheld" in res).toBe(false);
    }
  });

  it("says a duplicate has no parse to either reader, and still marks the staff answer", async () => {
    const h = uploadHarness(null);
    const res = (await h.controller.upload(
      PHOTO as never,
      staff as never,
    )) as Record<string, any>;
    expect(res.document).toBeNull();
    expect(res.amountsWithheld).toBe(true);
  });
});

describe("doorEchoOf is an allowlist", () => {
  it("omits keys it does not know rather than nulling them, so a new money field stays withheld", () => {
    const echo = doorEchoOf({
      ...PARSE,
      landedCost: 12.5,
      lines: [{ ...PARSE.lines[0], dutyPerBottle: 3.1 }, null],
    }) as Record<string, any>;
    expect(echo).not.toHaveProperty("landedCost");
    expect(echo).not.toHaveProperty("total");
    expect(echo.lines[0]).not.toHaveProperty("dutyPerBottle");
    expect(echo.lines[0]).not.toHaveProperty("unitPrice");
    expect(echo.lines[1]).toEqual({});
    expect(doorEchoOf(null)).toBeNull();
  });
});
