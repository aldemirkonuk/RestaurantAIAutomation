import { IsOptional, IsString, IsUrl, IsUUID, MaxLength } from "class-validator";

/**
 * POST /menus/import-url (DD-r108-66). The house comes from the session, never
 * from the body: `restaurantId` is accepted because the onboarding client
 * (#2252) sends it as /menus/import does, and the global ValidationPipe
 * (forbidNonWhitelisted) would refuse an unknown property, but it is IGNORED.
 */
export class ImportMenuUrlDto {
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "The link starts with https:// and names a web address." })
  url: string;

  @IsOptional()
  @IsUUID()
  restaurantId?: string;
}
