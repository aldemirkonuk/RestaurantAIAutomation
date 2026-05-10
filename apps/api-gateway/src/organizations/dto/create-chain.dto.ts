import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateChainDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  cuisine_type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  restaurantId?: string;
}
