/**
 * A supabase-js stand-in for the delivery specs — TEST SUPPORT, not product code.
 *
 * WHY IT LIVES IN `src/` AND NOT IN A SPEC FILE. Two spec files need exactly the
 * same fake, and the alternative — a copy in each — is how the two drift until
 * one of them is asserting against a mock that no longer behaves like the other.
 * It is imported only by `*.spec.ts`.
 *
 * THE ONE THING IT DOES THAT THE OLDER MOCKS IN THIS FOLDER DO NOT: it captures
 * the table name WHEN THE CHAIN IS BUILT, not when it resolves. supabase-js
 * chains are built eagerly and awaited later, so a service issuing two reads
 * under `Promise.all` builds both before either resolves; a mock that reads a
 * shared `currentTable` at resolution time answers BOTH with whatever was named
 * last. That is not a hypothetical — it silently hid four assertions while this
 * slice was being written (filed in v3.0-TECH-DEBT.md).
 */

export interface Answer {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface MockDb {
  client: { getClient: () => { from: (t: string) => unknown } };
  /** Per-table answers for reads. A table with no answer resolves to `null`. */
  answers: Record<string, Answer>;
  /** Per-table answers for a chain that called `.insert()`. */
  insertAnswers: Record<string, Answer>;
  /** Per-table answers for a chain that called `.update()`. */
  updateAnswers: Record<string, Answer>;
  /** Every write, in order, so assertions are on what the service SENT. */
  writes: { table: string; verb: string; payload: unknown }[];
  /** Every `table.verb` the service issued, in order. */
  verbs: string[];
  reset(): void;
}

export function makeMockDb(): MockDb {
  const state: MockDb = {
    client: { getClient: () => ({ from: (t: string) => chainFor(t) }) },
    answers: {},
    insertAnswers: {},
    updateAnswers: {},
    writes: [],
    verbs: [],
    reset() {
      state.answers = {};
      state.insertAnswers = {};
      state.updateAnswers = {};
      state.writes = [];
      state.verbs = [];
    },
  };

  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    let verb: "read" | "insert" | "update" = "read";

    const answer = (): Answer => {
      if (verb === "insert")
        return state.insertAnswers[table] ?? { data: null, error: null };
      if (verb === "update")
        return state.updateAnswers[table] ?? { data: null, error: null };
      return state.answers[table] ?? { data: null, error: null };
    };

    for (const v of [
      "select",
      "eq",
      "neq",
      "in",
      "gte",
      "lte",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "insert",
      "update",
      "upsert",
      "delete",
    ]) {
      chain[v] = (...args: unknown[]) => {
        state.verbs.push(`${table}.${v}`);
        if (
          v === "insert" ||
          v === "update" ||
          v === "upsert" ||
          v === "delete"
        ) {
          verb = v === "update" ? "update" : "insert";
          state.writes.push({ table, verb: v, payload: args[0] ?? null });
        }
        if (v === "single" || v === "maybeSingle") {
          const a = answer();
          const data = Array.isArray(a.data) ? (a.data[0] ?? null) : a.data;
          return Promise.resolve({
            data: a.error ? null : (data ?? null),
            error: a.error,
          });
        }
        return self();
      };
    }
    (chain as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
    ): unknown => {
      const a = answer();
      return Promise.resolve({
        data: a.error ? null : (a.data ?? null),
        error: a.error,
      }).then(resolve);
    };
    return chain;
  };

  return state;
}

/** The notifications funnel, recording what would have been sent. */
export function makeMockNotifications() {
  const sent: { restaurantId: string; payload: Record<string, unknown> }[] = [];
  return {
    sent,
    persistForRestaurant: async (
      restaurantId: string,
      payload: Record<string, unknown>,
    ) => {
      sent.push({ restaurantId, payload });
      return { inserted: 1, ids: ["n-1"] };
    },
  };
}
