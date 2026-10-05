/**
 * One bell note for the owners and managers when a POS import refuses checks
 * (ADR 0281, amended 2026-10-05: refused checks reach the bell).
 *
 * WHY
 * ---
 * ADR 0281's ruling F4 refuses a check whose closing time the import cannot
 * read: no `pos_checks` row, no stock, no consumption. The import result says
 * so (`refusedUnreadableDate`, `errors[]`), but only the caller reads that
 * result, and a webhook has no person reading its response. The founder's
 * answer (2026-10-05, verbatim in the ADR): "Bell note, follow-up PR
 * (Recommended)" — one owner/manager bell note per import with refusals,
 * with the check ids.
 *
 * WHAT IT DOES
 * ------------
 * - ONE note per import call that refused at least one check, never one per
 *   check. `PosHubService.ingest()` calls this once, after its loop, and only
 *   when something was refused.
 * - To the house's ACTIVE OWNERS AND MANAGERS only (`user_restaurant_access`,
 *   this house, `is_active`), written with `onlyUserIds`, so staff never get
 *   it and `persistForRestaurant` intersects it with the house's own members.
 *   A role read from the legacy `users` row is not read: that row proves
 *   membership, never privilege (ADR 0088).
 * - Away (ADR 0218) is applied by the funnel's own ladder,
 *   `AreaRoutingService.route`, over those owners and managers: the ones
 *   Away today are set aside; if every one of them is Away, the owners get
 *   the row in their inbox only (no push, no live ping), so it never waits
 *   unseen. An unreadable Away register writes to all of them, as the
 *   funnel does.
 * - The note names at most `MAX_NOTE_CHECK_IDS` check ids and counts the
 *   rest, each id cut at `MAX_NOTE_ID_CHARS`. It carries the till's name, the
 *   count, and the first unreadable value the till sent, cut at 40
 *   characters. Nothing else from the payload, and no secret.
 *
 * NEVER THROWS
 * ------------
 * A note that could not be filed must not fail or undo the import: the checks
 * were refused whatever happens here. Every path returns a `RefusedChecksNote`
 * that the import result carries as `bellNote`, so "not filed" is said, with
 * its reason, rather than read as "told" (ADR 0067's "a failed read is never
 * an empty one", in spirit). It is also logged.
 *
 * NO EMOJI: `notification-text-is-plain.spec.ts` scans every gateway file that
 * names a notification funnel, and this one does.
 */
import type { Logger } from "@nestjs/common";
import type { AreaRoutingService } from "../areas/area-routing.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { PROVIDER_BY_KEY } from "./pos-provider.registry";

/** The bell row's `type`. */
export const REFUSED_CHECKS_NOTE_TYPE = "pos_import_refused";

/** At most this many refused check ids are named in a note; the rest are counted. */
export const MAX_NOTE_CHECK_IDS = 10;

/** A check id longer than this is cut, so one id cannot fill a phone screen. */
export const MAX_NOTE_ID_CHARS = 40;

/** The value the till sent, as the note quotes it, is cut at this length. */
const MAX_NOTE_VALUE_CHARS = 40;

/** What the import result says about the note, as `bellNote`. */
export interface RefusedChecksNote {
  /** True when the note was written to at least one owner's or manager's bell. */
  filed: boolean;
  /** How many bells it was written to. */
  recipients: number;
  /** Owners and managers set aside because they are Away today (ADR 0218). */
  heldAway: number;
  /** Why it was not filed, in words. Null when it was. */
  notFiledBecause: string | null;
}

/** The part of a refused check the note reads. */
export interface RefusedCheck {
  externalCheckId: unknown;
  closedAt?: unknown;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A check id as the note shows it: one line, cut, never blank. */
export function sayCheckId(id: unknown): string {
  const text = String(id ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? cut(text, MAX_NOTE_ID_CHARS) : "(no id)";
}

/** The value the till sent, as JSON, on one line, cut. */
function sayValue(value: unknown): string {
  const text = (JSON.stringify(value) ?? String(value)).replace(/\s+/g, " ");
  return cut(text, MAX_NOTE_VALUE_CHARS);
}

/** The till as the house knows it: the registry's name, else its key. */
export function tillName(providerKey: string): string {
  return PROVIDER_BY_KEY[providerKey]?.name ?? providerKey;
}

/**
 * The note's words. Pure, so the copy is tested on its own. The title is the
 * founder's own example ("3 checks not imported: date not readable"); no
 * internal field name appears in it.
 */
export function refusedChecksNoteCopy(input: {
  providerKey: string;
  refused: ReadonlyArray<RefusedCheck>;
}): {
  title: string;
  message: string;
  named: string[];
  notNamed: number;
} {
  const n = input.refused.length;
  const one = n === 1;
  const named = input.refused
    .slice(0, MAX_NOTE_CHECK_IDS)
    .map((c) => sayCheckId(c.externalCheckId));
  const notNamed = n - named.length;
  const value = n > 0 ? sayValue(input.refused[0].closedAt) : "";
  const title = `${n} check${one ? "" : "s"} not imported: date not readable`;
  const message =
    `${n} check${one ? "" : "s"} from ${tillName(input.providerKey)} ` +
    `${one ? "was" : "were"} not imported because ${one ? "its" : "their"} closing time could not be read ` +
    `(${one ? "it was" : "the first was"} written as ${value}). ` +
    `${one ? "Its sale and its stock are" : "Their sales and stock are"} not recorded. ` +
    `${one ? "Check" : "Checks"}: ${named.join(", ")}${notNamed > 0 ? `, and ${notNamed} more` : ""}. ` +
    `Send ${one ? "it" : "them"} again with the closing time written as 2026-10-03 21:00.`;
  return { title, message, named, notNamed };
}

function isOwnerOrManager(role: unknown): boolean {
  if (typeof role !== "string") return false;
  const r = role.trim().toLowerCase();
  return r === "owner" || r === "manager";
}

/**
 * File the one note for an import's refused checks. Never throws; see the
 * header for every outcome.
 */
export async function fileRefusedChecksNote(
  deps: {
    client: any;
    notifications?: NotificationsService;
    areaRouting?: AreaRoutingService;
    logger: Logger;
  },
  input: {
    restaurantId: string;
    providerKey: string;
    refused: ReadonlyArray<RefusedCheck>;
    now?: Date;
  },
): Promise<RefusedChecksNote> {
  const { restaurantId, providerKey, refused } = input;
  const notFiled = (why: string, heldAway = 0): RefusedChecksNote => {
    deps.logger.warn(
      `POS_REFUSED_CHECKS_NOTE_NOT_FILED restaurant=${restaurantId} source=${providerKey} ` +
        `refused=${refused.length} — ${why}. The checks stay refused; the import result says so.`,
    );
    return { filed: false, recipients: 0, heldAway, notFiledBecause: why };
  };

  try {
    if (!deps.notifications) {
      return notFiled("the bell is not wired on this server");
    }

    const { data, error } = await deps.client
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (error) {
      return notFiled(
        `this house's owners and managers could not be read (${error.message})`,
      );
    }
    const audience = [
      ...new Set(
        ((data ?? []) as Array<{ user_id?: unknown; role?: unknown }>)
          .filter((r) => isOwnerOrManager(r?.role))
          .map((r) => r?.user_id)
          .filter((id): id is string => typeof id === "string" && id !== ""),
      ),
    ];
    if (audience.length === 0) {
      return notFiled("this house has no active owner or manager to tell");
    }

    // ADR 0218: the funnel's own ladder, over the owners and managers only.
    const route = deps.areaRouting
      ? await deps.areaRouting.route(
          restaurantId,
          audience,
          null,
          input.now ?? new Date(),
        )
      : null;
    const inboxOnly = route?.step === "owners_inbox_only";
    const to = route ? (inboxOnly ? route.inboxOnly : route.alert) : audience;
    const heldAway = route?.heldAway ?? 0;
    if (to.length === 0) {
      return notFiled("no owner or manager could be addressed", heldAway);
    }

    const copy = refusedChecksNoteCopy({ providerKey, refused });
    const { inserted } = await deps.notifications.persistForRestaurant(
      restaurantId,
      {
        type: REFUSED_CHECKS_NOTE_TYPE,
        title: copy.title,
        message: copy.message,
        // Every owner and manager Away: a row and nothing else. "low" keeps
        // the funnel from pushing to a phone; `broadcast: false` keeps it
        // from the live ping (ADR 0218, the ladder's last step).
        priority: inboxOnly ? "low" : "high",
        actionUrl: "/connections",
        actionLabel: "Open Connections",
        groupKey: `${REFUSED_CHECKS_NOTE_TYPE}:${providerKey}`,
        metadata: {
          source: providerKey,
          till: tillName(providerKey),
          refused: refused.length,
          checkIds: copy.named,
          checkIdsNotNamed: copy.notNamed,
          reason: "date_not_readable",
          awayStep: route?.step ?? null,
          heldAway,
        },
      },
      { onlyUserIds: to, broadcast: !inboxOnly },
    );
    if (inserted === 0) {
      return notFiled(
        "the bell write wrote no rows (the notification funnel logs why)",
        heldAway,
      );
    }
    deps.logger.log(
      `POS_REFUSED_CHECKS_NOTE_FILED restaurant=${restaurantId} source=${providerKey} ` +
        `refused=${refused.length} recipients=${inserted} heldAway=${heldAway}`,
    );
    return {
      filed: true,
      recipients: inserted,
      heldAway,
      notFiledBecause: null,
    };
  } catch (e: unknown) {
    return notFiled(
      `the bell write failed (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}
