import { receivingCountBasis } from "../receivingCountBasis";
const base = { id: "o1", status: "DELIVERED" };
it("counts 5 twelve-bottle cases as 60 individual bottles, with no guessed cached received unit", () => {
  expect(
    receivingCountBasis({
      ...base,
      quantity: 5,
      bottlesTotal: 60,
      unitType: "case",
      quantityReceived: 60,
      quantityReceivedUom: null,
    }),
  ).toMatchObject({ orderedBottles: 60, prefillBottles: 60 });
});
it("keeps an explicitly stated partial bottle count", () => {
  expect(
    receivingCountBasis({
      ...base,
      quantity: 5,
      bottlesTotal: 60,
      unitType: "case",
      quantityReceived: 58,
      quantityReceivedUom: "bottle",
    }).prefillBottles,
  ).toBe(58);
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
