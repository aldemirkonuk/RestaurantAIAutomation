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

  // Minted server-side only when the provider callback parks a code (KL audit
  // D1), never chosen by the sealer up front the way browserProof is. A
  // dishonest sealer who forwards the provider URL holds the proof but never
  // this — it travels only in the redirect fragment to whichever browser
  // actually returns from the provider — so completion needs both.
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  deliverySecret!: string;
}
