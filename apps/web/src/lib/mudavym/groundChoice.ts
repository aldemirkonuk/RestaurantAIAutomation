/**
 * The person's ground choice — ADR 0169.
 *
 * The founder, 2026-09-19: "I realized all pages will be charcoal however I
 * don't want it, I prefer the white look to be honest. People should have
 * the option to choose." This revises ADR 0149 row 6 (which retired the
 * light/dark toggle in favour of "charcoal everywhere, paper only where
 * declared"): the default is now PAPER, and a person may choose CHARCOAL for
 * themselves. See `.planning/decisions/0169-the-ground-is-white-by-default-and-each-person-chooses.md`.
 *
 * FIRST VISIT IS ALWAYS PAPER (founder, 2026-09-21; restated 2026-10-01 —
 * "paper at first always , then they can select is what i meant at
 * onboarding"). A person who has never chosen sees paper, on every device,
 * every time, and that is a decision rather than an accident: the default,
 * `unknown` and `unreadable` paths never consult the device.
 *
 * SYSTEM IS A CHOICE, NEVER A DEFAULT (founder, 2026-10-01, ADR 0169
 * amendment "batch 4" — it reverses the third-option half of Fork A2). The
 * person may choose Paper, Charcoal or System. What is STORED (`setting`) is
 * kept apart from what is PAINTED (`choice`): the attribute on `<html>` is
 * always `paper` or `charcoal`. Only while the stored setting is `system` does
 * this module read `prefers-color-scheme`, and it does so in exactly one place
 * (`deviceQueryFor`, which returns nothing for any other setting); it then
 * follows the device live through the media query's `change` event and stops
 * the moment the setting or the signed-in person changes. Nothing here reads
 * the device to decide what someone who never chose should see.
 *
 * WHERE THE CONTROL LIVES (founder, 2026-10-01, page walk-through DASH-W23).
 * The header's theme button is gone; the one control is the Theme row of the
 * Preferences card on `/profile` (`pages/profile/next/IdentityRegister.tsx`),
 * which every role can reach. ADR 0169's 2026-10-01 amendment records the
 * move and the alternatives it rejected.
 *
 * PER ACCOUNT, NOT PER DEVICE (founder, 2026-09-21 — "Always paper, follows
 * account"). The round-4 build kept the choice in a single device-wide
 * `localStorage` key; that is gone. The choice now lives on the person's row
 * in `user_preferences.preferences.ground` (the JSONB blob behind
 * `GET/PATCH /users/:userId/preferences` — no new table, no new column, no
 * second preferences system) and is loaded on sign-in on any device.
 * `GroundChoiceSync.tsx` is the only thing that talks to that endpoint; this
 * module never imports the auth store or the API client, so it stays a small
 * synchronous store the CSS cascade and `shellGround.ts` can read without
 * awaiting anything.
 *
 * THE DEVICE MIRROR, AND WHY IT CANNOT CONTRADICT THE ACCOUNT. A page paints
 * long before the gateway answers, so a charcoal person would see a paper
 * flash on every single load if nothing were cached locally. So each device
 * keeps a MIRROR of the account value — but keyed by the person it belongs
 * to, `mudavym.ground.<userId>` (`groundMirrorKey`), and written ONLY from an
 * answer the account actually gave (a confirmed read, or a confirmed write).
 * Three consequences, all deliberate:
 *
 *   - It can never be applied to the wrong person. A shared desk terminal
 *     where one manager chose charcoal shows PAPER to the next person who
 *     signs in, because the pre-paint script looks up the mirror under the
 *     user id in the session's own access token, and finds nothing.
 *   - It can never claim a choice the account did not accept. A failed PATCH
 *     leaves the mirror untouched, so an unsaved choice governs the page view
 *     the person is looking at and does not survive a reload.
 *   - It CAN be one page load stale for the same person who changed their
 *     ground on another device since. That is the whole and only staleness
 *     this design carries: same person, self-caused, corrected by the account
 *     read that every load performs, and vastly cheaper than flashing paper
 *     at every charcoal person on every load. It is reported honestly in the
 *     meantime — `source` is `'device-cache'`, not `'account'`.
 *
 * A READ THAT FAILED IS NOT AN ANSWER (CLAUDE.md §9, memory
 * `absence-reported-as-health`). `choice` always has a value because a page
 * must paint something, and that value is paper when nothing is known — but
 * `source` says which of five different things that paper actually is, and
 * the control marks NO option pressed under `'unknown'` and `'unreadable'`
 * (`groundIsKnown`) rather than pressing Paper as though the person had
 * chosen it, and says why underneath (`groundNote`).
 *
 * WHERE THE CHOICE ACTUALLY REACHES THE PAGE. This module does not walk the
 * DOM setting `data-ground` on every `.mudavym` root — that would mean
 * editing every one of the ~20 `MUDAVYM_PAGES` (`lib/mudavym/shellGround.ts`'s
 * file header explains why the ground is a DOM fact the PAGE states, not a
 * prop threaded from above). Instead the choice is written ONCE, as
 * `data-mudavym-ground` on `<html>`, and `styles/mudavym.css` carries a rule
 * that reaches every `.mudavym` element which has NOT itself declared a
 * `data-ground` — so the header, the sidebar, every page body and every
 * overlay pick it up together, in one cascade. A surface that hardcodes its
 * own ground (the canonical document's `data-ground="paper"`, DoorNext's
 * `data-ground="charcoal"`) keeps doing exactly what it did before, unreached
 * by this attribute — the same way it was already unreached by the base
 * `.mudavym` selector.
 *
 * NO FLASH. `index.html` carries a synchronous, blocking twin of the mirror
 * read below, inline in `<head>` before any stylesheet or script — it reads
 * the user id out of the session's own access token, looks up the same
 * `mudavym.ground.<userId>` key and sets the same attribute before the first
 * paint — resolving a mirrored `system` through the same media query, so a
 * System person on a dark device does not flash paper either. Keep the two in
 * sync by hand; there is no bundler step that shares code into a static HTML
 * file. `groundChoiceNoFlash.test.ts` is what checks they still agree.
 */

import { useSyncExternalStore } from 'react';

/** What is PAINTED. `<html>`'s attribute is only ever one of these two. */
export type GroundChoice = 'paper' | 'charcoal';

/**
 * What the person STORED — ADR 0169's 2026-10-01 amendment (batch 4) adds
 * `system`. It is never painted as itself: while it is the stored setting it
 * resolves to paper or charcoal from the device's light/dark setting, and
 * follows that setting live.
 */
export type GroundSetting = GroundChoice | 'system';

/**
 * Where the ground currently on screen came from. This exists so that
 * "paper" can never be four different things wearing one face.
 *
 *  - `default`      nobody is signed in, or this person's account says they
 *                   have never chosen. Paper by decision, and that IS the
 *                   answer — not a placeholder. Signed in, it is also the one
 *                   source under which the first-sign-in sheet asks
 *                   (`components/mudavym/GroundFirstChoice.tsx`).
 *  - `account`      the person's account answered this page load, and this is
 *                   what it said.
 *  - `device-cache` this device's mirror of a past confirmed account answer.
 *                   Either the account read is still in flight, or it failed
 *                   (`readFailed`) — check that flag before wording anything.
 *  - `unknown`      signed in, the account has not answered yet, and this
 *                   device has never seen this person's choice. Paper is
 *                   painted because something must be; nobody has said it is
 *                   their choice.
 *  - `unreadable`   the account could not be read at all, or answered with a
 *                   value this app does not recognise, and there is no mirror
 *                   to fall back on. `detail` says which.
 */
export type GroundSource = 'default' | 'account' | 'device-cache' | 'unknown' | 'unreadable';

export interface GroundState {
  /** What is painted right now. Always paper or charcoal — a page must paint. */
  choice: GroundChoice;
  /** The setting that painted it: the person's stored Paper / Charcoal /
   *  System, or paper standing in for it under `default`, `unknown` and
   *  `unreadable`. `choice` is this setting itself, except under `system`,
   *  where it is the device's light/dark resolved. A control presses THIS. */
  setting: GroundSetting;
  /** What that value actually is. Never collapse this into `choice`. */
  source: GroundSource;
  /** True when this page load's account read errored. */
  readFailed: boolean;
  /** Set when a chosen ground could not be saved to the account. The choice
   *  still governs this page view; it will not survive a reload. */
  writeError: string | null;
  /** Human-readable reason behind `unreadable` / `readFailed`. */
  detail: string | null;
}

/** The attribute `<html>` carries once a choice has been applied. Read by
 *  `styles/mudavym.css`'s person's-choice rule. */
export const GROUND_CHOICE_ATTR = 'data-mudavym-ground';

/**
 * Prefix of this device's per-person mirror key. NEVER read or write a bare
 * device-wide key: the whole no-contradiction argument in the module doc
 * rests on every mirror access going through `groundMirrorKey(userId)`.
 * `index.html`'s pre-paint script builds the same key by hand.
 */
export const GROUND_MIRROR_KEY_PREFIX = 'mudavym.ground.';

/** This device's mirror key for one person. */
export function groundMirrorKey(userId: string): string {
  return GROUND_MIRROR_KEY_PREFIX + userId;
}

/** ADR 0169 §Decision: paper, until the person's account says otherwise. */
const DEFAULT_CHOICE: GroundChoice = 'paper';

/** Saves the setting to the person's account. Registered by
 *  `GroundChoiceSync`; absent in tests and on any surface that renders the
 *  control without the sync mounted, in which case a choice applies to the page
 *  view and reports itself unsaved. */
export type GroundWriter = (setting: GroundSetting) => Promise<unknown>;

function isGroundSetting(value: unknown): value is GroundSetting {
  return value === 'paper' || value === 'charcoal' || value === 'system';
}

/* ── module state ───────────────────────────────────────────────────────── */

let ownerId: string | null = null;
let writer: GroundWriter | null = null;
let state: GroundState = {
  choice: DEFAULT_CHOICE,
  setting: DEFAULT_CHOICE,
  source: 'default',
  readFailed: false,
  writeError: null,
  detail: null,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function applyAttr(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(GROUND_CHOICE_ATTR, state.choice);
}

/* ── the device: read only while the stored setting is `system` ─────────── */

/**
 * THE ONLY PLACE THIS MODULE READS THE DEVICE. It refuses every setting but
 * `system` before touching anything, so `default`, `unknown`, `unreadable`,
 * Paper and Charcoal never reach `matchMedia` — paper for someone who has
 * never chosen stays a decision, not the device's guess. ADR 0169's CLAIMS row
 * (`ADR-0169-GROUND-FOLLOWS-ACCOUNT`) checks that every mention of the media
 * query in this file sits inside this function, behind that first line.
 */
function deviceQueryFor(setting: GroundSetting): MediaQueryList | null {
  if (setting !== 'system') return null;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

/** The query being followed, and the handler on it. Non-null only while the
 *  stored setting is `system` for the current person. */
let following: { query: MediaQueryList; onChange: () => void } | null = null;

function stopFollowingDevice(): void {
  const current = following;
  if (!current) return;
  following = null;
  try {
    if (typeof current.query.removeEventListener === 'function') {
      current.query.removeEventListener('change', current.onChange);
    } else if (typeof current.query.removeListener === 'function') {
      current.query.removeListener(current.onChange);
    }
  } catch {
    // Nothing left to undo: the handler also refuses to repaint once the
    // setting is no longer `system`.
  }
}

/** Start or stop following the device so it matches `setting`. */
function syncDeviceFollowing(setting: GroundSetting): void {
  if (setting !== 'system') {
    stopFollowingDevice();
    return;
  }
  if (following) return;
  const query = deviceQueryFor(setting);
  if (!query) return; // No media queries here: System paints paper, unfollowed.
  const onChange = (): void => {
    // A late event for a setting that has since moved on repaints nothing.
    if (state.setting !== 'system') return;
    commit({ ...state });
  };
  try {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
    } else if (typeof query.addListener === 'function') {
      query.addListener(onChange);
    }
  } catch {
    // Painted correctly once; it simply will not follow a later flip.
  }
  following = { query, onChange };
}

/** What a setting paints. Paper and Charcoal are themselves; `system` is the
 *  device's light/dark right now, or paper where it cannot be read. */
function paintFor(setting: GroundSetting): GroundChoice {
  if (setting !== 'system') return setting;
  const query = following ? following.query : deviceQueryFor(setting);
  return query && query.matches ? 'charcoal' : 'paper';
}

function commit(next: Omit<GroundState, 'choice'>): void {
  syncDeviceFollowing(next.setting);
  state = { ...next, choice: paintFor(next.setting) };
  applyAttr();
  notify();
}

/** Read this device's mirror for one person. Never throws — storage can be
 *  blocked (a private window, a locked-down browser), which simply means this
 *  device has no mirror. */
function readMirror(userId: string | null): GroundSetting | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(groundMirrorKey(userId));
    return isGroundSetting(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Mirror an answer the ACCOUNT gave. Never called with anything else — see
 *  the module doc's no-contradiction argument. */
function writeMirror(userId: string | null, setting: GroundSetting): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(groundMirrorKey(userId), setting);
  } catch {
    // Best-effort. A device that cannot remember simply reads the account
    // again next load, and flashes paper first while it does.
  }
}

/* ── reads ──────────────────────────────────────────────────────────────── */

/**
 * The ground painted right now, read synchronously. Non-React call sites use
 * this — `lib/mudavym/shellGround.ts`'s DOM readers fall back to it when a
 * page has declared no ground of its own. A component should use
 * `useGroundChoice` instead, so it re-renders when the choice changes.
 *
 * This answers "what is on screen", NOT "what did this person choose". Use
 * `getGroundState().source` when the difference matters.
 */
export function getGroundChoice(): GroundChoice {
  return state.choice;
}

/** The painted ground AND where it came from. */
export function getGroundState(): GroundState {
  return state;
}

/** Who the store currently believes is signed in. Exported for tests,
 *  `GroundChoiceSync`'s own assertions, and the first-sign-in sheet, which
 *  asks only a signed-in person. */
export function getGroundOwnerId(): string | null {
  return ownerId;
}

/**
 * What `setting` would paint on this device right now. For a preview — the
 * first-sign-in sheet repaints itself with the option under the cursor — and
 * it reads the device only when handed `system`.
 */
export function groundPaintFor(setting: GroundSetting): GroundChoice {
  return paintFor(setting);
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/**
 * The signed-in person changed (sign-in, sign-out, or a switch on a shared
 * device). Applies this device's mirror for the new person immediately — or
 * paper, if this device has never seen them — and drops everything known
 * about the previous one, including any device-following their System
 * setting started. `GroundChoiceSync` then reconciles against the account.
 */
export function setGroundOwner(userId: string | null): void {
  if (userId === ownerId) return;
  ownerId = userId;
  stopFollowingDevice();

  if (!userId) {
    // Signed out. There is no account to follow, so the decided default is
    // the honest and complete answer — not an "unknown".
    commit({
      setting: DEFAULT_CHOICE,
      source: 'default',
      readFailed: false,
      writeError: null,
      detail: null,
    });
    return;
  }

  const mirrored = readMirror(userId);
  commit({
    setting: mirrored ?? DEFAULT_CHOICE,
    source: mirrored ? 'device-cache' : 'unknown',
    readFailed: false,
    writeError: null,
    detail: null,
  });
}

/**
 * The person's account answered. `raw` is `preferences.ground` straight off
 * the wire: `'paper'`, `'charcoal'`, `'system'`, or `undefined`/`null`
 * meaning they have never chosen.
 *
 * STICKY AFTER A FAILED SAVE. When `writeError` is outstanding, this does not
 * repaint. The person picked a ground moments ago, the save failed, and
 * `useUserPreferences`' optimistic mutation rolls its cache back to the
 * server's older value and refetches — so without this guard the ground would
 * silently snap back underneath them a moment after the control told them it had
 * not been saved. The unsaved choice governs this page view, says so, and
 * does not survive a reload (the mirror was never written).
 */
export function applyAccountGround(raw: unknown): void {
  if (state.writeError) return;

  if (raw === undefined || raw === null) {
    // The account holds no ground for this person: they have never chosen.
    // That is a real answer, so mirror it — a confirmed paper is what keeps
    // the next load from painting an "unknown" paper.
    writeMirror(ownerId, DEFAULT_CHOICE);
    commit({
      setting: DEFAULT_CHOICE,
      source: 'default',
      readFailed: false,
      writeError: null,
      detail: null,
    });
    return;
  }

  if (!isGroundSetting(raw)) {
    // A value is stored but this app does not know it. Reporting that as
    // "paper, chosen" would be exactly the absence-as-health shape; say it.
    const mirrored = readMirror(ownerId);
    commit({
      setting: mirrored ?? DEFAULT_CHOICE,
      source: mirrored ? 'device-cache' : 'unreadable',
      readFailed: true,
      writeError: null,
      detail: `Your account holds a ground this app does not know: ${JSON.stringify(raw)}.`,
    });
    return;
  }

  writeMirror(ownerId, raw);
  commit({
    setting: raw,
    source: 'account',
    readFailed: false,
    writeError: null,
    detail: null,
  });
}

/**
 * The account read failed. Keeps painting whatever is on screen — this device's
 * mirror if it has one, otherwise the setting already showing (paper, unless
 * the person picked something this page view) — and records that nobody has
 * confirmed it. The control wears this; it is never silently folded into
 * "paper by default".
 */
export function reportGroundReadFailure(detail: string): void {
  const mirrored = readMirror(ownerId);
  commit({
    setting: mirrored ?? state.setting,
    source: mirrored ? 'device-cache' : 'unreadable',
    readFailed: true,
    writeError: state.writeError,
    detail,
  });
}

/**
 * Register (or clear, with `null`) the function that saves a choice to the
 * person's account. `GroundChoiceSync` owns this.
 */
export function registerGroundWriter(next: GroundWriter | null): void {
  writer = next;
}

/**
 * Choose a ground, and learn whether the account kept it. Applies immediately
 * — every mounted `.mudavym` surface that has not declared its own ground
 * repaints through the cascade rule in `styles/mudavym.css` — then saves it to
 * the person's account. Resolves `true` once the account accepted it, `false`
 * when it was not saved (no one signed in, no way to reach the account, or the
 * request failed); it never rejects.
 *
 * The save is where this differs from the round-4 build: nothing is written
 * to this device until the account has accepted it, so a failed save cannot
 * leave a choice behind that the person's other devices will never see.
 */
export function saveGroundSetting(setting: GroundSetting): Promise<boolean> {
  const sending = writer;
  const owner = ownerId;

  commit({
    setting,
    source: owner ? state.source : 'default',
    readFailed: state.readFailed,
    writeError: null,
    detail: state.detail,
  });

  if (!sending || !owner) {
    commit({
      ...state,
      writeError: owner
        ? 'This ground is not saved — the app could not reach your account settings.'
        : 'This ground is not saved — no one is signed in, so there is no account to remember it.',
    });
    return Promise.resolve(false);
  }

  return sending(setting).then(
    () => {
      // Only now is it the account's value, so only now does this device
      // mirror it.
      writeMirror(owner, setting);
      // Guard against a late resolution landing after the person switched
      // accounts or chose again.
      if (ownerId !== owner || state.setting !== setting) return true;
      commit({
        setting,
        source: 'account',
        readFailed: false,
        writeError: null,
        detail: null,
      });
      return true;
    },
    (error: unknown) => {
      if (ownerId !== owner || state.setting !== setting) return false;
      const message =
        error instanceof Error && error.message ? error.message : 'the request failed';
      commit({
        ...state,
        writeError: `This ground is not saved to your account (${message}). It will go back on your next visit.`,
      });
      return false;
    },
  );
}

/** `saveGroundSetting` for a control that does not wait on the answer — the
 *  store's `writeError` / `groundNote` carry a failure to it instead. */
export function setGroundChoice(setting: GroundSetting): void {
  void saveGroundSetting(setting);
}

/* ── React ──────────────────────────────────────────────────────────────── */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    // Another tab on this device changed the mirror for the SAME person.
    // `e.key === null` means a full `localStorage.clear()`, which also needs a
    // re-read rather than being ignored because it does not name our key.
    if (!ownerId) return;
    if (e.key !== null && e.key !== groundMirrorKey(ownerId)) return;
    const mirrored = readMirror(ownerId);
    if (mirrored === null || mirrored === state.setting) return;
    commit({
      setting: mirrored,
      source: 'device-cache',
      readFailed: state.readFailed,
      writeError: null,
      detail: state.detail,
    });
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getServerSnapshot(): GroundState {
  return state;
}

/**
 * The person's ground, reactive: `[painted, setSetting]`. `setSetting`
 * applies immediately and saves to the account — see `setGroundChoice`.
 *
 * This is the PAINTING hook. A caller that needs to tell "paper because they
 * chose it" from "paper because we do not know yet", or Paper from a System
 * that resolved to paper, wants `useGroundState`.
 */
export function useGroundChoice(): [GroundChoice, (setting: GroundSetting) => void] {
  const current = useSyncExternalStore(subscribe, getGroundState, getServerSnapshot);
  return [current.choice, setGroundChoice];
}

/** The painted ground and its provenance. The `/profile` control uses this so
 *  it never marks an option chosen that nobody chose. */
export function useGroundState(): GroundState {
  return useSyncExternalStore(subscribe, getGroundState, getServerSnapshot);
}

/* ── what a control says ────────────────────────────────────────────────── */

/**
 * The three options, in order (founder, 2026-10-01 — "Paper / Charcoal /
 * System", on the first-sign-in sheet and on `/profile`). This replaces the
 * 2026-09-21 "two, never three": System is offered, but it is never what
 * someone who has not chosen gets.
 */
export const GROUND_OPTIONS: ReadonlyArray<{
  value: GroundSetting;
  label: string;
  hint?: string;
}> = [
  { value: 'paper', label: 'Paper' },
  { value: 'charcoal', label: 'Charcoal' },
  { value: 'system', label: 'System', hint: 'Follows this device’s light or dark setting.' },
];

/**
 * Under these, nobody has told us what this person chose — so a control marks
 * nothing chosen. `default` is NOT one of them: paper-because-they-never-chose
 * is a real, confirmed answer.
 */
export function groundIsKnown(state: GroundState): boolean {
  return state.source !== 'unknown' && state.source !== 'unreadable';
}

/**
 * What a control says under its options, or null when the ground on screen is
 * simply this person's confirmed answer and needs no caveat. A write failure
 * outranks a read one: it is the thing that just happened.
 */
export function groundNote(state: GroundState): string | null {
  if (state.writeError) return state.writeError;
  switch (state.source) {
    case 'unknown':
      return 'Reading the ground you saved to your account. Paper until it answers.';
    case 'unreadable':
      return state.readFailed
        ? `The ground you saved could not be read (${state.detail ?? 'unknown reason'}). Paper until it can be.`
        : 'The ground you saved could not be read. Paper until it can be.';
    case 'device-cache':
      return state.readFailed
        ? `Your account could not be reached (${state.detail ?? 'unknown reason'}). This is the last ground this device saw you choose.`
        : 'This is the last ground this device saw you choose, while your account answers.';
    default:
      return null;
  }
}

/** Tests only — `ownerId`, `writer`, `state` and the device-following are
 *  module state and would otherwise leak across specs (same shape as
 *  `shellGround.ts`'s `resetMudavymShell`). */
export function resetGroundChoiceForTests(): void {
  stopFollowingDevice();
  ownerId = null;
  writer = null;
  state = {
    choice: DEFAULT_CHOICE,
    setting: DEFAULT_CHOICE,
    source: 'default',
    readFailed: false,
    writeError: null,
    detail: null,
  };
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  }
  notify();
}
