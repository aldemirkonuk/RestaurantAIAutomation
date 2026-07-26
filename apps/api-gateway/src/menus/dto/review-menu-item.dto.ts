import { IsIn, IsString, IsNotEmpty } from "class-validator";

export const EDITABLE_MENU_ITEM_FIELDS = [
  "name",
  "producer",
  "category",
  "vintage",
  "region",
  "grape_variety",
  "by_glass_price",
  "bottle_price",
] as const;

export type EditableMenuItemField = (typeof EDITABLE_MENU_ITEM_FIELDS)[number];

export class ReviewMenuItemDto {
  @IsIn(EDITABLE_MENU_ITEM_FIELDS)
  fieldName: EditableMenuItemField;

  @IsString()
  @IsNotEmpty()
  newValue: string;
}
