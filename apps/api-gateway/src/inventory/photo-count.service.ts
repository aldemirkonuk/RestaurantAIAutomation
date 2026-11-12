import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import { PARSE_BASIS, photoCountParseVerdict } from "./photo-count-verdict";

const COUNT_PROMPT =
  "You are helping a bar/restaurant staff member count units of a specific " +
  "item (a product such as a bottle, can, keg, box or bag) on a shelf or in " +
  "a bin, from a single photo. Count only intact, visibly full-or-partial " +
  "units of the item described. Return ONLY a JSON " +
  'object, no surrounding text: {"suggestedQty": <integer or null>, ' +
  '"confidence": "low"|"medium"|"high", "note": "<one short plain sentence ' +
  'on what the photo shows, with no word about confidence or certainty>"}. ' +
  'Set suggestedQty to null and confidence to "low" if the photo does not ' +
  "clearly show countable units (e.g. too blurry, wrong item, empty shelf " +
  "with none of the item). Never guess wildly — a null with a clear note is better " +
  "than a confident wrong number.";

/**
 * The note when the model wrote none and gave no count, in the house's
 * language: plain words, no confidence (ADR 0104), and not a repeat of the
 * page's own "The photo gave no count." A count with no note says nothing.
 */
export const NO_COUNT_NOTE = {
  en: "Type the count, or take the photo again closer and in good light.",
  tr: "Sayıyı yazın ya da fotoğrafı daha yakından ve iyi ışıkta yeniden çekin.",
} as const;
export type NoteLanguage = keyof typeof NO_COUNT_NOTE;

/**
 * One clause, read inside the sheet's "The photo could not be read — …. Type
 * the count instead." (InventorySheets.tsx), when
 * this gateway has no photo reader switched on. The operator's fix (the model
 * key) goes to the log, never to the house (onboarding walk 2026-11-11: the
 * page said "set ANTHROPIC_API_KEY" to a restaurant user).
 */
export const PHOTO_READER_OFF =
  "counting from a photo is not switched on here yet";

/** One clause, so it reads inside the sheet's "The photo could not be read — …". */
export const UNREADABLE_PHOTO =
  "This photo's format cannot be read here; take it as a JPEG or PNG";

/**
 * The type the bytes are, by magic number, of the four the model reads; else
 * null. HEIC/HEIF (`ftyp`), PDF and unknown bytes used to go as image/jpeg.
 */
export function sniffPhotoMediaType(base64: string) {
  const head = Buffer.from(base64.slice(0, 16), "base64");
  const at = (i: number, bytes: number[]) =>
    bytes.every((b, k) => head[i + k] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

export interface PhotoCountEstimate {
  suggestedQty: number | null;
  confidence: "low" | "medium" | "high";
  note: string;
}

/**
 * Photo counting (SimPOS testbed plan, decision E46) — vision-derived
 * SUGGESTION only. Mirrors the "nothing here writes stock" posture of
 * document-intake.service.ts: this call touches no database table and
 * returns a number for the counting UI to drop into the quantity field,
 * exactly like the Web Speech voice path (decision E45) — a human still has
 * to look at it and tap "submit count" before anything reaches
 * apply_stock_movement.
 */
@Injectable()
export class PhotoCountService {
  private readonly logger = new Logger(PhotoCountService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
    private readonly nfVerdicts: NfVerdictService,
  ) {}

  /**
   * @param eventRef optional handle on the NF row this call writes, supplied by
   * a caller that intends to grade the suggestion later (OD-59). Created by the
   * caller rather than returned from here so the response shape the controller
   * serialises to the browser is unchanged.
   */
  async estimate(
    imageBase64: string,
    itemName: string,
    restaurantId?: string,
    eventRef?: NfEventRef,
    lang: NoteLanguage = "en",
  ): Promise<PhotoCountEstimate> {
    // Refused before the key check, so no model call is spent on it.
    const mediaType = sniffPhotoMediaType(imageBase64);
    if (!mediaType) throw new BadRequestException(UNREADABLE_PHOTO);

    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      this.logger.error(
        "Photo count refused: ANTHROPIC_API_KEY is not set on this gateway",
      );
      throw new ServiceUnavailableException(PHOTO_READER_OFF);
    }

    try {
      // P1 NF-A: model client owns transport + emission. The 30s budget is a
      // product choice (interactive counting UI) and is preserved as an
      // explicit override of the client's 60s default.
      const payload: any = await this.modelClient.call({
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: imageBase64,
                  },
                },
                {
                  type: "text",
                  text: `${COUNT_PROMPT} Write the note in ${lang === "tr" ? "Turkish" : "English"}.\n\nItem being counted: "${itemName}".`,
                },
              ],
            },
          ],
        },
        timeoutMs: 30_000,
        nf: {
          subjectId: "PhotoCount",
          taskType: "photo_count",
          stimulus: "shelf_photo",
          choice: "count_estimate",
          restaurantId: restaurantId ?? null,
          eventRef,
        },
      });

      const content: string = payload?.content?.[0]?.text ?? "";
      const { estimate, parsed } = this.parseResponseGraded(content, lang);
      if (eventRef) {
        this.nfVerdicts.record(
          eventRef,
          PARSE_BASIS,
          photoCountParseVerdict({
            parsed,
            suggestedQty: estimate.suggestedQty,
            confidence: estimate.confidence,
          }),
        );
      }
      return estimate;
    } catch (error: any) {
      this.logger.error(`Photo count estimate failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Photo count estimate temporarily unavailable",
      );
    }
  }

  /**
   * The same parse, plus whether the response parsed at all.
   *
   * OD-59: a model that DECLINED to count and a response nothing could read
   * both produce `suggestedQty: null` with the same note, and they are
   * different outcomes — one is the prompt working, the other is a wasted call.
   */
  private parseResponseGraded(text: string, lang: NoteLanguage): {
    estimate: PhotoCountEstimate;
    parsed: boolean;
  } {
    try {
      const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const suggestedQty =
        typeof parsed.suggestedQty === "number" &&
        Number.isFinite(parsed.suggestedQty) &&
        parsed.suggestedQty >= 0
          ? Math.round(parsed.suggestedQty)
          : null;
      const confidence: PhotoCountEstimate["confidence"] =
        parsed.confidence === "high" || parsed.confidence === "medium"
          ? parsed.confidence
          : "low";
      return {
        estimate: {
          suggestedQty,
          confidence,
          note:
            typeof parsed.note === "string" && parsed.note
              ? parsed.note
              : suggestedQty === null
                ? NO_COUNT_NOTE[lang]
                : "",
        },
        parsed: true,
      };
    } catch {
      this.logger.warn(
        `Failed to parse photo count response: ${text.slice(0, 200)}`,
      );
      return {
        estimate: {
          suggestedQty: null,
          confidence: "low",
          note: NO_COUNT_NOTE[lang],
        },
        parsed: false,
      };
    }
  }
}
