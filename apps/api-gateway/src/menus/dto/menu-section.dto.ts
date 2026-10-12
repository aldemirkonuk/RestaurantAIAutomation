import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { MENU_CATEGORY_VOCABULARY } from "../wine-extract-item.interface";

/**
 * The bodies of the section routes under `/menu-versions/:menuId` (ADR 0340
 * rules 6, 9, 10, 18; lane 3b). The house is the session's, never a body
 * field; every id here is looked up inside that house.
 */

/** The longest section title the review takes. */
const TITLE_MAX = 120;
/** The most lines one request may move into a section. */
const LINES_MAX = 2000;

export const MENU_KINDS_A_SECTION_MOVES_TO = [
  "beverage",
  "food",
  "desserts",
] as const;
export const LINE_KINDS = ["drink", "dish"] as const;

export class CreateMenuSectionDto {
  @ApiProperty({
    description: "The section's name as the house wants it shown.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  title: string;

  @ApiPropertyOptional({
    description: "The section it sits inside; omitted or null = the top level.",
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({
    description:
      "A drink category for the section (one of the 0186 vocabulary). Only on a draft.",
    enum: MENU_CATEGORY_VOCABULARY,
  })
  @IsOptional()
  @IsIn(MENU_CATEGORY_VOCABULARY as unknown as string[])
  drinkCategory?: string | null;
}

export class RenameMenuSectionDto {
  @ApiProperty({
    description:
      "The new name. The section's key stays, so the name carries to the next upload.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  title: string;
}

export class ReparentMenuSectionDto {
  @ApiProperty({
    description:
      "The new parent section on the same menu, or null for the top level.",
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId: string | null;
}

export class ReorderMenuSectionsDto {
  @ApiPropertyOptional({
    description:
      "The parent whose sections are reordered; omitted or null = the top level.",
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    description: "Every section under that parent, in the new order.",
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINES_MAX)
  @IsUUID("all", { each: true })
  ids: string[];
}

export class MoveMenuSectionDto {
  @ApiProperty({
    description: "The kind the section moves to.",
    enum: MENU_KINDS_A_SECTION_MOVES_TO,
  })
  @IsIn(MENU_KINDS_A_SECTION_MOVES_TO as unknown as string[])
  kind: (typeof MENU_KINDS_A_SECTION_MOVES_TO)[number];
}

export class SetMenuSectionCategoryDto {
  @ApiProperty({
    description:
      "The section's drink category, or null to clear it. Only on a draft.",
    enum: MENU_CATEGORY_VOCABULARY,
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null)
  @IsIn(MENU_CATEGORY_VOCABULARY as unknown as string[])
  drinkCategory: string | null;
}

export class ConfirmMenuSectionDto {
  @ApiProperty({
    description: "Whether the section's lines are drinks or dishes.",
    enum: LINE_KINDS,
  })
  @IsIn(LINE_KINDS as unknown as string[])
  lineKind: (typeof LINE_KINDS)[number];

  @ApiPropertyOptional({
    description:
      "For drinks, the category they are filed under. Never on dishes.",
    enum: MENU_CATEGORY_VOCABULARY,
  })
  @IsOptional()
  @IsIn(MENU_CATEGORY_VOCABULARY as unknown as string[])
  drinkCategory?: string | null;
}

/** One line's kind, and for a drink an optional category of its own. */
export class ConfirmMenuLineDto extends ConfirmMenuSectionDto {}

export class AssignMenuLinesDto {
  @ApiProperty({
    description: "The section the lines go into, or null for Unsorted.",
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  sectionId: string | null;

  @ApiProperty({ description: "The lines, all on this menu.", type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LINES_MAX)
  @IsUUID("all", { each: true })
  lineIds: string[];
}
