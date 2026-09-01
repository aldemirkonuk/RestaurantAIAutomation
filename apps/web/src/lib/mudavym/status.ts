/**
 * Canonical order-status reading, shared by every Mudavym page.
 *
 * The gateway speaks ProcurementOrderStatus (SCREAMING_SNAKE) and the raw
 * list endpoint returns it verbatim; normalizeOrderStatus knows the canonical
 * set but not these backend-only variants, which the legacy page mapped by
 * hand (useOrdersPage.ts mapApiStatusToUi). One truth, in the foundation —
 * pages depend on lib/mudavym, never on each other.
 */
import { normalizeOrderStatus, type OrderStatus } from '@/services/api/types';

export function canonicalStatus(raw: string | undefined): OrderStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVAL_NEEDED':
      return 'pending_approval';
    case 'CONFIRMED':
      return 'ordered';
    case 'FAILED':
      return 'cancelled';
    default:
      return normalizeOrderStatus(raw);
  }
}
