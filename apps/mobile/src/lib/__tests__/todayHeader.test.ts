import { todayHeader } from "../todayHeader";

// F-675: Today never said which house was open.
it("names the open house under the greeting", () => {
  expect(
    todayHeader({ hour: 19, userName: "Ayla Demir", houseName: "Meyhouse" }),
  ).toEqual({ greeting: "Evening, Ayla", house: "Meyhouse" });
});

it("names no house until the houses are read", () => {
  expect(todayHeader({ hour: 9, userName: null, houseName: null })).toEqual({
    greeting: "Morning",
    house: null,
  });
});

it("keeps the afternoon greeting", () => {
  expect(todayHeader({ hour: 14, userName: "Ayla" }).greeting).toBe(
    "Afternoon, Ayla",
  );
});
