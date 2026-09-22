/**
 * What one person's calendar link may show (ADR 0111, review trail 2026-09-21).
 *
 * The founder, 2026-09-21: *"Ayse (bar staff) connects HER OWN link to her
 * phone. It shows only her shifts and bar-area events (deliveries to the bar,
 * bar tasks). The owner connects his own link, which shows everything, or just
 * the parts he picks."*
 *
 * Everything here is pure, so the rule that decides who sees what is tested
 * without a database and cannot drift between the feed and the page that
 * describes the feed: `CalendarLinksService` calls these same functions for
 * both.
 *
 * THE VISIBILITY RULES THIS KEEPS, AS MEASURED 2026-09-21
 * -------------------------------------------------------
 *  - `calendar_events` carries no visibility, privacy or owner-only column
 *    (baseline `20260805000000`, `CREATE TABLE public.calendar_events`), and
 *    `GET /calendar/events` returns every event of the house to any signed-in
 *    member (`calendar.service.ts` `listEvents`, no role filter). So today no
 *    event is private or owner-only, and a manager's link — "the house
 *    calendar minus owner-private items" — is the whole house calendar. If a
 *    private flag is ever added, `selectEvents` is where it is honoured.
 *  - Shifts: the full roster is manager-gated in the app
 *    (`schedule.service.ts` `getWeek`, `assertAccess(..., "manager")`); staff
 *    see only their own (`getMyWeek`). Labor cost is never in any feed.
 *  - Areas: the areas model is another lane's build. Until it binds
 *    `PERSON_AREAS` (below), a staff link carries their own shifts plus the
 *    house-wide events they can already see in the app — which, by the first
 *    bullet, is every event. That is wider than the founder's "only bar-area
 *    events" and is said so on the page and in the ADR.
 */

/** A person's role in one house, as far as the feed is concerned. */
export type FeedRole = "owner" | "manager" | "staff";

/**
 * The categories an owner may pick. The same list is the CHECK on
 * `calendar_feed_links.categories` (migration 20260921170600) — change both.
 */
export const FEED_CATEGORIES = [
  "shifts",
  "deliveries",
  "orders",
  "meetings",
  "stock_counts",
  "tastings",
  "reminders",
  "suppliers",
  "holidays",
  "other",
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export function isFeedCategory(value: unknown): value is FeedCategory {
  return (
    typeof value === "string" &&
    (FEED_CATEGORIES as readonly string[]).includes(value)
  );
}

/** `calendar_events.event_type` → the category an owner picks it by. */
export function categoryOfEventType(
  eventType: string | null | undefined,
): FeedCategory {
  switch (eventType) {
    case "delivery":
    case "delivery_eta":
      return "deliveries";
    case "order":
    case "recurring":
      return "orders";
    case "meeting":
      return "meetings";
    case "inventory":
    case "inventory_count":
      return "stock_counts";
    case "tasting":
      return "tastings";
    case "reminder":
      return "reminders";
    case "provider_birthday":
    case "provider_unavailable":
      return "suppliers";
    case "holiday":
    case "high_volume_expected":
      return "holidays";
    default:
      return "other";
  }
}

/**
 * The person's role from the two rows the rest of the gateway reads.
 *
 * - An ACTIVE `user_restaurant_access` row whose `valid_until` has not passed
 *   decides: `owner` and `manager` are themselves, anything else (a NULL role,
 *   an unknown word) is `staff` — membership is proven, privilege is not.
 *   Several such rows (a duplicate) resolve to the LEAST of them.
 * - With none, a `users` row whose `restaurant_id` names the house proves
 *   membership only and reads as `staff`. That is `TeamService.assertAccess`'s
 *   rule, deliberately not `house-role.ts`'s `users.role || "staff"`:
 *   `users.role` defaults to `manager` (baseline), and the shifts this feed
 *   serves are TeamService's data, where that default is never privilege.
 * - Anything else is `null`: not a member, and the link answers the expired
 *   notice. This is what makes "when Ayse leaves, only her link stops" hold
 *   the moment `MembersService.removeMember` runs, with no revocation step.
 */
export function feedRoleOf(
  accessRows: Array<{ role?: string | null; valid_until?: string | null }>,
  userRow: { restaurant_id?: string | null } | null,
  restaurantId: string,
  now: Date,
): FeedRole | null {
  const current = accessRows.filter(
    (r) => !r.valid_until || new Date(r.valid_until).getTime() > now.getTime(),
  );
  if (current.length > 0) {
    const ranks = current.map((r) =>
      r.role === "owner" ? 2 : r.role === "manager" ? 1 : 0,
    );
    const least = Math.min(...ranks);
    return least === 2 ? "owner" : least === 1 ? "manager" : "staff";
  }
  if (userRow && userRow.restaurant_id === restaurantId) return "staff";
  return null;
}

/** The areas the house's areas model knows for kinds of work. */
export type AreaKind =
  | "kitchen"
  | "bar"
  | "floor"
  | "cellar"
  | "receiving"
  | "management";

/**
 * A person's areas, or the fact that nothing models them yet.
 *
 * `modelled: false` is not "no areas": it is "the question cannot be asked
 * yet", and the staff rule below reads it that way — it falls back to what the
 * app already shows the person, never to nothing and never to a guess.
 */
export type PersonAreas =
  | { modelled: false }
  | { modelled: true; kinds: AreaKind[] };

/**
 * The hook the areas lane binds. Until it does, `CalendarLinksService` uses
 * `AREAS_NOT_MODELLED` and says so on the page.
 */
export interface PersonAreasSource {
  areasOf(restaurantId: string, userId: string): Promise<PersonAreas>;
}

/** Nest injection token for `PersonAreasSource`. */
export const PERSON_AREAS = Symbol("PERSON_AREAS");

export const AREAS_NOT_MODELLED: PersonAreasSource = {
  async areasOf(): Promise<PersonAreas> {
    return { modelled: false };
  },
};

/** What one link serves. */
export interface FeedScope {
  role: FeedRole;
  /** `all` = every shift in the house; `own` = the person's own only. */
  shifts: "all" | "own";
  /** `all` = every house event; `house_and_areas` = house-wide + the person's areas. */
  events: "all" | "house_and_areas";
  /** An owner's narrowing pick, or null for everything the role allows. */
  categories: ReadonlySet<FeedCategory> | null;
}

/**
 * The scope for a role. A saved category pick narrows an OWNER's link and is
 * ignored for anyone else (a demoted owner keeps their row, and their link
 * serves the manager's scope until they change it): the founder gave the pick
 * to the owner, and a pick can never widen what a role may see.
 */
export function feedScopeFor(
  role: FeedRole,
  savedCategories: readonly string[] | null,
): FeedScope {
  if (role === "owner") {
    const picked = savedCategories
      ? new Set(savedCategories.filter(isFeedCategory))
      : null;
    return { role, shifts: "all", events: "all", categories: picked };
  }
  if (role === "manager") {
    return { role, shifts: "all", events: "all", categories: null };
  }
  return { role, shifts: "own", events: "house_and_areas", categories: null };
}

/** One plain sentence for the page: what this link shows. */
export function scopeSentence(scope: FeedScope, areas: PersonAreas): string {
  const picked =
    scope.categories === null
      ? null
      : scope.categories.size === 0
        ? "nothing — you have picked no categories"
        : `only what you picked (${scope.categories.size} of ${FEED_CATEGORIES.length})`;
  if (scope.role === "owner") {
    return picked
      ? `Your link shows ${picked}.`
      : "Your link shows everything: every shift and every event in this house.";
  }
  if (scope.role === "manager") {
    return "Your link shows the house calendar and every shift.";
  }
  return areas.modelled
    ? "Your link shows your own shifts, the events for your areas and the events for the whole house."
    : "Your link shows your own shifts and the house calendar you can already see here. Areas are not set up yet, so it cannot narrow to your area.";
}

/**
 * Which events a link serves. `areaOf` names the area an event belongs to, or
 * null for a house-wide event; `calendar_events` has no area label yet, so the
 * service passes one that answers null for every row.
 */
export function selectEvents<E extends { event_type?: string | null }>(
  events: readonly E[],
  scope: FeedScope,
  areas: PersonAreas,
  areaOf: (event: E) => AreaKind | null,
): E[] {
  return events.filter((event) => {
    if (
      scope.categories &&
      !scope.categories.has(categoryOfEventType(event.event_type))
    ) {
      return false;
    }
    if (scope.events === "all") return true;
    const area = areaOf(event);
    if (area === null) return true;
    // Areas not modelled: the person already sees this event in the app.
    if (!areas.modelled) return true;
    return areas.kinds.includes(area);
  });
}

/**
 * Which shifts a link serves. `myMemberIds` are the person's own
 * `team_members.id`s in this house.
 */
export function selectShifts<S extends { member_id?: string | null }>(
  shifts: readonly S[],
  scope: FeedScope,
  myMemberIds: ReadonlySet<string>,
): S[] {
  if (scope.categories && !scope.categories.has("shifts")) return [];
  if (scope.shifts === "all") return [...shifts];
  return shifts.filter((s) => !!s.member_id && myMemberIds.has(s.member_id));
}
