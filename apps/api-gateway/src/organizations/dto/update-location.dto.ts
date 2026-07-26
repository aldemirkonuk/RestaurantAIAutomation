import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  chainId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** Billing / restaurant contact email (manager+ only) */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Billing / restaurant contact phone (manager+ only) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}
