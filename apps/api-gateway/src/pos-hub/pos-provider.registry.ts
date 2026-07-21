import { PosProviderMeta } from "./pos-types";

/**
 * POS Provider Registry — the platform map.
 *
 * Sequencing (per the platform program, not one roadmap wave):
 *   1. Foundation: canonical pipeline + pos_item_mappings (THIS build)
 *   2. Square → Clover → SpotOn — ~60% of detected SMB restaurants
 *   3. Rest of Tier 1 — indie/full-service wine venues
 *   4. Tier 2+ — only when selling into chains (partner agreements needed)
 *   5. Türkiye market — Simpra/ElektraWeb/Vectron/Wolvox/SambaPOS
 *
 * `generic_webhook` and `csv_import` are AVAILABLE TODAY — any POS or
 * middleware (Zapier, a nightly export, a partner integration) can push the
 * canonical shape and the whole analytics stack lights up.
 */
const CAP_FULL = {
  checks: true,
  items: true,
  tables: true,
  employees: true,
  webhooks: true,
};
const CAP_NO_TABLES = { ...CAP_FULL, tables: false };
const CAP_PULL = { ...CAP_FULL, webhooks: false };

export const POS_PROVIDERS: PosProviderMeta[] = [
  // ---- Universal (available today) --------------------------------------
  {
    key: "generic_webhook",
    name: "Generic Webhook (canonical JSON)",
    tier: "universal",
    status: "available",
    region: "global",
    apiStyle: "webhook",
    authModel: "none",
    notes:
      "POST the CanonicalCheck shape to /pos-hub/webhook/generic_webhook/:restaurantId — bridges any POS or middleware.",
    capabilities: CAP_FULL,
  },
  {
    key: "csv_import",
    name: "CSV / JSON Import",
    tier: "universal",
    status: "available",
    region: "global",
    apiStyle: "file",
    authModel: "none",
    notes: "Batch-import historical checks via /pos-hub/import/:restaurantId.",
    capabilities: { ...CAP_FULL, webhooks: false },
  },

  // ---- Tier 1 — cloud-native -------------------------------------------
  {
    key: "toast",
    name: "Toast",
    tier: "cloud",
    status: "partial",
    region: "us",
    apiStyle: "rest",
    authModel: "oauth2",
    docsUrl: "https://doc.toasttab.com/",
    notes:
      "Existing ToastModule handles item mappings; check-level normalizer ready here.",
    capabilities: CAP_FULL,
  },
  {
    key: "square",
    name: "Square",
    tier: "cloud",
    status: "scaffolded",
    region: "global",
    apiStyle: "rest",
    authModel: "oauth2",
    docsUrl: "https://developer.squareup.com/reference/square/orders-api",
    notes: "Orders API normalizer implemented; needs merchant OAuth token.",
    capabilities: CAP_NO_TABLES,
  },
  {
    key: "clover",
    name: "Clover",
    tier: "cloud",
    status: "scaffolded",
    region: "global",
    apiStyle: "rest",
    authModel: "oauth2",
    docsUrl: "https://docs.clover.com/reference",
    notes: "Orders v3 normalizer implemented; needs merchant API token.",
    capabilities: CAP_FULL,
  },
  {
    key: "spoton",
    name: "SpotOn",
    tier: "cloud",
    status: "planned",
    region: "us",
    apiStyle: "rest",
    authModel: "oauth2",
    capabilities: CAP_FULL,
  },
  {
    key: "lightspeed",
    name: "Lightspeed Restaurant",
    tier: "cloud",
    status: "planned",
    region: "global",
    apiStyle: "rest",
    authModel: "oauth2",
    docsUrl: "https://developers.lightspeedhq.com/",
    capabilities: CAP_FULL,
  },
  {
    key: "touchbistro",
    name: "TouchBistro",
    tier: "cloud",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_FULL,
  },
  {
    key: "revel",
    name: "Revel Systems",
    tier: "cloud",
    status: "planned",
    region: "global",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_FULL,
  },
  {
    key: "gotab",
    name: "GoTab",
    tier: "cloud",
    status: "planned",
    region: "us",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_FULL,
  },
  {
    key: "lavu",
    name: "Lavu",
    tier: "cloud",
    status: "planned",
    region: "global",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_FULL,
  },
  {
    key: "eposnow",
    name: "Epos Now",
    tier: "cloud",
    status: "planned",
    region: "eu",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_NO_TABLES,
  },

  // ---- Tier 2 — enterprise ---------------------------------------------
  {
    key: "ncr_aloha",
    name: "NCR Voyix Aloha",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "oracle_simphony",
    name: "Oracle MICROS Simphony",
    tier: "enterprise",
    status: "planned",
    region: "global",
    apiStyle: "rest",
    authModel: "oauth2",
    docsUrl: "https://docs.oracle.com/en/industries/food-beverage/",
    capabilities: CAP_PULL,
  },
  {
    key: "par_brink",
    name: "PAR Brink",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "heartland",
    name: "Heartland Restaurant",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_PULL,
  },
  {
    key: "shift4_skytab",
    name: "Shift4 SkyTab",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "rest",
    authModel: "api_key",
    capabilities: CAP_FULL,
  },
  {
    key: "hungerrush",
    name: "HungerRush",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "qu_beyond",
    name: "Qu Beyond",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "rest",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "positouch",
    name: "POSitouch",
    tier: "enterprise",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },

  // ---- Tier 3 — partner-gated legacy -----------------------------------
  {
    key: "focus_pos",
    name: "Focus POS",
    tier: "partner_gated",
    status: "planned",
    region: "us",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "givex",
    name: "Givex (Vexilor)",
    tier: "partner_gated",
    status: "planned",
    region: "global",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },

  // ---- Türkiye market leaders ------------------------------------------
  {
    key: "protel_simpra",
    name: "Protel / Simpra (MICROS heritage)",
    tier: "regional_tr",
    status: "planned",
    region: "tr",
    apiStyle: "rest",
    authModel: "api_key",
    notes: "Dominant in TR hospitality; Simpra cloud POS has a REST surface.",
    capabilities: CAP_FULL,
  },
  {
    key: "elektraweb",
    name: "Elektra (ElektraWeb)",
    tier: "regional_tr",
    status: "planned",
    region: "tr",
    apiStyle: "rest",
    authModel: "api_key",
    notes: "Hotel+F&B suite common in TR resorts.",
    capabilities: CAP_PULL,
  },
  {
    key: "vectron_omni",
    name: "Omni (Vectron)",
    tier: "regional_tr",
    status: "planned",
    region: "tr",
    apiStyle: "partner",
    authModel: "partner_agreement",
    capabilities: CAP_PULL,
  },
  {
    key: "akinsoft_wolvox",
    name: "AKINSOFT Wolvox Restoran",
    tier: "regional_tr",
    status: "planned",
    region: "tr",
    apiStyle: "file",
    authModel: "none",
    notes: "Widespread SMB TR; start with file export → csv_import bridge.",
    capabilities: { ...CAP_PULL, webhooks: false },
  },
  {
    key: "sambapos",
    name: "SambaPOS",
    tier: "regional_tr",
    status: "planned",
    region: "tr",
    apiStyle: "rest",
    authModel: "api_key",
    notes: "Popular open TR restaurant POS with GraphQL/message API.",
    capabilities: CAP_FULL,
  },
];

export const PROVIDER_BY_KEY: Record<string, PosProviderMeta> =
  Object.fromEntries(POS_PROVIDERS.map((p) => [p.key, p]));

export function registrySummary() {
  const byTier: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const p of POS_PROVIDERS) {
    byTier[p.tier] = (byTier[p.tier] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }
  return { total: POS_PROVIDERS.length, byTier, byStatus };
}
