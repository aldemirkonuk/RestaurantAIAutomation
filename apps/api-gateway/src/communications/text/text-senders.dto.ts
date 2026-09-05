import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * The bodies `/communications/text-senders` accepts.
 *
 * NO FIELD HERE TAKES A SECRET, and that is a rule rather than an omission. A
 * house's WhatsApp credential arrives as a provider-issued token through Meta's
 * own Embedded Signup window, and a provider subaccount credential is an API
 * key the house's own provider mints. Neither ever passes through a form on
 * this platform, and a DTO with a `password` or `authToken` field would be the
 * invitation to make it do so.
 */

const CHANNELS = ["whatsapp", "sms"] as const;

export class DeclareOwnSenderDto {
  @ApiProperty({ enum: CHANNELS })
  @IsIn(CHANNELS as unknown as string[])
  channel: "whatsapp" | "sms";

  @ApiProperty({
    description:
      "ISO 3166-1 alpha-2 market the sender is registered for. It decides the entire rule set: a US 10DLC campaign, a Turkish Sender ID, or WhatsApp with no SMS registration at all.",
    example: "TR",
  })
  @Matches(/^[A-Z]{2}$/)
  market: string;

  @ApiProperty({
    description:
      "The number in E.164, or the alphanumeric Sender ID. Alphanumeric IDs are one-way and are not supported in the US or Canada; the database refuses that combination.",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  identity: string;

  @ApiProperty({ enum: ["e164", "alphanumeric"] })
  @IsIn(["e164", "alphanumeric"])
  identityKind: "e164" | "alphanumeric";

  @ApiPropertyOptional({
    description:
      "What a recipient sees. Meta reviews it, and a declined display name caps the sender at 250 messages per 24 hours — so this is a fact about deliverability, not a label.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ description: "meta_cloud_api, twilio, …" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @ApiPropertyOptional({
    description:
      "A POINTER to the encrypted credential record. Never the credential itself; there is no field on this platform that accepts one.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vaultSecretRef?: string;
}

export class RequestRegistrationDto {
  @ApiProperty({ enum: CHANNELS })
  @IsIn(CHANNELS as unknown as string[])
  channel: "whatsapp" | "sms";

  @ApiProperty({ example: "US" })
  @Matches(/^[A-Z]{2}$/)
  market: string;

  @ApiProperty({
    description:
      "The legal business name EXACTLY as it appears on the tax record. A marketing name is the single most common brand rejection.",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName: string;

  @ApiProperty()
  @IsString()
  @MinLength(4)
  @MaxLength(400)
  registeredAddress: string;

  @ApiPropertyOptional({
    description:
      "A REFERENCE to the tax id, not the number. This platform records that the house supplied one and where it lives; it does not need to hold an EIN or a vergi kimlik numarası to know a registration is possible.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  taxIdRef?: string;

  @ApiPropertyOptional({
    description:
      "A live, publicly reachable site. A staging URL or a 404 is a rejection, because a reviewer opens it.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  websiteUrl?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  contactName: string;

  @ApiProperty()
  @IsEmail()
  contactEmail: string;

  @ApiProperty({
    description:
      "What the house will actually send. Vague use cases are rejected; the registrar compares it against the samples.",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(600)
  useCase: string;

  @ApiProperty({
    description:
      "At least two real sample messages that match the use case, each carrying an opt-out line.",
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  sampleMessages: string[];

  @ApiProperty({
    description:
      "The opt-in flow written out: the method, the message frequency, the 'message and data rates may apply' disclosure, and a publicly reachable link or screenshot. The registrar's own field is 40 to 2049 characters and it is the most common reason a campaign is refused.",
  })
  @IsString()
  @MinLength(40)
  @MaxLength(2049)
  optInDescription: string;
}

export class RevokeSenderDto {
  @ApiProperty()
  @IsUUID()
  senderId: string;

  @ApiProperty({
    description:
      "Why. Kept on the row: a sender that was stopped without a reason is a fact nobody can act on later.",
  })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason: string;
}

export class TextConsentDto {
  @ApiProperty({
    description:
      "The number YOU agree to be reached at. It is stored on the consent rather than read off your profile, so changing your profile number never silently re-points a consent.",
  })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone: string;

  @ApiProperty({ enum: ["whatsapp", "sms", "any"] })
  @IsIn(["whatsapp", "sms", "any"])
  channel: "whatsapp" | "sms" | "any";
}
