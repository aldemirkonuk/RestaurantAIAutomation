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
}

/**
 * The state of the provider itself, returned alongside the list.
 *
 * This is the field that stops an empty register from lying. "No cards on file"
 * and "no provider is connected, so no card can exist" render identically in any
 * UI that only counts rows; the page reads `connected` and says which one it is.
 */
export interface PaymentProviderState {
  id: "stripe";
  connected: boolean;
  /** Non-null exactly when `connected` is false. */
  reason: string | null;
}

export interface PaymentMethodsResponse {
  provider: PaymentProviderState;
  methods: PaymentMethodResponse[];
}
