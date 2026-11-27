import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import { CAP } from "./house-opening";

const base = {
  email: "owner@example.com",
  password: "longenough",
  restaurantName: "The Oak Room",
  address: "1 Main St",
  city: "Chicago",
  country: "US",
};

const nameMessages = async (name: unknown) => {
  const errors = await validate(
    plainToInstance(RegisterRestaurantDto, { ...base, name }),
  );
  const e = errors.find((x) => x.property === "name");
  return e ? Object.values(e.constraints ?? {}) : [];
};

describe("RegisterRestaurantDto.name messages", () => {
  it("a missing name is never called too long", async () => {
    const messages = await nameMessages(undefined);
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).not.toMatch(/longer than/);
      expect(m).not.toMatch(/must be a string/);
      expect(m).toMatch(/needed/);
    }
  });

  it("a 300-character name is too long, and only that", async () => {
    expect(await nameMessages("a".repeat(300))).toEqual([CAP.person.message]);
  });

  it("255 characters is kept", async () => {
    expect(await nameMessages("a".repeat(255))).toEqual([]);
  });
});
