import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface PublicVendorListing {
  id: string;
  productName: string;
  producer: string | null;
  vintage: number | null;
  region: string | null;
  country: string | null;
  grapeVarieties: string | null;
  price: number | null;
  currency: string;
  packSize: number;
  volumeMl: number | null;
  unitLabel: string | null;
  inStock: boolean | null;
  minOrderQuantity: number | null;
  leadTimeDays: number | null;
  notes: string | null;
}

export interface PublicVendorPage {
  slug: string;
  displayName: string;
  tagline: string | null;
  about: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  updatedAt: string;
  listings: PublicVendorListing[];
}

/**
 * Read model for the public vendor catalogue page.
 *
 * The column list on every query is explicit and deliberately narrow. A
 * `select("*")` here would ship edit_token — the entire authentication
 * mechanism for vendor editing — to anyone who loads the page. Naming columns
 * means a future column is invisible until someone decides it should be
 * public, which is the correct default for an endpoint with no auth at all.
 */
@Injectable()
export class VendorPortalService {
  private readonly logger = new Logger(VendorPortalService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async getPublishedPage(slug: string): Promise<PublicVendorPage> {
    const normalized = (slug || "").trim().toLowerCase();

    const { data: page, error } = await this.databaseService.supabase
      .from("vendor_portal_pages")
      .select(
        "id, slug, display_name, tagline, about, logo_url, contact_email, contact_phone, website_url, updated_at",
      )
      .eq("slug", normalized)
      .eq("is_published", true)
      .maybeSingle();

    // Unpublished and nonexistent both return 404. Distinguishing them would
    // let anyone enumerate which vendors have draft pages.
    if (error || !page) {
      throw new NotFoundException("Vendor page not found");
    }

    const { data: listings } = await this.databaseService.supabase
      .from("vendor_portal_listings")
      .select(
        "id, product_name, producer, vintage, region, country, grape_varieties, price, currency, pack_size, volume_ml, unit_label, in_stock, min_order_quantity, lead_time_days, notes",
      )
      .eq("page_id", page.id)
      .order("sort_order", { ascending: true })
      .order("product_name", { ascending: true });

    return {
      slug: page.slug,
      displayName: page.display_name,
      tagline: page.tagline ?? null,
      about: page.about ?? null,
      logoUrl: page.logo_url ?? null,
      contactEmail: page.contact_email ?? null,
      contactPhone: page.contact_phone ?? null,
      websiteUrl: page.website_url ?? null,
      updatedAt: page.updated_at,
      listings: (listings ?? []).map((l: any) => ({
        id: l.id,
        productName: l.product_name,
        producer: l.producer ?? null,
        vintage: l.vintage ?? null,
        region: l.region ?? null,
        country: l.country ?? null,
        grapeVarieties: l.grape_varieties ?? null,
        price: l.price === null || l.price === undefined ? null : Number(l.price),
        currency: l.currency ?? "USD",
        packSize: l.pack_size ?? 1,
        volumeMl: l.volume_ml ?? null,
        unitLabel: l.unit_label ?? null,
        inStock: l.in_stock ?? null,
        minOrderQuantity: l.min_order_quantity ?? null,
        leadTimeDays: l.lead_time_days ?? null,
        notes: l.notes ?? null,
      })),
    };
  }

  /**
   * schema.org ItemList of Product/Offer.
   *
   * This is the reason the portal is worth hosting. A vendor typing a price
   * once produces structured data we read back as JSON — an api_catalog
   * observation at trust tier 3 — instead of an LLM guessing at HTML for a
   * tier-4 website_scrape. It also makes the page legible to every other
   * crawler, which is the vendor's own reason to keep it current.
   *
   * Listings with no price emit no Offer rather than an Offer of zero. A
   * zero-price Offer is a valid document and a false statement.
   */
  buildJsonLd(page: PublicVendorPage, canonicalUrl: string): Record<string, unknown> {
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${page.displayName} — wine catalogue`,
      url: canonicalUrl,
      numberOfItems: page.listings.length,
      itemListElement: page.listings.map((l, i) => {
        const product: Record<string, unknown> = {
          "@type": "Product",
          name: l.productName,
          ...(l.producer ? { brand: { "@type": "Brand", name: l.producer } } : {}),
          ...(l.vintage ? { productionDate: String(l.vintage) } : {}),
          ...(l.region || l.country
            ? { countryOfOrigin: l.country ?? l.region }
            : {}),
          ...(l.volumeMl
            ? {
                size: {
                  "@type": "QuantitativeValue",
                  value: l.volumeMl,
                  unitCode: "MLT",
                },
              }
            : {}),
        };

        if (l.price !== null) {
          product.offers = {
            "@type": "Offer",
            price: l.price,
            priceCurrency: l.currency,
            ...(l.packSize > 1
              ? {
                  eligibleQuantity: {
                    "@type": "QuantitativeValue",
                    value: l.packSize,
                  },
                }
              : {}),
            availability:
              l.inStock === null
                ? "https://schema.org/InStock"
                : l.inStock
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
            seller: { "@type": "Organization", name: page.displayName },
          };
        }

        return { "@type": "ListItem", position: i + 1, item: product };
      }),
    };
  }
}
