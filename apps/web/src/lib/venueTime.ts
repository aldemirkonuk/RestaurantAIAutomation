/**
 * Rendering a POS timestamp in the venue's zone, and saying so.
 *
 * `new Date(iso).toLocaleString()` renders in the VIEWER's zone. On the
 * 2026-09-03 lens run a check rung at 23:20 PDT in Palo Alto showed as
 * "2:20 AM" to a reader on the east coast — a different clock time, a
 * different service day, and an unanswerable "did this ring after we closed?".
 *
 * Two rules here, and the second is the one that matters:
 *
 *   1. Given the venue's IANA zone, format in it and append the zone's short
 *      name, so the reader can see WHICH clock they are being shown.
 *   2. Given no zone, do NOT quietly fall back to the viewer's. Format in it
 *      and label it as the viewer's, because an unlabelled local time is
 *      exactly the defect — a confident wrong answer. Absence is rendered as
 *      absence (ADR 0067).
 */

export interface VenueTimeResult {
  /** e.g. "Fri, Sep 4, 11:20 PM PDT" */
  text: string;
  /** False when no venue zone was available and the viewer's was used instead. */
  inVenueZone: boolean;
  /** What to put in a title attribute so the ambiguity is never hidden. */
  title: string;
}

/**
 * `timezone` is the venue's IANA zone or null. An invalid zone string is
 * treated the same as a missing one — `Intl` throws on it, and swallowing that
 * into the viewer's clock without saying so is how the defect got here.
 */
export function formatVenueTime(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  opts: { dateStyle?: "short" | "medium"; withDate?: boolean } = {},
): VenueTimeResult {
  if (!iso) {
    return { text: "—", inVenueZone: false, title: "No timestamp recorded" };
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return {
      text: "—",
      inVenueZone: false,
      title: `Unparseable timestamp: ${iso}`,
    };
  }

  const withDate = opts.withDate !== false;
  const base: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
  };

  if (timezone) {
    try {
      const text = new Intl.DateTimeFormat("en-US", {
        ...base,
        timeZone: timezone,
        timeZoneName: "short",
      }).format(date);
      return {
        text,
        inVenueZone: true,
        title: `${iso} — shown in the restaurant's timezone (${timezone})`,
      };
    } catch {
      // Fall through: an invalid IANA string is a missing one.
    }
  }

  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const text = new Intl.DateTimeFormat("en-US", {
    ...base,
    timeZoneName: "short",
  }).format(date);
  return {
    text,
    inVenueZone: false,
    title:
      `${iso} — the restaurant has no timezone set, so this is YOUR clock ` +
      `(${viewerZone}), not the venue's.`,
  };
}

/** Short human label for a check's hours verdict, or null when there is none. */
export function hoursStateLabel(state: string | null | undefined): {
  label: string;
  tone: "warn" | "unknown";
  title: string;
} | null {
  switch (state) {
    case "outside_hours":
      return {
        label: "Rang after close",
        tone: "warn",
        title:
          "This check closed outside the venue's published operating hours. " +
          "Recorded, not refused — late trade is a fact about the night.",
      };
    case "closed_day":
      return {
        label: "Rang on a closed day",
        tone: "warn",
        title:
          "The venue's published hours say it is closed all day. Recorded, not refused.",
      };
    case "hours_unknown":
      return {
        label: "Hours not set",
        tone: "unknown",
        title:
          "Nobody has recorded this venue's opening hours, so whether this " +
          'check rang during service is unknown — not "fine".',
      };
    case "hours_invalid":
      return {
        label: "Hours unreadable",
        tone: "unknown",
        title:
          "The venue's stored operating_hours do not parse, so the question " +
          "could not be answered.",
      };
    case "timezone_unknown":
      return {
        label: "Timezone not set",
        tone: "unknown",
        title:
          "Without the venue timezone there is no local clock to compare the " +
          "close time against.",
      };
    // 'open' and null both render nothing: a check during service needs no
    // chip, and a check written before this column existed has no verdict to
    // show. They are not the same, but neither is a finding.
    default:
      return null;
  }
}
