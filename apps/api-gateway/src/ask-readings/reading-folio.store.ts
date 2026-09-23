import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseService } from "../database/database.service";
import { BoundReply, isBoundReply } from "./bound-reply";
import { Finding, QuestionClass, ReadingArgs, ReadingId } from "./reading.types";

/**
 * What one ask was made with, written once (ADR 0145, 2026-09-21 amendment,
 * founder's option "Rules in code, label rows"). The snapshot half is known
 * before any model call and is inserted with the folio; the model half is
 * written by the one `finish` that moves the folio out of `pending`. A DB
 * trigger (20260922220400) refuses any later change to either half.
 */
export interface FolioCapture {
  pickClass?: QuestionClass | null;
  pickArgs?: ReadingArgs | null;
  pickModel?: string | null;
  pickPromptSha?: string | null;
  composeModel?: string | null;
  composePromptSha?: string | null;
}
export type FeedbackStep = "pick" | "compose" | "knowledge" | "books";
export type FeedbackLabel = "correct" | "incorrect";
export interface FolioLabel {
  id: string;
  folio_id: string;
  restaurant_id: string;
  step: FeedbackStep;
  label: FeedbackLabel;
  gold_class: string | null;
  basis: "person" | "re_ask";
  labeled_by_role: string | null;
  at: string;
}
const LABEL_COLUMNS = "id,folio_id,restaurant_id,step,label,gold_class,basis,labeled_by_role,at";

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
  /** The asker's role in this house as the token resolved it, at ask time -- never re-read by join. */
  asked_as_role: string | null;
  /** `page` when the request named the Reading, `model` when the pick model chose. */
  reading_chosen_by: "page" | "model" | null;
  /** The pick model's validated class and spans, before any disposition collapses them. */
  pick_class: QuestionClass | null;
  pick_args: ReadingArgs | null;
  pick_model: string | null;
  pick_prompt_sha: string | null;
  compose_model: string | null;
  compose_prompt_sha: string | null;
  catalogue_sha: string | null;
  policy_sha: string | null;
}
const columns = "id,restaurant_id,user_id,request_id,correlation_id,origin,utterance,status,reading_id,reading_version,reading_args,finding,reply_kind,answer,failure_reason,proposal_id,previous_folio_id,created_at,completed_at,asked_as_role,reading_chosen_by,pick_class,pick_args,pick_model,pick_prompt_sha,compose_model,compose_prompt_sha,catalogue_sha,policy_sha";

/** A role as the token carried it, lower-cased, or null. Never widened or guessed. */
export function snapshotRole(role: string | null | undefined): string | null {
  const normalized = role ? String(role).trim().toLowerCase() : "";
  return normalized ? normalized : null;
}
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
    origin: ReadingFolio["origin"]; previousFolioId?: string; readingId?: ReadingId; readingVersion?: number; args?: ReadingArgs;
    askedAsRole: string | null; catalogueSha: string; policySha: string }): Promise<{ folio: ReadingFolio; created: boolean }> {
    if (input.previousFolioId) await this.get(input.restaurantId, input.userId, input.previousFolioId);
    const id = randomUUID();
    // A re-ask that names its Reading (previous_folio_id + a page-chosen
    // reading) becomes a pick label on the folio it follows. That label is
    // written by the database in THIS insert's transaction (trigger in
    // 20260922220400), so it can neither be lost nor half-written.
    // [2026-09-21, round 6r, "Two labels (Recommended)": the database also
    // derives the re-ask's kind -- `correction` for the same Reading,
    // `follow_up` for a different one -- and the derived label is that kind,
    // never correct | incorrect (20260922220500). No client field sets it.]
    const { data, error } = await this.db.getClient().from("ask_reading_folios").insert({
      id, restaurant_id: input.restaurantId, user_id: input.userId, request_id: input.requestId,
      correlation_id: id, utterance: input.utterance, origin: input.origin, status: "pending",
      reading_id: input.readingId || null, reading_version: input.readingVersion || null,
      reading_args: input.args || {}, previous_folio_id: input.previousFolioId || null,
      asked_as_role: snapshotRole(input.askedAsRole), reading_chosen_by: input.readingId ? "page" : "model",
      catalogue_sha: input.catalogueSha, policy_sha: input.policySha,
    }).select(columns).single();
    if (error?.code === "23505") {
      const previous = await this.db.getClient().from("ask_reading_folios").select(columns)
        .eq("restaurant_id", input.restaurantId).eq("user_id", input.userId).eq("request_id", input.requestId).maybeSingle();
      if (previous.error || !previous.data) throw new ServiceUnavailableException("The saved question could not be checked. Nothing was run again.");
      const folio = this.check(previous.data, input.restaurantId, input.userId);
      if (folio.utterance !== input.utterance || folio.origin !== input.origin ||
        folio.previous_folio_id !== (input.previousFolioId || null) ||
        folio.reading_chosen_by !== (input.readingId ? "page" : "model"))
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
  async finish(folio: ReadingFolio, answer: BoundReply, finding?: Finding, failureReason?: string, capture: FolioCapture = {}): Promise<ReadingFolio> {
    // `not_permitted` (founder, batch 4, 2026-09-19 -- the role gate) is the
    // one non-`finding` outcome that DOES name a real reading: the caller's
    // role refused it before a Finding was ever created, so the row would
    // otherwise record no reading id at all for a security-relevant refusal
    // reached by a naturally-worded question. Every other non-`finding`
    // outcome (not_built, no_reading_matched, model_knowledge) genuinely has
    // no reading to name, and keeps falling through to `folio.reading_id`
    // exactly as before.
    // [2026-09-21: an answer-kind refusal of model knowledge names no reading.]
    // [2026-09-21, round 6r: an unbuilt question class refused for the role
    // ("Classify now") names a question class, not a Reading, so it names none.]
    const refusedReadingId = answer.kind === "not_permitted" && "readingId" in answer ? answer.readingId : undefined;
    const { data, error } = await this.db.getClient().from("ask_reading_folios").update({
      status: failureReason ? "failed" : "complete", reply_kind: answer.kind, answer,
      reading_id: finding?.readingId || refusedReadingId || folio.reading_id,
      reading_version: finding?.readingVersion || folio.reading_version,
      reading_args: finding?.args || folio.reading_args,
      finding: finding || null, failure_reason: failureReason || null, completed_at: new Date().toISOString(),
      pick_class: capture.pickClass ?? null, pick_args: capture.pickArgs ?? null,
      pick_model: capture.pickModel ?? null, pick_prompt_sha: capture.pickPromptSha ?? null,
      compose_model: capture.composeModel ?? null, compose_prompt_sha: capture.composePromptSha ?? null,
    }).eq("id", folio.id).eq("restaurant_id", folio.restaurant_id).eq("user_id", folio.user_id)
      .eq("status", "pending").select(columns).maybeSingle();
    // Never return an unpersisted finished response. A transport loss may have
    // committed the write; a subsequent GET is the only honest resolution.
    if (error) throw new ServiceUnavailableException({ message: "The answer's saved state is uncertain. Reopen this folio to check it.", folioId: folio.id });
    if (!data) return this.get(folio.restaurant_id, folio.user_id, folio.id);
    return this.check(data, folio.restaurant_id, folio.user_id);
  }

  /**
   * A person's label on one step of their own ask (POST /ask/folios/:id/feedback).
   * Scoped exactly like `get`: the folio must be this person's, in the house
   * the token names, or it does not exist here. A step that did not run for
   * this folio cannot be labelled -- a label on nothing would enter a dataset
   * as if it described something.
   *
   * `books` means the house's records were wrong. It is kept for data
   * quality and is never exported for training (the export view omits it):
   * a model cannot learn to fix books it only reads.
   */
  async label(restaurantId: string, userId: string, role: string | null, folioId: string,
    input: { step: FeedbackStep; label: FeedbackLabel; goldClass?: QuestionClass }): Promise<FolioLabel> {
    const folio = await this.get(restaurantId, userId, folioId);
    if (folio.status === "pending") throw new ConflictException("This question has no answer yet to label.");
    if (input.goldClass && input.step !== "pick") throw new BadRequestException("Only the pick step takes a corrected question class.");
    const ran: Record<FeedbackStep, boolean> = {
      pick: folio.reading_chosen_by === "model" && !!folio.pick_class,
      compose: folio.reply_kind === "reading",
      knowledge: folio.reply_kind === "model_knowledge",
      books: !!folio.finding,
    };
    if (!ran[input.step]) throw new BadRequestException("That step did not run for this question.");
    // A corrected class must agree with the label: "right" naming another
    // class, or "wrong" naming the class the model chose, says two opposite
    // things, and an evaluation would read whichever half it looked at.
    if (input.goldClass && (input.label === "correct") !== (input.goldClass === folio.pick_class))
      throw new BadRequestException("The corrected class contradicts the label.");
    const { data, error } = await this.db.getClient().from("ask_folio_labels").insert({
      folio_id: folio.id, restaurant_id: folio.restaurant_id, step: input.step, label: input.label,
      gold_class: input.goldClass || null, basis: "person", labeled_by: userId, labeled_by_role: snapshotRole(role),
    }).select(LABEL_COLUMNS).single();
    if (error || !data) throw new ServiceUnavailableException("The label could not be saved.");
    return data as FolioLabel;
  }
}
