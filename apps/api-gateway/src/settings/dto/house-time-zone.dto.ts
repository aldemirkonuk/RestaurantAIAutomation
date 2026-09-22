import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

/**
 * The one field of `PUT /settings/time-zone` (ADR 0207, round 3).
 *
 * Only the TYPE is checked here. Whether the string names a zone is checked in
 * `HouseTimeZoneService` (`notAZoneBecause`), against the zones this server's
 * `Intl` knows, so the sentence a refusal prints is the service's and the list
 * is never copied into a decorator.
 */
export class SetHouseTimeZoneDto {
  @ApiProperty({
    description:
      "An IANA time zone, exactly as the list names it — Europe/Istanbul, America/Los_Angeles. It decides where midnight falls for every on-time verdict of this house.",
    example: "Europe/Istanbul",
  })
  @IsString({
    message:
      "A time zone is an IANA name such as Europe/Istanbul. None was sent, so nothing was recorded.",
  })
  zone: string;
}
