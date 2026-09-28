import { IsString, IsUUID, Matches, MaxLength } from "class-validator";

export class IntegrationConsentChallengeDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  disclosureDigest!: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  browserProofHash!: string;

  @IsUUID("4")
  browserRequestId!: string;

  @IsString() @MaxLength(2048)
  returnPath!: string;
}

export class IntegrationConsentAuthorizeDto extends IntegrationConsentChallengeDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  challenge!: string;
}

export class IntegrationConsentCompleteDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/)
  state!: string;

  @IsString() @Matches(/^[a-f0-9]{64}$/)
  browserProof!: string;
}
