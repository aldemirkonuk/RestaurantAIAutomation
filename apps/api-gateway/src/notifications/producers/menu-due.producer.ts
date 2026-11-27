/**
 * "The current menu is due for a newer read" — the due digest (DD-r108-17,
 * owed since DD-r106-17 PR2; menu r104 g1 built the state and the page line).
 *
 * WHAT IT READS. The house's ONE current menu (`restaurant_menus`, status
 * `active`) and the same pure `menuDueState` the versions read uses
 * (`menus/menu-due-state.ts`), on the house's own zone. So the bell and the
 * sentence on /menu can never disagree: due at one period of the menu's own
 * cadence, overdue at one and a half. A menu with no cadence, "none", or no
 * moment it was made current says nothing (ADR 0067: never a made-up reminder).
 *
 * HOW OFTEN. Once per (current menu, state): one note when it falls due, one
 * more if it becomes overdue, and nothing again until another menu is made
 * current. The dedupe key names the menu and the state, so the hourly sweep
 * claims it once. Rejected: a daily repeat (a monthly menu would ring the bell
 * thirty times for one fact), and folding it into the low-stock email digest
 * (that is its own fenced sweep, with its own preferences and audience).
 *
 * WHO HEARS IT. Owners and managers: reading a menu and making it current is
 * theirs (ADR 0193), as the page's sentence is. Low priority: in-app, no push;
 * a menu being due is never urgent and prices stay as they are.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { menuDueState, type MenuDue } from "../../menus/menu-due-state";
import { ProducerLedgerService, emptyTally, type ProducerAudience, type ProducerTally } from "./producer-ledger.service";

const PRODUCER = "menu_due";
const AUDIENCE_ROLES = ["owner", "manager"] as const;
/** The page's cadence words (MenuVersions CADENCE_WORD), so the bell and /menu say the same sentence. */
const CADENCE_WORD: Record<MenuDue["cadence"], string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "every quarter",
  yearly: "yearly",
};

/** The page's words for a span of whole days (MenuVersions agoWords), kept short. */
function agoWords(days: number): string {
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** The note's words: the page's sentence (MenuVersions DueSentence), due and overdue told apart. */
export function menuDueWords(due: MenuDue): { title: string; message: string } {
  const late = due.state === "overdue" ? "overdue" : "due";
  return {
    title: `A newer menu is ${late}`,
    message:
      `This menu was made current ${agoWords(due.daysSince)} and you keep it ${CADENCE_WORD[due.cadence]}, so a newer one is ${late}. ` +
      "Nothing on the menu has changed. Read the new one on the Menu page.",
  };
}

@Injectable()
export class MenuDueProducer {
  private readonly logger = new Logger(MenuDueProducer.name);

  static readonly PRODUCER = PRODUCER;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(restaurantId: string, timeZone: string, audience: ProducerAudience, now: Date): Promise<ProducerTally> {
    const tally = emptyTally();
    const { data, error } = await this.databaseService
      .getClient()
      .from("restaurant_menus")
      .select("id, cadence, made_current_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .limit(2);
    if (error) {
      // Unread is not "not due" (ADR 0067): a failure, never a quiet answer.
      tally.failed += 1;
      this.logger.error(`MENU_DUE_UNREADABLE restaurant=${restaurantId} — ${error.message}`);
      return tally;
    }
    const rows = (data ?? []) as Array<{ id: string; cadence: string | null; made_current_at: string | null }>;
    if (rows.length !== 1) {
      tally.withheldReason =
        rows.length === 0 ? "this house has no current menu, so none is due." : "this house has more than one current menu row, so which is due cannot be said.";
      return tally;
    }
    const menu = rows[0];
    const due = menuDueState(menu.cadence, menu.made_current_at, now, timeZone);
    if (!due || due.state === "ok") {
      tally.withheldReason = due ? "the current menu is not due yet by its own cadence." : "the current menu has no cadence (or none), so no reminder is made up.";
      return tally;
    }
    const managers = await this.managerAudience(restaurantId, audience);
    if (managers.ready.length === 0 && managers.deferred.length === 0) {
      tally.withheldReason = "no owner or manager is a member of this restaurant, so nobody could read a new menu.";
      return tally;
    }
    const words = menuDueWords(due);
    await this.ledger.emit(
      { restaurantId, producer: PRODUCER, audience: managers, tally, now },
      {
        dedupeKey: `menu-due:${restaurantId}:${menu.id}:${due.state}`,
        occurredAt: now,
        payload: {
          type: "menu_due",
          title: words.title,
          message: words.message,
          priority: "low",
          actionUrl: "/menu",
          actionLabel: "Read the new menu",
          metadata: { restaurantId, menuId: menu.id, state: due.state, cadence: due.cadence, daysSince: due.daysSince },
        },
      },
    );
    return tally;
  }

  /** Owners and managers of this house only; an unreadable roster tells nobody new (never the whole house). */
  private async managerAudience(restaurantId: string, audience: ProducerAudience): Promise<ProducerAudience> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", AUDIENCE_ROLES as unknown as string[]);
    if (error) {
      this.logger.error(`MENU_DUE_AUDIENCE_UNREADABLE restaurant=${restaurantId} — ${error.message}`);
      return { ready: [], deferred: [] };
    }
    const ids = new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
    return { ready: audience.ready.filter((id) => ids.has(id)), deferred: audience.deferred.filter((id) => ids.has(id)) };
  }
}
