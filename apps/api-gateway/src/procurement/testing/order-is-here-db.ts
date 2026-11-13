import { DatabaseService } from "../../database/database.service";

/**
 * A `DatabaseService` for specs that boot an `orders/:id` controller over HTTP
 * and are about something other than whether the order exists.
 *
 * `OrderInHouseInterceptor` asks the database whether the order in the path is
 * this house's before (writes) or while (reads) the handler runs. This answers
 * that question the way Postgres would for a house that holds every order: a
 * uuid is here; anything else fails the cast (22P02), which the interceptor
 * answers with its 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orderIsHereDb(): DatabaseService {
  const supabase: any = {
    from() {
      let id: unknown;
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          if (col === "id") id = val;
          return q;
        },
        maybeSingle: async () =>
          typeof id === "string" && UUID.test(id)
            ? { data: { id }, error: null }
            : { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } },
      };
      return q;
    },
  };
  return { supabase, getClient: () => supabase } as unknown as DatabaseService;
}

export const ORDER_IS_HERE_DB = { provide: DatabaseService, useFactory: orderIsHereDb };
