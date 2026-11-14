import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsString, MaxLength } from "class-validator";

/**
 * The menu dishes to put on the list, by the names the person was shown
 * (r28 onboarding audit, gap 1, slice 3). 500 is past any menu's dishes.
 */
export class AddMenuDishesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  names!: string[];
}
