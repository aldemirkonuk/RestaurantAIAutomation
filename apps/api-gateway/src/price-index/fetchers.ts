/**
 * The network fetchers — one per fetchable source. Dormant unless the scheduled
 * job is armed (`PRICE_INDEX_FETCH_ENABLED`); the endpoint reads the table, not
 * these. Every fetcher honours the source's terms recorded in
 * `.planning/07-reference/price-sources.md`: an identifying User-Agent with a
 * contact URL, and the crawl delay where the source's robots.txt sets one.
 */

import { createHmac, createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  CaliforniaPosting,
} from "./parse-california";
import { IOWA_URL, IowaRow } from "./parse-iowa";
import { OREGON_URL, OregonRow } from "./parse-oregon";
import { DEFRA_SERIES_URL, DefraRow, parseCsv } from "./parse-defra";

export const USER_AGENT =
  "MudavymPriceSightings/0.1 (+https://mudavym.com/bot; public price-list reader; one request per source per day)";

export const FIXTURES_DIR = join(__dirname, "__fixtures__");

export class FetchNotConfigured extends Error {}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * California's public data comes from an AWS AppSync endpoint whose "public"
 * queries are authorised by a short-lived HS256 JWT the app signs IN THE
 * BROWSER with a secret shipped in its own bundle. Reproducing that is the
 * anonymous path a member of the public uses — no login, no scrape.
 *
 * The secret is NOT stored in this repo (it is California's, not ours, and a
 * literal here would trip secret scanners). Set `PRICE_INDEX_CA_JWT_SECRET` to
 * the value in the app bundle (`priceposting.abc.ca.gov`, `REACT_APP_JWT_SECRET`)
 * to arm the fetch; without it the fetch refuses rather than guessing.
 */
function californiaBearer(): string {
  const secret = process.env.PRICE_INDEX_CA_JWT_SECRET;
  if (!secret) {
    throw new FetchNotConfigured(
      "PRICE_INDEX_CA_JWT_SECRET is not set. California's public GraphQL is authorised by a JWT the app signs with a secret shipped in its own bundle; set that value to fetch. Nothing is fabricated in its place.",
    );
  }
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    Buffer.from(JSON.stringify({ code: "getPublicPricePostsQuery", iat: now, exp: now + 20 })),
  );
  const signingInput = `${header}.${payload}`;
  const sig = base64url(createHmac("sha256", secret).update(signingInput).digest());
  return `Bearer ${signingInput}.${sig}`;
}

const CA_APPSYNC =
  "https://s7fcylvn8j.execute-api.us-west-2.amazonaws.com/prod/public/graphql";
const CA_QUERY = `query PricePostings($where: PricePostingWhereInput, $limit: Int, $offset: Int) {
  pricePostings(where: $where, limit: $limit, offset: $offset) {
    results { id manufacturer { name } product { name tradeName } status package { package }
      productSize { size unit { unit } containerType { type } } county pricesTo { name }
      receivingMethod price pricePromotion containerCharge effectiveDate createdAt createdByLicensee { id name } }
    count } }`;

/** Fetch active + prior beer postings for one California county. */
export async function fetchCalifornia(county = "Santa Clara"): Promise<CaliforniaPosting[]> {
  const out: CaliforniaPosting[] = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const res = await fetch(CA_APPSYNC, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: californiaBearer(),
        "content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        query: CA_QUERY,
        variables: { where: { county }, limit: 50, offset },
      }),
    });
    if (!res.ok) {
      throw new Error(`California AppSync returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { pricePostings?: { results?: CaliforniaPosting[] } };
    };
    const page = json.data?.pricePostings?.results ?? [];
    out.push(...page);
    if (page.length < 50) break;
    await new Promise((r) => setTimeout(r, 1000)); // polite between pages
  }
  return out;
}

/** Iowa: one request for the whole NDJSON file (a 303 to signed storage). */
export async function fetchIowa(): Promise<IowaRow[]> {
  const res = await fetch(IOWA_URL, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Iowa returned HTTP ${res.status}`);
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IowaRow);
}

/** Oregon: page the newest asofdate, sleeping the robots.txt crawl delay. */
export async function fetchOregon(): Promise<OregonRow[]> {
  const newestRes = await fetch(
    `${OREGON_URL}?$select=asofdate&$order=asofdate%20desc&$limit=1`,
    { headers: { Accept: "application/json", "User-Agent": USER_AGENT } },
  );
  if (!newestRes.ok) throw new Error(`Oregon returned HTTP ${newestRes.status}`);
  const newest = (await newestRes.json()) as Array<{ asofdate?: string }>;
  const asOf = newest[0]?.asofdate ? String(newest[0].asofdate).slice(0, 10) : null;
  if (!asOf) throw new Error("Oregon: could not read the newest asofdate.");
  await new Promise((r) => setTimeout(r, 1000)); // Crawl-delay: 1

  const out: OregonRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${OREGON_URL}?$where=asofdate%3D%27${asOf}%27&$limit=1000&$offset=${offset}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Oregon returned HTTP ${res.status}`);
    const page = (await res.json()) as OregonRow[];
    out.push(...page);
    if (page.length < 1000) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return out;
}

/**
 * Defra: read the series page, take the CSV edition it currently links, fetch
 * that. Two requests, once a fortnight.
 *
 * The edition URL carries a content hash and changes every edition, so it can
 * never be hard-coded — the series page is the only stable address. gov.uk's
 * robots.txt, fetched 2026-09-05: the wildcard agent is disallowed only from
 * print variants of a page and from site search, nothing else is restricted,
 * and no Crawl-delay is declared. Neither disallowed path is touched here.
 */
export async function fetchDefra(): Promise<DefraRow[]> {
  const page = await fetch(DEFRA_SERIES_URL, {
    headers: { Accept: "text/html", "User-Agent": USER_AGENT },
  });
  if (!page.ok) {
    throw new Error(`Defra series page returned HTTP ${page.status}`);
  }
  const html = await page.text();
  const link =
    /https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[^"']+\.csv/.exec(html);
  if (!link) {
    throw new Error(
      "Defra: no CSV edition is linked on the series page. Refusing rather than reusing a URL from a previous edition, which would file an old fortnight as this one.",
    );
  }
  await new Promise((r) => setTimeout(r, 1000)); // polite between the two
  const res = await fetch(link[0], {
    headers: { Accept: "text/csv", "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Defra CSV returned HTTP ${res.status}`);
  return parseCsv(await res.text()) as DefraRow[];
}

/** Load the recorded fixture for a source (the offline / test path). */
export async function loadFixture(fixture: string): Promise<unknown[]> {
  const path = join(FIXTURES_DIR, fixture);
  const text = await readFile(path, "utf-8");
  if (fixture.endsWith(".csv")) {
    return parseCsv(text);
  }
  if (fixture.endsWith(".ndjson")) {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  return JSON.parse(text) as unknown[];
}

/** sha256 of a raw payload, for a provenance stamp on a fetch run. */
export function payloadHash(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
