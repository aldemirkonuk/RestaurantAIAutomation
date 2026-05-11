import { Injectable } from '@nestjs/common';
import { WineExtractItem } from '../wine-extract-item.interface';

type PriceField = 'by_glass_price' | 'bottle_price';
type TextField = Exclude<keyof WineExtractItem, PriceField | 'raw_text'>;

// Maps lowercased CSV header aliases → WineExtractItem field names
const HEADER_MAP: Record<string, keyof WineExtractItem> = {
  name: 'name',
  wine_name: 'name',
  item: 'name',
  vintage: 'vintage',
  year: 'vintage',
  region: 'region',
  appellation: 'region',
  grape: 'grape_variety',
  variety: 'grape_variety',
  grape_variety: 'grape_variety',
  category: 'category',
  type: 'category',
  by_glass: 'by_glass_price',
  glass_price: 'by_glass_price',
  by_glass_price: 'by_glass_price',
  bottle: 'bottle_price',
  bottle_price: 'bottle_price',
};

const PRICE_FIELDS = new Set<keyof WineExtractItem>(['by_glass_price', 'bottle_price']);

@Injectable()
export class CsvParserService {
  parse(csvContent: string): WineExtractItem[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = this.parseLine(lines[0]).map((h) => h.toLowerCase().trim());
    const fieldMap: Array<keyof WineExtractItem | null> = headers.map(
      (h) => HEADER_MAP[h] ?? null,
    );

    const items: WineExtractItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseLine(lines[i]);
      const item: Partial<WineExtractItem> = {};

      fieldMap.forEach((field, colIdx) => {
        if (!field) return;
        const raw = cols[colIdx]?.trim();
        if (!raw) return;

        if (PRICE_FIELDS.has(field)) {
          const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
          if (!isNaN(num)) (item as any)[field] = num;
        } else {
          (item as any)[field] = raw;
        }
      });

      if (item.name) {
        item.raw_text = lines[i].trim();
        items.push(item as WineExtractItem);
      }
    }

    return items;
  }

  // Respects double-quoted fields that may contain commas
  private parseLine(line: string): string[] {
    const results: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        results.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    results.push(current);
    return results;
  }
}
