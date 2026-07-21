/**
 * POS Hub — canonical contracts.
 *
 * EVERY POS provider (Toast, Square, Clover, Simpra, ElektraWeb, a CSV
 * export...) normalizes into `CanonicalCheck`, and the hub writes it to the
 * `pos_checks` table. Analytics only ever reads pos_checks — adding a new POS
 * is writing one adapter, never touching analytics.
 */

export interface CanonicalItem {
  /** Display name as sold ("Ribeye", "Caymus Cabernet glass"). */
  name: string;
  /** POS-side item/catalog id when available (for pos_item_mappings). */
  externalItemId?: string | null;
  category?: string | null;
  qty: number;
  /** Unit price in major currency units (dollars/lira), not cents. */
  price: number;
  /** Resolved by the hub via pos_item_mappings + heuristics. */
  is_wine?: boolean;
  master_wine_id?: string | null;
}

export interface CanonicalCheck {
  /** Check/order id in the source POS — dedupe key with (restaurant, source). */
  externalCheckId: string;
  openedAt: string; // ISO
  closedAt?: string | null; // null = still open (live/hot-table analytics)
  /** Source POS table reference — resolved against restaurant_tables.pos_refs
   *  or label. */
  tableRef?: string | null;
  serverExternalId?: string | null;
  serverName?: string | null;
  covers?: number | null;
  subtotal?: number | null;
  total?: number | null;
  tip?: number | null;
  items: CanonicalItem[];
  /** Untouched source payload for audit/debug. */
  raw?: unknown;
}

export type ProviderTier =
  | "cloud" // Tier 1 — public APIs, best ROI
  | "enterprise" // Tier 2 — chains, partner/API access slower
  | "partner_gated" // Tier 3 — legacy, partner agreements required
  | "regional_tr" // Türkiye market leaders
  | "universal"; // works with anything (webhook / file)

export type AdapterStatus =
  | "available" // works today with zero external credentials
  | "partial" // some data flows exist (e.g. Toast item mappings)
  | "scaffolded" // normalizer written & tested; needs API credentials
  | "planned"; // registry entry only

export interface PosProviderMeta {
  key: string;
  name: string;
  tier: ProviderTier;
  status: AdapterStatus;
  region: "global" | "us" | "eu" | "tr";
  apiStyle: "rest" | "webhook" | "partner" | "file";
  authModel: "oauth2" | "api_key" | "partner_agreement" | "none";
  docsUrl?: string;
  notes?: string;
  capabilities: {
    checks: boolean;
    items: boolean;
    tables: boolean;
    employees: boolean;
    webhooks: boolean;
  };
}
