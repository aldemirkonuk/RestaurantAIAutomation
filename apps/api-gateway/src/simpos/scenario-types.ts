/**
 * The scenario expectation contract, v1 (ADR 0093 D2).
 *
 * `sim_scenario_runs.expected` is written by the Python scenario engine
 * (`scripts/simulate scenario …`) and read here. These types are the SAME
 * contract, restated in TypeScript — they are not a second source of truth.
 * `contract_version` is the hinge: a run whose version this build does not
 * understand is `unverifiable`, never silently compared under the wrong shape.
 */

export const EXPECTATION_CONTRACT_VERSION = 1;

export type LineExpectation =
  | "food"
  | "bottle"
  | "volume"
  | "unresolved_unmapped"
  | "unresolved_no_sale_volume"
  | "void_return";

export interface ExpectedLine {
  line_no: number;
  external_item_id: string | null;
  name: string;
  qty: number;
  price: number;
  is_wine: boolean;
  inventory_id?: string | null;
  expect: LineExpectation;
  volume_ml?: number | null;
  bottles?: number | null;
  idempotency_key?: string | null;
}

export interface ExpectedCheck {
  external_check_id: string;
  scenario?: string;
  opened_at: string;
  closed_at: string | null;
  voided?: boolean;
  table_label?: string | null;
  covers?: number | null;
  server_name?: string | null;
  subtotal?: number | null;
  total?: number | null;
  tip?: number | null;
  posted?: boolean;
  post_count?: number;
  outside_hours?: boolean;
  lines: ExpectedLine[];
}

export interface ExpectedDepletion {
  inventory_id: string;
  wine_name?: string | null;
  opening_stock_live?: number | null;
  bottles?: number | null;
  pour_ml?: number | null;
  expected_stock_live: number;
  stock_live_is_upper_bound?: boolean;
}

export interface ExpectedLowStock {
  inventory_id: string;
  /** The library wine — what the low-stock notification's `wineId` names. */
  master_wine_id?: string | null;
  wine_name?: string | null;
  threshold_min?: number | null;
  expected_stock_live?: number | null;
}

export interface ExpectedStory {
  id: string;
  title: string;
  story: string;
  check_ids?: string[];
}

export interface ScenarioExpectation {
  contract_version?: number;
  source?: string;
  archetype_id?: string;
  scenario?: string;
  seed?: number;
  service_date?: string;
  timezone?: string | null;
  operating_hours?: unknown;
  scenarios?: ExpectedStory[];
  checks?: ExpectedCheck[];
  depletion?: ExpectedDepletion[];
  unresolved?: { count?: number; by_reason?: Record<string, number> };
  low_stock?: ExpectedLowStock[];
  outside_hours_count?: number;
  dropped_check_ids?: string[];
  duplicate_check_ids?: string[];
  voided_check_ids?: string[];
  tables?: Array<{ label: string; seats?: number }>;
  totals?: {
    checks?: number;
    posted_checks?: number;
    wine_lines?: number;
    food_lines?: number;
    revenue?: number;
  };
}

export interface ScenarioRunRow {
  id: string;
  restaurant_id: string;
  archetype_id: string | null;
  scenario: string | null;
  seed: number | null;
  service_date: string | null;
  timezone: string | null;
  operating_hours: unknown;
  params: unknown;
  expected: ScenarioExpectation | null;
  posted_at: string | null;
  created_at: string | null;
}

export type VerifyStatus = "pass" | "fail" | "unverifiable";

export interface VerifyCheckRow {
  id: string;
  title: string;
  status: VerifyStatus;
  expected: unknown;
  actual: unknown;
  detail: string;
  samples?: unknown[];
}

/** One database read, named and owned. A failure here is never an empty result. */
export interface ReadRecord {
  table: string;
  ok: boolean;
  error?: string;
  rows?: number;
}

export interface ScenarioVerifyResult {
  runId: string;
  restaurantId: string;
  scenario: string | null;
  seed: number | null;
  serviceDate: string | null;
  postedAt: string | null;
  verifiedAt: string;
  summary: {
    pass: number;
    fail: number;
    unverifiable: number;
    total: number;
  };
  checks: VerifyCheckRow[];
  reads: ReadRecord[];
}
