/**
 * The text-sender module (ADR 0121, the parts the founder decided 2026-09-05).
 *
 * A MODULE OF ITS OWN, NOT A PROVIDER INSIDE `CommunicationsModule`, for the
 * same reason `RetentionModule` is one: `TeamModule` needs the send path for
 * the crew text, and `CommunicationsModule` sits on the
 * `auth -> communications -> auth` ring that Node closes at require time and no
 * `forwardRef` can open (the ReferenceError is recorded in
 * `communications.module.ts`'s own header). This module imports
 * `DatabaseModule`, `OrganizationsModule` and a `forwardRef` to `AuthModule`,
 * and nothing else.
 *
 * WHY `OrganizationsModule`. `assertCanManageRestaurant` is the one
 * implementation of "who may act for this house" (ADR 0114 closed G19 by making
 * the read posture and the write posture agree on it), and `IntegrationsModule`
 * already imports it for exactly this. A second copy of the role rule in this
 * module would be a second answer to the same question.
 *
 * WHY `AuthModule`. The routes are `@UseGuards(JwtAuthGuard)` and that guard
 * injects `TokenBlacklistService`. Behind a `forwardRef` because `AuthModule`
 * is on the existing ring; `check_gateway_boots.sh` is what proves the injector
 * resolves, since tsc and jest cannot see a Nest graph.
 *
 * `SmsService` is deliberately NOT imported. The deployment's shared Plivo
 * number must not be reachable from the house send path — see the header of
 * `text-sender.service.ts`.
 */

import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../../auth/auth.module";
import { OrganizationsModule } from "../../organizations/organizations.module";
import { CryptoModule } from "../../common/crypto/crypto.module";
import { SealModule } from "../../common/seal/seal.module";
import { BillingModule } from "../../billing/billing.module";
import { TextSenderService } from "./text-sender.service";
import { TextSendersController } from "./text-senders.controller";
import { TextCreditsController } from "./credits/text-credits.controller";
import { PurchaseIntentService } from "./credits/purchase-intent.service";
import { PurchaseIntentReconciler } from "./credits/purchase-intent.reconciler";
import { TextUsageService } from "./text-usage.service";
import { TextCredentialsService } from "./providers/text-credentials.service";
import { TextTransportRegistry } from "./providers/text-transport.registry";
import { TextDispatchService } from "./providers/text-dispatch.service";
import { TextConfigService } from "./text-config.service";
import { WhatsAppBookService } from "./inbound/whatsapp-book.service";
import { WhatsAppInboundService } from "./inbound/whatsapp-inbound.service";
import { WhatsAppWebhookController } from "./inbound/whatsapp-webhook.controller";
import { WhatsAppSendService } from "./whatsapp-send.service";

/**
 * WHY `CryptoModule`. A house's own provider token is stored encrypted the way
 * an OAuth refresh token is, and `TokenCryptoService` is the ONE implementation
 * of that (`common/crypto`). A second AES helper in this module would be a
 * second answer to "how is a secret at rest", and the two would drift on the
 * day one of them rotated a key format.
 *
 * WHY `SealModule`. `POST /communications/text-credits/purchase` changes what
 * the house is charged, which ADR 0107 puts behind a redeemed seal. Imported
 * rather than reimplemented, for the same reason `BillingModule` imports it.
 *
 * WHY `BillingModule`. `POST /communications/text-credits/purchase` charges the
 * house's card on file (founder, 2026-09-05), and `BillingService` is the one
 * implementation of "take money from this house" — it already holds the
 * customer lookup, the instrument mirror and the Stripe client. A second
 * charging path here would be a second answer to who is charged and on what.
 * Not circular: `BillingModule` imports Database, Auth, Organizations, its own
 * config module and Seal, and nothing in `communications`.
 *
 * WHY `ConfigModule`. The PLATFORM path's provider credential is a deployment
 * secret read from the environment and never stored per tenant, so
 * `TextCredentialsService` needs `ConfigService`.
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
    OrganizationsModule,
    CryptoModule,
    SealModule,
    BillingModule,
    ConfigModule,
  ],
  controllers: [
    TextSendersController,
    TextCreditsController,
    // PUBLIC, and it says so on every route. Meta calls it; the token it
    // carries instead of a JWT is `X-Hub-Signature-256` over the raw body.
    WhatsAppWebhookController,
  ],
  providers: [
    TextSenderService,
    TextUsageService,
    TextCredentialsService,
    TextTransportRegistry,
    PurchaseIntentService,
    PurchaseIntentReconciler,
    // The WhatsApp leg (ADR 0121 P1). `TextDispatchService` is the ONE place an
    // HTTP call to a message provider happens; the adapters and the registry
    // stay pure and `text-transport.spec.ts` still asserts they hold no HTTP
    // primitive.
    TextDispatchService,
    TextConfigService,
    WhatsAppBookService,
    WhatsAppInboundService,
    WhatsAppSendService,
  ],
  exports: [
    TextSenderService,
    TextUsageService,
    PurchaseIntentReconciler,
    WhatsAppSendService,
    WhatsAppBookService,
  ],
})
export class TextSendersModule {}
