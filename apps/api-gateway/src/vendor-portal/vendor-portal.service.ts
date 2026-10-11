import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
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
    if (error) {
      this.logger.warn(`Published vendor page read failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Could not load this catalogue. Please try again.",
      );
    }
    if (!page) {
      throw new NotFoundException("Vendor page not found");
    }

    const { data: listings, error: listingsError } =
      await this.databaseService.supabase
        .from("vendor_portal_listings")
        .select(
          "id, product_name, producer, vintage, region, country, grape_varieties, price, currency, pack_size, volume_ml, unit_label, in_stock, min_order_quantity, lead_time_days, notes",
        )
        .eq("page_id", page.id)
        .order("sort_order", { ascending: true })
        .order("product_name", { ascending: true });

    if (listingsError) {
      this.logger.warn(
        `Published vendor listings read failed: ${listingsError.message}`,
      );
      throw new ServiceUnavailableException(
        "Could not load this catalogue. Please try again.",
      );
    }

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
        price:
          l.price === null || l.price === undefined ? null : Number(l.price),
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
}
