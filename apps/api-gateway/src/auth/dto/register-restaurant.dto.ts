import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterRestaurantDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @MinLength(8) password: string;
  @IsString() restaurantName: string;
  @IsString() address: string;
  @IsString() city: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() cuisineType?: string;
  @IsOptional() @IsString() timezone?: string;
}
