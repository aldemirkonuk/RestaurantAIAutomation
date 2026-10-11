import type { OnboardingProgress } from '../services/api/menus'

/**
 * One reading of "set up", for the rail's Get started list and the Finish
 * setup nudge alike (F-1239). The list used to close on the row's
 * completed_at (a menu read, a supplier, an invite) while the nudge asked for
 * a current menu and a low-stock number, so the rail could call the house
 * done while the banner above it said "Finish setting up". Both now read these
 * steps, from the same answer, and never the stored stamp.
 */
export type SetUpStep = 'account' | 'menu' | 'threshold' | 'vendor' | 'team'

export function setUpSteps(progress: OnboardingProgress): Record<SetUpStep, boolean> {
  return {
    account: true,
    // A read menu that is not current yet stocks nothing (F-1061).
    menu: !!progress.menu_current,
    threshold: !!progress.threshold_configured,
    vendor: !!progress.vendor_added,
    team: !!progress.team_member_invited,
  }
}

/** The two essentials: a current menu and a low-stock number. The rest is optional. */
export function houseIsSetUp(progress: OnboardingProgress): boolean {
  const steps = setUpSteps(progress)
  return steps.menu && steps.threshold
}

/** Every step on the Get started list is done. */
export function getStartedDone(progress: OnboardingProgress): boolean {
  return Object.values(setUpSteps(progress)).every(Boolean)
}

export function setUpCount(progress: OnboardingProgress): { done: number; of: number } {
  const steps = Object.values(setUpSteps(progress))
  return { done: steps.filter(Boolean).length, of: steps.length }
}
