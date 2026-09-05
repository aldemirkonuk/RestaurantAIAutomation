/**
 * A house may REQUEST a scenario, in words. It may not author one.
 *
 *   *"Not yet; request a scenario instead."*
 *                             — the founder, 2026-09-05 (ADR 0120 Q4)
 *
 * The open question was whether a tenant may add a row to the book of goal
 * scenarios. The answer is no: `goal-scenarios.ts` stays the one catalogue,
 * because every row on it carries an operator source a reader can check and a
 * tenant-authored row could carry none of that — it cannot invent a metric key,
 * and a range typed by a house would be a number with no source sitting exactly
 * where a sourced one belongs.
 *
 * What a house CAN do is say what it wants to be held to. That sentence is the
 * most useful thing this product can learn about which of the eleven unserved
 * measures to fund next, and before this it had nowhere to go.
 *
 * THE SEAM, STATED
 * ----------------
 * Nothing here is read by `goalScenarioBook()`. There is no join, no merge and
 * no "custom scenarios" section: the book route does not touch this table. A
 * request is words addressed to Mudavym, read by a person.
 *
 * WHY IT IS NOT SEALED
 * --------------------
 * `HoldToApprove` and the seal exist for acts that move money or leave the
 * building (ADR 0113). A request is neither: it writes one row, sends nothing,
 * spends nothing and can be repeated. Sealing it would teach the gesture that
 * guards a purchase order to mean "I typed a sentence", which devalues it
 * everywhere it does matter. It is a plain authenticated write with the actor
 * named from the token.
 *
 * WHY THE ACTOR COMES FROM THE TOKEN
 * ----------------------------------
 * "Who asked" is a fact about the session. A client-supplied one would be an
 * assertion about someone else, and the founder's read would carry a name
 * chosen by the browser. The service REFUSES a write with no actor rather than
 * writing an anonymous row — the column is NOT NULL in the database as the
 * backstop, and this is the refusal a person can read.
 *
 * A FAILED READ IS A FAILURE (ADR 0020/0051)
 * ------------------------------------------
 * `supabase-js` resolves `{ data, error }` and never throws, so every read here
 * checks `error` and throws with its reason. An unread request list must never
 * render as "no house has asked for anything" — that is this project's standing
 * fault, and on this surface it would read as evidence that the catalogue is
 * complete.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/** Matches the CHECK in `20260906090000_a_house_may_request_a_scenario_in_words.sql`. */
export const MAX_REQUEST_CHARS = 2000;

/** The founder's read is a page, not the table: newest first, bounded. */
export const DEFAULT_READ_LIMIT = 100;
export const MAX_READ_LIMIT = 500;

export interface RecordedRequest {
  id: string;
  restaurantId: string;
  requestedBy: string;
  words: string;
  requestedAt: string;
}

/** A name that could not be read is `null` WITH a reason, never a blank. */
interface NameLookup {
  names: Map<string, string | null>;
  unreadable: string | null;
}

@Injectable()
export class GoalScenarioRequestsService {
  private readonly logger = new Logger(GoalScenarioRequestsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Record one house's request, in its own words.
   *
   * @param requestedBy the user id from the token. A missing one is refused.
   */
  async record(input: {
    restaurantId: string;
    words: string;
    requestedBy: string | null;
  }): Promise<{ recorded: true; request: RecordedRequest; note: string }> {
    const restaurantId = (input.restaurantId ?? "").trim();
    if (restaurantId === "")
      throw new Error("A request has to name the house it comes from.");

    const requestedBy = (input.requestedBy ?? "").trim();
    if (requestedBy === "")
      throw new Error(
        "A request records who asked, and this call carried no user. Sign in again and retry — Mudavym will not store an anonymous request.",
      );

    const words = (input.words ?? "").trim();
    if (words === "")
      throw new Error("Write what you want to be able to hold your house to.");
    if (words.length > MAX_REQUEST_CHARS)
      throw new Error(
        `A request is at most ${MAX_REQUEST_CHARS} characters; this one is ${words.length}.`,
      );

    const { data, error } = await this.databaseService.supabase
      .from("goal_scenario_request")
      .insert({
        restaurant_id: restaurantId,
        requested_by: requestedBy,
        words,
      })
      .select("id, restaurant_id, requested_by, words, requested_at")
      .single();

    // The write is the whole act, so its failure is the answer — never a
    // success message over a row that does not exist (ADR 0020).
    if (error) throw new Error(`The request was not stored: ${error.message}`);
    if (!data)
      throw new Error(
        "The request was not stored: the database returned no row.",
      );

    return {
      recorded: true,
      request: {
        id: String(data.id),
        restaurantId: String(data.restaurant_id),
        requestedBy: String(data.requested_by),
        words: String(data.words),
        requestedAt: String(data.requested_at),
      },
      note: "Mudavym has it, in your words. The catalogue is ours to write, so nothing was added to it — a request becomes a scenario only when the measure behind it exists.",
    };
  }

  /**
   * Every house's requests, newest first — the founder's read.
   *
   * Gated by `ServiceKeyGuard` at the controller (ADR 0099), so this method
   * takes no restaurant: it is deliberately cross-tenant, which is exactly why
   * no user token can reach it.
   */
  async listAll(limit?: number): Promise<{
    requests: Array<
      RecordedRequest & { house: string | null; asker: string | null }
    >;
    count: number;
    limit: number;
    truncated: boolean;
    namesUnread: string | null;
    basis: string;
  }> {
    const bounded = Number.isFinite(limit as number)
      ? Math.min(Math.max(Math.trunc(limit as number), 1), MAX_READ_LIMIT)
      : DEFAULT_READ_LIMIT;

    const { data, error } = await this.databaseService.supabase
      .from("goal_scenario_request")
      .select("id, restaurant_id, requested_by, words, requested_at")
      .order("requested_at", { ascending: false })
      .limit(bounded + 1);

    // A failed read is a failure with its reason. Returning `[]` here would say
    // "no house has asked for anything", which on this surface reads as
    // evidence the catalogue already covers the field.
    if (error)
      throw new Error(`The requests could not be read: ${error.message}`);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const truncated = rows.length > bounded;
    const page = truncated ? rows.slice(0, bounded) : rows;

    const houses = await this.namesFor(
      "restaurants",
      "id",
      page.map((r) => String(r.restaurant_id)),
    );
    const askers = await this.namesFor(
      "users",
      "user_id",
      page.map((r) => String(r.requested_by)),
    );

    return {
      requests: page.map((r) => ({
        id: String(r.id),
        restaurantId: String(r.restaurant_id),
        requestedBy: String(r.requested_by),
        words: String(r.words),
        requestedAt: String(r.requested_at),
        house: houses.names.get(String(r.restaurant_id)) ?? null,
        asker: askers.names.get(String(r.requested_by)) ?? null,
      })),
      count: page.length,
      limit: bounded,
      truncated,
      // One field for both lookups: if either failed, the names on this page
      // are not trustworthy and saying which one failed is what makes the
      // nulls readable as "unread" rather than as "unnamed".
      namesUnread: houses.unreadable ?? askers.unreadable,
      basis:
        "Every house's requests, newest first. These are words a person typed — they are not scenarios, nothing reads them into the catalogue, and no model has seen them.",
    };
  }

  /**
   * Resolve ids to names. A lookup that FAILS returns its reason rather than an
   * empty map pretending every name is missing.
   */
  private async namesFor(
    table: "restaurants" | "users",
    idColumn: "id" | "user_id",
    ids: string[],
  ): Promise<NameLookup> {
    const unique = Array.from(new Set(ids.filter((id) => id !== "")));
    if (unique.length === 0) return { names: new Map(), unreadable: null };

    // Two literal reads rather than `.from(table)`: check_queried_tables_exist
    // resolves a string literal, not a parameter, and a read it cannot resolve
    // is a read it cannot check.
    const { data, error } =
      table === "restaurants"
        ? await this.databaseService.supabase
            .from("restaurants")
            .select(`${idColumn}, name`)
            .in(idColumn, unique)
        : await this.databaseService.supabase
            .from("users")
            .select(`${idColumn}, name`)
            .in(idColumn, unique);

    if (error) {
      this.logger.warn(
        `goal_scenario_request name lookup on ${table} failed: ${error.message}`,
      );
      return {
        names: new Map(),
        unreadable: `${table} could not be read (${error.message}), so the names on this page are missing rather than absent.`,
      };
    }

    const names = new Map<string, string | null>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = row[idColumn];
      if (typeof id === "string")
        names.set(id, typeof row.name === "string" ? row.name : null);
    }
    return { names, unreadable: null };
  }
}
