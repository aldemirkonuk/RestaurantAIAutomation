import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { RawMailRetentionService } from "../communications/retention/raw-mail-retention.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { hashCallArgs } from "../common/seal/seal-token";
import { INTEGRATION_DEFINITIONS, IntegrationId, MIRRORING_INTEGRATION_IDS } from "./integrations-oauth.constants";
import { IntegrationConsentAuthorizeDto, IntegrationConsentChallengeDto } from "./integration-consent.dto";
import { IntegrationsOauthService } from "./integrations-oauth.service";

/** The snapshot is the page's only source of consent words and retention facts. */
@Injectable()
export class IntegrationConsentService {
  constructor(
    private readonly oauth: IntegrationsOauthService,
    private readonly retention: RawMailRetentionService,
    private readonly seals: SealChallengeService,
  ) {}

  async disclosure(integrationId: IntegrationId, restaurantId: string) {
    const definition = INTEGRATION_DEFINITIONS[integrationId];
    const status = this.oauth.availability()[integrationId];
    const mirrorsMail = MIRRORING_INTEGRATION_IDS.includes(integrationId);
    const snapshot = {
      version: 1 as const,
      integration: {
        ...definition,
        mirrorsMail,
        available: status.available,
        unavailableReason: status.reason ?? null,
      },
      statements: {
        personalAccount: "You are granting access to your own account.",
        providerNext: `${definition.providerLabel} will ask you to confirm on their own screen next.`,
        tokenStorage: "Access tokens are encrypted before they are stored.",
        revocation: "You can revoke this permission from your personal connections in Profile or Settings.",
        retentionCadence: "The stored retention window is reviewed by the quarterly derivation. The figure below names the window currently in force.",
      },
      retention: mirrorsMail && status.available ? await this.retention.disclosureFor(restaurantId) : null,
    };
    return { ...snapshot, digest: hashCallArgs(snapshot) };
  }

  private async binding(params: {
    integrationId: IntegrationId; restaurantId: string; userId: string;
    browserOrigin: string | undefined; body: IntegrationConsentChallengeDto;
  }) {
    const disclosure = await this.disclosure(params.integrationId, params.restaurantId);
    if (!disclosure.integration.available) {
      throw new ServiceUnavailableException(disclosure.integration.unavailableReason);
    }
    if (disclosure.digest !== params.body.disclosureDigest) {
      throw new ConflictException({
        message: "The permission words or retention facts changed. Read the current disclosure and hold again.",
        code: "consent_changed", disclosure,
      });
    }
    const frontendOrigin = this.oauth.consentFrontendOrigin(params.browserOrigin);
    const returnPath = this.oauth.safeReturnPath(params.body.returnPath);
    const { digest, ...snapshot } = disclosure;
    return {
      snapshot, digest, frontendOrigin, returnPath,
      seal: {
        restaurantId: params.restaurantId,
        actorUserId: params.userId,
        subjectKind: "integration_grant" as const,
        // A grant does not exist yet. The person is the subject; the integration
        // and house are also bound in the arguments, never trusted from a URL.
        subjectId: params.userId,
        action: "authorize",
        args: {
          integrationId: params.integrationId,
          restaurantId: params.restaurantId,
          disclosureDigest: digest,
          browserProofHash: params.body.browserProofHash,
          browserRequestId: params.body.browserRequestId,
          frontendOrigin, returnPath,
          providerTarget: this.oauth.authorizationTarget(params.integrationId),
        },
      },
    };
  }

  async challenge(params: Parameters<IntegrationConsentService["binding"]>[0]) {
    const binding = await this.binding(params);
    return this.seals.issue(binding.seal);
  }

  async authorize(params: Omit<Parameters<IntegrationConsentService["binding"]>[0], "body"> & {
    body: IntegrationConsentAuthorizeDto;
  }) {
    const binding = await this.binding(params);
    const { sealId } = await this.seals.redeem({ ...binding.seal, challenge: params.body.challenge });
    return this.oauth.createAuthorizationUrl({
      userId: params.userId, restaurantId: params.restaurantId,
      integrationId: params.integrationId, returnPath: binding.returnPath,
      consent: {
        sealId, snapshot: binding.snapshot, digest: binding.digest,
        frontendOrigin: binding.frontendOrigin,
        browserProofHash: params.body.browserProofHash,
        browserRequestId: params.body.browserRequestId,
      },
    });
  }
}
