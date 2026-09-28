/**
 * THE ONE PLACE THE PRICE REGISTER'S VISIBILITY RULE IS WRITTEN.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The founder, 2026-09-05 (batch 56, recorded in ADR 0126 and ADR 0128): the
 * fifteen census houses are **"All real."** The consequence he accepted with
 * that answer is recorded verbatim in ADR 0126:
 *
 *   > the contributor floors researched in `p4be-market.md` apply as written,
 *   > and the register's tenancy boundary (nine hand-written filters and no RLS
 *   > policy) must be fixed before any cross-house read
 *
 * Measured on this tree before the fix (`grep -rn 'restaurant_id.is.null'
 * apps/api-gateway/src --include='*.ts'`), the tenancy boundary of the two
 * register tables was **six** hand-written `.or()` clauses spread across five
 * files, plus **five reads that carried no tenancy clause at all**. (The "nine"
 * of ADR 0126's sentence counted three clauses that are not on these tables:
 * `identity.service.ts:701` filters `beverage_identity_candidates`,
 * `identity.service.ts:924` filters `beverage_identity_decisions`, and
 * `invoice-confirmed.producer.ts:261` filters `providers`. The correction is
 * recorded in ADR 0117's addendum; the shape of the finding was right and the
 * count was not.)
 *
 * A hand-written boundary fails in the direction nobody sees: an omitted `.or()`
 * does not throw, it returns MORE rows, and the extra rows are another house's
 * buying terms. That is `absence-reported-as-health` at the door — the query
 * succeeds, the ladder is confident, and nothing says whose prices it drew.
 *
 * So: every read of `vendor_price_observations` and `price_index_postings`
 * passes through `scopePriceRegisterRead`, and
 * `scripts/check_price_register_reads_are_scoped.py` fails CI for a read that
 * does not.
 *
 * THE THREE VISIBILITY STATES
 * ---------------------------
 * Before this file there were exactly two, and neither was written down:
 *
 *   1. `restaurant_id = <a house>` — that house's own row. An invoice line, a
 *      quote a rep gave them. A negotiating position.
 *   2. `restaurant_id IS NULL`     — openly posted. A scraped public list
 *      price. Everyone's, verbatim, as a ROW.
 *
 * There was no third, and a cross-house band needs one: a row a house agrees
 * may COUNT TOWARD an aggregate and may never be SHOWN as a row. So the
 * migration `20260906100000_the_register_states_who_may_see_a_row.sql` adds
 * `vendor_price_observations.visibility` with a CHECK that admits exactly:
 *
 *   3. `'contributed_aggregate_only'` — the house's row, contributed under a
 *      floor. **No row is in this state and no read returns one.** Both facts
 *      are asserted: the migration asserts the row count, and this function
 *      excludes the state from every read, in every scope, without exception.
 *
 * `visibility IS NULL` is NOT a fourth state. It means "this row's visibility is
 * whatever `restaurant_id` says", which is precisely states 1 and 2 — the rule
 * the register has always had. The column exists to NAME the one state that
 * `restaurant_id` cannot express, and that one state is the only one that
 * changes what a read may return.
 *
 * WHAT THIS PROTECTS, AND WHAT IT DOES NOT
 * ----------------------------------------
 * The gateway connects with `SUPABASE_SERVICE_ROLE_KEY`
 * (`database.service.ts:15`), and the service role BYPASSES row level security.
 * So for every read this codebase makes, **this function is the entire
 * boundary** — the RLS policies the same migration adds are a statement of the
 * rule in SQL, not a second wall behind this one. Said plainly, and repeated in
 * the migration: an RLS policy cannot save a query this function never saw.
 *
 * `scopePriceRegisterRead` is not a security boundary against a caller who
 * supplies the `restaurantId`. It scopes to the house it is GIVEN; proving that
 * house is the caller's is the controller's job, upstream of here.
 */

/**
 * The two tables this rule governs. String literals rather than an enum so a
 * caller's `.from("vendor_price_observations")` and its scope call name the
 * same characters, which is what `check_read_columns_exist.py` and the new
 * guard both read.
 */
export const VENDOR_PRICE_OBSERVATIONS = "vendor_price_observations";
export const PRICE_INDEX_POSTINGS = "price_index_postings";

export type PriceRegisterTable =
  | typeof VENDOR_PRICE_OBSERVATIONS
  | typeof PRICE_INDEX_POSTINGS;

/**
 * The third state's name, written once. The migration's CHECK and this
 * constant have to be the same string or the exclusion below silently stops
 * excluding anything; `check_price_register_reads_are_scoped.py` compares them.
 */
export const CONTRIBUTED_AGGREGATE_ONLY = "contributed_aggregate_only";

/**
 * Every value `vendor_price_observations.visibility` may hold, in the order the
 * migration's CHECK lists them. `null` is absent on purpose — see the header:
 * an unstated visibility is not a state, it is a deferral to `restaurant_id`.
 */
export const REGISTER_VISIBILITY_STATES = [
  "house",
  "open_market",
  CONTRIBUTED_AGGREGATE_ONLY,
] as const;

/**
 * The PostgREST predicate that keeps the third state out of every read.
 *
 * The `visibility.is.null` arm is load-bearing and not redundant: PostgREST's
 * `neq` follows SQL's three-valued logic, so `visibility=neq.contributed…`
 * alone drops every row whose `visibility` is NULL — which today is every row
 * in the table. Without the first arm this predicate would silently empty the
 * ladder rather than filter it.
 */
export const NOT_CONTRIBUTED_ONLY = `visibility.is.null,visibility.neq.${CONTRIBUTED_AGGREGATE_ONLY}`;

/**
 * WHICH POSTINGS ARE THE MARKET (ADR 0128).
 *
 * A posting is the market when nobody carried it (`uploaded_by IS NULL` — it
 * was fetched, and was never held) or when somebody let it in (`admitted_at IS
 * NOT NULL`). A hand-carried book still waiting for a second pair of eyes has
 * rows in the table and is NOT an index line.
 *
 * Moved here from `price-index.service.ts` on 2026-09-05 so that the postings
 * register's visibility rule and the observations register's live in one file
 * and are applied by one function. `price-index.service.ts` re-exports it, so
 * every existing import keeps working.
 */
export const MARKET_VISIBILITY = "uploaded_by.is.null,admitted_at.not.is.null";

/**
 * HOW MUCH OF THE REGISTER A READ MAY SEE.
 *
 * Every kind is a sentence someone had to be willing to write. There is
 * deliberately no default and no optional argument: a read that wants every
 * house's rows says so, by name, with a reason, and the guard can then find it
 * by grepping for one word.
 */
export type RegisterScope =
  /** This house's own rows plus the openly posted ones. The ladder's scope. */
  | { kind: "houseAndOpenMarket"; restaurantId: string }
  /** This house's own rows ONLY — no market rows. The house's own record. */
  | { kind: "houseOwnRowsOnly"; restaurantId: string }
  /** Only openly posted rows. No house's private paper, including the caller's. */
  | { kind: "openMarketOnly" }
  /**
   * Every house's rows. A CROSS-HOUSE read, and the only kind that is one.
   * `because` is required, non-empty, and is what a reviewer greps for.
   */
  | { kind: "everyHouse"; because: string }
  /**
   * `price_index_postings` only: the held books too, not just the market.
   * `because` is required for the same reason.
   */
  | { kind: "includingHeldBooks"; because: string };

/**
 * The shape this function needs from a PostgREST builder.
 *
 * Structural rather than importing `PostgrestFilterBuilder`, whose five type
 * parameters change between supabase-js minors. It is deliberately NOT used as
 * a constraint on `Q`: `Q extends RegisterQuery<Q>` typechecks but makes tsc
 * report *"Type instantiation is excessively deep and possibly infinite"* on
 * the real client (measured on this tree, `vendor-comparison.service.ts:154`,
 * supabase-js 2.103). So `Q` is free, the builder is narrowed here, and the
 * cost of that -- a caller could pass something that is not a query -- is paid
 * back at runtime by `assertIsQuery` below, loudly, rather than by a read that
 * silently skipped its own scope.
 */
export interface RegisterQuery {
  or(filters: string, options?: { referencedTable?: string }): RegisterQuery;
  is(column: string, value: null): RegisterQuery;
  eq(column: string, value: string): RegisterQuery;
}

/**
 * Narrow the builder, checking ONLY the methods this call is about to use.
 *
 * Checking all three would refuse a legitimate query object that happens not to
 * expose a method this path never calls -- including the hand-written PostgREST
 * doubles several suites in this repo build. Checking the ones about to be
 * called is the honest test: if the scope cannot be applied, the read must not
 * proceed unscoped.
 */
function assertIsQuery(
  query: unknown,
  ...needed: Array<keyof RegisterQuery>
): RegisterQuery {
  const q = query as Partial<RegisterQuery> | null | undefined;
  const missing = !q
    ? needed
    : needed.filter((m) => typeof (q as Record<string, unknown>)[m] !== "function");
  if (!q || typeof q !== "object" || missing.length > 0) {
    throw new Error(
      "scopePriceRegisterRead was given something that is not a PostgREST query" +
        (missing.length ? ` (missing .${missing.join("(), .")}())` : "") +
        ". It cannot scope it, and returning it unscoped would read the whole register.",
    );
  }
  return q as RegisterQuery;
}

/**
 * Characters that would let an interpolated id break out of a PostgREST filter
 * string. `restaurant_id.eq.${id}` is a STRING, not a bound parameter, so a
 * comma or a parenthesis in `id` becomes another clause.
 *
 * This is deliberately not a UUID check. Ids reach this function from route
 * params and from fixtures, and a strict UUID gate would turn a wrong-shaped id
 * from an empty result into a 500 while telling an attacker which ids parse.
 * The narrow rule refuses exactly the injection surface and nothing else.
 */
const FILTER_UNSAFE = /[,()"'\s\\]/;

function assertFilterSafe(restaurantId: string): void {
  if (typeof restaurantId !== "string" || restaurantId.length === 0) {
    throw new Error(
      "scopePriceRegisterRead: a house-scoped read was given no restaurant id. " +
        "An empty scope would read the whole register; refusing rather than widening.",
    );
  }
  if (FILTER_UNSAFE.test(restaurantId)) {
    throw new Error(
      "scopePriceRegisterRead: the restaurant id carries a character that would " +
        "change the meaning of the filter string it is interpolated into. Refused.",
    );
  }
}

function assertReason(scope: { kind: string; because: string }): void {
  if (typeof scope.because !== "string" || scope.because.trim().length === 0) {
    throw new Error(
      `scopePriceRegisterRead: scope '${scope.kind}' widens the read past one ` +
        "house and must state why, in a sentence. An unexplained cross-house " +
        "read is the thing this function exists to prevent.",
    );
  }
}

/**
 * Apply the register's visibility rule to a read.
 *
 * Pass the query AFTER `.from(...).select(...)` and keep the `.from()` at the
 * call site: `check_read_columns_exist.py` pairs a literal `.from("t")` with the
 * `.select(` that follows it, and hiding the `.from()` inside this file would
 * make every register read invisible to that guard.
 *
 *     const { data, error } = await scopePriceRegisterRead(
 *       this.db.supabase.from(VENDOR_PRICE_OBSERVATIONS).select(COLUMNS),
 *       VENDOR_PRICE_OBSERVATIONS,
 *       { kind: "houseAndOpenMarket", restaurantId },
 *     );
 *
 * PostgREST ANDs repeated top-level `or` parameters, so the predicates this
 * adds compose with a caller's own `.or()` (a product-key search, say) rather
 * than replacing it.
 *
 * @throws when a scope is asked of a table it cannot mean anything on, when a
 * cross-house scope states no reason, or when an id would change the filter's
 * meaning. Every one of those is a programming error, and every one of them
 * would otherwise widen a read.
 */
export function scopePriceRegisterRead<Q>(
  query: Q,
  table: PriceRegisterTable,
  scope: RegisterScope,
): Q {
  if (table === PRICE_INDEX_POSTINGS) {
    // The postings register has NO `restaurant_id` — it is keyed by
    // jurisdiction, and deliberately so (see
    // `20260904200000_a_posted_price_names_its_state.sql:30`). A house scope
    // asked of it is not "no-op", it is a caller who believes something false
    // about the table, so it throws rather than quietly reading everything.
    if (scope.kind === "openMarketOnly") {
      return assertIsQuery(query, "or").or(MARKET_VISIBILITY) as unknown as Q;
    }
    if (scope.kind === "includingHeldBooks") {
      assertReason(scope);
      return query;
    }
    throw new Error(
      `scopePriceRegisterRead: scope '${scope.kind}' has no meaning on ` +
        `${PRICE_INDEX_POSTINGS}, which carries no restaurant_id. Use ` +
        "'openMarketOnly' for the index lines a reader may see, or " +
        "'includingHeldBooks' with a reason for the review path.",
    );
  }

  // vendor_price_observations. The third state is excluded FIRST and
  // unconditionally, before any scope can widen anything.
  const out = assertIsQuery(
    query,
    "or",
    ...(scope.kind === "houseOwnRowsOnly"
      ? (["eq"] as const)
      : scope.kind === "openMarketOnly"
        ? (["is"] as const)
        : []),
  ).or(NOT_CONTRIBUTED_ONLY);

  switch (scope.kind) {
    case "houseAndOpenMarket":
      assertFilterSafe(scope.restaurantId);
      return out.or(
        `restaurant_id.is.null,restaurant_id.eq.${scope.restaurantId}`,
      ) as unknown as Q;
    case "houseOwnRowsOnly":
      assertFilterSafe(scope.restaurantId);
      // `.eq()` parameterises its value; the `.or()` above cannot. Where one
      // house is meant and no market rows are, this is the narrower path.
      return out.eq("restaurant_id", scope.restaurantId) as unknown as Q;
    case "openMarketOnly":
      return out.is("restaurant_id", null) as unknown as Q;
    case "everyHouse":
      assertReason(scope);
      // No tenancy predicate, on purpose and by name. The third state is still
      // excluded — `out` already carries it.
      return out as unknown as Q;
    case "includingHeldBooks":
      throw new Error(
        `scopePriceRegisterRead: 'includingHeldBooks' is a ${PRICE_INDEX_POSTINGS} ` +
          `scope. ${VENDOR_PRICE_OBSERVATIONS} holds no books.`,
      );
    default: {
      // Exhaustiveness, as a runtime refusal rather than a silent pass-through:
      // a scope added later and not handled here must not read the register.
      const unreachable: never = scope;
      throw new Error(
        `scopePriceRegisterRead: unknown scope ${JSON.stringify(unreachable)}.`,
      );
    }
  }
}
