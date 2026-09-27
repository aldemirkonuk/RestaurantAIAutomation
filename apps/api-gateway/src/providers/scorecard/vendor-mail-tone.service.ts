import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { TONE_SCORER, ToneScorer } from "../../vendor-tone/jev-tone.client";
import { TONE_SCALE_VERSION } from "../../vendor-tone/tone-scale";
import {
  InboundMessageRow,
  LISTED_CAP,
  MailToneSection,
  ToneScoreRow,
  buildMailToneSection,
} from "./vendor-mail-tone";
import { MAIL_COPY } from "./vendor-mail-tone.copy";

/**
 * The reads behind "How their mail reads" (ADR 0207, round 3).
 *
 * EVERY READ NAMES THE HOUSE. The service-role client bypasses RLS, so the
 * `.eq("restaurant_id", house)` on each query IS the tenant boundary; the house
 * record is read by `.eq("id", house)`. The house comes from the token only
 * (`houseOf` in the controller), and the controller refuses anyone but an owner
 * or a manager before this is called.
 *
 * THE RAW SCORES STAY HERE. `vendor_message_tone_scores` is read for the
 * numbers the word is derived from, and only the word leaves
 * (`buildMailToneSection` returns no number of the scale).
 *
 * A FAILED READ IS NEVER AN EMPTY ONE: the mail or the scores failing is the
 * section's `could_not_read`, never "no mail yet".
 */

const IN_CHUNK = 150;
const PAGE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

function reasonOf(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (!error) return "no reason given";
  return (
    [error.code, error.message].filter(Boolean).join(" ") || "no reason given"
  );
}

@Injectable()
export class VendorMailToneService {
  private readonly logger = new Logger(VendorMailToneService.name);

  /** The wall clock, replaceable in a spec. */
  clock: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(TONE_SCORER) private readonly scorer?: ToneScorer,
  ) {}

  private client() {
    return this.db.getClient();
  }

  async section(
    house: string,
    providerId: string,
    days: number,
  ): Promise<MailToneSection> {
    const now = this.clock();
    const jevOn = await this.switchOf(house);
    await this.vendorOfHouse(house, providerId);
    const since = new Date(now.getTime() - 2 * days * DAY_MS).toISOString();
    const mail = await this.inbound(house, providerId, since);
    const scores =
      jevOn && mail.ok
        ? await this.scoresOf(
            house,
            mail.rows.map((r) => r.id),
          )
        : null;
    return buildMailToneSection({
      providerId,
      days,
      now,
      jevOn,
      jevAvailable: this.scorer?.available() ?? false,
      mail,
      scores,
    });
  }

  /** The house's switch, by the token's house id. A failed read refuses the section. */
  private async switchOf(house: string): Promise<boolean> {
    const { data, error } = await this.client()
      .from("restaurants")
      .select("id, vendor_tone_scoring_enabled")
      .eq("id", house)
      .maybeSingle();
    if (error)
      throw new ServiceUnavailableException(
        MAIL_COPY.error.houseRecord(reasonOf(error)),
      );
    if (!data) throw new NotFoundException(MAIL_COPY.error.noHouseRecord);
    return (
      (data as { vendor_tone_scoring_enabled?: unknown })
        .vendor_tone_scoring_enabled === true
    );
  }

  private async vendorOfHouse(
    house: string,
    providerId: string,
  ): Promise<void> {
    const { data, error } = await this.client()
      .from("providers")
      .select("id")
      .eq("id", providerId)
      .eq("restaurant_id", house)
      .is("deleted_at", null)
      .maybeSingle();
    if (error)
      throw new ServiceUnavailableException(
        MAIL_COPY.error.vendorBook(reasonOf(error)),
      );
    // A foreign house's vendor and a missing one are the same answer.
    if (!data)
      throw new NotFoundException(MAIL_COPY.error.noSuchVendor(providerId));
  }

  private async inbound(
    house: string,
    providerId: string,
    since: string,
  ): Promise<
    { ok: true; rows: InboundMessageRow[] } | { ok: false; reason: string }
  > {
    const rows: InboundMessageRow[] = [];
    // Two windows of one vendor's inbound mail; paged, and capped well above
    // what the section lists so a busy vendor still reads whole.
    for (let page = 0; page < 8; page++) {
      const { data, error } = await this.client()
        .from("procurement_conversations")
        .select(
          "id, received_at, message_text, content, email_headers, detected_sentiment, conversation_context",
        )
        .eq("restaurant_id", house)
        .eq("provider_id", providerId)
        .ilike("direction", "inbound")
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        this.logger.error(`vendor mail read failed: ${reasonOf(error)}`);
        return { ok: false, reason: reasonOf(error) };
      }
      const got = (data ?? []) as InboundMessageRow[];
      rows.push(...got);
      if (got.length < PAGE) return { ok: true, rows };
    }
    return {
      ok: false,
      reason: `more than ${8 * PAGE} messages in two windows — narrow the window (the section lists ${LISTED_CAP})`,
    };
  }

  private async scoresOf(
    house: string,
    ids: string[],
  ): Promise<
    { ok: true; rows: ToneScoreRow[] } | { ok: false; reason: string }
  > {
    const rows: ToneScoreRow[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await this.client()
        .from("vendor_message_tone_scores")
        .select(
          "message_id, status, reason, valence, friction, confidence, quote_index",
        )
        .eq("restaurant_id", house)
        .eq("scale_version", TONE_SCALE_VERSION)
        .in("message_id", ids.slice(i, i + IN_CHUNK));
      if (error) {
        this.logger.error(`tone scores read failed: ${reasonOf(error)}`);
        return {
          ok: false,
          reason: `Jev's readings did not answer: ${reasonOf(error)}`,
        };
      }
      rows.push(...((data ?? []) as ToneScoreRow[]));
    }
    return { ok: true, rows };
  }
}
