import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { ItemNutritionService } from "./item-nutrition.service";
import {
  draftFromFoodDataCentral,
  draftFromOpenFoodFacts,
  type LookupChoice,
  type NutritionDraft,
} from "./nutrition-lookup";

/** Injected in tests so no spec ever goes outbound. */
export const NUTRITION_FETCH = "NUTRITION_FETCH";
type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The env var that switches raw-ingredient search on. Absent: skipped, and said. */
export const FDC_KEY_ENV = "USDA_FDC_API_KEY";
const OFF = "https://world.openfoodfacts.org";
const FDC = "https://api.nal.usda.gov/fdc/v1";
// Open Food Facts asks every app to name itself.
const USER_AGENT = "Mudavym/1.0 (inventory nutrition lookup; https://mudavym.com)";
const TIMEOUT_MS = 8000;

const OFF_UNREACHED = "Open Food Facts could not be reached, so nothing was looked up there.";
const FDC_UNREACHED = "USDA FoodData Central could not be reached, so raw ingredients were not searched.";
const FDC_SKIPPED = "Raw ingredients (USDA FoodData Central) are not searched: that lookup is not set up yet.";
const TYPE_INSTEAD = "You can type the figures from the pack instead.";

export type LookupAnswer =
  | { kind: "draft"; draft: NutritionDraft }
  | { kind: "choices"; choices: LookupChoice[]; said: string[] }
  | { kind: "none"; why: string; said: string[] };

export interface LookupRequest {
  barcode?: string;
  name?: string;
  fdcId?: string;
}

class Unreached extends Error {}

/**
 * Fill a DRAFT from a public source; never saves (the house confirms with
 * PUT .../nutrition). Open Food Facts needs no key. USDA FoodData Central is
 * used only when USDA_FDC_API_KEY is set; otherwise it is skipped and the
 * answer says so. A source that cannot be reached is a 502 sentence, never an
 * empty answer.
 */
@Injectable()
export class NutritionLookupService {
  private readonly logger = new Logger(NutritionLookupService.name);
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly nutrition: ItemNutritionService,
    @Optional() @Inject(NUTRITION_FETCH) fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private fdcKey(): string | null {
    return process.env[FDC_KEY_ENV]?.trim() || null;
  }

  /** null on a 404 (no such product); throws Unreached on anything that is not an answer. */
  private async getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      this.logger.warn(`nutrition lookup: ${url.split("?")[0]} unreachable: ${(e as Error).message}`);
      throw new Unreached();
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.warn(`nutrition lookup: ${url.split("?")[0]} answered ${res.status}`);
      throw new Unreached();
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      throw new Unreached();
    }
  }

  async lookup(restaurantId: string, itemId: string, req: LookupRequest): Promise<LookupAnswer> {
    const given = [req.barcode, req.name, req.fdcId].filter((v) => typeof v === "string" && v.trim() !== "");
    if (given.length !== 1) {
      throw new BadRequestException("Look up by one thing: a barcode, a name, or a FoodData Central entry.");
    }
    // The item must be this house's; its unit says per 100 g or 100 ml.
    const { suggestedBasis } = await this.nutrition.read(restaurantId, itemId);

    if (req.barcode) {
      const code = req.barcode.trim();
      if (!/^\d{6,14}$/.test(code)) throw new BadRequestException("A barcode is 6 to 14 digits.");
      let body: Record<string, unknown> | null;
      try {
        body = await this.getJson(
          `${OFF}/api/v2/product/${code}.json?fields=product_name,brands,quantity,product_quantity_unit,nutriments,allergens_tags,traces_tags`,
          { "User-Agent": USER_AGENT },
        );
      } catch {
        throw new BadGatewayException(`${OFF_UNREACHED} ${TYPE_INSTEAD}`);
      }
      const product = body?.product as Record<string, unknown> | undefined;
      if (!body || body.status === 0 || !product) {
        return { kind: "none", why: `Open Food Facts has no product with barcode ${code}.`, said: [] };
      }
      return { kind: "draft", draft: draftFromOpenFoodFacts(code, product, suggestedBasis) };
    }

    if (req.fdcId) {
      const id = req.fdcId.trim();
      if (!/^\d{1,10}$/.test(id)) throw new BadRequestException("A FoodData Central entry is a number.");
      const key = this.fdcKey();
      if (!key) throw new BadRequestException(FDC_SKIPPED);
      let food: Record<string, unknown> | null;
      try {
        food = await this.getJson(`${FDC}/food/${id}?format=full`, { "X-Api-Key": key });
      } catch {
        throw new BadGatewayException(`${FDC_UNREACHED} ${TYPE_INSTEAD}`);
      }
      if (!food) return { kind: "none", why: `FoodData Central has no entry ${id}.`, said: [] };
      return { kind: "draft", draft: draftFromFoodDataCentral(id, food) };
    }

    const name = (req.name ?? "").trim();
    if (name.length < 2 || name.length > 100) throw new BadRequestException("Search by a name of 2 to 100 letters.");
    const key = this.fdcKey();
    const q = encodeURIComponent(name);
    const [off, fdc] = await Promise.allSettled([
      this.getJson(
        `${OFF}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=5&fields=code,product_name,brands`,
        { "User-Agent": USER_AGENT },
      ),
      key
        ? this.getJson(`${FDC}/foods/search?query=${q}&pageSize=5&dataType=Foundation,SR%20Legacy`, { "X-Api-Key": key })
        : Promise.resolve(null),
    ]);
    const said: string[] = [];
    const choices: LookupChoice[] = [];
    if (off.status === "rejected") said.push(OFF_UNREACHED);
    else {
      for (const p of ((off.value?.products as unknown[]) ?? []).slice(0, 5)) {
        const r = p as Record<string, unknown>;
        const code = String(r.code ?? "");
        const pname = typeof r.product_name === "string" ? r.product_name.trim() : "";
        if (/^\d{6,14}$/.test(code) && pname) {
          choices.push({ source: "open_food_facts", ref: code, name: pname, brand: typeof r.brands === "string" && r.brands.trim() ? r.brands.trim() : null });
        }
      }
    }
    if (!key) said.push(FDC_SKIPPED);
    else if (fdc.status === "rejected") said.push(FDC_UNREACHED);
    else {
      for (const f of ((fdc.value?.foods as unknown[]) ?? []).slice(0, 5)) {
        const r = f as Record<string, unknown>;
        if (r.fdcId !== undefined && typeof r.description === "string") {
          choices.push({ source: "usda_fdc", ref: String(r.fdcId), name: r.description, brand: null });
        }
      }
    }
    const offFailed = off.status === "rejected";
    const fdcFailed = !key || fdc.status === "rejected";
    if (offFailed && fdcFailed) throw new BadGatewayException(`${said.join(" ")} ${TYPE_INSTEAD}`);
    if (choices.length === 0) return { kind: "none", why: `Nothing called “${name}” was found.`, said };
    return { kind: "choices", choices, said };
  }
}
