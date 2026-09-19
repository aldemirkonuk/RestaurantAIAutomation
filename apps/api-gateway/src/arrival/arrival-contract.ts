import { BadRequestException } from "@nestjs/common";
import { isIso4217 } from "../common/iso-4217";
import { REGISTER_IDS } from "../cellar/cellar-registers";

export const FOLIOS = [
  "evidence",
  "currency",
  "pour",
  "vendors",
  "notifications",
  "assistant",
] as const;
export type Folio = (typeof FOLIOS)[number];
export type Provenance = "typed" | "spoken" | "inferred" | "invoice" | "menu";
export type Target =
  | "currency"
  | "cellar"
  | "threshold"
  | "vendor_terms"
  | "vendor_currency"
  | "notifications"
  | "menu_item";
export interface ConfigurationInput {
  target: Target;
  field: string;
  value: unknown;
  subjectId?: string;
}
export interface ConfigurationRow extends ConfigurationInput {
  id: string;
  provenance: Exclude<Provenance, "typed">;
  before: unknown;
  beforeValue: unknown;
  evidenceId?: string;
  status:
    | "pending"
    | "applying"
    | "written"
    | "refused"
    | "not_attempted"
    | "unconfirmed"
    | "undone";
  reason: string | null;
  result?: unknown;
  after?: unknown;
}
export interface ConfigurationBatch {
  id: string;
  restaurant_id: string;
  user_id: string;
  revision: number;
  status: "draft" | "applying" | "applied" | "undoing" | "undone";
  rows: ConfigurationRow[];
  created_at: string;
  sealed_at: string | null;
  undo_until: string | null;
}
export function folioFor(target: Target): Folio {
  return (
    {
      menu_item: "evidence",
      currency: "currency",
      cellar: "pour",
      threshold: "pour",
      vendor_terms: "vendors",
      vendor_currency: "vendors",
      notifications: "notifications",
    } as const
  )[target];
}
export function rowKey(row: ConfigurationInput): string {
  return `${row.target}:${row.subjectId ?? ""}:${row.field}`;
}
export function sameValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, stable(v)]),
          )
        : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** Closed configuration vocabulary. Credentials, autonomy, roles and spending
 * authority cannot be reached by a forged proposal (ADR0113 rule2). */
export function validateConfiguration(
  input: ConfigurationInput,
): ConfigurationInput {
  const fail = () => {
    throw new BadRequestException(
      "This is not a supported configuration value. Nothing was recorded.",
    );
  };
  if (!input || typeof input !== "object") return fail();
  const { target, field, value, subjectId } = input;
  const boolean = () => typeof value === "boolean";
  const integer = (max: number) =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;
  const text = (max: number) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max;
  if (target === "vendor_terms" || target === "vendor_currency") {
    if (
      typeof subjectId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        subjectId,
      )
    )
      return fail();
  } else if (subjectId !== undefined) return fail();
  let valid = false;
  if (target === "currency" || target === "vendor_currency")
    valid =
      field === "code" &&
      typeof value === "string" &&
      /^[A-Z]{3}$/.test(value) &&
      isIso4217(value);
  if (target === "cellar")
    valid = (REGISTER_IDS as readonly string[]).includes(field) && boolean();
  if (target === "threshold") valid = field === "thresholdMin" && integer(999);
  if (target === "vendor_terms") {
    valid =
      field === "paymentTerms"
        ? text(200)
        : field === "notes"
          ? text(2000)
          : field === "leadTimeDays"
            ? integer(365)
            : field === "orderCutoffOffsetDays"
              ? integer(14)
              : field === "minimumOrderAmount"
                ? typeof value === "number" &&
                  Number.isFinite(value) &&
                  value >= 0 &&
                  value <= 1e9
                : field === "orderCutoffTime"
                  ? typeof value === "string" &&
                    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
                  : field === "deliveryWeekdays"
                    ? Array.isArray(value) &&
                      value.length <= 7 &&
                      value.every(
                        (v) => Number.isInteger(v) && v >= 0 && v <= 6,
                      ) &&
                      new Set(value).size === value.length
                    : false;
  }
  if (target === "notifications") {
    valid = [
      "email",
      "push",
      "sms",
      "quietHours.enabled",
      "categories.inventory",
      "categories.orders",
      "categories.calendar",
      "categories.system",
      "categories.ai",
    ].includes(field)
      ? boolean()
      : ["quietHours.startTime", "quietHours.endTime"].includes(field)
        ? typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
        : false;
  }
  if (target === "menu_item") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail();
    const item = value as Record<string, unknown>;
    const textFields = [
      "name",
      "producer",
      "category",
      "vintage",
      "region",
      "grape_variety",
    ];
    const priceFields = ["by_glass_price", "bottle_price"];
    valid =
      typeof item.name === "string" &&
      item.name.trim().length > 0 &&
      Object.entries(item).every(([key, entry]) =>
        textFields.includes(key)
          ? typeof entry === "string" && entry.length <= 300
          : priceFields.includes(key)
            ? typeof entry === "number" &&
              Number.isFinite(entry) &&
              entry >= 0 &&
              entry <= 1e7
            : false,
      );
  }
  if (!valid) return fail();
  return { target, field, value, ...(subjectId ? { subjectId } : {}) };
}
