import { IsIn, IsString, IsNotEmpty, MaxLength } from "class-validator";

export const EDITABLE_MENU_ITEM_FIELDS = [
  "name",
  "producer",
  "category",
  "vintage",
  "region",
  "grape_variety",
  "by_glass_price",
  "bottle_price",
  // r108 menu-g10: the printed description. Marks are not editable: they are
  // what the menu prints, read from it, never typed in as a claim.
  "description",
] as const;

export type EditableMenuItemField = (typeof EDITABLE_MENU_ITEM_FIELDS)[number];

export class ReviewMenuItemDto {
  @IsIn(EDITABLE_MENU_ITEM_FIELDS)
  fieldName: EditableMenuItemField;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  newValue: string;
}
