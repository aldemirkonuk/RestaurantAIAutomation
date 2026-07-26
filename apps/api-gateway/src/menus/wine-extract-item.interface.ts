export interface WineExtractItem {
  name: string;
  producer?: string; // e.g. 'Chateau Margaux', 'Duckhorn' — required for reliable library matching
  category?: string; // 'red' | 'white' | 'sparkling' | 'rosé' | 'dessert' | 'other'
  vintage?: string; // e.g. '2019', '2020'
  region?: string; // e.g. 'Burgundy', 'Napa Valley'
  grape_variety?: string; // e.g. 'Pinot Noir', 'Chardonnay'
  by_glass_price?: number;
  bottle_price?: number;
  raw_text?: string; // original text line from scan/csv
}
