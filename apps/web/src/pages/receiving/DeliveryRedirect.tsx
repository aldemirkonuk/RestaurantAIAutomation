/**
 * DeliveryRedirect — what `/deliveries/:id` opens.
 *
 * The id here is a DELIVERY id, not an order id (they are different columns —
 * `delivery.id` vs `delivery.order_id`, `deliveries.controller.ts`). The link
 * itself already existed and already went nowhere: `delivery-clock.service.ts`
 * and `delivery.service.ts` build in-app notification `actionUrl`s of exactly
 * this shape (`/deliveries/${deliveryId}`) for the D9 catch-up ladder, a
 * vendor's proposal, and a door-vs-paperwork mismatch — and `apps/web/src/
 * App.tsx` had no route for it at all, so every one of those notifications'
 * "Open the delivery" action landed on the SPA catch-all and silently
 * redirected to `/`.
 *
 * WHERE A DELIVERY OPENS. All three notification kinds above fire AFTER the
 * door — a clock closing, a vendor's counter-position, a counted-vs-billed
 * disagreement — which makes the manager decision queue on `/receiving`
 * (`ReceivingNext`'s `RcManagerQueue`, "worst money first") the honest home,
 * not `/receiving/:orderId/door`: the door screen is the one-time box count
 * taken at the truck and has no control for any of these three things. So
 * this page reads the delivery, keeps only the order id off it, and hands off
 * to `/receiving?order=…`, which `RcManagerQueue` already knows how to open a
 * specific row from (added alongside this file).
 *
 * HONESTY. A read that fails is shown as a failure, in the gateway's own
 * words when it gave one — never folded into a redirect to somewhere generic.
 * A 404 and a foreign-tenant delivery look identical from here on purpose:
 * `GET /procurement/deliveries/:id` scopes every read to the token's
 * restaurant (deliveries.controller.ts), so a delivery that exists but
 * belongs to another house is indistinguishable, from this page, from one
 * that never existed — and guessing which would be a claim this page cannot
 * back up.
 */

import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router-dom'
import { deliveriesApi } from '../../services/api/deliveries'

const shell: React.CSSProperties = {
  maxWidth: 520,
  margin: '15vh auto 0',
  padding: '0 24px',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: '#4F473C',
  textAlign: 'center',
}

export default function DeliveryRedirect() {
  const { id = '' } = useParams<{ id: string }>()

  const q = useQuery({
    queryKey: ['delivery-redirect', id],
    queryFn: () => deliveriesApi.event(id),
    enabled: !!id,
    retry: false,
    staleTime: 0,
  })

  if (!id) return <Navigate to="/receiving" replace />

  if (q.isLoading) {
    return (
      <div style={shell}>
        <p style={{ fontSize: 13 }}>Opening the delivery…</p>
      </div>
    )
  }

  if (q.isError) {
    const status =
      (q.error as { response?: { status?: unknown } } | null)?.response?.status
    const notFound = status === 404 || status === 403
    return (
      <div style={shell} role="alert" data-testid="delivery-not-found">
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          {notFound
            ? 'This delivery was not found — it does not exist, or it does not belong to this house.'
            : `This delivery could not be read (${(q.error as Error)?.message ?? 'unknown error'}).`}
        </p>
        <Link to="/receiving" style={{ color: '#14515C', fontWeight: 600 }}>
          Go to Receiving
        </Link>
      </div>
    )
  }

  const orderId = q.data?.orderId ?? null
  if (!orderId) {
    // A real read, of a real delivery, that simply carries no order id
    // (`DeliveryEvent.orderId` is `string | null`) — ADR 0103's UNORDERED
    // provenance is exactly this case. Folding it into a bare `/receiving`
    // redirect would say nothing, contradicting this file's own header claim
    // that a read is "never folded into a redirect to somewhere generic".
    return (
      <div style={shell} role="status" data-testid="delivery-no-order">
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          This delivery ({q.data?.id ?? id}) was read, but it has no order to open.
        </p>
        <Link to="/receiving" style={{ color: '#14515C', fontWeight: 600 }}>
          Go to Receiving
        </Link>
      </div>
    )
  }
  return <Navigate to={`/receiving?order=${encodeURIComponent(orderId)}`} replace />
}
