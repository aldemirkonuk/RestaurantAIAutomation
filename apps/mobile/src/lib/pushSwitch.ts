/**
 * The Push switch in Settings says what this phone really gets (F-1571).
 *
 * It used to save "on" first and ignore what happened next, so a phone that
 * refused notifications, or a device the gateway never took, showed ON and
 * received nothing. Now the switch is on only when the saved setting is on
 * AND nothing stands in the way; when something does, the screen says what
 * and how to fix it.
 *
 * Pure on purpose: the screen is a React Native component this runner does
 * not render (see jest.config.js).
 */
import type { PushOutcome } from "@/lib/push";

/** Why Push is not reaching this phone, or null when nothing is wrong. */
export type PushProblem = Exclude<PushOutcome, "registered"> | null;

export function pushSwitchOn(saved: boolean, problem: PushProblem): boolean {
  return saved && problem === null;
}

/**
 * Turn Push on: register first, save "on" only when the phone allowed it and
 * the device was taken. Returns what stands in the way, if anything.
 */
export async function turnPushOn(deps: {
  register: () => Promise<PushOutcome>;
  save: (on: boolean) => void;
}): Promise<PushProblem> {
  const outcome = await deps.register().catch((): PushOutcome => "failed");
  if (outcome !== "registered") return outcome;
  deps.save(true);
  return null;
}

/**
 * Push saved on, but the phone's own setting since turned off: the switch
 * must not say on. Read without asking; an unreadable answer is not a refusal.
 */
export async function savedPushProblem(
  saved: boolean,
  allowedByPhone: () => Promise<boolean | null>,
): Promise<PushProblem> {
  if (!saved) return null;
  const allowed = await allowedByPhone().catch(() => null);
  return allowed === false ? "refused" : null;
}

/** What the screen says for each problem, and the one thing to do about it. */
export const PUSH_PROBLEM_WORDS: Record<
  Exclude<PushProblem, null>,
  { message: string; action: string | null }
> = {
  refused: {
    message:
      "Notifications are off for Mudavym in your phone's settings, so alerts cannot reach this phone.",
    action: "Open phone settings",
  },
  failed: {
    message:
      "This phone could not be set up for alerts just now. Check your connection and try again.",
    action: "Try again",
  },
  unavailable: {
    message: "This device cannot receive alerts.",
    action: null,
  },
};
