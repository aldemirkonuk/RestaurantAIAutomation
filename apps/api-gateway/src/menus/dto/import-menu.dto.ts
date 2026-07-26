import { IsIn, IsObject, IsUUID } from "class-validator";
import { WineExtractItem } from "../wine-extract-item.interface";

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
}
