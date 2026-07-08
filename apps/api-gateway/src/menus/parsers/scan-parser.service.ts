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
  "{ name, category, vintage, region, grape_variety, by_glass_price, bottle_price, raw_text }. " +
  "Return ONLY a JSON array with no surrounding text. " +
  "If a field is not visible, omit it. " +
  'Example: [{"name":"Chateau Margaux","category":"red","vintage":"2018","bottle_price":120}]';

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

    try {
      const response = await axios.post(
        ANTHROPIC_API_URL,
        {
          model: "claude-haiku-4-5",
          max_tokens: 4096,
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
      return this.parseJsonResponse(content);
    } catch (error) {
      this.logger.error(`Scan parser LLM call failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Menu scan service temporarily unavailable",
      );
    }
  }

  private detectMediaType(
    base64: string,
  ): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
    if (base64.startsWith("/9j/")) return "image/jpeg";
    if (base64.startsWith("iVBORw")) return "image/png";
    if (base64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg"; // safe default
  }

  private parseJsonResponse(text: string): WineExtractItem[] {
    try {
      const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item: unknown): item is WineExtractItem =>
          typeof (item as any)?.name === "string" &&
          (item as any).name.length > 0,
      );
    } catch {
      this.logger.warn(
        `Failed to parse LLM JSON response: ${text.slice(0, 200)}`,
      );
      return [];
    }
  }
}
