/**
 * Haptics map — one physical language across the app.
 *
 * tick     selection, toggles, tab changes
 * commit   irreversible action fires (the Ledger Fold thock)
 * confirm  a queued/optimistic action was accepted
 * warn     discrepancy flagged, destructive confirm shown
 */
import * as Haptics from "expo-haptics";

export const haptic = {
  tick: () => Haptics.selectionAsync().catch(() => {}),
  commit: () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {}),
  confirm: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    ),
  warn: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    ),
} as const;
