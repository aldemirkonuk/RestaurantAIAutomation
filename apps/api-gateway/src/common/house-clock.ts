import { houseFrame, type HouseRecord } from "./house-frame";

/** Where a house's clock came from; "utc" means it named none we can use. */
export type HouseClockSource = "house" | "country" | "utc";

export interface HouseClock {
  /** An IANA zone this server can read; "UTC" when `source` is "utc". */
  zone: string;
  source: HouseClockSource;
}

/**
 * The one clock every quiet-hours sender reads a house on (F-1339): the
 * house's own zone, else its country's zone when the country keeps just one
 * (`houseFrame`, ADR 0207), else UTC, which the caller logs. Push holds, the
 * producer ledger, calendar reminders, the Away release and the low-stock
 * digest all come through here, so a house with no zone but a one-zone country
 * is never quiet on one clock for pushes and another for everything else.
 */
export function houseClock(row: HouseRecord | null | undefined): HouseClock {
  const frame = houseFrame(row);
  if (frame.zone && frame.zoneSource !== "none")
    return { zone: frame.zone, source: frame.zoneSource };
  return { zone: "UTC", source: "utc" };
}
