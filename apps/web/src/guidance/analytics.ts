/**
 * Lightweight guidance analytics — console in dev, dataLayer / custom hook in prod.
 */

export type GuidanceEventName =
  | 'tip_shown'
  | 'tip_snoozed'
  | 'tip_dismissed'
  | 'tip_take_tour'
  | 'tour_started'
  | 'tour_step'
  | 'tour_completed'
  | 'tour_skipped'
  | 'guide_card_clicked'
  | 'wine_agent_fab_clicked'
  | 'services_visited'
  | 'learn_opened'

export function trackGuidance(
  event: GuidanceEventName,
  props?: Record<string, string | number | boolean | undefined>,
): void {
  const payload = { event: `guidance_${event}`, ...props, ts: Date.now() }

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[guidance]', payload)
  }

  try {
    const w = window as Window & { dataLayer?: unknown[] }
    w.dataLayer?.push(payload)
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new CustomEvent('wineops:guidance', { detail: payload }))
  } catch {
    // ignore
  }
}
