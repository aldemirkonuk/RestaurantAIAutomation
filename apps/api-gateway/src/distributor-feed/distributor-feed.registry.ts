/**
 * The declared distributor connection, and what each distributor actually
 * publishes — measured, on a named day, with the URL.
 *
 * THE SHAPE (ADR 0114, ADR 0126)
 * ------------------------------
 * ADR 0114's rule is "the house declares, each person consents". A distributor
 * feed fits that rule exactly: the licence is the HOUSE's, the login is a
 * PERSON's, and the thing being read is the house's own buying terms. So this is
 * a declared connection with a per-distributor sub-type, not an OAuth grant —
 * there is no provider, no token endpoint and no scope list, and putting it in
 * `integrations-oauth.constants.ts` beside Google and Microsoft would have
 * required inventing all three.
 *
 * THE HONEST STATE, AND IT IS THE WHOLE POINT OF THIS FILE
 * -------------------------------------------------------
 * **No Illinois distributor was found to publish a price feed a house could
 * connect, and two of the three forbid the attempt in their own words.** That is
 * a measurement, not an estimate, and it is why every entry below carries an
 * `availability` sentence rather than a "connect" button. The register would
 * rather say "this cannot be built, here is the sentence that proves it" than
 * draw a control that fails after a person types a password into it.
 *
 * The measurement, 2026-09-05, transcript in `$SP/p4ar-fetch-log.md`:
 *
 *   - `now.breakthrubev.com/robots.txt` publishes `User-agent: *` /
 *     `Allow: /bbg/en/login` / `Disallow: /`. The buyer portal forbids every
 *     automated reader everything except the login page.
 *   - `breakthrubev.com/terms-and-conditions` §6.2(c) forbids "access the Site
 *     through any automated means … (including use of scripts or web crawlers,
 *     data mining, scraping, robots, spiders, or any other data gathering or
 *     extraction tools)".
 *   - `southernglazers.com/terms-of-use` forbids "any robot, spider, or other
 *     automatic device, process, or means to access the Website for any
 *     purpose" AND, separately, "your account is personal to you and agree not
 *     to provide any other person with access to this Website or portions of it
 *     using your username, password, or other security information" — so
 *     handing this product a portal login is itself the breach, before any
 *     request is made.
 *   - `shop.sgproof.com/robots.txt` allows browsing but publishes
 *     `Crawl-delay: 10`, `Request-rate: 1/10` and `Visit-time: 0400-0845`. The
 *     research pass honoured it: the window was closed at 12:18 UTC and no page
 *     on that host was fetched.
 *   - `app.erndc.com` serves a login and publishes no `robots.txt` (404).
 *   - `analyticsapi.libdib.com/openapi.json` is public (HTTP 200, 70,801
 *     bytes) and is **not a price feed**: 52 paths, 49 schemas, and the string
 *     `price` occurs **zero** times in the whole document. It is LibDib's
 *     internal ML and telemetry portal. ADR 0117's registry called it "the most
 *     promising class-C connection"; that is corrected here.
 *   - Provi publishes no buyer-facing API at all; its integration is
 *     distributor-ERP-side and is set up by its own sales team ("complete the
 *     EDI setup").
 *
 * WHAT THE INDUSTRY ACTUALLY DOES, WHICH IS THE MORE USEFUL FINDING
 * ----------------------------------------------------------------
 * The buyer-side "distributor price list" is built from the buyer's own
 * invoices. MarginEdge says it in one sentence — "We update your order guides
 * based on your invoices" (`marginedge.com/bar-inventory`, HTTP 200,
 * 2026-09-05). Restaurant365's vendor table gives Southern Glazers, Republic
 * National Distributing and Youngs Market a tick under **Multi-Invoice** and
 * leaves **Order Guides** blank for all three. Fintech delivers "line-item
 * invoice data" and no catalogue. Southern Glazer's documented EDI set, on two
 * independent trading-partner pages, is 850 / 856 / 810 (/997) — **no 832**.
 *
 * Which means the Illinois answer is not a feed this product is missing. It is
 * that the house's own invoices ARE the licensee price list, and that path is
 * already built as ADR 0117 class A (`procurement/own-paper-sighting.ts`).
 */

/** What a house would actually connect to, if anything. */
export type FeedMechanism =
  /** An EDI 832 price/sales catalogue — a real price list. Nothing measured sends one. */
  | "edi_832_catalog"
  /** An EDI 810 invoice feed. Real, and it is the house's own paper (class A), not a list. */
  | "edi_810_invoice"
  /** A login, and no machine-readable route behind it that terms permit. */
  | "portal_only"
  /** Looked for, and there is nothing: no API, no export, no documented file. */
  | "none_documented";

/** Whether a machine may read this at all, in the publisher's own words. */
export type AutomatedAccessVerdict =
  | "forbidden"
  | "permitted_with_bounds"
  | "unstated";

export interface DistributorEntry {
  key: string;
  distributor: string;
  /** ISO-3166-2 jurisdictions this entry was measured for. */
  jurisdictions: string[];
  portal: { name: string; url: string } | null;
  mechanism: FeedMechanism;
  automatedAccess: {
    verdict: AutomatedAccessVerdict;
    /** The robots rule, verbatim, or the reason there is none. */
    robots: string;
    /** The terms clause, verbatim, or null when none was read. */
    terms: string | null;
    measuredOn: string;
    evidence: string[];
  };
  /**
   * The sentence a person reads on `/connections`. It says what is true today.
   * It never says "coming soon" and never draws a control that cannot work.
   */
  availability: string;
  /**
   * Present on every entry that cannot be connected — which today is every
   * entry. Deliberately the same shape as `price-index.registry.ts`'s
   * `withheld`, so a reader who has met one has met both.
   */
  unbuilt: { reason: string; measuredOn: string } | null;
  /**
   * The `CTP02` price-identifier codes this distributor's own implementation
   * guide defines, and what each means. EMPTY on every entry today, because no
   * distributor guide was obtained — and an empty map makes `parseEdi832`
   * refuse every row, which is the correct posture for a house that has not
   * been told what its distributor's codes mean.
   */
  priceBasisByCode: Readonly<Record<string, string>>;
}

/**
 * The declared connection itself. One definition, per-distributor sub-types.
 *
 * `dataHandling` is the same four required questions the OAuth catalogue asks
 * (`integrations/integrations-oauth.constants.ts`), for the same reason: a
 * scope list answers "what may this touch" and stops, and the questions a
 * person actually has are what is deliberately NOT read, where it lands and who
 * can then see it. They are written now, while the decision about them is being
 * taken, rather than the day somebody builds the connection and has to invent
 * them.
 */
export const DISTRIBUTOR_FEED_CONNECTION = Object.freeze({
  id: "distributor_feed" as const,
  label: "Licensed distributor feed",
  description:
    "The price list your own licence sees at a distributor — the number this house actually pays, rather than a public posting anyone can read.",
  /** The house declares the distributor; a named person consents to their login being used. */
  declaredBy: "restaurant" as const,
  consentedBy: "person" as const,
  /**
   * FALSE on purpose, and the reason travels with it. Nothing in the product
   * offers this connection, because no measured distributor has a feed to
   * connect and two forbid the attempt.
   */
  offerable: false,
  notOfferableBecause:
    "No distributor measured on 2026-09-05 publishes a price feed a house could connect. Breakthru's buyer portal forbids every automated reader in its robots.txt; Breakthru's and Southern Glazer's terms of use each forbid automated access, and Southern Glazer's separately forbids giving any other person access with your credentials — which is what declaring a portal login here would be. Your own invoices already carry your licensee price, and this house records them (ADR 0117 class A).",
  dataHandling: Object.freeze({
    reads:
      "The distributor's price list for this house's own licence — product, pack, size, the price and the trade level it is quoted at — and nothing else on the account.",
    doesNotRead:
      "Your orders, your invoices, your deliveries, your credit terms, your rep's messages and your account balance. A price list is a list of what things cost; none of the rest of your relationship with the distributor is any of this product's business, and none of it would be fetched.",
    landsIn:
      "`vendor_price_observations`, scoped to THIS restaurant, as an `api_catalog` sighting at trust tier 3. Not `price_index_postings` — that register has no restaurant column and is read by every house in the state, so a licensee price written there would publish your buying terms to your competitors.",
    visibleTo:
      "Everyone who works in this restaurant, and no other restaurant on this deployment. A manager can stop the house using the connection without touching the person's own login.",
    // A fifth question, matching the one `DataHandlingDisclosure` gained on
    // 2026-09-05 in `integrations-oauth.constants.ts`. Answered here while the
    // decision is being taken, for the same reason the other four are: the day
    // somebody builds this connection is the wrong day to invent a retention
    // rule for it.
    keptFor:
      "A price sighting is kept for as long as the register keeps any sighting — a price is evidence about a date, and deleting last quarter's makes this quarter's uncomparable. Disconnecting stops new rows and never deletes old ones; the rows already read stay in this restaurant's own register, labelled with the distributor that quoted them.",
  }),
  /** Where a class-C row goes. Named here so the docs and the parser agree. */
  landsInTable: "vendor_price_observations" as const,
  landsInSourceType: "api_catalog" as const,
  landsInTrustTier: 3 as const,
});

export const DISTRIBUTORS: Record<string, DistributorEntry> = {
  "breakthru-il": {
    key: "breakthru-il",
    distributor: "Breakthru Beverage Illinois",
    jurisdictions: ["US-IL"],
    portal: { name: "Breakthru Now", url: "https://now.breakthrubev.com/" },
    mechanism: "portal_only",
    automatedAccess: {
      verdict: "forbidden",
      robots:
        "now.breakthrubev.com/robots.txt (HTTP 200, 834 bytes): 'User-agent: *' / 'Allow: /bbg/en/login' / 'Disallow: /'.",
      terms:
        "breakthrubev.com Terms of Use §6.2(c): you may not 'access the Site through any automated means or with any automated features or devices (including use of scripts or web crawlers, data mining, scraping, robots, spiders, or any other data gathering or extraction tools)'.",
      measuredOn: "2026-09-05",
      evidence: [
        "https://now.breakthrubev.com/robots.txt",
        "https://www.breakthrubev.com/terms-and-conditions",
        "https://www.breakthrubev.com/account-services",
        "https://www.breakthrubev.com/sitemap.xml",
      ],
    },
    availability:
      "Breakthru Now shows this house real-time pricing behind its own login, and Breakthru forbids any machine from reading it: the portal's robots.txt disallows everything except the login page, and the terms of use forbid automated access outright. There is nothing here for this house to connect, and mirroring the list would breach the terms the house agreed to.",
    unbuilt: {
      reason:
        "The public site is corporate only — its advertised sitemap holds 60 URLs and not one product, price or catalogue path — and the buyer portal is closed to machines by its own robots.txt and terms. No API, EDI catalogue or export is documented anywhere.",
      measuredOn: "2026-09-05",
    },
    priceBasisByCode: Object.freeze({}),
  },

  "southern-glazers-il": {
    key: "southern-glazers-il",
    distributor: "Southern Glazer's Wine & Spirits of Illinois",
    jurisdictions: ["US-IL"],
    portal: { name: "SG Proof", url: "https://shop.sgproof.com/" },
    mechanism: "edi_810_invoice",
    automatedAccess: {
      verdict: "forbidden",
      robots:
        "shop.sgproof.com/robots.txt (HTTP 200, 791 bytes) allows all but cart/checkout/my-account, and publishes 'Crawl-delay: 10', 'Request-rate: 1/10' and 'Visit-time: 0400-0845'. The research pass honoured the visit window and fetched no page on that host: the request would have been made at 12:18 UTC.",
      terms:
        "southernglazers.com Terms of Use: you may not 'use any robot, spider, or other automatic device, process, or means to access the Website for any purpose, including monitoring or copying any of the material on the Website', and 'your account is personal to you and agree not to provide any other person with access to this Website or portions of it using your username, password, or other security information'.",
      measuredOn: "2026-09-05",
      evidence: [
        "https://shop.sgproof.com/robots.txt",
        "https://www.southernglazers.com/terms-of-use",
        "https://www.cleo.com/trading-partner-network/southern-glazers-wine-spirits",
        "https://www.truecommerce.com/trading-partner/southern-glazer/",
        "https://docs.restaurant365.com/docs/vendor-integrations-list",
      ],
    },
    availability:
      "Southern Glazer's does run an EDI programme, and what it sends a customer is orders, shipments and invoices — 850, 856 and 810 on two independent trading-partner pages, with no 832 price catalogue among them. So the number this house pays reaches it as an invoice, which this house already records. Reading the Proof portal instead is forbidden twice over: by the terms' ban on automated access, and by their ban on giving anyone else your credentials.",
    unbuilt: {
      reason:
        "No 832 price/sales catalogue is documented for Southern Glazer's by either EDI provider whose trading-partner page was read; Restaurant365 lists it as Multi-Invoice with the Order Guides column blank. An EDI 810 feed is the house's own paper (ADR 0117 class A) and is already covered by the invoice path, not by a new connection.",
      measuredOn: "2026-09-05",
    },
    priceBasisByCode: Object.freeze({}),
  },

  "rndc-il": {
    key: "rndc-il",
    distributor: "Republic National Distributing Company, Illinois",
    jurisdictions: ["US-IL"],
    portal: { name: "eRNDC", url: "https://app.erndc.com/login" },
    mechanism: "edi_810_invoice",
    automatedAccess: {
      verdict: "unstated",
      robots:
        "app.erndc.com/robots.txt answers HTTP 404, so no rules are published and the default under RFC 9309 is unrestricted. The login page itself answers HTTP 200 (10,966 bytes). rndc-usa.com publishes a WordPress default that disallows /wp-admin/ only.",
      terms: null,
      measuredOn: "2026-09-05",
      evidence: [
        "https://app.erndc.com/login",
        "https://www.rndc-usa.com/robots.txt",
        "https://docs.restaurant365.com/docs/vendor-integrations-list",
      ],
    },
    availability:
      "eRNDC prices per account behind a login and publishes no API, no export and no price file. Restaurant365 lists Republic National Distributing under Multi-Invoice with the Order Guides column blank, which is the same finding: what leaves RNDC for a buyer's system is invoices. No terms of use were read for this portal, so its position on automated access is recorded as unstated rather than as permission.",
    unbuilt: {
      reason:
        "No documented feed of any kind. The absence of a robots.txt is not consent, and no terms of use were located to read, so nothing here is treated as permitted.",
      measuredOn: "2026-09-05",
    },
    priceBasisByCode: Object.freeze({}),
  },

  "libdib-national": {
    key: "libdib-national",
    distributor: "LibDib",
    jurisdictions: ["US-IL", "US-MI", "US-CA"],
    portal: { name: "LibDib", url: "https://app.libdib.com/login" },
    mechanism: "none_documented",
    automatedAccess: {
      verdict: "unstated",
      robots:
        "app.libdib.com/robots.txt answers HTTP 404. analyticsapi.libdib.com serves its Swagger UI and its OpenAPI document to an anonymous reader.",
      terms: null,
      measuredOn: "2026-09-05",
      evidence: [
        "https://analyticsapi.libdib.com/docs",
        "https://analyticsapi.libdib.com/openapi.json",
      ],
    },
    availability:
      "LibDib's Analytics API is public enough to read its own specification, and it is not a price feed. Measured over the whole 70,801-byte document: 52 paths, 49 schemas, and the word 'price' does not appear once as a field. It is an internal machine-learning and telemetry portal — recommendation engines, propensity models, reseller order analytics. Nothing in it would give a house a price for a bottle.",
    unbuilt: {
      reason:
        "The one distributor-side API whose documentation is public turns out to publish no price. This corrects the price-source register's earlier reading of it as 'the most promising class-C connection': the specification was read in full on 2026-09-05 and contains no price, cost, catalog or wholesale field.",
      measuredOn: "2026-09-05",
    },
    priceBasisByCode: Object.freeze({}),
  },

  "provi-marketplace": {
    key: "provi-marketplace",
    distributor: "Provi (marketplace, formerly SevenFifty)",
    jurisdictions: ["US-IL", "US-MI", "US-CA"],
    portal: { name: "Provi", url: "https://www.provi.com/" },
    mechanism: "none_documented",
    automatedAccess: {
      verdict: "unstated",
      robots:
        "provi.com/robots.txt is a HubSpot marketing configuration; it disallows preview and sample paths and says nothing about the application.",
      terms: null,
      measuredOn: "2026-09-05",
      evidence: [
        "https://www.provi.com/robots.txt",
        "https://www.provi.com/partnerships/encompass",
        "https://go.sevenfifty.com/distributors/",
      ],
    },
    availability:
      "Provi carries distributor catalogues for buyers, and its integration runs the other way: distributors connect their ERP to Provi, arranged by Provi's own sales team who 'complete the EDI setup'. No buyer-facing API or developer documentation was found on either the Provi or the SevenFifty side. A house cannot connect Provi to anything; it can only shop there.",
    unbuilt: {
      reason:
        "No public or buyer-facing API, no developer documentation, no export. The customer-specific pricing Provi advertises reaches Provi from the distributor's ERP and stops there.",
      measuredOn: "2026-09-05",
    },
    priceBasisByCode: Object.freeze({}),
  },
};

/** Every distributor entry that covers a given ISO-3166-2 jurisdiction. */
export function distributorsFor(jurisdiction: string): DistributorEntry[] {
  const key = (jurisdiction ?? "").trim().toUpperCase();
  if (!key) return [];
  return Object.values(DISTRIBUTORS).filter((d) =>
    d.jurisdictions.includes(key),
  );
}

/**
 * The one sentence a jurisdiction gets when it has distributors and none of
 * them can be connected. It names the cause and where the answer actually
 * lives, because "no connection available" invites a house to wait for one.
 */
export function distributorSilenceFor(jurisdiction: string): string | null {
  const entries = distributorsFor(jurisdiction);
  if (entries.length === 0) return null;
  const connectable = entries.filter((d) => !d.unbuilt);
  if (connectable.length > 0) return null;
  const forbidden = entries.filter(
    (d) => d.automatedAccess.verdict === "forbidden",
  );
  const named = entries.map((d) => d.distributor).join(", ");
  const banned = forbidden.length
    ? ` ${forbidden.length === 1 ? "One of them forbids" : `${forbidden.length} of them forbid`} an automated reader in their own terms, so mirroring the list is not something this house may authorise.`
    : "";
  return `${named} price this house per account, behind a login, and none of them publishes a feed it could connect (measured 2026-09-05).${banned} Your own invoices carry the price your licence pays, and this house records them — that is the register to read here.`;
}
