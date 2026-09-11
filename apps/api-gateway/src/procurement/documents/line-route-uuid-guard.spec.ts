import { HttpException, HttpStatus } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

/**
 * A MALFORMED PATH PARAM IS THE CALLER'S MISTAKE, NOT OURS (slice 4 live
 * re-drive, defect 3).
 *
 * `POST /procurement/documents/:id/lines/:lineId/link-item` with a `lineId`
 * that is not a uuid reached Postgres and answered 500 "invalid input syntax
 * for type uuid" — a 5xx says the server broke, and nothing here broke. Every
 * `:id`/`:lineId` route on this controller reaches a uuid column the same way,
 * so the guard runs on all of them, BEFORE any read.
 *
 * The guard is checked route by route rather than once: a guard applied to the
 * one route the defect was reported on leaves its siblings holding the same
 * hole, which is how this one survived the slice-4 build.
 */
describe("documents: :id and :lineId must be uuids before any read", () => {
  const user = { userId: "u1", restaurantId: "rest-1" };
  const UUID = "11111111-1111-4111-8111-111111111111";

  /**
   * Every collaborator THROWS. If a route reaches one of these, the guard did
   * not run first — which is the whole claim under test, so a silent stub would
   * make this suite pass for the wrong reason.
   */
  const forbidden = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(
            `line-route-uuid-guard.spec: ${name}.${String(prop)} was reached ` +
              `with a malformed path param — the guard did not run first.`,
          );
        },
      },
    ) as never;

  const controller = new DocumentsController(
    forbidden("DocumentIntakeService"),
    forbidden("DatabaseService"),
    forbidden("CanonicalDocumentService"),
    forbidden("DeliverySpineService"),
    forbidden("DocumentCorrectionService"),
    forbidden("DeliveryService"),
    forbidden("DeliveryStockService"),
    forbidden("LineMappingService"),
  );

  const BAD = "not-a-uuid";

  const calls: [string, () => Promise<unknown>][] = [
    [
      "link-item — bad lineId (the reported defect)",
      () => controller.linkLineToItem(UUID, BAD, { inventoryId: null }, user),
    ],
    [
      "link-item — bad documentId",
      () => controller.linkLineToItem(BAD, UUID, { inventoryId: null }, user),
    ],
    [
      "link — bad lineId",
      () => controller.linkLine(UUID, BAD, { orderLineId: null }, user),
    ],
    [
      "link — bad documentId",
      () => controller.linkLine(BAD, UUID, { orderLineId: null }, user),
    ],
    [
      "PATCH lines/:lineId — bad lineId",
      () => controller.editLine(UUID, BAD, { qty: 1 }, user),
    ],
    [
      "PATCH lines/:lineId — bad documentId",
      () => controller.editLine(BAD, UUID, { qty: 1 }, user),
    ],
    ["line-mappings — bad documentId", () => controller.lineMappings(BAD, user)],
  ];

  it.each(calls)("answers 400 with a sentence: %s", async (_name, call) => {
    const err = await call().then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);

    const msg = String(err.message);
    // A sentence for a person, not the database's own complaint.
    expect(msg).not.toContain("invalid input syntax");
    expect(msg).toMatch(/[a-z]{3,} [a-z]{3,}/i);
    expect(msg).toContain(BAD);
  });

  it("does not fire on a well-formed pair — the guard passes the call through", async () => {
    // Reaching a `forbidden` collaborator proves the guard let it past; what
    // the collaborator would have done is not this suite's business.
    const err = await controller
      .linkLineToItem(UUID, UUID, { inventoryId: null }, user)
      .then(
        () => null,
        (e) => e,
      );
    // It is re-wrapped by the handler's own catch — what matters is that the
    // collaborator was REACHED, and that the answer is not the guard's 400.
    expect(String(err?.message)).toContain("LineMappingService");
    expect(err.getStatus()).not.toBe(HttpStatus.BAD_REQUEST);
  });
});
