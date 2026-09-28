import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../database/database.service";
import { BoundReply, isBoundReply } from "./bound-reply";
import { Finding, ReadingArgs, ReadingId } from "./reading.types";

export interface ReadingFolio {
  id: string;
  restaurant_id: string;
  user_id: string;
  request_id: string;
  correlation_id: string;
  origin: "page" | "panel" | "standing";
  utterance: string;
  status: "pending" | "complete" | "failed";
  reading_id: ReadingId | null;
  reading_version: number | null;
  reading_args: ReadingArgs;
  finding: Finding | null;
  reply_kind: BoundReply["kind"] | null;
  answer: BoundReply | null;
  failure_reason: string | null;
  proposal_id: string | null;
  previous_folio_id: string | null;
  created_at: string;
  completed_at: string | null;
}
const columns = "id,restaurant_id,user_id,request_id,correlation_id,origin,utterance,status,reading_id,reading_version,reading_args,finding,reply_kind,answer,failure_reason,proposal_id,previous_folio_id,created_at,completed_at";
@Injectable()
export class ReadingFolioStore {
  constructor(private readonly db: DatabaseService) {}
  private check(row: any, restaurantId: string, userId: string): ReadingFolio {
    if (!row || row.restaurant_id !== restaurantId || row.user_id !== userId) throw new NotFoundException("This folio is not available here.");
    if (row.status === "complete" && !isBoundReply(row.answer))
      throw new ServiceUnavailableException("This saved folio has an unreadable answer. It has not been replaced.");
    return row as ReadingFolio;
  }
  async begin(input: { restaurantId: string; userId: string; requestId: string; utterance: string;
    origin: ReadingFolio["origin"]; previousFolioId?: string; readingId?: ReadingId; readingVersion?: number; args?: ReadingArgs }): Promise<{ folio: ReadingFolio; created: boolean }> {
    if (input.previousFolioId) await this.get(input.restaurantId, input.userId, input.previousFolioId);
    const id = randomUUID();
    const { data, error } = await this.db.getClient().from("ask_reading_folios").insert({
      id, restaurant_id: input.restaurantId, user_id: input.userId, request_id: input.requestId,
      correlation_id: id, utterance: input.utterance, origin: input.origin, status: "pending",
      reading_id: input.readingId || null, reading_version: input.readingVersion || null,
      reading_args: input.args || {}, previous_folio_id: input.previousFolioId || null,
    }).select(columns).single();
    if (error?.code === "23505") {
      const previous = await this.db.getClient().from("ask_reading_folios").select(columns)
        .eq("restaurant_id", input.restaurantId).eq("user_id", input.userId).eq("request_id", input.requestId).maybeSingle();
      if (previous.error || !previous.data) throw new ServiceUnavailableException("The saved question could not be checked. Nothing was run again.");
      const folio = this.check(previous.data, input.restaurantId, input.userId);
      if (folio.utterance !== input.utterance || folio.origin !== input.origin ||
        folio.previous_folio_id !== (input.previousFolioId || null))
        throw new ConflictException("This question identity already belongs to a different request.");
      return { folio, created: false };
    }
    if (error || !data) throw new ServiceUnavailableException("The question could not be saved. Nothing was sent for an answer.");
    return { folio: this.check(data, input.restaurantId, input.userId), created: true };
  }
  async get(restaurantId: string, userId: string, id: string): Promise<ReadingFolio> {
    const { data, error } = await this.db.getClient().from("ask_reading_folios").select(columns)
      .eq("id", id).eq("restaurant_id", restaurantId).eq("user_id", userId).maybeSingle();
    if (error) throw new ServiceUnavailableException("The folio could not be read.");
    return this.check(data, restaurantId, userId);
  }
  async list(restaurantId: string, userId: string): Promise<ReadingFolio[]> {
    const { data, error } = await this.db.getClient().from("ask_reading_folios").select(columns)
      .eq("restaurant_id", restaurantId).eq("user_id", userId).order("created_at", { ascending: false })
      .order("id", { ascending: false }).limit(50);
    if (error || !Array.isArray(data)) throw new ServiceUnavailableException("The folio book could not be read.");
    return data.map(row => this.check(row, restaurantId, userId));
  }
  async finish(folio: ReadingFolio, answer: BoundReply, finding?: Finding, failureReason?: string): Promise<ReadingFolio> {
    const { data, error } = await this.db.getClient().from("ask_reading_folios").update({
      status: failureReason ? "failed" : "complete", reply_kind: answer.kind, answer,
      reading_id: finding?.readingId || folio.reading_id,
      reading_version: finding?.readingVersion || folio.reading_version,
      reading_args: finding?.args || folio.reading_args,
      finding: finding || null, failure_reason: failureReason || null, completed_at: new Date().toISOString(),
    }).eq("id", folio.id).eq("restaurant_id", folio.restaurant_id).eq("user_id", folio.user_id)
      .eq("status", "pending").select(columns).maybeSingle();
    // Never return an unpersisted finished response. A transport loss may have
    // committed the write; a subsequent GET is the only honest resolution.
    if (error) throw new ServiceUnavailableException({ message: "The answer's saved state is uncertain. Reopen this folio to check it.", folioId: folio.id });
    if (!data) return this.get(folio.restaurant_id, folio.user_id, folio.id);
    return this.check(data, folio.restaurant_id, folio.user_id);
  }
}
