import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import axios, { AxiosError, AxiosInstance } from "axios";
import * as crypto from "crypto";
import { StripeConfigService } from "./stripe-config.service";

/**
 * The Stripe wire, as four calls and nothing else.
 *
 * WHY NOT THE `stripe` SDK (ADR 0110, option 1.2)
 * -----------------------------------------------
 * Adding it means rewriting `pnpm-lock.yaml`, which three concurrent builders
 * share in this worktree and which both Vercel entry points install with
 * `--frozen-lockfile` (`vercel.json:3`, `apps/web/vercel.json:2`). That is a
 * deploy-wide risk taken for typings and pagination helpers we do not use. The
 * SDK also does not change the network path: the card is collected by
 * Stripe.js on Stripe's origin either way.
 *
 * THE CLIENT CANNOT EXPRESS A CHARGE
 * ----------------------------------
 * `FORBIDDEN_PATHS` throws before a request is built if a caller ever names
 * `payment_intents`, `charges`, `subscriptions`, `invoices`, `refunds`,
 * `transfers` or `payouts`. This build stops at "a card on file" because
 * pricing is OD-23 and open, and a guard in the transport is the version of
 * that promise that survives a future contributor who has not read the ADR.
 * It is a real assertion, not a comment: `stripe.client.spec.ts` proves it
 * throws and proves no HTTP call is made when it does.
 *
 * IDEMPOTENCY
 * -----------
 * Every POST carries an `Idempotency-Key`. Stripe replays the original
 * response for 24h on a repeat, so a retry after a socket timeout cannot mint
 * a second customer or a second SetupIntent for the same intent.
 */

export interface StripeCustomer {
  id: string;
  livemode: boolean;
}

export interface StripeSetupIntent {
  id: string;
  client_secret: string;
  status: string;
  livemode: boolean;
  payment_method: string | null;
}

export interface StripePaymentMethod {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  customer?: string | null;
  card?: {
    brand?: string | null;
    last4?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
    funding?: string | null;
  } | null;
  us_bank_account?: {
    bank_name?: string | null;
    last4?: string | null;
  } | null;
  [key: string]: unknown;
}

const STRIPE_BASE_URL = "https://api.stripe.com/v1";

/**
 * Paths this product must not be able to call. Named rather than allow-listed
 * on purpose: an allow-list of four would silently permit nothing new, but a
 * deny-list of the money-moving resources fails loudly at the exact moment
 * somebody adds a fifth call that takes money.
 */
const FORBIDDEN_PATHS = [
  "payment_intents",
  "charges",
  "subscriptions",
  "subscription_items",
  "invoices",
  "invoiceitems",
  "refunds",
  "transfers",
  "payouts",
  "checkout/sessions",
];

@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  private http: AxiosInstance | null = null;
  private httpForKey: string | null = null;

  constructor(private readonly config: StripeConfigService) {}

  /**
   * The axios instance, built lazily from the secret that is configured NOW.
   * Rebuilt when the key changes so a deployment that rotates its secret is
   * not served by a client holding the old one.
   */
  private client(): AxiosInstance {
    const secret = this.config.secretKey();
    if (!secret) {
      throw new ServiceUnavailableException(
        this.config.state().reason ??
          "No payment provider credential is configured in this deployment.",
      );
    }
    if (!this.http || this.httpForKey !== secret) {
      this.http = axios.create({
        baseURL: STRIPE_BASE_URL,
        timeout: 20_000,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": this.config.apiVersion(),
        },
      });
      this.httpForKey = secret;
    }
    return this.http;
  }

  /** Stripe's form encoding: `a[b]=c` for nesting, repeated `k[]=v` for lists. */
  static form(
    params: Record<string, unknown>,
    prefix = "",
  ): URLSearchParams {
    const out = new URLSearchParams();
    const walk = (value: unknown, key: string) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${key}[${i}]`));
      } else if (typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(v, `${key}[${k}]`);
        }
      } else {
        out.append(key, String(value));
      }
    };
    for (const [k, v] of Object.entries(params)) walk(v, prefix ? `${prefix}[${k}]` : k);
    return out;
  }

  private assertAllowed(path: string): void {
    const normalised = path.replace(/^\/+/, "").toLowerCase();
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalised === forbidden || normalised.startsWith(`${forbidden}/`)) {
        throw new Error(
          `StripeClient refuses to call /${normalised}: this product stops at "a card on file". ` +
            `Charging requires a price, and pricing is an open decision (OD-23). ` +
            `Removing this guard is a decision, not a refactor — see ADR 0110.`,
        );
      }
    }
  }

  private describe(error: unknown): string {
    const err = error as AxiosError<{ error?: { message?: string; code?: string } }>;
    const body = err?.response?.data?.error;
    if (body?.message) return body.code ? `${body.message} (${body.code})` : body.message;
    if (err?.response?.status) return `Stripe answered ${err.response.status}`;
    return err?.message ?? "Stripe could not be reached";
  }

  private async post<T>(
    path: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    this.assertAllowed(path);
    try {
      const { data } = await this.client().post<T>(
        `/${path.replace(/^\/+/, "")}`,
        StripeClient.form(params).toString(),
        {
          headers: {
            "Idempotency-Key":
              idempotencyKey ?? crypto.randomUUID(),
          },
        },
      );
      return data;
    } catch (error) {
      const message = this.describe(error);
      this.logger.error(`Stripe POST /${path} failed: ${message}`);
      throw new ServiceUnavailableException(`Stripe refused the request: ${message}`);
    }
  }

  private async get<T>(path: string, params: Record<string, unknown>): Promise<T> {
    this.assertAllowed(path);
    try {
      const { data } = await this.client().get<T>(`/${path.replace(/^\/+/, "")}`, {
        params,
      });
      return data;
    } catch (error) {
      const message = this.describe(error);
      this.logger.error(`Stripe GET /${path} failed: ${message}`);
      throw new ServiceUnavailableException(`Stripe refused the request: ${message}`);
    }
  }

  /**
   * The restaurant's identity at Stripe. `idempotencyKey` is the restaurant id
   * plus the key mode, so two racing tabs cannot mint two customers.
   */
  createCustomer(input: {
    name: string;
    email?: string | null;
    restaurantId: string;
    idempotencyKey: string;
  }): Promise<StripeCustomer> {
    return this.post<StripeCustomer>(
      "customers",
      {
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        metadata: {
          mudavym_restaurant_id: input.restaurantId,
        },
      },
      input.idempotencyKey,
    );
  }

  /**
   * A SetupIntent — permission to store an instrument, NOT a payment.
   * `usage: off_session` because the eventual use is a subscription charge the
   * operator will not be present for; `payment_method_types` is left to the
   * dashboard so enabling ACH is a Stripe setting, not a deploy.
   */
  createSetupIntent(input: {
    customerId: string;
    restaurantId: string;
    idempotencyKey?: string;
  }): Promise<StripeSetupIntent> {
    return this.post<StripeSetupIntent>(
      "setup_intents",
      {
        customer: input.customerId,
        usage: "off_session",
        metadata: { mudavym_restaurant_id: input.restaurantId },
      },
      input.idempotencyKey,
    );
  }

  retrieveSetupIntent(id: string): Promise<StripeSetupIntent> {
    return this.get<StripeSetupIntent>(`setup_intents/${encodeURIComponent(id)}`, {});
  }

  async listPaymentMethods(customerId: string): Promise<StripePaymentMethod[]> {
    const page = await this.get<{ data: StripePaymentMethod[] }>("payment_methods", {
      customer: customerId,
      limit: 100,
    });
    return Array.isArray(page?.data) ? page.data : [];
  }

  retrievePaymentMethod(id: string): Promise<StripePaymentMethod> {
    return this.get<StripePaymentMethod>(
      `payment_methods/${encodeURIComponent(id)}`,
      {},
    );
  }

  detachPaymentMethod(id: string): Promise<{ id: string }> {
    return this.post<{ id: string }>(
      `payment_methods/${encodeURIComponent(id)}/detach`,
      {},
      `detach:${id}`,
    );
  }

  /** Which instrument Stripe should reach for first on this customer. */
  setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<StripeCustomer> {
    return this.post<StripeCustomer>(
      `customers/${encodeURIComponent(customerId)}`,
      {
        invoice_settings: { default_payment_method: paymentMethodId },
      },
      `default:${customerId}:${paymentMethodId}`,
    );
  }
}
