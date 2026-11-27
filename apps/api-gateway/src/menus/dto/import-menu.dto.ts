import { IsBoolean, IsIn, IsObject, IsOptional, IsUUID, Matches } from "class-validator";
import { WineExtractItem } from "../wine-extract-item.interface";

/** The optional cadence tag a person may give a menu (ADR 0193, menu versions). */
export const MENU_CADENCES = ["weekly", "monthly", "quarterly", "yearly", "none"] as const;
export type MenuCadence = (typeof MENU_CADENCES)[number];

export class ImportMenuDto {
  @IsIn(["scan", "csv", "manual"])
  method: "scan" | "csv" | "manual";

  @IsObject()
  data: {
    imageBase64?: string; // for scan: one photo or one PDF
    /**
     * For scan: several photos of ONE menu, in page order (founder 2026-11-07,
     * "One upload = one version"). Joined into one PDF by the gateway, at most
     * MAX_MENU_PAGES (parsers/pages-to-pdf.ts).
     */
    images?: string[];
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

  /**
   * OPTIONAL: read these bytes again even though this house already read the
   * same file. Without it, a resend reopens the earlier read (not billed twice).
   */
  @IsOptional()
  @IsBoolean()
  readAgain?: boolean;
}
