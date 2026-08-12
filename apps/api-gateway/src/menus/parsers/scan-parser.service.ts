import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { WineExtractItem } from "../wine-extract-item.interface";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const WINE_EXTRACTION_PROMPT =
  "You are analyzing a restaurant wine list or beverage menu image. " +
  "Extract all wine and beverage items you can identify. For each item return JSON: " +
  "{ name, producer, category, vintage, region, grape_variety, by_glass_price, bottle_price, raw_text }. " +
  "producer is the winery/estate/château name if distinguishable from the wine's cuvée/label name " +
  "(e.g. for 'Duckhorn Merlot', producer is 'Duckhorn' and name is 'Merlot' or 'Duckhorn Merlot' as printed). " +
  "If the menu only prints one name with no separable producer, set producer to the same value as name. " +
  "Return ONLY a JSON array with no surrounding text. " +
  "If a field is not visible, omit it. " +
  'Example: [{"name":"Chateau Margaux","producer":"Chateau Margaux","category":"red","vintage":"2018","bottle_price":120}]';

@Injectable()
export class ScanParserService {
  private readonly logger = new Logger(ScanParserService.name);

  constructor(private readonly configService: ConfigService) {}

  async parse(imageBase64: string): Promise<WineExtractItem[]> {
    const apiKey = this.configService.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Anthropic API key not configured — set ANTHROPIC_API_KEY",
      );
    }

    // Infer image media type from base64 prefix bytes
    const mediaType = this.detectMediaType(imageBase64);

    const isPdf = mediaType === "application/pdf";

    try {
      const response = await axios.post(
        ANTHROPIC_API_URL,
        {
          model: "claude-haiku-4-5",
          // A real wine list costs ~55-60 output tokens per wine, so 4096 —
          // the previous value — truncated the JSON on any menu past ~70
          // wines. Measured against datasets/annotation_inbox/pdfs: a 2-page,
          // 76-wine list needs 4,363 tokens and a 13-page, 199-wine list needs
          // 11,808, so three of four sampled menus silently produced nothing
          // (the truncated array failed JSON.parse and parseJsonResponse
          // returned []). 16000 covers ~270 wines and stays under the
          // non-streaming HTTP timeout; past that the stop_reason check below
          // reports the truncation instead of hiding it.
          max_tokens: 16000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: isPdf ? "document" : "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: imageBase64,
                  },
                },
                { type: "text", text: WINE_EXTRACTION_PROMPT },
              ],
            },
          ],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 60_000,
        },
      );

      const content: string = response.data?.content?.[0]?.text ?? "";
      const stopReason: string = response.data?.stop_reason ?? "";
      const items = this.parseJsonResponse(content);

      // Truncation used to be invisible: the cut-off array failed JSON.parse
      // and the caller got an empty list indistinguishable from "this menu had
      // no wines". Salvaging partial results is the right call for a menu
      // import (60 of 199 wines beats 0), but it must be logged loudly so the
      // gap is attributable rather than mysterious.
      if (stopReason === "max_tokens") {
        this.logger.error(
          `Menu extraction hit the ${16000}-token output cap — recovered ` +
            `${items.length} wine(s) from a truncated response. The menu is ` +
            `larger than one request can return; split it or move this call ` +
            `to a streaming request with a higher max_tokens.`,
        );
      }
      return items;
    } catch (error) {
      this.logger.error(`Scan parser LLM call failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Menu scan service temporarily unavailable",
      );
    }
  }

  private detectMediaType(
    base64: string,
  ): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf" {
    if (base64.startsWith("JVBERi0")) return "application/pdf";
    if (base64.startsWith("/9j/")) return "image/jpeg";
    if (base64.startsWith("iVBORw")) return "image/png";
    if (base64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg"; // safe default
  }

  private parseJsonResponse(text: string): WineExtractItem[] {
    const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return this.keepNamedItems(parsed);
    } catch {
      // A truncated array is the common failure (output token cap), and it is
      // recoverable: every element before the cut is still well-formed JSON.
      // Returning those beats discarding a whole menu import.
      const salvaged = this.salvageTruncatedArray(cleaned);
      if (salvaged.length > 0) {
        this.logger.warn(
          `LLM JSON response was truncated — salvaged ${salvaged.length} complete item(s)`,
        );
        return salvaged;
      }
      this.logger.warn(
        `Failed to parse LLM JSON response: ${cleaned.slice(0, 200)}`,
      );
      return [];
    }
  }

  private keepNamedItems(parsed: unknown[]): WineExtractItem[] {
    return parsed.filter(
      (item: unknown): item is WineExtractItem =>
        typeof (item as any)?.name === "string" && (item as any).name.length > 0,
    );
  }

  /**
   * Pull every complete `{...}` element out of a JSON array that was cut off
   * mid-write. Scans with a depth counter so nested objects stay intact, and
   * ignores braces inside string literals (wine names contain quotes and
   * escapes often enough to matter).
   */
  private salvageTruncatedArray(text: string): WineExtractItem[] {
    const start = text.indexOf("[");
    if (start === -1) return [];

    const items: unknown[] = [];
    let depth = 0;
    let objStart = -1;
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try {
            items.push(JSON.parse(text.slice(objStart, i + 1)));
          } catch {
            // Skip an element we can't parse; keep collecting the rest.
          }
          objStart = -1;
        }
      }
    }
    return this.keepNamedItems(items);
  }
}
