import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { TONE_SCORER, ToneScorer } from "./jev-tone.client";
import { egressFor } from "./tone-egress";
import { displayNameOf } from "./pii-mask";
import { JEV_MODEL, TONE_SCALE_VERSION } from "./tone-scale";

/**
 * Scores each inbound vendor message with Jev, for houses that turned it on
 * (ADR 0207, round 3). The vendor sheet reads the result as one word.
 *
 * THE ORDER IS THE SAFETY:
 *   1. only houses whose `restaurants.vendor_tone_scoring_enabled` is true —
 *      off by default, and nothing of a house that has not turned it on is
 *      read here, let alone sent;
 *   2. the house's names are read FIRST (its members, its vendors' contacts and
 *      contact people), and each message adds its sender's display name (the
 *      `From:` header). If any of the house reads fails, the house sends
 *      nothing this run: a message cannot be masked against names that were
 *      not read;
 *   3. each message goes through `egressFor` — the latest part only, emails,
 *      phone numbers and person names masked — and ONLY its output is sent;
 *   4. automated mail is not sent at all (it is `not assessed` on the sheet);
 *   5. the answer is keyed to OUR message id. A failed call is a `failed` row
 *      with its reason — the message reads `not assessed`, never a guessed
 *      word — retried on later runs until `MAX_ATTEMPTS`.
 *
 * Nothing of the message is stored or logged here: the row holds the scale's
 * numbers, the model, the confidence and the mask COUNTS.
 *
 * NO KEY, NO RUN: without a Jev key the scheduled run returns before reading
 * anything.
 */

export const SWEEP_CRON = "*/15 * * * *";
export const SWEEP_JOB_NAME = "vendor-tone-scoring";
/** Messages scored per house per run. */
export const PER_HOUSE = 40;
/** A message whose call failed this many times is left `failed`. */
export const MAX_ATTEMPTS = 3;
/** How far back a newly switched-on house is scored. */
export const LOOKBACK_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const IN_CHUNK = 150;

export interface SweepSummary {
  houses: number;
  scored: number;
  failed: number;
  skippedAutomated: number;
  skippedEmpty: number;
  housesRefused: { house: string; reason: string }[];
}

interface MessageRow {
  id: string;
  provider_id: string;
  message_text: string | null;
  content: string | null;
  email_headers: { from?: unknown } | null;
  conversation_context: {
    classification?: { is_automated?: unknown } | null;
  } | null;
}

interface ExistingRow {
  message_id: string;
  status: string;
  attempts: number | null;
}

function reasonOf(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (!error) return "no reason given";
  return (
    [error.code, error.message].filter(Boolean).join(" ") || "no reason given"
  );
}

@Injectable()
export class VendorToneScoringService {
  private readonly logger = new Logger(VendorToneScoringService.name);

  clock: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    @Inject(TONE_SCORER) private readonly scorer: ToneScorer,
  ) {}

  private client() {
    return this.db.getClient();
  }

  @Cron(SWEEP_CRON, { name: SWEEP_JOB_NAME })
  async scheduled(): Promise<void> {
    if (!this.scorer.available()) {
      this.logger.debug(
        `${SWEEP_JOB_NAME} skipped: Jev is not set up on this server.`,
      );
      return;
    }
    try {
      const s = await this.sweep();
      if (s.scored || s.failed || s.housesRefused.length)
        this.logger.log(
          `${SWEEP_JOB_NAME}: ${s.houses} houses, ${s.scored} scored, ${s.failed} failed, ${s.housesRefused.length} refused`,
        );
    } catch (err: unknown) {
      this.logger.error(
        `${SWEEP_JOB_NAME} failed: ${(err as { name?: string })?.name ?? "Error"}`,
      );
    }
  }

  async sweep(): Promise<SweepSummary> {
    const summary: SweepSummary = {
      houses: 0,
      scored: 0,
      failed: 0,
      skippedAutomated: 0,
      skippedEmpty: 0,
      housesRefused: [],
    };
    if (!this.scorer.available()) return summary;
    const { data, error } = await this.client()
      .from("restaurants")
      .select("id")
      .eq("vendor_tone_scoring_enabled", true);
    if (error)
      throw new Error(`the house switches did not answer: ${reasonOf(error)}`);
    for (const h of (data ?? []) as { id: string }[]) {
      summary.houses += 1;
      await this.sweepHouse(h.id, summary);
    }
    return summary;
  }

  /** One house. Exported through `sweep`; public for the spec. */
  async sweepHouse(house: string, summary: SweepSummary): Promise<void> {
    const since = new Date(
      this.clock().getTime() - LOOKBACK_DAYS * DAY_MS,
    ).toISOString();
    const msgs = await this.client()
      .from("procurement_conversations")
      .select(
        "id, provider_id, message_text, content, email_headers, conversation_context",
      )
      .eq("restaurant_id", house)
      .ilike("direction", "inbound")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(PER_HOUSE * 5);
    if (msgs.error) {
      summary.housesRefused.push({
        house,
        reason: `vendor mail: ${reasonOf(msgs.error)}`,
      });
      return;
    }
    const rows = (msgs.data ?? []) as MessageRow[];
    if (rows.length === 0) return;

    const existing = await this.existingOf(
      house,
      rows.map((r) => r.id),
    );
    if (!existing.ok) {
      summary.housesRefused.push({ house, reason: existing.reason });
      return;
    }
    // Automated mail is never sent (it reads "not assessed" on the sheet), and
    // it is set aside BEFORE the per-run slice so a house flooded with
    // newsletters still gets its vendors' own mail read.
    const todo: MessageRow[] = [];
    for (const r of rows) {
      if (r.conversation_context?.classification?.is_automated === true) {
        summary.skippedAutomated += 1;
        continue;
      }
      const e = existing.rows.get(r.id);
      if (e && !(e.status === "failed" && (e.attempts ?? 1) < MAX_ATTEMPTS))
        continue;
      if (todo.length < PER_HOUSE) todo.push(r);
    }
    if (todo.length === 0) return;

    const names = await this.namesOf(house, [
      ...new Set(todo.map((r) => r.provider_id)),
    ]);
    if (!names.ok) {
      // Nothing is sent for a house whose names could not be read.
      summary.housesRefused.push({ house, reason: names.reason });
      return;
    }

    for (const r of todo) {
      // The sender signs the message: their own display name is masked as a
      // name the house knows, whether or not the house's records hold it.
      const payload = egressFor(String(r.message_text ?? r.content ?? ""), [
        ...names.all,
        displayNameOf(r.email_headers?.from),
      ]);
      if (!payload) {
        summary.skippedEmpty += 1;
        continue;
      }
      const outcome = await this.scorer.score(payload);
      const prev = existing.rows.get(r.id);
      const attempts = (prev?.attempts ?? 0) + 1;
      const base = {
        restaurant_id: house,
        provider_id: r.provider_id,
        message_id: r.id,
        scale_version: TONE_SCALE_VERSION,
        model_requested: JEV_MODEL,
        masked: payload.masked,
        attempts,
        scored_at: this.clock().toISOString(),
      };
      const row = outcome.ok
        ? {
            ...base,
            status: "scored",
            reason: null,
            valence: outcome.score.valence,
            friction: outcome.score.friction,
            urgency: outcome.score.urgency,
            commitment: outcome.score.commitment,
            apology: outcome.score.apology,
            escalation: outcome.score.escalation,
            confidence: outcome.score.confidence,
            quote_index: outcome.score.quoteIndex,
            quote_confidence: outcome.score.quoteConfidence,
            model_version: outcome.score.modelVersion,
          }
        : {
            ...base,
            status: "failed",
            reason: outcome.reason.slice(0, 300),
            valence: null,
            friction: null,
            urgency: null,
            commitment: null,
            apology: null,
            escalation: null,
            confidence: null,
            quote_index: null,
            quote_confidence: null,
            model_version: null,
          };
      const w = await this.client()
        .from("vendor_message_tone_scores")
        .upsert(row, { onConflict: "message_id,scale_version" });
      if (w.error) {
        this.logger.error(`tone score write failed: ${reasonOf(w.error)}`);
        summary.housesRefused.push({
          house,
          reason: `write: ${reasonOf(w.error)}`,
        });
        return;
      }
      if (outcome.ok) summary.scored += 1;
      else summary.failed += 1;
    }
  }

  private async existingOf(
    house: string,
    ids: string[],
  ): Promise<
    { ok: true; rows: Map<string, ExistingRow> } | { ok: false; reason: string }
  > {
    const rows = new Map<string, ExistingRow>();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await this.client()
        .from("vendor_message_tone_scores")
        .select("message_id, status, attempts")
        .eq("restaurant_id", house)
        .eq("scale_version", TONE_SCALE_VERSION)
        .in("message_id", ids.slice(i, i + IN_CHUNK));
      if (error)
        return { ok: false, reason: `tone scores: ${reasonOf(error)}` };
      for (const r of (data ?? []) as ExistingRow[]) rows.set(r.message_id, r);
    }
    return { ok: true, rows };
  }

  /**
   * Every person's name this house's records hold near its vendor mail: the
   * house's members, the vendors' contacts and the vendors' contact people.
   * All three must answer, or nothing is sent.
   */
  async namesOf(
    house: string,
    providerIds: string[],
  ): Promise<{ ok: true; all: string[] } | { ok: false; reason: string }> {
    const all: string[] = [];
    const access = await this.client()
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", house);
    if (access.error)
      return { ok: false, reason: `members: ${reasonOf(access.error)}` };
    const userIds = ((access.data ?? []) as { user_id: string }[]).map(
      (r) => r.user_id,
    );
    for (let i = 0; i < userIds.length; i += IN_CHUNK) {
      const u = await this.client()
        .from("users")
        .select("name")
        .in("user_id", userIds.slice(i, i + IN_CHUNK));
      if (u.error)
        return { ok: false, reason: `member names: ${reasonOf(u.error)}` };
      for (const r of (u.data ?? []) as { name: string | null }[])
        all.push(r.name ?? "");
    }
    // Members from before the access table (the legacy `users.restaurant_id`).
    const legacy = await this.client()
      .from("users")
      .select("name")
      .eq("restaurant_id", house);
    if (legacy.error)
      return { ok: false, reason: `member names: ${reasonOf(legacy.error)}` };
    for (const r of (legacy.data ?? []) as { name: string | null }[])
      all.push(r.name ?? "");
    if (providerIds.length) {
      const p = await this.client()
        .from("providers")
        .select("id, contact_first_name, contact_last_name")
        .eq("restaurant_id", house)
        .in("id", providerIds);
      if (p.error)
        return {
          ok: false,
          reason: `vendor contact people: ${reasonOf(p.error)}`,
        };
      const ours: string[] = [];
      for (const r of (p.data ?? []) as Record<string, string | null>[]) {
        if (r.id) ours.push(r.id);
        all.push(r.contact_first_name ?? "", r.contact_last_name ?? "");
        all.push(`${r.contact_first_name ?? ""} ${r.contact_last_name ?? ""}`);
      }
      // provider_contacts has no restaurant_id: it is read only for the vendor
      // ids the house-scoped read above returned, so only this house's vendors
      // are named.
      if (ours.length) {
        const c = await this.client()
          .from("provider_contacts")
          .select("name")
          .in("provider_id", ours);
        if (c.error)
          return { ok: false, reason: `vendor contacts: ${reasonOf(c.error)}` };
        for (const r of (c.data ?? []) as { name: string | null }[])
          all.push(r.name ?? "");
      }
    }
    return { ok: true, all: all.filter((s) => s.trim().length >= 2) };
  }
}
