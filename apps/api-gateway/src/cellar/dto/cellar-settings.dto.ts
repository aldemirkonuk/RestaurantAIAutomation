import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from "class-validator";
import { HOLD_CEREMONIES, type HoldCeremony } from "./hold-ceremony";

/**
 * Both fields optional, both nullable-through-omission: a write is a PATCH of
 * whichever choice the caller is changing, not a full replace of the row —
 * the settings screen shows two independent controls and either can be saved
 * on its own without the other reverting to a default it never asked for.
 */
export class SetCellarSettingsDto {
  @ApiPropertyOptional({ enum: HOLD_CEREMONIES })
  @IsOptional()
  @IsIn(HOLD_CEREMONIES)
  holdCeremony?: HoldCeremony;

  /**
   * Ordered tile ids for "In the building tonight". The vocabulary is the
   * gateway's read model, not a DB CHECK — an id this build does not
   * recognise is dropped by the service (never written, never crashes the
   * request) so an older client can never wedge a newer one's id in, or vice
   * versa. Omit the field to leave the stored choice unchanged; send `[]` to
   * choose "show none" explicitly.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  gazetteerMeasures?: string[];
}
