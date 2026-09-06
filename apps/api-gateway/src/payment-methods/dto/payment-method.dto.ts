import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export const PAYMENT_KINDS = [
  "card",
  "bank_account",
  "apple_pay",
  "invoice",
  /**
   * The register offers four kinds; Stripe has roughly thirty types. Filing an
   * unmapped instrument as `card` because `card` is the closest would be a
   * quiet lie about something that will be charged, so it is filed as `other`
   * and `providerType` carries the provider's own word for it, which the page
   * prints verbatim. Added with the provider path (ADR 0110, migration
   * 20260903110000).
   */
  "other",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/**
 * What a provider hands back after it has taken the instrument — never what the
 * customer typed. There is no PAN field, no CVC field and no address field on
 * this DTO, and the table has nowhere to put one.
 *
 * `providerRef` is required and has no default, which is the structural reason
 * this endpoint cannot be used to invent an instrument: a reference only a
 * provider can mint has to be supplied, and no provider is connected.
 */
export class CreatePaymentMethodDto {
  @IsIn(PAYMENT_KINDS as unknown as string[])
  kind!: PaymentKind;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: "last4 must be exactly four digits" })
  last4?: string;

  @IsOptional()
  @Matches(/^(0[1-9]|1[0-2])\/[0-9]{4}$/, {
    message: "exp must be MM/YYYY",
  })
  exp?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsString()
  @MaxLength(255)
  providerRef!: string;
}

/** One row of the Payment register, as the browser receives it. */
export interface PaymentMethodResponse {
  id: string;
  kind: PaymentKind;
  brand: string | null;
  last4: string | null;
  exp: string | null;
  isDefault: boolean;
  provider: string;
  createdAt: string;
  /**
   * The provider's own type string, verbatim ("card", "us_bank_account",
   * "link", …). Null on a row written before the provider path existed.
   */
  providerType: string | null;
  /**
   * When this row was last confirmed against the provider. Every field above
   * except the id is a CACHED COPY of the provider's answer, so without this
   * the page would assert a present tense it cannot support. Null means never
   * confirmed since it was written.
   */
  syncedAt: string | null;
  /**
   * Whether the provider reported this instrument under a LIVE key. Null when
   * unknown. A test instrument must never be presented as chargeable.
   */
  livemode: boolean | null;
}

/** Which key this deployment is holding, from the key's own prefix. */
export type StripeMode = "test" | "live" | "unknown";

/**
 * The state of the provider itself, returned alongside the list.
 *
 * This is the field that stops an empty register from lying. "No cards on file"
 * and "no provider is connected, so no card can exist" render identically in any
 * UI that only counts rows; the page reads `connected` and says which one it is.
 *
 * EVERY FIELD BELOW `reason` WAS ADDED WITH THE PROVIDER PATH (ADR 0110)
 * ---------------------------------------------------------------------
 * One boolean told the operator that something was missing and never which
 * thing. Three secrets can be absent and they live in two different processes,
 * so each is named. `mode` comes from the secret key's own prefix rather than
 * from a separate variable that could disagree with the key it describes.
 *
 * `webhookLastReceivedAt` is the one that earns its place: a webhook secret
 * being SET is not a webhook working — the endpoint still has to be registered
 * at Stripe — and if it never was, everything looks healthy until a card is
 * removed at the provider and this register goes on showing it. Null therefore
 * reads as "configured, never delivered", and `webhookReason` says so in words.
 */
export interface PaymentProviderState {
  id: "stripe";
  connected: boolean;
  /** Non-null exactly when `connected` is false. */
  reason: string | null;
  /** Null when no secret key is set at all. */
  mode: StripeMode | null;
  secretKeyPresent: boolean;
  webhookSecretPresent: boolean;
  /** The Stripe API version this deployment is pinned to. */
  apiVersion: string;
  /**
   * When a signed delivery last arrived. NULL IS NOT HEALTH — it means no
   * delivery has ever been authenticated by this deployment.
   */
  webhookLastReceivedAt: string | null;
  webhookLastEventType: string | null;
  /** Null exactly when a delivery is on record. Otherwise it says why not. */
  webhookReason: string | null;
}

export interface PaymentMethodsResponse {
  provider: PaymentProviderState;
  methods: PaymentMethodResponse[];
}
