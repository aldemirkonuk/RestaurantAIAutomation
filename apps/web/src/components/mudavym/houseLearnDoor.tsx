/**
 * The door to "Get started" / "Learn & Help" in the house shell (r33 w1 F1).
 *
 * The panel (`LearnPanel`: the setup steps, the steps to the costs, the page
 * tours) used to be reachable only from the legacy `Sidebar`. The shell is on
 * for every house, so in production nobody could open it. This is the same
 * entry, drawn in the rooms rail and the phone's Rooms sheet.
 *
 * Which entry, by the role IN THIS HOUSE (the same rule as the legacy Sidebar):
 *   - owner or manager, setup not finished and the checklist not put away:
 *     "Get started" with the count of the four setup steps;
 *   - everyone else (and an owner or manager once setup is done or put
 *     away): "Learn & Help";
 *   - role not known yet, or the house's progress still being read for an
 *     owner or a manager: no entry, so "Learn & Help" never flashes in and
 *     swaps to "Get started".
 * A progress read that FAILED gives "Learn & Help": the tours and tips stay
 * reachable, and no count the house did not answer is shown.
 */

import type { Ref } from 'react';
import type { OnboardingProgress } from '../../services/api/menus';
import type { ShellRole } from '../../lib/mudavym/rooms';

export type LearnDoorMode = 'get-started' | 'learn';

export interface LearnDoor {
  mode: LearnDoorMode;
  /** Setup steps done, of `of` (get-started only; the account counts as one). */
  done: number;
  of: number;
  /** Owner or manager: Learn & Help also keeps the steps to the costs. */
  runsSetup: boolean;
}

export interface ProgressRead {
  progress: OnboardingProgress | null;
  isLoading: boolean;
  isError: boolean;
}

export const SETUP_STEPS = 4;

export function learnDoorFor(role: ShellRole, read: ProgressRead): LearnDoor | null {
  if (role == null) return null;
  const runsSetup = role === 'owner' || role === 'manager';
  const learn: LearnDoor = { mode: 'learn', done: 0, of: SETUP_STEPS, runsSetup };
  if (!runsSetup) return learn;
  const { progress } = read;
  if (!progress) {
    if (read.isLoading) return null;
    if (read.isError) return learn;
  }
  if (progress?.completed_at || progress?.checklist_dismissed) return learn;
  const done = [
    true,
    !!progress?.menu_current,
    !!progress?.vendor_added,
    !!progress?.team_member_invited,
  ].filter(Boolean).length;
  return { mode: 'get-started', done, of: SETUP_STEPS, runsSetup };
}

/**
 * A new owner lands on the panel once: the first time the shell opens for
 * them in a house whose setup is not done, "Get started" opens by itself.
 * Remembered per person and house on this device; a blocked store means it
 * is not opened at all rather than opened on every page.
 */
const SHOWN_KEY = (userId: string, houseId: string) => `mudavym.getStarted.opened.${userId}@${houseId}`;

export function getStartedOpenedBefore(userId: string, houseId: string): boolean {
  try {
    return window.localStorage.getItem(SHOWN_KEY(userId, houseId)) === '1';
  } catch {
    return true;
  }
}

export function rememberGetStartedOpened(userId: string, houseId: string): void {
  try {
    window.localStorage.setItem(SHOWN_KEY(userId, houseId), '1');
  } catch {
    /* nothing to keep; getStartedOpenedBefore already says "opened" */
  }
}

export interface LearnDoorButtonProps {
  door: LearnDoor;
  open: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function LearnDoorButton({ door, open, onClick, buttonRef }: LearnDoorButtonProps) {
  const start = door.mode === 'get-started';
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`mdv-rail__room mdv-rail__learn${start ? ' mdv-rail__learn--start' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-guidance={start ? 'get-started' : 'learn-help'}
      onClick={onClick}
    >
      <span>{start ? 'Get started' : 'Learn & Help'}</span>
      {start && (
        <span className="mdv-rail__learncount" aria-label={`${door.done} of ${door.of} steps done`}>
          {door.done}/{door.of}
        </span>
      )}
    </button>
  );
}
