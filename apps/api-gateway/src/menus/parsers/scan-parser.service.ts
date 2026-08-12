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

  /**
   * Extract wines from a menu image or PDF.
   *
   * Large PDFs are split into page-range chunks and extracted separately, then
   * merged. Measured on datasets/annotation_inbox/pdfs: a wine costs ~58
   * output tokens, so a menu past ~270 wines cannot fit in one response — and
   * 3 of the 4 largest menus in that corpus hit the cap (RL Restaurant,
   * Saison, Obelix all returned stop_reason=max_tokens). Splitting keeps every
   * sub-request far inside the limit and is preferred over raising max_tokens,
   * which is already at the practical non-streaming ceiling.
   */
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

    // Page count alone is a poor predictor of output size: RL Restaurant
    // truncates at 12 pages (491 priced lines, ~41/page) while Theodora fits
    // at 65 pages (328 lines, ~5/page). So pre-split only the obviously-large
    // PDFs — where one request is near-certain waste — and otherwise let
    // truncation itself trigger the split. That costs one wasted call on a
    // dense short menu and zero on everything else, without guessing a
    // density threshold the corpus would immediately violate.
    if (isPdf) {
      const preSplit = await this.splitPdfIfLarge(imageBase64);
      if (preSplit.length > 1) return this.parseChunks(preSplit, apiKey);
    }

    const first = await this.parseOne(imageBase64, mediaType, isPdf, apiKey);
    if (!first.truncated || !isPdf) return first.items;

    const chunks = await this.splitPdfIfLarge(imageBase64, { force: true });
    if (chunks.length <= 1) {
      // Single-page PDF, or unsplittable — the salvaged partial is all there is.
      this.logger.error(
        `Menu truncated and could not be split — importing ` +
          `${first.items.length} partial item(s)`,
      );
      return first.items;
    }

    this.logger.log(
      `Menu truncated on a single request — retrying as ${chunks.length} page-range chunk(s)`,
    );
    const retried = await this.parseChunks(chunks, apiKey);
    // Keep whichever run recovered more; a split should always win, but never
    // return less than the first attempt already proved was extractable.
    return retried.length >= first.items.length ? retried : first.items;
  }

  /**
   * Extract each chunk in sequence and merge, de-duplicating across the seam.
   *
   * Sequential rather than parallel: a 40-page menu is 3-4 chunks, and firing
   * them concurrently multiplies the burst against the org's rate limit for no
   * meaningful latency win on an import that is already asynchronous.
   *
   * A chunk that fails does not abort the rest — a partial menu with a loud
   * error beats losing the whole import, matching how truncation is handled.
   */
  private async parseChunks(
    chunks: string[],
    apiKey: string,
    depth = 0,
  ): Promise<WineExtractItem[]> {
    // Splitting once is not always enough. RL Restaurant packs ~27 wines per
    // page, so even a 6-page chunk overflows the output cap. Rather than guess
    // a page size that survives the densest menu, halve again whenever a chunk
    // reports truncation — the cap itself is the signal. Bounded so a
    // pathological PDF cannot recurse indefinitely.
    const MAX_SPLIT_DEPTH = 3;
    const all: WineExtractItem[] = [];
    const failed: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const { items, truncated } = await this.parseOne(
          chunks[i],
          "application/pdf",
          true,
          apiKey,
        );

        if (truncated && depth < MAX_SPLIT_DEPTH) {
          const finer = await this.splitPdfIfLarge(chunks[i], {
            force: true,
            pagesPerChunk: 2,
          });
          if (finer.length > 1) {
            this.logger.log(
              `Menu chunk ${i + 1}/${chunks.length} still truncated — ` +
                `re-splitting into ${finer.length} (depth ${depth + 1})`,
            );
            const deeper = await this.parseChunks(finer, apiKey, depth + 1);
            // Never regress: keep whichever pass recovered more.
            all.push(...(deeper.length >= items.length ? deeper : items));
            continue;
          }
        }

        all.push(...items);
        this.logger.log(
          `Menu chunk ${i + 1}/${chunks.length}: ${items.length} item(s)` +
            (truncated ? " (still truncated — cannot split further)" : ""),
        );
      } catch (err: any) {
        failed.push(i + 1);
        this.logger.error(
          `Menu chunk ${i + 1}/${chunks.length} failed: ${err?.message}`,
        );
      }
    }

    if (failed.length === chunks.length) {
      throw new ServiceUnavailableException(
        "Menu scan failed — every page range errored",
      );
    }
    if (failed.length > 0) {
      this.logger.error(
        `Menu extracted with gaps — chunk(s) ${failed.join(", ")} of ` +
          `${chunks.length} failed; ${all.length} item(s) recovered`,
      );
    }

    const merged = this.dedupe(all);
    this.logger.log(
      `Menu split into ${chunks.length} chunk(s): ${all.length} item(s) ` +
        `-> ${merged.length} after dedupe`,
    );
    return merged;
  }

  /**
   * Drop repeats across chunk boundaries. A wine printed in a section header
   * that spans a page break can legitimately appear in two chunks; the same
   * (producer, name, vintage) twice is a seam artifact, not two wines.
   */
  private dedupe(items: WineExtractItem[]): WineExtractItem[] {
    const seen = new Set<string>();
    const out: WineExtractItem[] = [];
    for (const item of items) {
      const norm = (v: unknown) =>
        String(v ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const key = `${norm(item.producer)}|${norm(item.name)}|${norm(
        (item as any).vintage,
      )}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  private async parseOne(
    imageBase64: string,
    mediaType: string,
    isPdf: boolean,
    apiKey: string,
  ): Promise<{ items: WineExtractItem[]; truncated: boolean }> {
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
          // A full 16,000-token response takes ~100s at Haiku's measured
          // throughput (~160 tok/s; Rose Mary produced 11,808 tokens in 73s).
          // The previous 60s timeout therefore fired *before* a large menu
          // could finish — converting truncation into a hard failure and
          // hiding the stop_reason signal the split retry depends on. Sized
          // to comfortably clear a maxed-out response plus upload time.
          timeout: 180_000,
        },
      );

      const content: string = response.data?.content?.[0]?.text ?? "";
      const stopReason: string = response.data?.stop_reason ?? "";
      const items = this.parseJsonResponse(content);

      // Truncation used to be invisible: the cut-off array failed JSON.parse
      // and the caller got an empty list indistinguishable from "this menu had
      // no wines". Salvage keeps the partial result, and the flag lets the
      // caller re-run the same PDF split into page ranges.
      const truncated = stopReason === "max_tokens";
      if (truncated) {
        this.logger.warn(
          `Menu extraction hit the 16000-token output cap — salvaged ` +
            `${items.length} wine(s) from a truncated response`,
        );
      }
      return { items, truncated };
    } catch (error) {
      this.logger.error(`Scan parser LLM call failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Menu scan service temporarily unavailable",
      );
    }
  }

  /**
   * Split a PDF into page-range chunks when it is large enough to risk hitting
   * the output token cap. Returns `[original]` unchanged when splitting is
   * unnecessary or impossible, so the caller never has to special-case it.
   *
   * PAGES_PER_CHUNK is set from measurement, not intuition: the densest menu
   * in the corpus (Obelix) ran ~19 wines/page and truncated at 13 pages, so a
   * 10-page chunk leaves roughly 2.7x headroom under the ~270-wine ceiling
   * even on a denser list.
   */
  private async splitPdfIfLarge(
    base64: string,
    opts: { force?: boolean; pagesPerChunk?: number } = {},
  ): Promise<string[]> {
    // `force` is used on the truncation retry, where page count already
    // proved to be the wrong signal — split whatever we have.
    const SPLIT_THRESHOLD_PAGES = opts.force ? 1 : 12;
    const PAGES_PER_CHUNK = opts.pagesPerChunk ?? (opts.force ? 6 : 10);

    let source: Buffer;
    try {
      source = Buffer.from(base64, "base64");
    } catch {
      return [base64];
    }

    try {
      // Lazy import: only large PDFs pay the cost of loading pdf-lib.
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(source, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      if (pageCount <= SPLIT_THRESHOLD_PAGES) return [base64];

      const chunks: string[] = [];
      for (let start = 0; start < pageCount; start += PAGES_PER_CHUNK) {
        const end = Math.min(start + PAGES_PER_CHUNK, pageCount);
        const out = await PDFDocument.create();
        const pages = await out.copyPages(
          doc,
          Array.from({ length: end - start }, (_, k) => start + k),
        );
        pages.forEach((p) => out.addPage(p));
        chunks.push(Buffer.from(await out.save()).toString("base64"));
      }

      this.logger.log(
        `Menu PDF has ${pageCount} pages — split into ${chunks.length} chunk(s) ` +
          `of up to ${PAGES_PER_CHUNK} pages to stay under the output token cap`,
      );
      return chunks;
    } catch (err: any) {
      // An unsplittable PDF (encrypted, malformed) still deserves a shot at
      // single-request extraction — truncation handling downstream covers it.
      this.logger.warn(
        `Could not split menu PDF (${err?.message}) — sending as one request`,
      );
      return [base64];
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
