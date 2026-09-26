import { validate } from "class-validator";
import { AuthController } from "./auth.controller";
import {
  RegisterAccountDto,
  RegisterGoogleAccountDto,
} from "./dto/register-account.dto";
import { CreateFirstHouseDto } from "./dto/create-first-house.dto";

jest.mock("bcrypt", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe("arrival registration contract", () => {
  it("keeps account registration account-only", async () => {
    const dto = Object.assign(new RegisterAccountDto(), {
      name: "Selin Kaya",
      email: "selin@example.com",
      password: "long-enough",
      restaurantName: "must not be accepted",
    });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
    expect(
      (dto as RegisterAccountDto & { restaurantName?: string }).restaurantName,
    ).toBeUndefined();
  });

  it("requires the first house address and accepts inferred money and zone", async () => {
    const dto = Object.assign(new CreateFirstHouseDto(), {
      restaurantName: "Meyhane",
      address: "1 House Street",
      city: "Istanbul",
      country: "Türkiye",
      currency: "TRY",
      timezone: "Europe/Istanbul",
    });
    expect(await validate(dto)).toHaveLength(0);

    const missingAddress = Object.assign(new CreateFirstHouseDto(), {
      restaurantName: "Meyhane",
      city: "Istanbul",
      country: "Türkiye",
    });
    expect(
      (await validate(missingAddress)).some((e) => e.property === "address"),
    ).toBe(true);
  });

  it("uses a validated token DTO for Google registration", async () => {
    expect(
      (await validate(Object.assign(new RegisterGoogleAccountDto(), {}))).some(
        (e) => e.property === "token",
      ),
    ).toBe(true);
  });

  it("delegates house creation to the authenticated user only", async () => {
    const auth = {
      createFirstHouse: jest.fn().mockResolvedValue({
        accessToken: "access",
        refreshToken: "refresh",
        restaurantId: "house",
      }),
    };
    const controller = new AuthController(auth as any);
    const dto = Object.assign(new CreateFirstHouseDto(), {
      restaurantName: "Meyhane",
      address: "1 House Street",
      city: "Istanbul",
      country: "Türkiye",
    });
    await controller.createFirstHouse(
      { user: { userId: "person" } } as any,
      dto,
    );
    // The third argument carries the session's auth_time (ADR 0229); a
    // request with none carries null, never "now".
    expect(auth.createFirstHouse).toHaveBeenCalledWith("person", dto, null);
  });
});
