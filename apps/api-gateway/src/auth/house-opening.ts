import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { registerDecorator, type ValidationOptions } from "class-validator";

/**
 * Opening a house (`AuthService.createFirstHouse`, and the public
 * `AuthService.registerRestaurant`) in the owner's words: what a failed write
 * is called, and how a place another house already holds is told apart from
 * every other duplicate (F-006, ADR 0265's 2026-10-03 amendment).
 */

/** A failed write inside a house opening, keeping the database's own code. */
export class HouseWriteError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** supabase-js resolves a refused write as `{ code, message, ... }`, never a throw. */
export function houseWriteError(
  step: string,
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): HouseWriteError {
  return new HouseWriteError(
    step,
    error?.code ?? "",
    error?.message || fallback,
  );
}

/**
 * The partial unique index on `restaurants.google_place_id`. The quotes are
 * part of the match: PostgreSQL quotes the name in a 23505's message, and an
 * index whose name merely starts the same is another rule.
 */
export const SHARED_PLACE_INDEX = '"idx_restaurants_google_place_id"';

/** What one house-row insert answers; supabase-js resolves a refusal too. */
export type HouseRowAnswer = {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
};

/** True only for a 23505 on the place index, never a slug or email duplicate. */
export function isSharedPlace(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "23505" &&
    typeof error.message === "string" &&
    error.message.includes(SHARED_PLACE_INDEX)
  );
}

export const HOUSE_DETAIL_TOO_LONG =
  "Could not open the house: one of its details is too long to keep. Shorten it and try again.";
export const HOUSE_NOT_OPENED =
  "Could not open the house. Something went wrong on our side; try again in a moment.";

/**
 * The one refusal both openings send. The raw code and message go to the
 * server log only; the response carries a fixed sentence, so it can name no
 * constraint, index or other house.
 */
export function refuseHouseOpening(
  where: string,
  error: unknown,
  logger: Pick<Logger, "error">,
): HttpException {
  const step = error instanceof HouseWriteError ? error.step : "a later step";
  const code = error instanceof HouseWriteError ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  logger.error(
    `${where} rolled back at ${step}: ${code || "no code"} ${message}`,
  );
  if (["23514", "22001"].includes(code))
    return new BadRequestException(HOUSE_DETAIL_TOO_LONG);
  return new InternalServerErrorException(HOUSE_NOT_OPENED);
}

/** `restaurants.slug` is varchar(100); the base leaves room for "-" and six hex. */
export const HOUSE_SLUG_BASE_MAX = 90;

/** "The Oak Room" → "the-oak-room", never longer than HOUSE_SLUG_BASE_MAX. */
export function slugBase(restaurantName: string): string {
  return restaurantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, HOUSE_SLUG_BASE_MAX)
    .replace(/-+$/, "");
}

export function tooLong(label: string, max: number): string {
  return `${label} is longer than ${max} characters, so nothing was recorded. Shorten it and try again.`;
}

/**
 * Each sign-up field's cap, at its column: the restaurant name is 249 because
 * the organization is named `${restaurantName} Group` in varchar(255). The keys
 * are short so a decorated DTO field stays on one line, which the mobile
 * contract test reads (`apps/mobile/src/auth/__tests__/authContract.test.ts`).
 */
export const CAP = {
  name: { message: tooLong("The restaurant name", 249) },
  city: { message: tooLong("The city", 100) },
  state: { message: tooLong("The state or province", 100) },
  neighborhood: { message: tooLong("The neighborhood", 100) },
  country: { message: tooLong("The country", 100) },
  postal: { message: tooLong("The postal code", 20) },
  phone: { message: tooLong("The phone number", 50) },
} satisfies Record<string, ValidationOptions>;

/** ADR 0265: the CHECK on `restaurants.google_place_id`, in bytes (F1, locked 2026-10-03). */
export const GOOGLE_PLACE_ID_MAX_BYTES = 2048;
export const PLACE_ID_TOO_LONG =
  "The place picked from the list is longer than we can keep, so nothing was recorded. Type the address in yourself instead of picking it from the list.";

/**
 * A bound in UTF-8 bytes. `@MaxLength` counts characters, and class-validator's
 * `@IsByteLength` throws on a lone surrogate (a 500 instead of a 400).
 */
export function FitsInBytes(
  max: number,
  message: string,
  options?: ValidationOptions,
) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: "fitsInBytes",
      target: object.constructor,
      propertyName,
      options: { ...options, message },
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value !== "string" || Buffer.byteLength(value, "utf8") <= max
          );
        },
      },
    });
  };
}
