import { IsIn, IsObject, IsUUID } from "class-validator";
import { WineExtractItem } from "../wine-extract-item.interface";

export class ImportMenuDto {
  @IsIn(["scan", "csv", "manual"])
  method: "scan" | "csv" | "manual";

  @IsObject()
  data: {
    imageBase64?: string; // for scan
    csvContent?: string; // for csv
    items?: WineExtractItem[]; // for manual
  };

  @IsUUID()
  restaurantId: string;
}
