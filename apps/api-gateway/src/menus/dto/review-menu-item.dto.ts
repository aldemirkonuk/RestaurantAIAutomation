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
  // A dish's one price (ADR 0340 rule 7). Which price a line takes is its
  // stored kind's: the service refuses a bottle or glass price on a dish and
  // this price on anything else (F-1530).
  "price",
] as const;

export type EditableMenuItemField = (typeof EDITABLE_MENU_ITEM_FIELDS)[number];

export class ReviewMenuItemDto {
  @IsIn(EDITABLE_MENU_ITEM_FIELDS)
  fieldName: EditableMenuItemField;

  @IsString()
  @IsNotEmpty()
  newValue: string;
}
