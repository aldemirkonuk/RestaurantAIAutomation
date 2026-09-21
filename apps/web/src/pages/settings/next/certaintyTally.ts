/**
 * The certainty tally — sketch 109A's tally strip, the founder's ship-now
 * interim (not the sketch's full design).
 *
 * Sketch 109A drew a tally that sits above every register and counts across
 * ALL of them, computed from an assistant-proposal system (ADR 0113) that has
 * no endpoint for arbitrary settings fields today — `SettingsNext.tsx`'s own
 * docblock names that fork and why this pass could not build it as drawn. The
 * founder settled the fork directly ("Lane answers batch 2", 2026-09-19
 * ~09:30Z, `founder-sketch-decisions-106-115.md`): *"settings tally =
 * ship the counted sentence now (from data, labelled 'computed here'),
 * 'Waiting on you' rail later."* This module is that counted sentence. The
 * rail stays unbuilt — it has no design of its own yet, and shipping one
 * would be new, undesigned UI, not a fix.
 *
 * FROM DATA, NEVER THE DOM. Nothing here reads `document` or `data-cert`
 * (`SectionKit.tsx`'s `Row` still sets that attribute for other purposes —
 * this module ignores it). Every count is read straight off the same
 * `SettingsNextData` fields each section already reads to decide its own
 * `cert=`, computed during the same render React already does.
 *
 * HONESTY (ADR 0020, the same rule the whole page holds): this counts NINE
 * rows across five registers — Currency, Carrying cost, Hours (×2), the
 * digest, and Notifications' four always-manual doors — the only rows this
 * pass could carry a certainty stamp to, NOT "every setting on this page".
 * `certaintyTallySentence` says "certainty-stamped settings", never bare
 * "settings", so the denominator cannot be misread as the whole page — the
 * exact "undercount dressed as a total" `SettingsNext.tsx` warns against.
 *
 * SINGLE SOURCE OF TRUTH. Each `*Cert`/`*Certs` function below is the same
 * expression its section calls for its own `cert=` prop
 * (`CurrencySection.tsx`, `CarryingCostSection.tsx`, `HoursSection.tsx`,
 * `DigestRow.tsx` all import these rather than re-deriving them), so this
 * tally and the tag a reader actually sees cannot drift apart. The one
 * exception is Notifications: its four rows (Email door, SMS door, Low-stock
 * alerts, Quiet hours — `NotifySection.tsx:101-131,203-224`) are hardcoded
 * `cert="manual"` with no expression to share, so `notifyCertCount` restates
 * the count "4" directly. A fifth manual row added there without updating
 * this file is not caught by anything but a reviewer reading both — named
 * here so it can be.
 */

import type { NotificationPreferences } from '@/services/api/notifications';
import type { OperatingHoursResponse } from '@/services/api/restaurants';
import type { Certainty } from './SectionKit';
import { fmtShare } from './st-format';
import type {
  DigestRegister,
  HouseCarryingCostRegister,
  HouseCurrencyRegister,
  Remote,
  SettingsNextData,
} from './useSettingsNextData';

/** `CarryingCostSection.tsx`'s own "What does a month of holding stock cost it?" row. */
export function carryingCostCert(reg: HouseCarryingCostRegister): Certainty {
  return reg.percentPerMonth !== null ? 'manual' : 'unstated';
}

/** `CurrencySection.tsx`'s own "What money does it count in?" row. */
export function currencyCert(reg: HouseCurrencyRegister): Certainty {
  return reg.code ? 'manual' : 'unstated';
}

/** `HoursSection.tsx`'s own "When is it open?" row. */
export function hoursOpenCert(reg: OperatingHoursResponse): Certainty {
  return reg.operatingHours !== null ? 'manual' : 'unstated';
}

/** `HoursSection.tsx`'s own "Which clock does it keep?" row. */
export function hoursTimezoneCert(reg: OperatingHoursResponse): Certainty {
  return reg.timezone ? 'manual' : 'unstated';
}

/**
 * `DigestRow.tsx`'s own branching, as the single value it now imports rather
 * than re-derives: every one of its early-return states (idle, loading,
 * denied, error, or a null `data`) is `unstated`; only a loaded, answered row
 * is `manual`. Unlike the other four registers, this row is on the page in
 * EVERY one of those states (`DigestRow` renders its own "Opening…"/"could
 * not be read"/etc. rows rather than delegating to the shared `Register`
 * shell), so it is never simply absent from the tally.
 */
export function digestCert(digest: Remote<DigestRegister>): Certainty {
  if (digest.status !== 'ok' || digest.data === null) return 'unstated';
  return digest.data.stated ? 'manual' : 'unstated';
}

/**
 * `NotifySection.tsx`'s four always-manual doors, once the register has
 * loaded: Email (`:101-110`), SMS (`:111-120`), Low-stock alerts
 * (`:129-138`), Quiet hours (`:203-224`). None of the four is derived from a
 * field value — a toggle is always in some position — so there is no
 * expression to share; see this file's own docblock for the honesty note.
 */
export function notifyCertCount(notif: Remote<NotificationPreferences>): number {
  return notif.status === 'ok' && notif.data !== null ? 4 : 0;
}

export interface CertaintyTally {
  /** Rows whose stamp is not `unstated` — a person, or the register itself, answered. */
  counted: number;
  /** Every certainty-stamped row currently on the page. */
  total: number;
}

/** Only the fields the tally reads — never the whole data hook. */
export type CertaintyTallyInput = Pick<
  SettingsNextData,
  'houseCarryingCost' | 'houseCurrency' | 'hours' | 'digest' | 'notif'
>;

/**
 * Every certainty-stamped row's tag, computed from `data` — never the DOM. A
 * register that is still loading, denied, errored, or answers "not readable"
 * contributes NOTHING: that row is not on the page at all yet, which is a
 * different fact from "on the page and unstated" (the digest row is the one
 * exception — see `digestCert`).
 */
export function certaintyTags(data: CertaintyTallyInput): Certainty[] {
  const tags: Certainty[] = [];
  const { houseCarryingCost, houseCurrency, hours, digest, notif } = data;

  if (houseCarryingCost.status === 'ok' && houseCarryingCost.data !== null && houseCarryingCost.data.readable) {
    tags.push(carryingCostCert(houseCarryingCost.data));
  }
  if (houseCurrency.status === 'ok' && houseCurrency.data !== null && houseCurrency.data.readable) {
    tags.push(currencyCert(houseCurrency.data));
  }
  if (hours.status === 'ok' && hours.data !== null) {
    tags.push(hoursOpenCert(hours.data), hoursTimezoneCert(hours.data));
  }
  tags.push(digestCert(digest));
  for (let i = 0; i < notifyCertCount(notif); i += 1) tags.push('manual');

  return tags;
}

export function computeCertaintyTally(data: CertaintyTallyInput): CertaintyTally {
  const tags = certaintyTags(data);
  return { counted: tags.filter((c) => c !== 'unstated').length, total: tags.length };
}

/**
 * The one sentence the founder decided to ship now: the count, "from data",
 * labelled "computed here". `null` before anything has loaded — a "0 of 0"
 * sentence is not a finding worth printing (and `fmtShare` would otherwise
 * print an em dash for a zero denominator, reading as its own false claim).
 */
export function certaintyTallySentence(tally: CertaintyTally): string | null {
  if (tally.total <= 0) return null;
  return `Stated so far: ${fmtShare(tally.counted, tally.total)} certainty-stamped settings — computed here.`;
}

/** The one call `SettingsNext.tsx` needs. */
export function certaintyTallyLine(data: CertaintyTallyInput): string | null {
  return certaintyTallySentence(computeCertaintyTally(data));
}
