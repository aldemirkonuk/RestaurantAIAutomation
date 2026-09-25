import { IsIn, IsObject, IsOptional, IsUUID, Matches } from "class-validator";
import { WineExtractItem } from "../wine-extract-item.interface";

/** The optional cadence tag a person may give a menu (ADR 0193, menu versions). */
export const MENU_CADENCES = ["weekly", "monthly", "quarterly", "yearly", "none"] as const;
export type MenuCadence = (typeof MENU_CADENCES)[number];

export class ImportMenuDto {
  @IsIn(["scan", "csv", "manual"])
  method: "scan" | "csv" | "manual";

  @IsObject()
  data: {
    imageBase64?: string; // for scan
    csvContent?: string; // for csv (text)
    fileBase64?: string; // for csv (binary .xlsx/.xls workbook)
    items?: WineExtractItem[]; // for manual
  };

  @IsUUID()
  restaurantId: string;

  /**
   * OPTIONAL (founder, 2026-09-21): how often this menu changes. Omitted =
   * not tagged; "none" = tagged as not recurring. Never defaulted.
   */
  @IsOptional()
  @IsIn(MENU_CADENCES as unknown as string[])
  cadence?: MenuCadence;

  /**
   * OPTIONAL (founder, 2026-09-21): the date this menu is for -- a day
   * (YYYY-MM-DD) or just a month (YYYY-MM). Never defaulted. It labels the
   * menu; it does not date its prices (the newest scan wins, ADR 0193).
   */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, {
    message: "menuDate is a day (YYYY-MM-DD) or a month (YYYY-MM).",
  })
  menuDate?: string;
}
