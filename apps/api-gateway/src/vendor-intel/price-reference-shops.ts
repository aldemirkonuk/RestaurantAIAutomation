/**
 * The merchant-shop registry — where a class-D retail reference comes from.
 *
 * WHOSE DECISION THIS IS
 * ----------------------
 * ADR 0117 Q9 asked whether the vendor sweep is pointed at the wrong
 * population: it reads `providers`, and the 23 vendors in `vendor_catalogue`
 * are US three-tier wholesalers, importers and Turkish producers — zero of the
 * twenty reachable ones publish a price. Every page the size reader was built
 * against is a retail MERCHANT shop. The founder answered on 2026-09-05:
 * **"Point it at merchant shops, as their own class."**
 *
 * "As their own class" is the load-bearing half. A merchant's shelf price is
 * class D (ADR 0117): a consumer-facing reference that may be compared only to
 * other class-D lines and never placed beside a wholesale quote. So these shops
 * do NOT feed `vendor_price_observations` — they feed `price_index_postings`,
 * the sibling register keyed by jurisdiction, which `belowTrailingAverage`
 * does not read at all. The separation is structural, not a check that could be
 * forgotten.
 *
 * WHY A CONFIG FILE AND NOT A `price_reference_shops` TABLE
 * ---------------------------------------------------------
 * The brief allowed either and asked for the decision on evidence. Five things
 * decided it:
 *
 * 1. **The sibling register already answers this question in code.**
 *    `price-index/price-index.registry.ts` holds every class-B/D/E source with
 *    its issuer, jurisdiction, cadence, terms and a `withheld`/`silent` record
 *    carrying `measuredOn`. A shop is the same kind of entry. Two registries
 *    for one register would be two answers to "where does a source come from".
 * 2. **A shop row's content is the evidence of a fetch**, not configuration:
 *    what robots.txt said, on what day, at what status, with which crawl delay
 *    and visit window, and whether the shop states a date on its prices. That
 *    belongs where it can be reviewed and where `git blame` says who claimed it.
 *    A table row records none of that.
 * 3. **Arming a shop starts outbound requests in the house's name.**
 *    `isSweepArmed`'s docblock (`vendor-site-sweep.ts`) already argues that a
 *    job with that property must not be switchable without a deploy. A boolean
 *    column would let anyone with `service_role` arm a crawler with no review.
 *    The arming here stays an environment allow-list, per environment.
 * 4. **A seeded table is a production write executed by a merge.** Migrations
 *    auto-apply on merge in this repo, so seeding shops by migration would take
 *    the founder's decision to point at a particular shop out of his hands and
 *    put it in a squash-merge. This session was told to make no production
 *    write; a config file makes none by construction.
 * 5. **Cost.** A table needs a migration, RLS, two guards, a CRUD surface
 *    nobody asked for, and a second definition of the same fields.
 *
 * THE COUNTER-ARGUMENT, STATED RATHER THAN HIDDEN. An operator cannot add a
 * shop without a deploy, and no house can keep its own shop list. Both are
 * true. Neither costs anything today: the register has deliberately no
 * `restaurant_id` (the migration's own comment says so — it is public and keyed
 * by jurisdiction), so a per-house list has nowhere to live; and a shop may not
 * be added until a fetch has PROVEN its terms, which is a research act with an
 * evidence trail, not a settings toggle. The day a non-engineer must add shops
 * at will, this file becomes the seed for a table and the argument is
 * reopened — that is the trigger, recorded here so it is not rediscovered.
 *
 * EVERY FACT BELOW WAS MEASURED. Each shop carries the date of the fetch that
 * proved it. A shop whose terms could not be read is recorded as unarmed WITH
 * THE REASON, never quietly omitted: an omitted shop and a refused shop read
 * identically to anyone looking at this file, and only one of them means
 * "we looked".
 */

/** The environment variable that arms this sweep at all. Allow-list. */
export const SHOP_SWEEP_ENABLED_FLAG = "PRICE_REFERENCE_SHOP_SWEEP_ENABLED";

/**
 * The environment variable naming WHICH shops may be fetched, comma-separated.
 *
 * Two switches, not one, and deliberately: the first says this job may run at
 * all, the second says which third parties it may touch. A single flag would
 * mean that arming the sweep for one shop arms it for every shop added later,
 * including one added by a merge nobody read closely.
 */
export const SHOP_ARMED_KEYS_FLAG = "PRICE_REFERENCE_SHOPS_ARMED";

/** Why a shop in this registry is not fetched. A value, never an absence. */
export type ShopUnarmedReason =
  | "terms_unstated"
  | "fetch_refused"
  | "no_price_published"
  | "serves_no_house"
  /**
   * The shop quotes a currency that is not its own market's to an anonymous
   * visitor. ADR 0117 Q29, founder 2026-09-05: **"Not a source until it quotes
   * GBP unprompted."**
   *
   * Its own code, added because it was being filed under `terms_unstated` with
   * a detail that began "Not a terms problem but a CURRENCY one" — a reason
   * that has to apologise for itself is the wrong reason, and it made the one
   * shop blocked on presentment currency invisible to any count of shops
   * blocked on terms.
   */
  | "quotes_another_market_currency";

export interface ShopRobotsEvidence {
  /** The day the robots.txt below was fetched with the sweep's own agent. */
  fetchedOn: string;
  httpStatus: number;
  /** The host's own `Crawl-delay`, in seconds, or null when it states none. */
  crawlDelaySeconds: number | null;
  /**
   * The host's own `Visit-time` window in UTC, `HHMM-HHMM`, or null.
   *
   * Non-standard and rare — and www.bbr.com publishes one. Honoured, because a
   * publisher that states an hours window has told us when it wants to be read
   * and our silence about it would be a choice to ignore it.
   */
  visitTimeUtc: string | null;
  /** True when the group for our agent disallows the product path. */
  disallowsProducts: boolean;
  /** The verbatim directives that matter, so the claim above is checkable. */
  note: string;
}

export interface ShopEntry {
  key: string;
  shopName: string;
  /** ISO-3166-2, matching `price_index_postings.state`'s CHECK. */
  jurisdiction: string;
  /**
   * The currency the shop's jurisdiction prices in. A page served in another
   * currency is REFUSED rather than filed: a London shop's price presented in
   * USD is not the UK shelf price, and putting it on a GB index line beside
   * GBP lines is the comparison this whole ADR exists to prevent. Measured on
   * hedonism.co.uk, which serves USD to an anonymous fetcher.
   */
  currency: string;
  baseUrl: string;
  /** Where product pages live, for the robots check and for the sitemap. */
  productPathPrefix: string;
  /** How often a shelf price is worth re-reading. Days. */
  cadenceDays: number;
  robots: ShopRobotsEvidence;
  /** The terms as STATED by the shop, and where they were read. */
  terms: string;
  /**
   * Does this shop state a date its price applies from?
   *
   * The admission test of ADR 0117 that shop pages fail most often. Measured
   * per shop on the recorded fixtures: schema.org `Offer.validFrom`. `false`
   * here is a measurement on the pages read, not a claim about every page the
   * shop serves — the sweep still asks page by page and refuses page by page.
   */
  statesIssueDate: boolean;
  /** Where the price is machine-readable, in the order it was found. */
  priceMarkup: Array<"json_ld_offer" | "microdata" | "og_meta">;
  /**
   * Present when this shop must not be fetched, with the reason and — the part
   * that keeps a block honest — the exact re-measurement that would lift it.
   *
   * `armsWhen` exists because a block with no stated exit is a block somebody
   * deletes in six months for looking stale. It names an observation, not an
   * intention: a person can go and make it, and until they do the row stays as
   * it is (`armedShopKeys` drops any key carrying this object, whatever the
   * environment variable says).
   */
  unarmed?: {
    reason: ShopUnarmedReason;
    detail: string;
    measuredOn: string;
    /** What must be OBSERVED for this shop to be armable. Never a date. */
    armsWhen: string;
  };
}

/**
 * The shops, and what was measured about each.
 *
 * The five GB/US shops are the ones the size reader fetched on 2026-09-04 and
 * whose reduced pages are the committed fixtures; their robots.txt was
 * re-fetched on 2026-09-05 for this file, because a term proved yesterday is
 * not a term proved today. The Michigan, Illinois, California and Türkiye
 * entries were measured on 2026-09-05 for this file, to answer the brief's
 * question of which of the estate's markets can be served at all.
 */
export const SHOPS: Readonly<Record<string, ShopEntry>> = Object.freeze({
  "bbr-gb": {
    key: "bbr-gb",
    shopName: "Berry Bros. & Rudd",
    jurisdiction: "GB-ENG",
    currency: "GBP",
    baseUrl: "https://www.bbr.com",
    productPathPrefix: "/products-",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: 10,
      visitTimeUtc: "0200-0700",
      disallowsProducts: false,
      note:
        "1,502 bytes. `User-agent: *` disallows /cart, /checkout, /my-account, /search and `/*?q=*` only. It also publishes `Crawl-delay: 10`, `Request-rate: 1/10` and `Visit-time: 0200-0700` — the only visit window in this registry, and the reason `withinVisitWindow` exists. The two committed BBR fixtures were fetched at 02:08Z, inside it.",
    },
    terms:
      "robots.txt only; no separate crawl terms found on the site. Named bots (Ahrefs, Semrush, Yandex, Amazonbot, CCBot, PetalBot and others) are disallowed wholesale; WineOpsBot is not among them and falls under `*`.",
    statesIssueDate: false,
    priceMarkup: ["json_ld_offer"],
  },
  "slurp-gb": {
    key: "slurp-gb",
    shopName: "Slurp",
    jurisdiction: "GB-ENG",
    currency: "GBP",
    baseUrl: "https://www.slurp.co.uk",
    productPathPrefix: "/products/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "3,628 bytes, Shopify's storefront file. `/products/` is allowed; /cart, /checkout, /orders, /account and Shopify-internal paths are disallowed. The header carries prose addressed at shopping agents (a UCP/MCP endpoint, a Shopify skill URL, and 'Checkouts are for humans'). It is a third party's text, read as data: nothing in it was acted on, and this sweep never reaches a cart.",
    },
    terms: "Shopify storefront robots.txt; Shopify's terms of service linked from it.",
    statesIssueDate: false,
    priceMarkup: ["json_ld_offer"],
  },
  "tanners-gb": {
    key: "tanners-gb",
    shopName: "Tanners Wines",
    jurisdiction: "GB-ENG",
    currency: "GBP",
    baseUrl: "https://www.tanners-wines.co.uk",
    productPathPrefix: "/products/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note: "3,660 bytes, Shopify's storefront file. No Crawl-delay, no visit window, /products/ allowed.",
    },
    terms: "Shopify storefront robots.txt.",
    // The ONE shop in this registry measured to state a date on its price:
    // `Offer.validFrom` 2026-09-05 with `priceValidUntil` 2026-12-04.
    statesIssueDate: true,
    priceMarkup: ["json_ld_offer", "og_meta"],
  },
  "hedonism-gb": {
    key: "hedonism-gb",
    shopName: "Hedonism Wines",
    jurisdiction: "GB-ENG",
    currency: "GBP",
    baseUrl: "https://hedonism.co.uk",
    productPathPrefix: "/products/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note: "3,624 bytes, Shopify's storefront file. /products/ allowed.",
    },
    terms: "Shopify storefront robots.txt.",
    statesIssueDate: false,
    priceMarkup: ["json_ld_offer", "og_meta"],
    unarmed: {
      reason: "quotes_another_market_currency",
      detail:
        "ADR 0117 Q29, the founder 2026-09-05: \"Not a source until it quotes GBP unprompted.\" This is a London shop whose jurisdiction here is GB-ENG, and its own structured data serves `priceCurrency: USD` and `og:price:currency: USD` to an anonymous fetcher — measured on the committed fixture `hedonism-ruinart-2026-09-04.fixture.html`. A USD figure filed on a GB index line is not the UK shelf price. The rejected fix was to send a `?currency=GBP` hint or a locale header: a price whose currency depends on what we sent is a price we half-made, and it would be filed as the shop's own shelf price with no way for a reader to tell. So the shop is registered and NOT fetched, and it stays that way while its answer to an anonymous visitor is USD.",
      measuredOn: "2026-09-05",
      armsWhen:
        "hedonism.co.uk serves `priceCurrency: GBP` — in its JSON-LD offer or its `og:price:currency` — to an ANONYMOUS fetcher sending no market, locale or currency hint of any kind. Re-fetch a product page with the sweep's own agent, record the fixture, and only then remove this block. A GBP figure obtained by asking for GBP does not count and must not be recorded as if it did.",
    },
  },
  "winechateau-us-nj": {
    key: "winechateau-us-nj",
    shopName: "Wine Chateau",
    jurisdiction: "US-NJ",
    currency: "USD",
    baseUrl: "https://winechateau.com",
    productPathPrefix: "/products/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note: "3,622 bytes after a 301 from www to the apex; Shopify's storefront file. /products/ allowed.",
    },
    terms: "Shopify storefront robots.txt.",
    statesIssueDate: false,
    priceMarkup: ["json_ld_offer", "og_meta"],
    unarmed: {
      reason: "serves_no_house",
      detail:
        "New Jersey. The register is scoped to a house's own jurisdiction at read time, and no house in the estate is in NJ (3 Michigan, 3 Illinois, 3 California, 2 Türkiye, 1 UK, 2 with no state recorded — `price-sources.md`). Fetching it would write rows no house can see, which is the Iowa/Oregon asymmetry again. It stays registered because it is a committed fixture and the US half of the size reader's evidence. CONFIRMED by the founder 2026-09-05 (ADR 0117 Q29): it stays off until a house is in its market.",
      measuredOn: "2026-09-05",
      armsWhen:
        "A house in the estate records `state_province` in New Jersey. This is a fact about the estate, not about the shop: nothing Wine Chateau does can lift it, and nothing about it needs re-measuring. Until then a row fetched here would be visible to nobody.",
    },
  },
  "hitime-us-ca": {
    key: "hitime-us-ca",
    shopName: "Hi-Time Wine Cellars",
    jurisdiction: "US-CA",
    currency: "USD",
    baseUrl: "https://www.hitimewine.net",
    productPathPrefix: "/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: 10,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "1,674 bytes. `Crawl-delay: 10`; disallows the transactional BigCommerce endpoints (/cart.php, /checkout, /login.php, /search.php and the rest). Product pages are root-level slugs and are allowed; `/xmlsitemap.php?type=products` is a permitted enumeration route and returned 1,154,767 bytes of product URLs on 2026-09-05.",
    },
    terms: "robots.txt only.",
    statesIssueDate: false,
    // The shop that made the precedence necessary: measured 2026-09-05 on
    // `/pommery-brut-royal-354430`, the ONLY schema.org block is a
    // BreadcrumbList — no Product, no Offer. The price is in microdata
    // (`itemprop="price" content="54.99"`) and in Open Graph
    // (`product:price:amount` 54.99, `product:price:currency` USD, with
    // `og:price:standard_amount` 59.95 as the struck-through was-price).
    priceMarkup: ["microdata", "og_meta"],
  },
  "merchants-us-mi": {
    key: "merchants-us-mi",
    shopName: "Merchant's Fine Wine",
    jurisdiction: "US-MI",
    currency: "USD",
    baseUrl: "https://merchantsfinewine.com",
    productPathPrefix: "/products/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "1,248 bytes, and it contains NO directives at all — 24 lines, every one a comment. It is the Cloudflare content-signals preamble, which defines `search`, `ai-input` and `ai-train` signals and then states no signal, plus an express reservation of rights under Article 4 of EU Directive 2019/790.",
    },
    terms:
      "The file's own rule (c) applies: where the operator includes no content signal, it 'neither grants nor restricts permission via content signal'. Unstated terms are recorded as unstated, never as permissive (ADR 0117).",
    statesIssueDate: false,
    priceMarkup: [],
    unarmed: {
      reason: "terms_unstated",
      detail:
        "Michigan is the estate's best-covered state (3 of 14 houses) and this is the one Michigan merchant whose robots.txt could be read on 2026-09-05 — and it declares the content-signals framework while stating no signal, alongside an express Article 4 reservation. That is an explicit 'neither granted nor restricted'. No page was fetched.",
      measuredOn: "2026-09-05",
      armsWhen:
        "merchantsfinewine.com states a content signal — any signal — in its robots.txt, or states terms elsewhere that a person has read and recorded here. Silence is not permission and does not become permission by ageing: re-reading the same 24 comment lines next year changes nothing.",
    },
  },
  "binnys-us-il": {
    key: "binnys-us-il",
    shopName: "Binny's Beverage Depot",
    jurisdiction: "US-IL",
    currency: "USD",
    baseUrl: "https://www.binnys.com",
    productPathPrefix: "/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "297 bytes. Disallows /search, /EPiServer/CMS/, /Util/, two API paths and /blog?*; product pages are allowed and two sitemaps are advertised.",
    },
    terms: "robots.txt only.",
    statesIssueDate: false,
    priceMarkup: [],
    unarmed: {
      reason: "fetch_refused",
      detail:
        "robots.txt answered 200 and permits the sitemap it advertises — and the sitemap itself answered HTTP 403 with a Cloudflare 'Attention Required!' body (4,574 bytes) to the same polite agent on 2026-09-05. That is a fact about our fetcher, not about Binny's prices, and Illinois (3 of 14 houses) therefore has no readable merchant shop today.",
      measuredOn: "2026-09-05",
      armsWhen:
        "the advertised sitemap answers 200 to the sweep's own agent. This is our fetcher's problem, not the shop's, so the observation to make is a plain re-fetch — and a 403 that persists is a measurement worth keeping, not a reason to try harder.",
    },
  },
  "klwines-us-ca": {
    key: "klwines-us-ca",
    shopName: "K&L Wine Merchants",
    jurisdiction: "US-CA",
    currency: "USD",
    baseUrl: "https://www.klwines.com",
    productPathPrefix: "/p/",
    cadenceDays: 7,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 403,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "HTTP 403 (5,606 bytes of challenge page) to the robots.txt request itself, re-measured 2026-09-05 — the same result `price-sources.md` recorded on 2026-09-04.",
    },
    terms:
      "Unread. A crawl rule that cannot be fetched has not been honoured, so nothing here may be fetched: 'until a robots.txt is actually read, no retail sweep may be written' (price-sources.md, UK retail row).",
    statesIssueDate: false,
    priceMarkup: [],
    unarmed: {
      reason: "fetch_refused",
      detail:
        "Its robots.txt is behind a challenge, so the shop's own crawl rules are unknown. Registered so the next person does not spend the request finding out again.",
      measuredOn: "2026-09-05",
      armsWhen:
        "its robots.txt answers 200 to the sweep's own agent, so the shop's crawl rules can be read before anything else is. A rule that cannot be fetched has not been honoured.",
    },
  },
  "kavaklidere-tr": {
    key: "kavaklidere-tr",
    shopName: "Kavaklidere Saraplari",
    // TR has no subdivision here and `price_index_postings.state` requires
    // `^[A-Z]{2}-[A-Z0-9]{1,3}$`, so a bare 'TR' could not be written even if a
    // price existed. Recorded as the country code the register would need a
    // subdivision for; it is moot while the shop is unarmed, and it is named in
    // the ADR as the constraint a Turkish source would hit first.
    jurisdiction: "TR",
    currency: "TRY",
    baseUrl: "https://www.kavaklidere.com",
    productPathPrefix: "/",
    cadenceDays: 30,
    robots: {
      fetchedOn: "2026-09-05",
      httpStatus: 200,
      crawlDelaySeconds: null,
      visitTimeUtc: null,
      disallowsProducts: false,
      note:
        "293 bytes. `*` is allowed everything but /wp-admin/. It disallows `Google-Extended`, `GPTBot` and `CCBot` by name — the three AI-ingestion agents — while permitting ordinary crawlers.",
    },
    terms:
      "robots.txt permits `*`; the named AI-crawler blocks are an expressed intent against AI ingestion. This reader is not one of those agents and reads markup rather than sending the page to a model, but the intent is recorded rather than argued away.",
    statesIssueDate: false,
    priceMarkup: [],
    unarmed: {
      reason: "no_price_published",
      detail:
        "Fetched 2026-09-05: the homepage is 170,717 bytes and contains no price signal at all — zero occurrences of the lira sign, of 'TL', of 'fiyat' and of a cart. That is what Turkish law predicts: Law 4250 art. 6 and the sales regulation md. 11/1 make consumer-facing online alcohol sale unlawful, so no Turkish shop publishes a price to fetch. (The statute was reachable only through secondary commentary on 2026-09-04 — `price-sources.md` records it as unverified at primary source — and the measured behaviour is what is asserted here.) The two Türkiye houses have no merchant-shop line, and this row is why.",
      measuredOn: "2026-09-05",
      armsWhen:
        "a Turkish merchant publishes a price to an anonymous visitor at all. Nothing here is about kavaklidere.com in particular: while Law 4250 art. 6 stands, no Turkish shop has a price to fetch, so this row is a fact about the market and it lifts when the market changes.",
    },
  },
});

/** Every shop whose terms and reachability allow it to be fetched at all. */
export const FETCHABLE_SHOP_KEYS: readonly string[] = Object.freeze(
  Object.values(SHOPS)
    .filter((s) => !s.unarmed)
    .map((s) => s.key),
);

/**
 * Which shop keys this environment has armed.
 *
 * A key that is not in the registry, or is registered but unarmed, is dropped
 * with a reason rather than fetched. Unknown keys are returned so the caller
 * can say "you armed a shop that does not exist" instead of running silently.
 */
export function armedShopKeys(raw: string | null | undefined): {
  armed: string[];
  unknown: string[];
  refused: Array<{
    key: string;
    reason: ShopUnarmedReason;
    detail: string;
    /** What must be observed for this key to become armable. */
    armsWhen: string;
  }>;
} {
  const wanted = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const armed: string[] = [];
  const unknown: string[] = [];
  const refused: Array<{
    key: string;
    reason: ShopUnarmedReason;
    detail: string;
    armsWhen: string;
  }> = [];
  for (const key of wanted) {
    const shop = SHOPS[key];
    if (!shop) {
      unknown.push(key);
      continue;
    }
    if (shop.unarmed) {
      refused.push({
        key,
        reason: shop.unarmed.reason,
        detail: shop.unarmed.detail,
        armsWhen: shop.unarmed.armsWhen,
      });
      continue;
    }
    armed.push(key);
  }
  return { armed, unknown, refused };
}

/** The shops that serve a house in this jurisdiction, armed or not. */
export function shopsForJurisdiction(state: string | null): ShopEntry[] {
  if (!state) return [];
  const s = state.trim().toUpperCase();
  return Object.values(SHOPS).filter((shop) => shop.jurisdiction === s);
}
