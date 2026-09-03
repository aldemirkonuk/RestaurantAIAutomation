/**
 * The one place that says which feature flags are real.
 *
 * OD-86 audit, 2026-08-26. Settings rendered 22 switches that wrote to
 * `restaurant_feature_flags`. Grepping every one of the 22 names across
 * `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` and
 * `services/agent-orchestrator` found exactly ONE that any code branches on:
 * `enable_ai_negotiation`, at inbound-responder.service.ts:175. The other 21
 * were read by nothing at all — a stored user preference that changed no
 * behaviour anywhere.
 *
 * The audit also found the deeper failure. The wide table those 22 columns
 * belong to (`services/database/migrations_archive/011_add_restaurant_feature_flags.sql`,
 * plus its `get_restaurant_feature_flag()` RPC) was NEVER applied: it lives in
 * an archived directory outside `supabase/migrations/`. The table that actually
 * exists in production is the EAV one dumped at
 * `supabase/migrations/20260805000000_baseline_from_production.sql:5097` —
 * `(restaurant_id, flag_name, enabled, metadata, created_at)` plus a single
 * bolted-on `enable_ai_autonomous_send` column. So none of the 22 columns the
 * service SELECTed, UPDATEd and INSERTed have ever existed. Every one of those
 * switches was inert at the database as well as at the gate.
 *
 * ADR 0020 ("a surface with no data says so; it never invents one") makes the
 * remedy non-optional: a control that cannot work is disabled and explained,
 * never left looking functional. Hence three lists below, and nothing else.
 */

/**
 * `restaurant_feature_flags` is keyed UNIQUE(restaurant_id, flag_name) and its
 * `flag_name` is NOT NULL, because the table's original job was one row per
 * named flag (self-evolution still writes rows that way). Per-restaurant
 * settings therefore live on ONE reserved row per restaurant, under this name.
 * Every reader must filter on it, or it will read a self-evolution row instead
 * and `.single()`/`.maybeSingle()` will fail once a restaurant has two rows.
 */
export const SETTINGS_ROW_FLAG_NAME = "restaurant_settings";

export const FEATURE_FLAGS_TABLE = "restaurant_feature_flags";

export interface ActiveFeatureFlagSpec {
  /** Column name on the settings row. */
  key: string;
  /** Value used when the restaurant has no settings row yet. */
  defaultValue: boolean;
  /** file:line of the code that branches on it. Required — no gate, not active. */
  readBy: string;
}

/**
 * ACTIVE — a real column on the settings row AND real code that branches on it.
 * Adding an entry here without a `readBy` you can point at is the exact defect
 * this registry exists to prevent.
 */
export const ACTIVE_FEATURE_FLAGS: ActiveFeatureFlagSpec[] = [
  {
    key: "enable_ai_negotiation",
    // ON by default: the responder has always treated "no row" as enabled, and
    // flipping that on existing restaurants would silently stop vendor replies
    // being analysed at all.
    defaultValue: true,
    readBy: "common/orchestrator/inbound-responder.service.ts:987",
  },
  {
    key: "enable_ai_autonomous_send",
    // OFF by default, and the default is the whole point: ON means AI email
    // leaves for a vendor with no human approval. A restaurant gets that only
    // by deliberately asking for it.
    defaultValue: false,
    readBy: "common/orchestrator/inbound-responder.service.ts:1011",
  },
  {
    key: "mudavym_design_dashboard",
    // OFF by default: the Mudavym redesign of `/` (ADR 0044) is opt-in per
    // restaurant while under founder review; legacy renders otherwise.
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_orders",
    // OFF by default: the Mudavym redesign of `/orders` (ADR 0044), same gate.
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_receiving",
    // OFF by default: the Mudavym redesign of `/receiving` (ADR 0044 P2).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_receiving_door",
    // OFF by default: the Mudavym redesign of the door flow (ADR 0044 P2).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_providers",
    // OFF by default: the Mudavym redesign of `/providers` (ADR 0045 §5 wave,
    // MERGE verdict — small buckets + twin-in-sheet), founder-reviewed per flip.
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_communications",
    // OFF by default: the Mudavym redesign of `/communications` (ADR 0045 §5
    // wave, MERGE verdict — glance strip + ledger + template-clarity sheet).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_team",
    // OFF by default: the Mudavym redesign of `/team` (ADR 0045 §5 wave, KEEP
    // verdict + the founder's three additions: gaps-first, labour build-up,
    // credential blockers).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_inventory",
    // OFF by default: NOT a page swap — the KEEP verdict's named gap only:
    // the ReceiptDepth card inside the kept RowExpansion dropdown (ADR 0045
    // §5). The page renders byte-identically with the flag off.
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_receipts",
    // OFF by default: the Mudavym redesign of `/receipts` (ADR 0045 §5 wave,
    // KEEP+ verdict — the founder's four requirements + the swipe-up confirm).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_documents_reports",
    // OFF by default: the Mudavym redesign of `/documents-reports` — Direction
    // D "the Sorting Office" (ADR 0045 §5 wave, REWORK verdict, round-2 sketch
    // chosen by the founder 2026-08-31 for scale: every register countable,
    // routine noise files itself, C's clean reading pane kept as the detail).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_reports",
    // OFF by default: the Mudavym redesign of `/reports` (ADR 0044 p4 wave, MERGE verdict — today's drag-to-rearrange canvas back, more graphs, insights + reports focus).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_notifications",
    // OFF by default: the Mudavym redesign of `/notifications` (ADR 0044 p4 wave, REWORK verdict — density of what is happening, handled items subdued).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_recommendations",
    // OFF by default: the Mudavym redesign of `/recommendations` (ADR 0044 p4 wave, REWORK verdict — "more structure and uniqueness"; also the first authenticated build of the page).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_calendar",
    // OFF by default: the Mudavym redesign of `/calendar` (ADR 0044 p4 wave, KEEP verdict — the one page the founder named as unreservedly liked).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_settings",
    // OFF by default: the Mudavym redesign of `/settings` (ADR 0044 p4 wave, KEEP Editorial + "there should be more").
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_profile",
    // OFF by default: the Mudavym redesign of `/profile` (ADR 0044 p4 wave, KEEP+ — MCPs, linked accounts and payments as first-class sections, honest about what is not yet connected).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
  {
    key: "mudavym_design_cellar",
    // OFF by default: the Mudavym `/cellar` parent surface and its `/wines` `/beer` `/whiskey` `/cocktails` children (ADR 0044 p4 wave; IA decided 2026-08-30, the crowded redesign rejected — "more character", keep "see everything").
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:92",
  },
];

export const ACTIVE_FEATURE_FLAG_KEYS: readonly string[] =
  ACTIVE_FEATURE_FLAGS.map((f) => f.key);

export function isActiveFeatureFlag(name: string): boolean {
  return ACTIVE_FEATURE_FLAG_KEYS.includes(name);
}

export function defaultActiveFlags(): Record<string, boolean> {
  return ACTIVE_FEATURE_FLAGS.reduce<Record<string, boolean>>((acc, f) => {
    acc[f.key] = f.defaultValue;
    return acc;
  }, {});
}

/**
 * INACTIVE — the capability exists in the codebase, but nothing reads a
 * per-restaurant flag for it. These are NOT persisted and NOT returned by the
 * API. They are listed so the gap stays legible: `apps/web` renders them as
 * "not active yet" rows with no switch, rather than a switch that lies.
 *
 * Promoting one to ACTIVE means: add the column in a migration, add the gate,
 * cite the gate here. Anything less is a switch that does nothing.
 */
export const INACTIVE_FEATURE_FLAGS: Array<{
  key: string;
  /** Where the capability lives today, so the gate has somewhere to go. */
  capability: string;
}> = [
  {
    key: "enable_inventory_storage_locations",
    capability: "apps/api-gateway/src/storage-locations/ (module, ungated)",
  },
  {
    key: "enable_invoice_scanning",
    capability: "apps/api-gateway/src/procurement/documents/ (ungated)",
  },
  {
    key: "enable_check_scanning",
    capability: "apps/web/src/components/reports/molecules/CheckScannerSection.tsx",
  },
  {
    key: "enable_auto_procurement",
    capability: "services/agent-orchestrator/agents/procurement_agent.py (reorder path)",
  },
  {
    key: "enable_recurring_orders",
    capability: "services/agent-orchestrator/agents/recurring_order_agent.py",
  },
  {
    key: "enable_sommelier_ai",
    // Gated, but on an ORCHESTRATOR-PROCESS env var, not per restaurant:
    // agent_registry.py:153 reads FEATURE_SOMMELIER_AI. A per-restaurant flag
    // cannot drive a process-wide switch, so wiring this is not one line.
    capability: "services/agent-orchestrator/agents/sommelier_agent.py (env FEATURE_SOMMELIER_AI)",
  },
  {
    key: "enable_menu_analyzer",
    capability: "services/agent-orchestrator/agents/menu_analyzer_agent.py (env FEATURE_MENU_ANALYZER)",
  },
  {
    key: "enable_visual_verification",
    capability: "services/agent-orchestrator/agents/visual_verification_agent.py (env FEATURE_VISUAL_VERIFICATION)",
  },
  {
    key: "enable_predictive_analytics",
    capability: "apps/api-gateway/src/analytics/engine/forecasting.ts",
  },
  {
    key: "enable_profit_margin_tracking",
    capability: "apps/api-gateway/src/analytics/engine/finance.ts",
  },
  {
    key: "enable_guest_crm",
    // Schema only: supabase/migrations/20260819000000_guest_identity_minimal_slice.sql.
    // No application code reads a guest table yet. Kept rather than removed
    // because its OFF-by-default was a deliberate privacy decision recorded in
    // settings.service.ts, and consent capture must begin by a restaurant's
    // own act — that decision should survive the cleanup, not be discarded
    // with the switch.
    capability: "supabase/migrations/20260819000000_guest_identity_minimal_slice.sql (schema only)",
  },
];

/**
 * REMOVED, 2026-08-26 — these named no capability that exists, so per ADR 0020
 * they were deleted rather than labelled. Nothing was ever stored under them
 * (the columns never existed), so no restaurant loses a setting.
 *
 *   enable_auction_purchases        AuctionPurchaseModal.tsx is never imported
 *                                   or rendered anywhere; no auction feature.
 *   enable_voice_agent              no voice agent. The only speech code is the
 *                                   browser SpeechRecognition helper inside
 *                                   inventory/command/SpotCountPanel.tsx, which
 *                                   is unrelated to a "voice agent" product.
 *   enable_wine_pairing_ai          no pairing capability distinct from the
 *                                   sommelier; zero pairing code paths.
 *   enable_calendar_sync            labelled "Sync with Google Calendar"; no
 *                                   Google Calendar sync exists (only a
 *                                   credential-gated e2e that skips). The real
 *                                   calendar feature is the iCal subscription
 *                                   feed, which Settings already offers.
 *   enable_whatsapp_business        no WhatsApp integration; the only hits are
 *                                   a 'whatsapp' value in a phone-type enum.
 *   enable_quickbooks_sync          zero references in the entire repo.
 *   enable_pour_cost_optimizer      no optimizer; one calculatePourCost() helper
 *                                   in a mock data file.
 *   enable_compliance_autopilot     compliance_agent.py declares IS_STUB = True;
 *                                   the orchestrator refuses to start it.
 *   enable_shrinkage_detective      shrinkage_detective_agent.py, same: IS_STUB.
 *   enable_staff_training_simulator zero references in the entire repo.
 */
export const REMOVED_FEATURE_FLAGS: readonly string[] = [
  "enable_auction_purchases",
  "enable_voice_agent",
  "enable_wine_pairing_ai",
  "enable_calendar_sync",
  "enable_whatsapp_business",
  "enable_quickbooks_sync",
  "enable_pour_cost_optimizer",
  "enable_compliance_autopilot",
  "enable_shrinkage_detective",
  "enable_staff_training_simulator",
];
