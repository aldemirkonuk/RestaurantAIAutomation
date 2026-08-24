import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  AUTO_MATCH_THRESHOLD,
  SUGGEST_THRESHOLD,
  normalizeDescription,
  trigramSimilarity,
} from "../procurement/documents/line-matcher";
import { PosHubService } from "./pos-hub.service";

/**
 * Catalog matcher — SimPOS testbed plan, decisions D32-39.
 *
 * "POS owns what is sellable; WineOps owns cost and stock. Pull, auto-map,
 * queue the rest." Pulls the POS-side catalog (today only the `simpos`
 * source is wired — a real Toast/Square catalog pull is a future adapter,
 * not in scope here), matches every item against `restaurant_inventory`
 * through three ranked tiers, and never silently overwrites: auto-map only
 * at >=0.9 confidence and only when unambiguous (decision 34); everything
 * else lands in `pos_catalog_match_proposals` for a human to confirm
 * (decision 32/38).
 */

export interface PosCatalogPullItem {
  externalItemId: string;
  itemName: string;
  producer?: string | null;
  vintage?: number | null;
  sizeMl?: number | null;
  category?: string | null;
}

interface InventoryCandidate {
  inventoryId: string;
  masterWineId: string | null;
  wineName: string;
  producer: string | null;
  vintage: number | null;
  sizeMl: number | null;
  posSku: string | null;
  sku: string | null;
  internalSku: string | null;
  skuAliases: string[];
}

type MatchMethod = "external_id" | "sku" | "trigram";

/**
 * A catalog *pull* source and a sales *delivery* source are different
 * namespaces, and conflating them silently defeats this whole module.
 *
 * SimPOS's catalog is pulled as `simpos`, but its closed checks arrive over
 * the canonical adapter at `/pos-hub/webhook/generic_webhook/:restaurantId`
 * — there is no `simpos` entry in the provider registry at all. Because
 * PosHubService.loadItemMappings() filters `source IN (arrivingSource, '*')`,
 * a mapping stamped `simpos` is invisible to every inbound sale: the item
 * resolves to no inventory row and falls through to `pos_unresolved_lines`,
 * no matter how many proposals a human approves. Stamp the mapping with the
 * source sales actually arrive under, not the one the catalog was read from.
 */
const SALES_SOURCE_BY_PULL_SOURCE: Record<string, string> = {
  simpos: "generic_webhook",
};

function salesSourceFor(pullSource: string): string {
  return SALES_SOURCE_BY_PULL_SOURCE[pullSource] ?? pullSource;
}

interface ScoredMatch {
  candidate: InventoryCandidate;
  confidence: number;
  method: MatchMethod;
  ambiguous: boolean;
}

export interface CatalogMatchSummary {
  source: string;
  pulled: number;
  alreadyMapped: number;
  autoMapped: Array<{
    externalItemId: string;
    itemName: string;
    inventoryId: string;
    confidence: number;
  }>;
  proposed: Array<{
    externalItemId: string;
    itemName: string;
    confidence: number | null;
    method: MatchMethod;
  }>;
}

@Injectable()
export class CatalogMatcherService {
  private readonly logger = new Logger(CatalogMatcherService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly posHub: PosHubService,
  ) {}

  /**
   * Pull the POS catalog for `source`, match every unmapped item against
   * WineOps inventory, auto-map the confident+unambiguous ones, and queue
   * the rest as review proposals.
   */
  async pullAndMatch(
    restaurantId: string,
    source: string,
  ): Promise<CatalogMatchSummary> {
    const items = await this.pullPosCatalog(restaurantId, source);
    const candidates = await this.loadInventoryCandidates(restaurantId);
    const alreadyMapped = await this.loadAlreadyMappedExternalIds(
      restaurantId,
      source,
    );

    const summary: CatalogMatchSummary = {
      source,
      pulled: items.length,
      alreadyMapped: 0,
      autoMapped: [],
      proposed: [],
    };

    for (const item of items) {
      if (alreadyMapped.has(item.externalItemId)) {
        summary.alreadyMapped++;
        continue;
      }

      const best = this.matchOne(item, candidates);

      if (best && !best.ambiguous && best.confidence >= AUTO_MATCH_THRESHOLD) {
        await this.posHub.upsertItemMapping(restaurantId, {
          source: salesSourceFor(source),
          external_item_id: item.externalItemId,
          item_name: item.itemName,
          category: item.category ?? null,
          is_wine: true,
          master_wine_id: best.candidate.masterWineId,
          inventory_id: best.candidate.inventoryId,
        });
        summary.autoMapped.push({
          externalItemId: item.externalItemId,
          itemName: item.itemName,
          inventoryId: best.candidate.inventoryId,
          confidence: best.confidence,
        });
        this.logger.log(
          `Auto-mapped ${item.itemName} (${item.externalItemId}) -> inventory ${best.candidate.inventoryId} [${best.method}, ${best.confidence.toFixed(2)}]`,
        );
        continue;
      }

      // Suggested-but-unconfirmed, or no candidate at all — either way this
      // is a review-queue row, never a silent write (decision 38).
      await this.queueProposal(
        restaurantId,
        source,
        item,
        best?.candidate.inventoryId ?? null,
        best?.candidate.masterWineId ?? null,
        best?.confidence ?? null,
        best?.method ?? "trigram",
      );
      summary.proposed.push({
        externalItemId: item.externalItemId,
        itemName: item.itemName,
        confidence: best?.confidence ?? null,
        method: best?.method ?? "trigram",
      });
    }

    return summary;
  }

  // ===========================================================================
  // POS-side pull
  // ===========================================================================

  private async pullPosCatalog(
    restaurantId: string,
    source: string,
  ): Promise<PosCatalogPullItem[]> {
    if (source !== "simpos") {
      throw new Error(
        `Catalog pull for source '${source}' is not implemented — only 'simpos' is wired in this testbed.`,
      );
    }
    const db = this.dbService.getClient();
    const { data, error } = await db
      .from("simpos_catalog")
      .select("external_item_id, wine_name, producer, vintage, size_ml")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      externalItemId: row.external_item_id,
      itemName: row.wine_name,
      producer: row.producer ?? null,
      vintage: row.vintage ?? null,
      sizeMl: row.size_ml ?? null,
    }));
  }

  // ===========================================================================
  // WineOps-side candidates
  // ===========================================================================

  private async loadInventoryCandidates(
    restaurantId: string,
  ): Promise<InventoryCandidate[]> {
    const inventory = await this.dbService.getRestaurantInventory(restaurantId);
    return (inventory || []).map((inv: any) => {
      const wine = inv.master_wine_library || {};
      const aliases = Array.isArray(inv.sku_aliases)
        ? inv.sku_aliases.filter((a: unknown) => typeof a === "string")
        : [];
      return {
        inventoryId: inv.id,
        masterWineId: inv.master_wine_id ?? null,
        wineName: inv.wine_name || wine.name || "",
        producer: wine.producer ?? null,
        vintage: inv.vintage ?? wine.vintage ?? null,
        sizeMl: inv.bottle_size_ml ?? null,
        posSku: inv.pos_sku ?? null,
        sku: inv.sku ?? null,
        internalSku: inv.internal_sku ?? null,
        skuAliases: aliases,
      };
    });
  }

  private async loadAlreadyMappedExternalIds(
    restaurantId: string,
    source: string,
  ): Promise<Set<string>> {
    const db = this.dbService.getClient();
    const { data, error } = await db
      .from("pos_item_mappings")
      .select("external_item_id")
      .eq("restaurant_id", restaurantId)
      .in("source", [source, "*"])
      .not("inventory_id", "is", null);
    if (error) throw new Error(error.message);
    return new Set((data || []).map((r: any) => r.external_item_id));
  }

  // ===========================================================================
  // Matching, tiers per decision 33: external item id exact, vendor SKU
  // exact, normalized-name trigram, then unmatched.
  // ===========================================================================

  private matchOne(
    item: PosCatalogPullItem,
    candidates: InventoryCandidate[],
  ): ScoredMatch | null {
    const scored: Array<{
      candidate: InventoryCandidate;
      confidence: number;
      method: MatchMethod;
    }> = [];

    for (const c of candidates) {
      const score = this.scorePair(item, c);
      if (score) scored.push(score);
    }
    if (scored.length === 0) return null;

    scored.sort((a, b) => b.confidence - a.confidence);
    const top = scored[0];
    // Decision 34: a wrong link is worse than no link — two candidates tied
    // at the top score means the identity is genuinely ambiguous, not just
    // uncertain, so this never auto-maps regardless of the raw score.
    const ambiguous =
      scored.length > 1 &&
      Math.abs(scored[1].confidence - top.confidence) < 1e-6;

    return { ...top, ambiguous };
  }

  private scorePair(
    item: PosCatalogPullItem,
    inv: InventoryCandidate,
  ): {
    candidate: InventoryCandidate;
    confidence: number;
    method: MatchMethod;
  } | null {
    const externalId = (item.externalItemId || "").trim();

    // 1. External item id exact — the POS's own identifier already recorded
    // against this inventory row (e.g. a previous manual mapping, or a real
    // POS's menu-item GUID captured in pos_sku).
    if (externalId && inv.posSku && inv.posSku === externalId) {
      return { candidate: inv, confidence: 0.99, method: "external_id" };
    }

    // 2. Vendor/internal SKU exact — the same identifier space, just not the
    // POS-specific field (CSV imports, internal codes, known aliases).
    const skuCandidates = [inv.sku, inv.internalSku, ...inv.skuAliases].filter(
      Boolean,
    );
    if (externalId && skuCandidates.includes(externalId)) {
      return { candidate: inv, confidence: 0.97, method: "sku" };
    }

    // 3. Normalized-name trigram, vintage/size disambiguated exactly as
    // line-matcher.ts treats a document/order pair: leaving the vintage in
    // the text would make two years of the same wine look less alike than
    // two unrelated wines, and a vintage/size mismatch is a substitution
    // that must never auto-apply.
    const itemText = `${item.itemName} ${item.producer ?? ""}`;
    const invText = `${inv.wineName} ${inv.producer ?? ""}`;
    const ni = normalizeDescription(itemText);
    const nv = normalizeDescription(invText);
    const textScore = trigramSimilarity(ni.normalized, nv.normalized);
    if (textScore < SUGGEST_THRESHOLD) return null;

    const itemVintage = item.vintage ?? ni.vintage;
    const invVintage = inv.vintage ?? nv.vintage;
    const itemSize = item.sizeMl ?? ni.formatMl;
    const invSize = inv.sizeMl ?? nv.formatMl;
    const vintageDiffers =
      itemVintage != null && invVintage != null && itemVintage !== invVintage;
    const sizeDiffers =
      itemSize != null && invSize != null && itemSize !== invSize;
    const substitution = vintageDiffers || sizeDiffers;

    const base = Math.min(0.88, textScore);
    const confidence = substitution ? base * 0.85 : base;
    if (confidence < SUGGEST_THRESHOLD) return null;

    return { candidate: inv, confidence, method: "trigram" };
  }

  // ===========================================================================
  // Review queue — decision 38: every change lands as a reviewable delta,
  // never a silent overwrite. Manual read-then-write rather than upsert()
  // because the table's dedupe index is partial (WHERE status='pending'),
  // which supabase-js's upsert cannot target.
  // ===========================================================================

  private async queueProposal(
    restaurantId: string,
    source: string,
    item: PosCatalogPullItem,
    candidateInventoryId: string | null,
    candidateMasterWineId: string | null,
    confidence: number | null,
    method: MatchMethod,
  ): Promise<void> {
    const db = this.dbService.getClient();
    const { data: existing, error: findError } = await db
      .from("pos_catalog_match_proposals")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("source", source)
      .eq("external_item_id", item.externalItemId)
      .eq("status", "pending")
      .maybeSingle();
    if (findError) throw new Error(findError.message);

    const row = {
      restaurant_id: restaurantId,
      source,
      external_item_id: item.externalItemId,
      item_name: item.itemName,
      candidate_inventory_id: candidateInventoryId,
      candidate_master_wine_id: candidateMasterWineId,
      confidence,
      match_method: method,
    };

    if (existing) {
      const { error } = await db
        .from("pos_catalog_match_proposals")
        .update(row)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("pos_catalog_match_proposals")
        .insert(row);
      if (error) throw new Error(error.message);
    }
  }

  // ===========================================================================
  // Review queue reads/writes exposed to the controller.
  // ===========================================================================

  async listProposals(restaurantId: string, status = "pending") {
    const db = this.dbService.getClient();
    const { data, error } = await db
      .from("pos_catalog_match_proposals")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", status)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  /** A human confirms a proposal: writes the mapping and closes the queue row. */
  async approveProposal(restaurantId: string, proposalId: string) {
    const db = this.dbService.getClient();
    const { data: proposal, error } = await db
      .from("pos_catalog_match_proposals")
      .select("*")
      .eq("id", proposalId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (error || !proposal) throw new Error("Proposal not found");
    if (!proposal.candidate_inventory_id)
      throw new Error("Proposal has no candidate inventory item to approve");

    await this.posHub.upsertItemMapping(restaurantId, {
      source: salesSourceFor(proposal.source),
      external_item_id: proposal.external_item_id,
      item_name: proposal.item_name,
      is_wine: true,
      master_wine_id: proposal.candidate_master_wine_id,
      inventory_id: proposal.candidate_inventory_id,
    });

    const { error: updateError } = await db
      .from("pos_catalog_match_proposals")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", proposalId);
    if (updateError) throw new Error(updateError.message);
    return { approved: true, proposalId };
  }

  async rejectProposal(restaurantId: string, proposalId: string) {
    const db = this.dbService.getClient();
    const { error } = await db
      .from("pos_catalog_match_proposals")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", proposalId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new Error(error.message);
    return { rejected: true, proposalId };
  }
}
