import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  stateProvince?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  cuisineType?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsUUID()
  chainId?: string;
}
