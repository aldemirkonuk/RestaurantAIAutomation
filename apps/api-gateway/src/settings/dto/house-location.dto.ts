import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsString, MaxLength } from "class-validator";

/**
 * The body of `PUT /settings/location` (F-174): the street address and the map
 * point picked with it from the address search.
 *
 * Only the TYPES are checked here. Whether the pair is a real point (finite,
 * in range, both present) and whether the street says anything is checked in
 * `HouseLocationService` (`notALocationBecause`), so the sentence a refusal
 * prints is the service's and a direct call to the service is held to the same
 * rule as the route.
 */
export class SetHouseLocationDto {
  @ApiProperty({
    description:
      "The street address, as the address search returned it — 12 Rıhtım Caddesi. Kept on the house as `address.street`, the shape sign-up writes.",
    example: "12 Rıhtım Caddesi",
  })
  @IsString({
    message:
      "An address is a line of text. None was sent, so nothing was recorded.",
  })
  @MaxLength(300, {
    message:
      "That address is longer than 300 characters, so nothing was recorded.",
  })
  street: string;

  @ApiProperty({
    description:
      "Latitude of the place picked, in degrees (−90 to 90). Sent with the longitude, never alone.",
    example: 40.9905,
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    {
      message:
        "The map point needs a latitude, and none was sent. Pick the address from the search list; nothing was recorded.",
    },
  )
  latitude: number;

  @ApiProperty({
    description:
      "Longitude of the place picked, in degrees (−180 to 180). Sent with the latitude, never alone.",
    example: 29.0253,
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    {
      message:
        "The map point needs a longitude, and none was sent. Pick the address from the search list; nothing was recorded.",
    },
  )
  longitude: number;
}
