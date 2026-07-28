/**
 * Pure query-shaping helpers for distributor discovery.
 *
 * Kept free of DI so they can be tested directly, following the convention set
 * by common/orchestrator/promo-extract.ts and procurement/documents/line-matcher.ts.
 */

/**
 * Escape LIKE/ILIKE metacharacters in user input.
 *
 * The search RPC builds `'%' || p_q || '%'`, so an unescaped `%` or `_` typed by
 * a user is a wildcard rather than a literal: searching for `100%` would
 * otherwise match every vendor. Backslash is Postgres's default LIKE escape
 * character, so escaping it first keeps a literal backslash literal.
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export type FacetSelection = Record<string, string[]>;

/**
 * Turn repeated `kind:slug` query params into the jsonb shape the RPC expects.
 *
 * Values sharing a kind are OR'd, distinct kinds are AND'd, which is what the
 * grouping here encodes:
 *   ["region:burgundy", "region:rhone", "varietal:pinot-noir"]
 *     -> { region: ["burgundy", "rhone"], varietal: ["pinot-noir"] }
 *
 * Returns null for an empty selection so the caller can pass SQL NULL and skip
 * the filter entirely rather than matching against an empty object.
 */
export function parseFacets(facets?: string[]): FacetSelection | null {
  if (!facets?.length) return null;

  const out: FacetSelection = {};
  for (const raw of facets) {
    const idx = raw.indexOf(":");
    if (idx <= 0 || idx === raw.length - 1) continue;

    const kind = raw.slice(0, idx);
    const slug = raw.slice(idx + 1);
    const bucket = (out[kind] ??= []);
    if (!bucket.includes(slug)) bucket.push(slug);
  }

  return Object.keys(out).length ? out : null;
}

/**
 * A viewport is only usable when all four corners are present and the box is
 * non-degenerate. Partial bboxes are dropped rather than half-applied, so a
 * dropped param cannot silently narrow results.
 */
export function normalizeBbox(b: {
  minLng?: number;
  minLat?: number;
  maxLng?: number;
  maxLat?: number;
}): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  const { minLng, minLat, maxLng, maxLat } = b;
  if ([minLng, minLat, maxLng, maxLat].some((v) => typeof v !== "number" || Number.isNaN(v))) {
    return null;
  }
  if (minLng! >= maxLng! || minLat! >= maxLat!) return null;
  return { minLng: minLng!, minLat: minLat!, maxLng: maxLng!, maxLat: maxLat! };
}

/** Group flat facet-count rows into the shape the filter rail renders. */
export function groupFacetCounts(
  rows: Array<{ facet_kind: string; facet_slug: string; facet_value: string; vendors: number }>,
): Record<string, Array<{ slug: string; value: string; vendors: number }>> {
  const out: Record<string, Array<{ slug: string; value: string; vendors: number }>> = {};
  for (const r of rows ?? []) {
    (out[r.facet_kind] ??= []).push({
      slug: r.facet_slug,
      value: r.facet_value,
      vendors: Number(r.vendors) || 0,
    });
  }
  return out;
}
