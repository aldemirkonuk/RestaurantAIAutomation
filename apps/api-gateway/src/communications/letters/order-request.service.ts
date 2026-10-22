import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../../database/database.service";
import { lookupRestaurantRole } from "../../organizations/organizations.service";
import { currencyCode } from "../../common/iso-4217";
import {
  DEFAULT_ORDER_REQUEST_TEMPLATES,
  ORDER_REQUEST_KIND,
  ORDER_REQUEST_TEMPLATE_KEY,
  houseLocale,
  renderOrderRequest,
  type OrderRequestFacts,
  type OrderRequestLine,
  type OrderRequestLocale,
  type OrderRequestRender,
} from "./order-request-letter";

/** `communication_templates.type` of a letter template (house-letters.service.ts LETTER_TEMPLATE_TYPE). */
const LETTER_TEMPLATE_TYPE = "letter";

/**
 * The one gateway door for an order's request letter (W25; ADR 0313, 4a-i).
 *
 * Reads the order, its lines, the house, the vendor, the vendor's stated
 * terms and the placer with the placer's role here; renders the house's
 * PUBLISHED order letter (4a-ii: the version its `published_version_id`
 * names, when that version is in the letter's language) or else Mudavym's
 * default; and, with `stage`, stages the letter through `stage_order_letter`
 * (ADR 0266) as an `ORDER_REQUEST`.
 *
 * THE DRAFT IS NEVER READ. A house's saved-but-unpublished words
 * (`communication_templates.body`) never reach a vendor; only a version a
 * preview and a publish made does (ADR 0313, 0173 D2).
 *
 * TENANCY. The caller is a service (the orchestrator, behind ServiceKeyGuard)
 * and carries no house. Every read after the order's is scoped by the ORDER
 * ROW's `restaurant_id`, never by anything in the request. A `restaurantId`
 * the caller sends is only a cross-check: one that disagrees with the row is
 * answered 404, the same as an order that does not exist.
 *
 * A FAILED READ IS A FAILURE. A read that errors throws; it is never taken as
 * "no terms" or "no address", because a letter rendered without a fact the
 * house has would tell the vendor less than it should and look complete. The
 * one exception is the placer's role: a role that cannot be read is treated
 * as no role, which only ever removes money and the placer's name (fail
 * closed, W12b F6).
 *
 * LOCALE (ADR 0313, F3). The letter's language comes from the house's
 * `restaurants.country`: trimmed, lower-cased the Turkish way, diacritics
 * folded; "tr", "turkey" or "türkiye"/"turkiye" writes Turkish, anything else
 * (NULL included) writes English. No locale column exists on restaurants or
 * providers; `houseLocale` in order-request-letter.ts is the one rule.
 */
export interface OrderRequestResult extends OrderRequestRender {
  orderId: string;
  restaurantId: string;
  /** "house": the published version; "default": Mudavym's words. */
  template: { key: string; source: "house" | "default" };
  /** Which words exactly (ADR 0313, I6): the version (null for the default) and their sha256. */
  templateVersion: { id: string | null; version: number | null; hash: string };
  staged: boolean | null;
  conversationId: string | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function positive(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

@Injectable()
export class OrderRequestService {
  private readonly logger = new Logger(OrderRequestService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.supabase;
  }

  async render(params: {
    orderId: string;
    restaurantId?: string | null;
    courtesySentence?: string | null;
    stage: boolean;
  }): Promise<OrderRequestResult> {
    const facts = await this.readFacts(params.orderId, params.restaurantId ?? null);
    const template = await this.publishedTemplate(facts.restaurantId, facts.facts.locale ?? "en");
    let rendered: OrderRequestRender;
    try {
      rendered = renderOrderRequest(facts.facts, {
        template: template.body,
        courtesySentence: params.courtesySentence ?? null,
      });
    } catch (e: any) {
      throw new UnprocessableEntityException(
        template.source === "house"
          ? `The house's published order letter (version ${template.version}) can no longer be used: ${e?.message ?? "it could not be rendered"} Publish it again from the order letter sheet, or reset it to Mudavym's words.`
          : (e?.message ?? "The letter could not be rendered."),
      );
    }

    const result: OrderRequestResult = {
      ...rendered,
      orderId: facts.facts.orderId,
      restaurantId: facts.restaurantId,
      template: { key: ORDER_REQUEST_TEMPLATE_KEY, source: template.source },
      templateVersion: { id: template.versionId, version: template.version, hash: template.hash },
      staged: null,
      conversationId: null,
    };
    if (!params.stage) return result;

    const row = {
      order_id: facts.facts.orderId,
      restaurant_id: facts.restaurantId,
      provider_id: facts.providerId,
      direction: "outbound",
      channel: "email",
      message_text: rendered.body,
      content: rendered.body,
      // The courtesy sentence is the only AI-written text; without one the
      // letter is the renderer's alone.
      ai_generated: !!rendered.parts.courtesy_line,
      status: "PENDING_APPROVAL",
      outbound_email_type: ORDER_REQUEST_KIND,
      round_count: 0,
      // F4: the Mudavym line is in the body already; the sender must not add a second.
      disclaimer_appended: true,
      email_headers: {
        subject: rendered.subject,
        template_key: ORDER_REQUEST_TEMPLATE_KEY,
        renderer_version: rendered.rendererVersion,
        facts_hash: rendered.factsHash,
        // Which words (ADR 0313, I6): the published version, or null for
        // Mudavym's default; the hash of the words either way.
        template_source: template.source,
        template_version_id: template.versionId,
        template_hash: template.hash,
      },
    };
    const { data, error } = await this.db.rpc("stage_order_letter", {
      p_row: row,
      p_kind: ORDER_REQUEST_KIND,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST202" || String(error.message ?? "").includes("PGRST202")) {
        // The function is not deployed yet: nothing was staged, and saying so
        // is the whole answer. The caller keeps its own letter.
        throw new ServiceUnavailableException(
          "The order letter door (stage_order_letter) is not deployed yet; nothing was staged.",
        );
      }
      throw new InternalServerErrorException(
        `The letter could not be staged (${error.message}); nothing is reported as staged.`,
      );
    }
    const answer = (Array.isArray(data) ? data[0] : data) as
      | { id?: string; staged?: boolean }
      | null;
    if (!answer?.id) {
      throw new InternalServerErrorException("stage_order_letter returned no id; nothing is reported as staged.");
    }
    // staged:false means the order already had a live letter: relayed as-is,
    // with that letter's id.
    result.staged = answer.staged === true;
    result.conversationId = answer.id;
    return result;
  }

  /**
   * The words this house's letter is rendered from: the version its order
   * letter's `published_version_id` names, read under the house, when it is in
   * the letter's language; else Mudavym's default for that language. A failed
   * read throws: rendering the default over a house that published its own
   * words would send words the house replaced.
   */
  async publishedTemplate(
    restaurantId: string,
    locale: OrderRequestLocale,
  ): Promise<{
    body: string;
    source: "house" | "default";
    versionId: string | null;
    version: number | null;
    hash: string;
  }> {
    const fallback = () => {
      const body = DEFAULT_ORDER_REQUEST_TEMPLATES[locale];
      return { body, source: "default" as const, versionId: null, version: null, hash: sha256(body) };
    };
    const { data: row, error } = await this.db
      .from("communication_templates")
      .select("id, published_version_id")
      .eq("restaurant_id", restaurantId)
      .eq("type", LETTER_TEMPLATE_TYPE)
      .eq("category", ORDER_REQUEST_TEMPLATE_KEY)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The house's order letter could not be read (${error.message}); no letter is written over words it may have replaced.`,
      );
    }
    const r = row as { id?: string; published_version_id?: string | null } | null;
    if (!r?.id || !r.published_version_id) return fallback();
    const { data: v, error: vError } = await this.db
      .from("letter_template_versions")
      .select("id, version, locale, body, body_hash")
      .eq("id", r.published_version_id)
      .eq("restaurant_id", restaurantId)
      .eq("template_id", r.id)
      .maybeSingle();
    if (vError) {
      throw new InternalServerErrorException(
        `The house's published order letter could not be read (${vError.message}); no letter is written over words it may have replaced.`,
      );
    }
    const version = v as { id: string; version: number; locale: string; body: string } | null;
    if (!version) {
      throw new InternalServerErrorException(
        "The house's order letter names a published version that cannot be found under the house; no letter is written.",
      );
    }
    // Published in the other language: this letter is written in the house's
    // language, so Mudavym's words for it (ADR 0313 R4).
    if (version.locale !== locale) return fallback();
    return {
      body: version.body,
      source: "house",
      versionId: version.id,
      version: Number(version.version),
      hash: sha256(version.body),
    };
  }

  /** Every fact the letter can show, read under the order row's house. */
  async readFacts(
    orderId: string,
    claimedRestaurantId: string | null,
  ): Promise<{ facts: OrderRequestFacts; restaurantId: string; providerId: string }> {
    const { data: order, error: orderError } = await this.db
      .from("procurement_orders")
      .select("id, order_number, restaurant_id, provider_id, created_by, expected_delivery_date")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) {
      throw new InternalServerErrorException(`The order could not be read (${orderError.message}).`);
    }
    const o = order as Record<string, any> | null;
    if (!o || (claimedRestaurantId != null && o.restaurant_id !== claimedRestaurantId)) {
      throw new NotFoundException("No such order.");
    }
    const restaurantId: string = o.restaurant_id;
    const providerId: string = o.provider_id;

    const [items, house, vendor, terms] = await Promise.all([
      this.db
        .from("procurement_order_items")
        .select(
          "wine_name, vendor_sku, quantity, unit_type, bottles_per_unit, final_unit_price, negotiated_unit_price, quoted_unit_price, price_uom, price_pack_size, currency, line_no, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .order("line_no", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      this.db
        .from("restaurants")
        .select("name, address, city, postal_code, state_province, country")
        .eq("id", restaurantId)
        .maybeSingle(),
      this.db
        .from("providers")
        .select("contact_first_name")
        .eq("id", providerId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
      this.db
        .from("restaurant_vendor_terms")
        .select("payment_terms")
        .eq("restaurant_id", restaurantId)
        .eq("provider_id", providerId)
        .maybeSingle(),
    ]);
    for (const [what, r] of [
      ["the order's lines", items],
      ["the house", house],
      ["the vendor", vendor],
      ["the vendor's terms", terms],
    ] as const) {
      if (r.error) {
        throw new InternalServerErrorException(`${what} could not be read (${r.error.message}).`);
      }
    }
    const h = house.data as Record<string, any> | null;
    if (!h?.name) throw new InternalServerErrorException("The order's house could not be read.");

    const lines: OrderRequestLine[] = ((items.data as Record<string, any>[] | null) ?? []).map(
      (row) => {
        // The price already told to the vendor (W12c F7), from the LINE only.
        // A NULL or zero line price is no price: the header's final_price is
        // 0 on a no-price order and is never read here.
        const amount =
          positive(row.final_unit_price) ??
          positive(row.negotiated_unit_price) ??
          positive(row.quoted_unit_price);
        const unit = text(row.unit_type);
        return {
          name: text(row.wine_name) ?? "Unnamed line",
          vendorSku: text(row.vendor_sku),
          quantity: Number(row.quantity),
          unit,
          bottlesPerUnit: positive(row.bottles_per_unit),
          price:
            amount == null
              ? null
              : {
                  amount,
                  currency: currencyCode(row.currency),
                  uom: text(row.price_uom),
                  packSize: positive(row.price_pack_size),
                },
        };
      },
    );
    if (lines.length === 0) {
      throw new UnprocessableEntityException(
        "This order has no line written down, so there is nothing to ask the vendor for.",
      );
    }
    if (lines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) {
      throw new BadRequestException("A line on this order has no quantity; the letter is not written.");
    }

    // The placer and their role in THIS house now. NULL creator (recurring
    // orders, procurement.service.ts asUuid) or no role: no money, house signs.
    let placer: OrderRequestFacts["placer"] = { userId: null, name: null, role: null };
    const createdBy = text(o.created_by);
    if (createdBy) {
      const { role, readError } = await lookupRestaurantRole(this.db, createdBy, restaurantId);
      if (readError) {
        this.logger.warn(
          `Placer role unreadable for order ${orderId} (${readError}); the letter shows no price and the house signs alone.`,
        );
      }
      const { data: person, error: personError } = await this.db
        .from("users")
        .select("name")
        .eq("user_id", createdBy)
        .maybeSingle();
      if (personError) {
        throw new InternalServerErrorException(`The placer could not be read (${personError.message}).`);
      }
      placer = {
        userId: createdBy,
        name: text((person as { name?: string } | null)?.name),
        role: readError ? null : role,
      };
    }

    const address = (h.address ?? {}) as Record<string, unknown>;
    const addressParts = [
      text(address.street),
      text(h.city),
      text(h.postal_code),
      text(h.state_province),
      text(h.country),
    ].filter((p): p is string => p != null);

    return {
      restaurantId,
      providerId,
      facts: {
        orderId,
        orderNumber: String(o.order_number),
        houseName: String(h.name),
        vendorFirstName: text((vendor.data as { contact_first_name?: string } | null)?.contact_first_name),
        lines,
        placer,
        deliverTo: addressParts.length > 0 ? addressParts.join(", ") : null,
        neededBy: text(o.expected_delivery_date)?.slice(0, 10) ?? null,
        paymentTerms: text((terms.data as { payment_terms?: string } | null)?.payment_terms),
        locale: houseLocale(text(h.country)),
      },
    };
  }
}
