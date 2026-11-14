import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * Whether this house's prices hold tax, and whether it reclaims the tax it
 * pays (ADR 0359 C2/C3, lane 3.5a). Every house reads `unset` until a person
 * answers here; until then every lot is costed as its paper prints it.
 *
 * Explicit, never derived: no basis from the country, no write on a read, no
 * way back to `unset`. Both answers at once, and a no-VAT house reclaims none.
 * `tax_basis_since` is the database trigger's (founder F2: no backfill).
 * Audited, or the caller is told it was not. The role check is the
 * controller's `assertCanManageRestaurant`.
 */

export const TAX_BASES = ["prices_include_tax", "prices_exclude_tax", "not_vat_charging"] as const;
export type StatedTaxBasis = (typeof TAX_BASES)[number];
export type HouseTaxBasis = StatedTaxBasis | "unset";

/** The action string this service files. Also in `SETTINGS_AUDIT_ACTIONS`. */
export const TAX_BASIS_AUDIT_ACTION = "house_tax_basis_changed" as const;

export interface HouseTaxBasisReadout {
  restaurantId: string;
  /** `unset` means nobody has answered: every lot is costed as printed. */
  basis: HouseTaxBasis;
  /** Null when not answered. Always false for a house that charges no VAT. */
  reclaimsInputTax: boolean | null;
  /** The first answer's moment; deliveries verified from then on use it. */
  since: string | null;
  statedAt: string | null;
  statedBy: { userId: string; name: string | null } | null;
  /** False when the row could not be READ. Never conflated with `unset`. */
  readable: boolean;
  reason: string | null;
  /** Present on a write only. `false` means the change happened, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  tax_basis: string | null;
  reclaims_input_tax: boolean | null;
  tax_basis_since: string | null;
  tax_basis_set_at: string | null;
  tax_basis_set_by: string | null;
}

const isStated = (v: unknown): v is StatedTaxBasis =>
  typeof v === "string" && (TAX_BASES as readonly string[]).includes(v);

@Injectable()
export class HouseTaxBasisService {
  private readonly logger = new Logger(HouseTaxBasisService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseTaxBasisReadout> {
    const house = await this.readHouse(restaurantId);
    if (house.error !== null) {
      return {
        restaurantId,
        basis: "unset",
        reclaimsInputTax: null,
        since: null,
        statedAt: null,
        statedBy: null,
        readable: false,
        reason: house.error,
      };
    }
    const row = house.row;
    const basis: HouseTaxBasis = isStated(row?.tax_basis) ? row!.tax_basis as StatedTaxBasis : "unset";
    const by = basis !== "unset" && row?.tax_basis_set_by ? row.tax_basis_set_by : null;
    return {
      restaurantId,
      basis,
      reclaimsInputTax:
        basis === "unset" ? null : basis === "not_vat_charging" ? false : typeof row?.reclaims_input_tax === "boolean" ? row.reclaims_input_tax : null,
      since: basis === "unset" ? null : row?.tax_basis_since ?? null,
      statedAt: basis === "unset" ? null : row?.tax_basis_set_at ?? null,
      statedBy: by ? { userId: by, name: await this.nameOf(by) } : null,
      readable: true,
      reason: null,
    };
  }

  async write(
    restaurantId: string,
    basis: unknown,
    reclaims: unknown,
    actorUserId: string,
  ): Promise<HouseTaxBasisReadout> {
    if (!isStated(basis)) {
      throw new BadRequestException(
        `${JSON.stringify(basis ?? null)} is not an answer this product knows. Send "prices_include_tax", "prices_exclude_tax" or "not_vat_charging". Nothing was recorded.`,
      );
    }
    let reclaimsInputTax: boolean;
    if (basis === "not_vat_charging") {
      if (reclaims === true) {
        throw new BadRequestException(
          "A house that charges no VAT has no VAT to reclaim, so it cannot reclaim the tax it pays. Nothing was recorded.",
        );
      }
      if (reclaims != null && reclaims !== false) {
        throw new BadRequestException("Whether the house reclaims tax is a yes or a no. Nothing was recorded.");
      }
      reclaimsInputTax = false;
    } else {
      if (typeof reclaims !== "boolean") {
        throw new BadRequestException(
          "Say whether the house reclaims the tax it pays on its purchases (yes or no). Its stock is costed before tax only if it does. Nothing was recorded.",
        );
      }
      reclaimsInputTax = reclaims;
    }
    if (!actorUserId) {
      throw new BadRequestException("No signed-in person was attached to the answer, so nothing was recorded.");
    }

    const before = await this.readHouse(restaurantId);
    if (before.error !== null) {
      // The previous answer is part of what is written to the trail, and the
      // switch date rule needs the row. Unlike the currency, nothing is
      // written on a row that could not be read.
      throw new InternalServerErrorException(
        "The house's current tax answer could not be read, so nothing was changed.",
      );
    }
    const prevBasis = isStated(before.row?.tax_basis) ? before.row!.tax_basis : "unset";
    const prevReclaims = prevBasis === "unset" ? null : before.row?.reclaims_input_tax ?? null;

    if (prevBasis === basis && prevReclaims === reclaimsInputTax) {
      // Nothing changed: the author and moment of the answer stay true.
      const same = await this.read(restaurantId);
      return { ...same, audited: false, auditReason: "nothing changed" };
    }

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        tax_basis: basis,
        reclaims_input_tax: reclaimsInputTax,
        tax_basis_set_by: actorUserId,
        tax_basis_set_at: new Date().toISOString(),
      })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(`Could not record the tax answer for ${restaurantId}: ${error.message}`);
      throw new InternalServerErrorException("Could not record the tax answer. Nothing was changed.");
    }

    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: TAX_BASIS_AUDIT_ACTION,
      register: "tax-basis",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "tax basis",
      fields: {
        tax_basis: { from: prevBasis, to: basis },
        reclaims_input_tax: { from: prevReclaims, to: reclaimsInputTax },
      },
    });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readHouse(restaurantId: string): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("tax_basis, reclaims_input_tax, tax_basis_since, tax_basis_set_at, tax_basis_set_by")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Could not read the tax answer for ${restaurantId}: ${error.message}`);
      return { row: null, error: "the house's tax answer could not be read just now" };
    }
    return { row: (data as HouseRow | null) ?? null, error: null };
  }

  /** `public.users.user_id` — never an `auth.users` id; the two are disjoint. */
  private async nameOf(userId: string): Promise<string | null> {
    const { data, error } = await this.databaseService.client
      .from("users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return (data as { name?: string | null } | null)?.name ?? null;
  }
}
