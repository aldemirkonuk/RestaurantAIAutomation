import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModelClientService } from "../common/model-client/model-client.service";

const COUNT_PROMPT =
  "You are helping a bar/restaurant staff member count bottles of a specific " +
  "wine on a shelf or in a bin, from a single photo. Count only intact, " +
  "visibly full-or-partial bottles of the wine described. Return ONLY a JSON " +
  'object, no surrounding text: {"suggestedQty": <integer or null>, ' +
  '"confidence": "low"|"medium"|"high", "note": "<one short sentence>"}. ' +
  'Set suggestedQty to null and confidence to "low" if the photo does not ' +
  "clearly show countable bottles (e.g. too blurry, wrong item, empty shelf " +
  "with no bottles). Never guess wildly — a null with a clear note is better " +
  "than a confident wrong number.";

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
  ) {}

  async estimate(
    imageBase64: string,
    wineName: string,
    restaurantId?: string,
  ): Promise<PhotoCountEstimate> {
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Anthropic API key not configured — set ANTHROPIC_API_KEY",
      );
    }

    const mediaType = this.detectMediaType(imageBase64);

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
                  text: `${COUNT_PROMPT}\n\nWine being counted: "${wineName}".`,
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
        },
      });

      const content: string = payload?.content?.[0]?.text ?? "";
      return this.parseResponse(content);
    } catch (error: any) {
      this.logger.error(`Photo count estimate failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Photo count estimate temporarily unavailable",
      );
    }
  }

  private detectMediaType(
    base64: string,
  ): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
    if (base64.startsWith("/9j/")) return "image/jpeg";
    if (base64.startsWith("iVBORw")) return "image/png";
    if (base64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg";
  }

  private parseResponse(text: string): PhotoCountEstimate {
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
        suggestedQty,
        confidence,
        note:
          typeof parsed.note === "string" && parsed.note
            ? parsed.note
            : "Could not read a confident count from this photo.",
      };
    } catch {
      this.logger.warn(
        `Failed to parse photo count response: ${text.slice(0, 200)}`,
      );
      return {
        suggestedQty: null,
        confidence: "low",
        note: "Could not read a confident count from this photo.",
      };
    }
  }
}
