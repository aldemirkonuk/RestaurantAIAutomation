import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isReadingId } from "./reading-catalogue";
import { ReadingFolioStore } from "./reading-folio.store";
import { ReadingRunner } from "./reading-runner";
import { Finding } from "./reading.types";

export interface ReadingSealContext { readingFolioId: string; readingFingerprint: string }
@Injectable()
export class ReadingCommitService {
  constructor(private readonly db: DatabaseService, private readonly folios: ReadingFolioStore) {}

  /** The caller has already authorized the order. Returns evidence, never private conversation history. */
  private async load(restaurantId: string, folioId: string): Promise<{ saved: Finding; current: Finding }> {
    const { data, error } = await this.db.getClient().from("ask_reading_folios")
      .select("id,restaurant_id,status,reading_id,reading_version,reading_args,finding")
      .eq("id", folioId).eq("restaurant_id", restaurantId).maybeSingle();
    if (error) throw new ServiceUnavailableException("The draft's Reading could not be read. Nothing was approved or sent.");
    if (!data || data.restaurant_id !== restaurantId || data.status !== "complete" || !isReadingId(data.reading_id) ||
      data.finding?.kind !== "finding" || data.finding?.outcome !== "read" || !data.finding?.fingerprint ||
      data.finding.readingId !== data.reading_id || data.finding.readingVersion !== data.reading_version)
      throw new BadRequestException("This draft has no complete, supported Reading to approve against.");
    const current = await new ReadingRunner(this.db.getClient()).run(restaurantId, data.reading_id, data.reading_args, data.reading_version);
    return { saved: data.finding as Finding, current };
  }

  async assertCurrent(restaurantId: string, folioId: string): Promise<ReadingSealContext> {
    const { saved, current } = await this.load(restaurantId, folioId);
    if (current.outcome !== "read" || current.fingerprint !== saved.fingerprint)
      throw new ConflictException({ reason: "reading_changed", message: "The Reading behind this draft changed or could not be repeated. Review both records before holding again.",
        readingFolioId: folioId, previous: saved, current });
    return { readingFolioId: folioId, readingFingerprint: current.fingerprint };
  }

  async assertForActor(restaurantId: string, userId: string, folioId: string): Promise<ReadingSealContext> {
    await this.folios.get(restaurantId, userId, folioId);
    return this.assertCurrent(restaurantId, folioId);
  }

  async orderReference(restaurantId: string, orderId: string): Promise<string | null> {
    const { data, error } = await this.db.getClient().from("procurement_orders")
      .select("id,restaurant_id,ask_reading_folio_id").eq("id", orderId).eq("restaurant_id", restaurantId).maybeSingle();
    if (error) throw new ServiceUnavailableException("The order's Reading could not be checked. Nothing was approved or sent.");
    if (!data || data.restaurant_id !== restaurantId) throw new NotFoundException("This order is not available here.");
    return data.ask_reading_folio_id || null;
  }

  async forOrder(restaurantId: string, orderId: string): Promise<ReadingSealContext | null> {
    const reference = await this.orderReference(restaurantId, orderId);
    return reference ? this.assertCurrent(restaurantId, reference) : null;
  }

  /** Called only after the same manager boundary as the draft's creation. */
  async attach(restaurantId: string, userId: string, orderId: string, folioId: string): Promise<void> {
    await this.assertForActor(restaurantId, userId, folioId);
    const previous = await this.orderReference(restaurantId, orderId);
    let update = this.db.getClient().from("procurement_orders").update({ ask_reading_folio_id: folioId })
      .eq("id", orderId).eq("restaurant_id", restaurantId);
    update = previous ? update.eq("ask_reading_folio_id", previous) : update.is("ask_reading_folio_id", null);
    const { data, error } = await update.select("id").maybeSingle();
    if (error) throw new ServiceUnavailableException("The draft's Reading could not be attached. Nothing was sent.");
    if (!data) throw new ConflictException("This order's Reading changed while attaching the draft. Review it again.");
  }

  /** Ordinary review of changed evidence; this does not approve or send an order. */
  async acceptChanged(restaurantId: string, userId: string, orderId: string,
    expectedFolioId: string, expectedFingerprint: string, requestId: string) {
    if (await this.orderReference(restaurantId, orderId) !== expectedFolioId)
      throw new ConflictException("The order is now based on a different Reading. Review it again.");
    const { saved, current } = await this.load(restaurantId, expectedFolioId);
    if (current.outcome !== "read" || current.fingerprint !== expectedFingerprint)
      throw new ConflictException({ reason: "reading_changed", message: "The Reading changed again. Review the current record.", previous: saved, current });
    const began = await this.folios.begin({ restaurantId, userId, requestId, origin: "panel",
      utterance: "Review the Reading attached to this order.", readingId: current.readingId,
      readingVersion: current.readingVersion, args: current.args });
    const folio = began.created ? await this.folios.finish(began.folio, { kind: "reading", finding: current,
      focus: current.rows.flatMap(r => r.cells).slice(0, 8).map(c => ({ cellId: c.id })) }, current) : began.folio;
    if (folio.status !== "complete" || folio.finding?.fingerprint !== expectedFingerprint)
      throw new ConflictException("This review has not completed with the currently displayed Reading.");
    const { data, error } = await this.db.getClient().from("procurement_orders")
      .update({ ask_reading_folio_id: folio.id }).eq("id", orderId).eq("restaurant_id", restaurantId)
      .eq("ask_reading_folio_id", expectedFolioId).select("id").maybeSingle();
    if (error) throw new ServiceUnavailableException("The reviewed Reading's saved state is uncertain. Reload the order before holding.");
    if (!data) throw new ConflictException("Another review changed this order. Reload before holding.");
    return { readingFolioId: folio.id, readingFingerprint: current.fingerprint, finding: current };
  }
}
