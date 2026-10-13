import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";

export class AddMenuItemDto {
  @IsUUID()
  menuId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  producer?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  vintage?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  grape_variety?: string;

  @IsOptional()
  @IsNumber()
  by_glass_price?: number;

  @IsOptional()
  @IsNumber()
  bottle_price?: number;

  /**
   * The line's kind, the person's own word (ADR 0340 rule 7): a dessert wine
   * added to a Desserts menu is a drink only when it is told so (F-1530).
   * Absent: a line sent with a dish `price` is a dish; otherwise no kind is
   * stored and lineIsDrink judges it by its menu, as before.
   */
  @IsOptional()
  @IsIn(["drink", "dish"])
  line_kind?: "drink" | "dish";

  /** A dish's one price (rule 7); never sent with a bottle or glass price. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
