import { apiClient, getActiveRestaurantId } from "./client";

export type ProviderTier =
  | "cloud"
  | "enterprise"
  | "partner_gated"
  | "regional_tr"
  | "universal";

export type AdapterStatus = "available" | "partial" | "scaffolded" | "planned";

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

export interface PosProvidersResponse {
  summary: {
    total: number;
    byTier: Record<string, number>;
    byStatus: Record<string, number>;
  };
  providers: PosProviderMeta[];
}

export interface PosStatusResponse {
  /**
   * True when the `pos_checks` read FAILED. `sources` is then null, not an
   * empty array — a dead read and a quiet integration are different answers
   * and must not render the same. ADR 0067.
   */
  unavailable?: boolean;
  totalChecks?: number | null;
  sources?: Array<{
    source: string;
    checks?: number;
    open?: number;
    latest?: string | null;
    providerName?: string;
  }> | null;
  [key: string]: unknown;
}

export async function getPosProviders(): Promise<PosProvidersResponse> {
  const { data } =
    await apiClient.get<PosProvidersResponse>("/pos-hub/providers");
  return data;
}

export async function getPosStatus(
  restaurantId?: string,
): Promise<PosStatusResponse> {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error("No restaurant ID available");
  const { data } = await apiClient.get<PosStatusResponse>(
    `/pos-hub/status/${id}`,
  );
  return data;
}

// ===========================================================================
// The mapping surface (POS lens defects 1-2).
//
// Every route below has existed and worked on the gateway since the SimPOS
// testbed landed; none of them had a caller. The SPA reached exactly two
// pos-hub routes — `providers` and `status` — so a closed check queued its
// lines in `pos_unresolved_lines` and stayed there until someone worked the
// API by hand with curl. Measured on Sim Meyhouse: 44 checks, 99 lines, 39
// open queue rows, 0 bottles moved without manual intervention.
// ===========================================================================

/** `unmapped` = we do not know what the button is. `no_sale_volume` = we do, but not how much one sale removes. */
export type UnresolvedReason = "unmapped" | "no_sale_volume";

export interface UnresolvedLineGroup {
  source: string;
  external_item_id: string | null;
  item_name: string;
  reason: UnresolvedReason | string;
  mapped_inventory_id: string | null;
  occurrences: number;
  qty_total: number;
  revenue_total: number;
  first_seen: string | null;
  last_seen: string | null;
  line_ids: string[];
}

export interface UnresolvedLinesResponse {
  restaurant_id: string;
  summary: {
    open_lines: number;
    distinct_items: number;
    unmapped: number;
    no_sale_volume: number;
    qty_total: number;
    revenue_total: number;
    /** The read hit its cap: the counts are a floor, not a total. */
    truncated: boolean;
  };
  items: UnresolvedLineGroup[];
}

export interface PosMatchProposal {
  id: string;
  source: string;
  external_item_id: string;
  item_name: string;
  candidate_inventory_id: string | null;
  candidate_master_wine_id: string | null;
  confidence: number | null;
  match_method: string;
  status: string;
  created_at: string;
}

export interface PosItemMapping {
  id: string;
  source: string;
  external_item_id: string | null;
  item_name: string | null;
  is_wine: boolean;
  inventory_id: string | null;
  master_wine_id: string | null;
  sale_unit: string | null;
  sale_volume_ml: number | null;
  updated_at: string | null;
}

export interface ApproveProposalAnswer {
  proposal_id: string;
  /** Open label — reporting only. Omitted means "not answered", never "bottle". */
  sale_unit?: string | null;
  /** The millilitres depletion actually reads (ADR 0011). */
  sale_volume_ml?: number | null;
}

export interface ApproveBatchResponse {
  requested: number;
  approved: number;
  failed: number;
  results: Array<{ proposal_id: string; ok: boolean; error?: string }>;
}

function requireRestaurant(restaurantId?: string): string {
  const id = restaurantId || getActiveRestaurantId();
  if (!id) throw new Error("No restaurant ID available");
  return id;
}

export async function getUnresolvedLines(
  restaurantId?: string,
): Promise<UnresolvedLinesResponse> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.get<UnresolvedLinesResponse>(
    `/pos-hub/unresolved/${id}`,
  );
  return data;
}

export async function getMatchProposals(
  restaurantId?: string,
  status = "pending",
): Promise<PosMatchProposal[]> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.get<PosMatchProposal[]>(
    `/pos-hub/catalog-match/${id}/proposals`,
    { params: { status } },
  );
  return data;
}

export async function getItemMappings(
  restaurantId?: string,
): Promise<PosItemMapping[]> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.get<PosItemMapping[]>(
    `/pos-hub/mappings/${id}`,
  );
  return data;
}

/** Pull the POS catalog and re-match it against inventory. */
export async function runCatalogMatch(
  restaurantId?: string,
  source = "simpos",
): Promise<{
  pulled: number;
  alreadyMapped: number;
  autoMapped: unknown[];
  proposed: unknown[];
}> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.post(`/pos-hub/catalog-match/${id}`, {
    source,
  });
  return data;
}

/**
 * Confirm identity AND sale unit in one step, for as many buttons as the owner
 * ticked. One request, not one per wine: the per-proposal route makes the
 * default 100-requests-per-60s limit a function of menu size.
 */
export async function approveProposals(
  items: ApproveProposalAnswer[],
  restaurantId?: string,
): Promise<ApproveBatchResponse> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.post<ApproveBatchResponse>(
    `/pos-hub/catalog-match/${id}/proposals/approve`,
    { items },
  );
  return data;
}

export async function rejectProposal(
  proposalId: string,
  restaurantId?: string,
): Promise<{ rejected: boolean }> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.post(
    `/pos-hub/catalog-match/${id}/proposals/${proposalId}/reject`,
    {},
  );
  return data;
}

/** Answer the sale unit for a mapping that already exists (the `no_sale_volume` queue). */
export async function setSaleUnits(
  items: Array<{ mapping_id: string; sale_unit: "glass" | "bottle" }>,
  restaurantId?: string,
): Promise<{
  results: Array<{ mapping_id: string; ok: boolean; error?: string }>;
}> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.post(`/pos-hub/mappings/${id}/sale-unit`, {
    items,
  });
  return data;
}

/** Map a button straight onto an inventory row, unit and all — no proposal needed. */
export async function upsertMapping(
  mapping: {
    source?: string;
    external_item_id?: string;
    item_name?: string;
    is_wine: boolean;
    inventory_id?: string | null;
    master_wine_id?: string | null;
    sale_unit?: string | null;
    sale_volume_ml?: number | null;
  },
  restaurantId?: string,
): Promise<PosItemMapping> {
  const id = requireRestaurant(restaurantId);
  const { data } = await apiClient.post<PosItemMapping>(
    `/pos-hub/mappings/${id}`,
    mapping,
  );
  return data;
}
