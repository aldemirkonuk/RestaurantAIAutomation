export type GuidanceEventName =
  | "tip_shown"
  | "tip_snoozed"
  | "tip_dismissed"
  | "tip_take_tour"
  | "tour_started"
  | "tour_step"
  | "tour_completed"
  | "tour_skipped"
  | "guide_card_clicked"
  | "wine_agent_fab_clicked"
  | "services_visited"
  | "learn_opened";

export function trackGuidance(
  event: GuidanceEventName,
  props?: Record<string, string | number | boolean | undefined>,
): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.debug("[guidance]", { event: `guidance_${event}`, ...props });
  }
}
