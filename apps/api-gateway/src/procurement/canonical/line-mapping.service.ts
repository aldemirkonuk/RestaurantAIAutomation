import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { normalizeDescription } from "../documents/line-matcher";
import type { ReadResult } from "./canonical-document.service";

/**
 * LineMappingService — ADR 0104 D12 slice 4, the line-to-item mapping memory.
 *
 * A person links an invoice line to a shelf once; the product remembers the
 * pairing FOR THAT VENDOR and proposes it the next time the same line arrives.
 * The proposal is a tick, never a number (ADR 0104), and nothing is booked or
 * costed from it (ADR 0103 A12) — the tick calls the link door, which is what
 * writes `procurement_document_lines.inventory_id`, which is what lets
 * `finalise_delivery_cost` find the price for that shelf (ADR 0103 A1).
 *
 * FOUR RULES THIS FILE EXISTS TO KEEP.
 *
 * 1. THE MEMORY FORGETS, IT DOES NOT AVERAGE. A pairing that was wrong once is
 *    un-linked, which appends an `unlinked` act; the memory then returns NOTHING
 *    for that key and the next document gets no proposal. There is deliberately
 *    no vote between the old answer and the new one — a majority of wrong ticks
 *    is still the wrong shelf.
 *
 * 2. THE LATEST HUMAN ANSWER WINS (ADR 0104 S8). Conflicting history is kept and
 *    shown; the proposal follows the newest `linked` act, never a mode or a mean
 *    over the history.
 *
 * 3. A PAIRING IS ONE VENUE'S. Every read is filtered by `restaurant_id` AND
 *    `provider_id` before it filters by key. There is no path here that can
 *    return another restaurant's shelf.
 *
 * 4. A FAILED READ IS "MEMORY UNAVAILABLE", NEVER "NO SUGGESTION". Both answers
 *    render as a line with no tick, and only one of them is true. Every read
 *    returns `ReadResult`, and the caller carries the failure onto the line as
 *    `proposalUnavailable` with the reason in words. This is
 *    absence-reported-as-health in the one place it would be invisible: a broken
 *    query looks exactly like a vendor we have never linked before.
 */

/** What a line has to offer the memory. */
export interface MappableLine {
  vendorSku?: string | null;
  description?: string | null;
  vintage?: number | null;
  formatMl?: number | null;
}

export interface MappingKey {
  kind: "vendor_sku" | "description";
  value: string;
  /** What was actually printed, for the log and the sentence. */
  display: string;
}

export interface RememberedPairing {
  inventoryId: string;
  /** Count of `linked` acts for this key SINCE the last `unlinked`. Derived. */
  timesConfirmed: number;
  lastConfirmedBy: string | null;
  lastConfirmedAt: string;
  key: MappingKey;
  /**
   * The whole sentence a person reads. Never a percentage, never a score —
   * "Remembered from N earlier documents from this vendor, last confirmed by
   * <name> on <date>." A number here would be a confidence wearing a costume.
   */
  sentence: string;
}

interface MappingRow {
  action: "linked" | "unlinked";
  inventory_id: string | null;
  linked_by: string | null;
  linked_at: string;
  key_kind: "vendor_sku" | "description";
  key_value: string;
  key_display: string | null;
}

/** Stable map key for a pairing key. */
export const compositeKey = (k: MappingKey): string => `${k.kind}:${k.value}`;

/**
 * The key of a pairing.
 *
 * A SKU key FOLDS IN THE PRINTED VINTAGE. A distributor that reuses one SKU for
 * the 2022 and the 2023 is routine, and those are two shelves with two cost
 * lots; keying on the SKU alone would propose last year's shelf for this year's
 * wine, confidently and silently. Folded in, the new vintage is simply a key we
 * have never seen — no proposal, which is the honest and the safe answer.
 *
 * A description key folds in format and vintage for the same reason, over the
 * matcher's normalisation (which strips vintage and format OUT of the text
 * precisely so they can be compared as fields).
 *
 * Returns null when the line prints nothing to key on — a line with neither a
 * SKU nor a description teaches nothing and is asked nothing.
 */
export function mappingKeyFor(line: MappableLine): MappingKey | null {
  const sku = (line.vendorSku ?? "").trim();
  const parsed = normalizeDescription(line.description);
  const vintage = line.vintage ?? parsed.vintage;
  const formatMl = line.formatMl ?? parsed.formatMl;

  if (sku.length > 0) {
    return {
      kind: "vendor_sku",
      value: `${sku.toUpperCase()}|${vintage ?? ""}`,
      display: sku,
    };
  }

  if (parsed.normalized.length > 0) {
    return {
      kind: "description",
      value: `${parsed.normalized}|${formatMl ?? ""}|${vintage ?? ""}`,
      display: (line.description ?? "").trim(),
    };
  }

  return null;
}

@Injectable()
export class LineMappingService {
  private readonly logger = new Logger(LineMappingService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Append one act. `inventoryId === null` is an un-link: the memory forgets
   * this key, and the row that says so is itself part of the history.
   *
   * `providerId === null` means the document names no vendor. There is nobody to
   * remember the pairing FOR, so nothing is written and the caller is told —
   * writing a provider-less row would later propose one vendor's shelf for
   * another vendor's paper.
   */
  async record(input: {
    restaurantId: string;
    providerId: string | null;
    line: MappableLine;
    inventoryId: string | null;
    source: "chosen" | "remembered";
    documentId: string;
    lineNo: number;
    linkedBy: string | null;
  }): Promise<ReadResult<{ remembered: boolean; reason?: string }>> {
    const key = mappingKeyFor(input.line);
    if (!key)
      return {
        ok: true,
        value: {
          remembered: false,
          reason:
            "this line prints neither a vendor SKU nor a description, so there is nothing to remember it by",
        },
      };
    if (!input.providerId)
      return {
        ok: true,
        value: {
          remembered: false,
          reason:
            "this document names no vendor, so there is nobody to remember the pairing for",
        },
      };

    const insert = await this.db
      .getClient()
      .from("document_line_mappings")
      .insert({
        restaurant_id: input.restaurantId,
        provider_id: input.providerId,
        key_kind: key.kind,
        key_value: key.value,
        key_display: key.display,
        action: input.inventoryId ? "linked" : "unlinked",
        inventory_id: input.inventoryId,
        source: input.source,
        document_id: input.documentId,
        line_no: input.lineNo,
        linked_by: input.linkedBy,
      });

    if (insert.error)
      return {
        ok: false,
        error: `the link was written to the line but the mapping memory did not record it (${insert.error.message}). The next document from this vendor will ask again rather than propose.`,
      };

    return { ok: true, value: { remembered: true } };
  }

  /**
   * What the memory currently says for each of these lines.
   *
   * One read for the whole document, keyed in memory afterwards — a per-line
   * read would be N queries and would make a partial failure look like a partial
   * memory.
   *
   * The returned map holds only keys the memory ANSWERS with a shelf. A key
   * whose newest act is `unlinked` is deliberately absent: the memory forgot it,
   * and that is the same thing to the person looking at the line as never having
   * linked it — there is no proposal, ask me.
   */
  async proposalsFor(input: {
    restaurantId: string;
    providerId: string | null;
    lines: MappableLine[];
    /**
     * Resolves `linked_by` to a name for the sentence. Optional, and only for
     * a caller that already holds the names — when it is absent this service
     * reads `public.users` ITSELF rather than falling back to a pronoun. The
     * fallback was the whole defect: `linked_by` is a known id, so "someone
     * here" was the product declining to read a fact it holds.
     */
    nameFor?: (userId: string) => string | null;
  }): Promise<ReadResult<Map<string, RememberedPairing>>> {
    const out = new Map<string, RememberedPairing>();
    if (!input.providerId) return { ok: true, value: out };

    const keys = new Map<string, MappingKey>();
    for (const line of input.lines) {
      const k = mappingKeyFor(line);
      if (k) keys.set(compositeKey(k), k);
    }
    if (keys.size === 0) return { ok: true, value: out };

    const read = await this.db
      .getClient()
      .from("document_line_mappings")
      .select(
        "action, inventory_id, linked_by, linked_at, key_kind, key_value, key_display",
      )
      // Tenant and vendor FIRST. A pairing is per restaurant, never global.
      .eq("restaurant_id", input.restaurantId)
      .eq("provider_id", input.providerId)
      .in(
        "key_value",
        Array.from(keys.values()).map((k) => k.value),
      )
      .order("linked_at", { ascending: false });

    if (read.error)
      return {
        ok: false,
        error: `the mapping memory could not be read (${read.error.message}) — no shelf is being proposed on this document, which is NOT the same as having nothing to propose`,
      };

    const rows = (read.data ?? []) as MappingRow[];

    // The names for every author the memory is about to quote. ONE read, and a
    // FAILED one withholds the whole proposal: "a person whose name is not on
    // record" asserts we looked, and after a failed read we did not.
    const names = input.nameFor
      ? null
      : await this.namesFor(
          rows
            .filter((r) => r.action === "linked")
            .map((r) => r.linked_by)
            .filter((v): v is string => !!v),
        );
    if (names && !names.ok) return names;
    const lookup = (id: string): string | null =>
      input.nameFor ? input.nameFor(id) : (names?.value.get(id) ?? null);

    for (const [composite, key] of keys) {
      // Newest first, and `key_value` alone is not unique across kinds.
      const forKey = rows.filter(
        (r) => r.key_kind === key.kind && r.key_value === key.value,
      );
      const newest = forKey[0];
      // No history, or the newest act was an un-link: the memory has no answer.
      if (!newest || newest.action !== "linked" || !newest.inventory_id)
        continue;

      // Confirmations SINCE the last un-link. Counting the whole history would
      // let a forgotten mistake keep inflating the sentence.
      let timesConfirmed = 0;
      for (const r of forKey) {
        if (r.action === "unlinked") break;
        if (r.inventory_id === newest.inventory_id) timesConfirmed++;
      }

      // A person, always — named when we hold the name, and otherwise SAID to
      // be unnamed. "someone here" read the same for an id we never looked up
      // and an id that has no name, and only one of those is a fact.
      const who =
        (newest.linked_by ? lookup(newest.linked_by) : null) ??
        "a person whose name is not on record";
      const when = newest.linked_at.slice(0, 10);
      const from =
        timesConfirmed === 1
          ? "1 earlier document"
          : `${timesConfirmed} earlier documents`;

      out.set(composite, {
        inventoryId: newest.inventory_id,
        timesConfirmed,
        lastConfirmedBy: newest.linked_by,
        lastConfirmedAt: newest.linked_at,
        key,
        sentence: `Remembered from ${from} from this vendor, last confirmed by ${who} on ${when}.`,
      });
    }

    return { ok: true, value: out };
  }

  /**
   * user_id → name, the same read the correction log uses
   * (`document-correction.service.ts` `namesFor`). An id we hold no row for is
   * ABSENT from the map, never mapped to the id itself — a raw uuid in a
   * sentence is not a name.
   */
  private async namesFor(
    ids: string[],
  ): Promise<ReadResult<Map<string, string>>> {
    const unique = Array.from(new Set(ids));
    if (!unique.length) return { ok: true, value: new Map() };
    const read = await this.db
      .getClient()
      .from("users")
      .select("user_id, name")
      .in("user_id", unique);
    if (read.error)
      return {
        ok: false,
        error: `the people who confirmed these pairings could not be read (${read.error.message}) — no shelf is being proposed on this document, which is NOT the same as having nothing to propose`,
      };
    return {
      ok: true,
      value: new Map(
        ((read.data ?? []) as { user_id: string; name: string | null }[])
          .filter((u) => !!u.name)
          .map((u) => [u.user_id, u.name as string]),
      ),
    };
  }

  /**
   * The link door for a SHELF (ADR 0103 A12) — distinct from `…/link`, which
   * pairs a document line with an ORDER line.
   *
   * Two writes, in this order and no other:
   *   1. `procurement_document_lines.inventory_id` — the fact the booking path
   *      reads, and what lets `finalise_delivery_cost` find the price for the
   *      item the door booked (ADR 0103 A1).
   *   2. the mapping memory act — what makes the NEXT document easier.
   *
   * If (2) fails, (1) still stands and the caller is TOLD the memory did not
   * record it. The reverse order would let a memory exist for a link the line
   * does not carry, which would propose a shelf the document never confirmed.
   *
   * `inventoryId === null` is "not this one": it clears the line AND appends the
   * forgetting act, so the wrong shelf stops being proposed everywhere.
   */
  async linkLineToItem(input: {
    documentId: string;
    lineId: string;
    restaurantId: string;
    userId: string | null;
    inventoryId: string | null;
    source: "chosen" | "remembered";
  }): Promise<{
    lineId: string;
    inventoryId: string | null;
    remembered: boolean;
    memoryNote: string | null;
  }> {
    const client = this.db.getClient();

    const line = await client
      .from("procurement_document_lines")
      .select("id, line_no, vendor_sku, description, vintage, format_ml")
      .eq("id", input.lineId)
      .eq("document_id", input.documentId)
      .eq("restaurant_id", input.restaurantId)
      .maybeSingle();
    if (line.error) throw new Error(line.error.message);
    if (!line.data) throw new Error("NOT_FOUND");

    const doc = await client
      .from("procurement_documents")
      .select("id, provider_id")
      .eq("id", input.documentId)
      .eq("restaurant_id", input.restaurantId)
      .maybeSingle();
    if (doc.error) throw new Error(doc.error.message);
    if (!doc.data) throw new Error("NOT_FOUND");

    // The shelf must be THIS restaurant's. Without this check a caller could
    // name any item id and the line would carry it into a stock booking.
    if (input.inventoryId) {
      const item = await client
        .from("restaurant_inventory")
        .select("id")
        .eq("id", input.inventoryId)
        .eq("restaurant_id", input.restaurantId)
        .maybeSingle();
      if (item.error) throw new Error(item.error.message);
      if (!item.data) throw new Error("ITEM_NOT_FOUND");
    }

    const updated = await client
      .from("procurement_document_lines")
      .update({ inventory_id: input.inventoryId })
      .eq("id", input.lineId)
      .eq("document_id", input.documentId)
      .eq("restaurant_id", input.restaurantId)
      .select("id, inventory_id")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    if (!updated.data) throw new Error("NOT_FOUND");

    const row = line.data as {
      line_no: number;
      vendor_sku: string | null;
      description: string | null;
      vintage: number | null;
      format_ml: number | null;
    };

    const remembered = await this.record({
      restaurantId: input.restaurantId,
      providerId: (doc.data as { provider_id: string | null }).provider_id,
      line: {
        vendorSku: row.vendor_sku,
        description: row.description,
        vintage: row.vintage,
        formatMl: row.format_ml,
      },
      inventoryId: input.inventoryId,
      source: input.source,
      documentId: input.documentId,
      lineNo: row.line_no,
      linkedBy: input.userId,
    });

    if (!remembered.ok) {
      this.logger.warn(remembered.error);
      return {
        lineId: input.lineId,
        inventoryId: input.inventoryId,
        remembered: false,
        memoryNote: remembered.error,
      };
    }

    return {
      lineId: input.lineId,
      inventoryId: input.inventoryId,
      remembered: remembered.value.remembered,
      memoryNote: remembered.value.reason ?? null,
    };
  }

  /** The acts on one document, newest first — the "who linked what and when" log. */
  async logFor(
    documentId: string,
    restaurantId: string,
  ): Promise<
    ReadResult<
      {
        action: "linked" | "unlinked";
        inventoryId: string | null;
        lineNo: number | null;
        keyDisplay: string | null;
        source: string;
        linkedBy: string | null;
        linkedAt: string;
      }[]
    >
  > {
    const read = await this.db
      .getClient()
      .from("document_line_mappings")
      .select(
        "action, inventory_id, line_no, key_display, source, linked_by, linked_at",
      )
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .order("linked_at", { ascending: false });

    if (read.error)
      return {
        ok: false,
        error: `the mapping log for document ${documentId} could not be read: ${read.error.message}`,
      };

    return {
      ok: true,
      value: (
        (read.data ?? []) as (MappingRow & {
          line_no: number | null;
          source: string;
        })[]
      ).map((r) => ({
        action: r.action,
        inventoryId: r.inventory_id,
        lineNo: r.line_no,
        keyDisplay: r.key_display,
        source: r.source,
        linkedBy: r.linked_by,
        linkedAt: r.linked_at,
      })),
    };
  }
}
