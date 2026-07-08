import { IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  chainId?: string | null;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  city?: string;
}
