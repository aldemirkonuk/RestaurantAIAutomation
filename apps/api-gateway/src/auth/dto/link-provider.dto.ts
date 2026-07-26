import { IsString, MinLength } from "class-validator";

export class LinkProviderDto {
  @IsString()
  @MinLength(1)
  token: string;
}
