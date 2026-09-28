import { receivingCountBasis } from "../receivingCountBasis";
const base = { id: "o1", status: "DELIVERED" };
/** The gateway's ledger block (ADR 0192) for a case-of-12 order. */
const shelf = (over: Record<string, unknown> = {}) => ({
  readable: true,
  why: null,
  quantityInStockUom: 65,
  stockUom: "bottle",
  packUnit: "case",
  packSize: 12,
  packs: 5,
  looseInStockUom: 5,
  words: "5 cases + 5 bottles",
  rejectedAtDoorBottles: 0,
  countedNotBookedBottles: 0,
  ...over,
});
const caseOrder = { ...base, quantity: 5, bottlesTotal: 60, unitType: "case" };

it("pre-fills the ledger's bottles for a part case, never a rounded case count", () => {
  const basis = receivingCountBasis({ ...caseOrder, received: shelf() as any });
  expect(basis).toMatchObject({ orderedBottles: 60, prefillBottles: 65 });
  expect(basis.note).toContain("5 cases + 5 bottles");
});
it("states the door's rejections and a counted-not-booked truck beside the pre-fill", () => {
  // ADR 0192: "rejected and counted-but-not-booked shown beside it". The
  // pre-fill stays the ledger's 65; the two facts are said, never added in.
  const basis = receivingCountBasis({
    ...caseOrder,
    received: shelf({ rejectedAtDoorBottles: 1, countedNotBookedBottles: 12 }) as any,
  });
  expect(basis.prefillBottles).toBe(65);
  expect(basis.note).toContain("1 bottle was rejected at the door.");
  expect(basis.note).toContain(
    "12 bottles were counted at the door and are not on the shelf yet.",
  );
  expect(basis.note).toMatch(/Confirm the physical count\.$/);
});
it("ignores the retired column an older gateway sent", () => {
  // quantityReceived is no longer on the wire (ADR 0192); even if a stale
  // response carries it, the count starts from the ordered bottles.
  expect(
    receivingCountBasis({ ...caseOrder, quantityReceived: 5 } as any).prefillBottles,
  ).toBe(60);
});
it("says a failed ledger read, and starts from the ordered bottles", () => {
  const basis = receivingCountBasis({
    ...caseOrder,
    received: shelf({ readable: false, why: "timeout", quantityInStockUom: null }) as any,
  });
  expect(basis.prefillBottles).toBe(60);
  expect(basis.note).toContain("could not be read (timeout)");
});
it("does not invent the size of a case or a keg", () => {
  expect(
    receivingCountBasis({ ...base, quantity: 5, unitType: "case" })
      .orderedBottles,
  ).toBeNull();
  expect(
    receivingCountBasis({
      ...base,
      quantity: 1,
      bottlesTotal: 30,
      unitType: "keg",
    }).orderedBottles,
  ).toBeNull();
});
