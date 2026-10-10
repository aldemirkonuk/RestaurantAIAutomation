/**
 * OrderHeldElsewhere — inside the "not among the loaded orders" banner, when
 * a link names an order that another of the person's own houses holds
 * (F-245): "This order is in Kadikoy. Open it there", which moves the session
 * there, and the page then finds the order under the same link.
 *
 * Asks `GET /auth/houses/holding`, which answers only with a house the person
 * is a member of. Says nothing while asking, when the read fails, when no
 * house of theirs holds it, or when the holder is the house already open (the
 * order is then just further back than the page loaded).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import apiClient from '@/services/api/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HoldingHouse {
  id: string;
  name: string;
  city: string | null;
}

export function OrderHeldElsewhere({ orderId }: { orderId: string }) {
  const { activeRestaurantId, setActiveRestaurantId } = useAuth();
  const [opening, setOpening] = useState(false);
  const [refused, setRefused] = useState(false);

  const holding = useQuery({
    queryKey: ['house-holding-order', orderId, activeRestaurantId],
    queryFn: async (): Promise<HoldingHouse | null> => {
      const { data } = await apiClient.get('/auth/houses/holding', {
        params: { order: orderId },
      });
      const house = data?.house;
      return house && typeof house.id === 'string' ? (house as HoldingHouse) : null;
    },
    // An id that is not an order id is held by no house; the gateway would
    // only refuse it.
    enabled: UUID.test(orderId),
    retry: false,
    staleTime: 60_000,
  });

  const house = holding.data;
  if (!house || house.id === activeRestaurantId) return null;
  const name = house.name || 'another of your houses';

  const open = async () => {
    setOpening(true);
    setRefused(false);
    const ok = await setActiveRestaurantId(house.id);
    setOpening(false);
    if (!ok) setRefused(true);
  };

  return (
    <div data-testid="order-held-elsewhere" className="mt-2">
      This order is in {name}.{' '}
      <button
        type="button"
        onClick={open}
        disabled={opening}
        style={{
          font: 'inherit',
          fontWeight: 600,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'var(--seal-deep, #14515C)',
          textDecoration: 'underline',
          cursor: opening ? 'default' : 'pointer',
        }}
      >
        {opening ? `Opening ${name}…` : 'Open it there'}
      </button>
      {refused && (
        <span role="status">
          {' '}
          {name} could not be opened, so you are still in this house. Try again.
        </span>
      )}
    </div>
  );
}
