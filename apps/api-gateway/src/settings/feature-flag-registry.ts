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
    readBy: "common/orchestrator/inbound-responder.service.ts:1003",
  },
  {
    key: "enable_ai_autonomous_send",
    // OFF by default, and the default is the whole point: ON means AI email
    // leaves for a vendor with no human approval. A restaurant gets that only
    // by deliberately asking for it.
    defaultValue: false,
    readBy: "common/orchestrator/inbound-responder.service.ts:1027",
  },
  {
    key: "mudavym_design_receiving",
    // OFF by default: the Mudavym redesign of `/receiving` (ADR 0044 P2).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:171",
  },
  {
    key: "mudavym_design_recommendations",
    // OFF by default: the Mudavym redesign of `/recommendations` (ADR 0044 p4 wave, REWORK verdict — "more structure and uniqueness"; also the first authenticated build of the page).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:171",
  },
  {
    key: "enable_house_inbox_read",
    // OFF by default, and the default is the point: ON means a scheduled job
    // reads a person's Gmail mailbox. Consent (a `gmail_read` grant, ADR 0114)
    // is necessary and NOT sufficient — a person agreeing is a fact about that
    // person, and a deployment reading is a fact about this restaurant. Read
    // fails-closed: no row, a read error or a thrown client all mean OFF
    // (communications/inbox/house-inbox.service.ts `isEnabled`).
    defaultValue: false,
    readBy: "communications/inbox/house-inbox.service.ts:339",
  },
  {
    key: "mudavym_design_cellar",
    // OFF by default: the Mudavym `/cellar` parent surface and its `/wines` `/beer` `/whiskey` `/cocktails` children (ADR 0044 p4 wave; IA decided 2026-08-30, the crowded redesign rejected — "more character", keep "see everything").
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:171",
  },
  {
    key: "mudavym_design_shell",
    // OFF by default: the Mudavym app shell — the rooms rail, the house
    // header, the counter and the phone's four doors (sketch 119 direction D,
    // the founder's pick of 2026-09-21; ADR 0149 row 5). Unlike the page
    // flags this one swaps the LAYOUT every signed-in route renders inside
    // (DashboardLayout reads `useMudavymDesign("shell")`); off, the legacy
    // Sidebar layout is the path. Held back from LIVE_PAGES. Column added by
    // 20260921114300.
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:171",
  },
  {
    key: "mudavym_design_arrival",
    // OFF by default: the Arrival book at /get-started (ADR 0113/0143/0144;
    // sketch 121). Held back from LIVE_PAGES so every house keeps today's
    // GetStarted until this column is deliberately turned on. Column added by
    // 20260922190300 — ships in the same change as this registry entry so the
    // Settings `.select()` of every ACTIVE key cannot 42703 before the
    // migration has applied (the failure mode that blocked PR #414).
    defaultValue: false,
    readBy: "apps/web/src/lib/mudavym/useMudavymDesign.ts:171",
  },
];

export const ACTIVE_FEATURE_FLAG_KEYS: readonly string[] =
  ACTIVE_FEATURE_FLAGS.map((f) => f.key);

export function isActiveFeatureFlag(name: string): boolean {
  return ACTIVE_FEATURE_FLAG_KEYS.includes(name);
}

/**
 * LIVE IN CODE, 2026-09-17 (live-review.md defect 2; ADR 0149 row 36, "16
 * locked pages"; `settings` joined 2026-09-19 / PR #419 after its sketch
 * review; `help` joined 2026-09-21 / PR #413 / ADR 0149 row 52). These
 * eighteen `mudavym_design_*` keys used to be ACTIVE — real columns AND real
 * gating code — but `useMudavymDesign.ts`'s `LIVE_PAGES` now resolves every
 * one of these pages for every house before `fetchFlag` (the
 * `.checkFeatureFlag` call these entries used to cite) ever runs. The cited
 * line still exists and still says `checkFeatureFlag`, but it is UNREACHABLE
 * for these eighteen keys, so the ACTIVE contract — "a real column AND real
 * code that branches on it" — no longer holds for them. (`help` never had a
 * column; it is listed here so the LIVE_PAGES ↔ LIVE_IN_CODE_FLAGS guard
 * stays exact.)
 *
 * Deliberately NOT in ACTIVE_FEATURE_FLAGS:
 *  - `GET /settings/feature-flags` returns only ACTIVE_FEATURE_FLAG_KEYS
 *    (`settings.service.ts` `ACTIVE_COLUMNS`), so these columns stop being
 *    read OR written by that route the moment they leave this list.
 *  - `FeaturesSection.tsx` renders exactly the server's key set ("Everything
 *    with a control here is a key the gateway's registry declares ACTIVE"),
 *    so it stops offering a switch for a page that a switch can no longer
 *    change — the "switch that lies" ADR 0020 and this file's own header
 *    forbid.
 *  - `check_flag_readby_anchors.py` cross-checks this list against
 *    `LIVE_PAGES` (apps/web/src/lib/mudavym/useMudavymDesign.ts), so the two
 *    files cannot silently disagree again.
 *
 * The columns themselves are NOT dropped (ADR 0149: "never deleted: any
 * table, column, row" — they stay on `restaurant_feature_flags`, unread,
 * until the founder approves the legacy-deletion manifest that removes this
 * whole gate machinery).
 *
 * `scripts/flip_mudavym_design_flags.py` treats every key here as a no-op: it
 * refuses to plan a write for one and says why, rather than reporting success
 * on a column nothing reads.
 */
export const LIVE_IN_CODE_FLAGS: readonly string[] = [
  "mudavym_design_dashboard",
  "mudavym_design_orders",
  "mudavym_design_receiving_door",
  "mudavym_design_providers",
  "mudavym_design_communications",
  "mudavym_design_team",
  "mudavym_design_inventory",
  "mudavym_design_receipts",
  "mudavym_design_documents_reports",
  "mudavym_design_document",
  "mudavym_design_reports",
  "mudavym_design_calendar",
  "mudavym_design_profile",
  "mudavym_design_connections",
  "mudavym_design_notifications",
  "mudavym_design_logs",
  "mudavym_design_settings",
  "mudavym_design_help",
];

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
    capability:
      "apps/web/src/components/reports/molecules/CheckScannerSection.tsx",
  },
  {
    key: "enable_auto_procurement",
    capability:
      "services/agent-orchestrator/agents/procurement_agent.py (reorder path)",
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
    capability:
      "services/agent-orchestrator/agents/sommelier_agent.py (env FEATURE_SOMMELIER_AI)",
  },
  {
    key: "enable_menu_analyzer",
    capability:
      "services/agent-orchestrator/agents/menu_analyzer_agent.py (env FEATURE_MENU_ANALYZER)",
  },
  {
    key: "enable_visual_verification",
    capability:
      "services/agent-orchestrator/agents/visual_verification_agent.py (env FEATURE_VISUAL_VERIFICATION)",
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
    capability:
      "supabase/migrations/20260819000000_guest_identity_minimal_slice.sql (schema only)",
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
