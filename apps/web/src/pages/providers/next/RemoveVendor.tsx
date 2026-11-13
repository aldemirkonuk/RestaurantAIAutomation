/**
 * "Remove vendor" at the foot of the vendor sheet (r27). No page could remove
 * a vendor before, so #1337's sentence reached no one.
 *
 * - Owners and managers only, read as this sheet reads it for "How their mail
 *   reads". The gateway refuses anyone else with a 403 in words.
 * - Asked first, in the house `Panel` (ADR 0112: a confirmation). Removal is
 *   not on F10's undo-after list and no page restores a vendor.
 * - The outcome is the gateway's sentence in a toast (the sheet closes). A
 *   refusal stays in the panel, which stays open.
 */
import { useState } from 'react';
import { Panel } from '../../../components/mudavym';
import { useAuth } from '../../../contexts/AuthContext';
import { useDeleteProvider } from '../../../hooks/queries/useProviderQueries';
import type { Provider } from '../../../services/api/providers';
import { MONO, SANS } from './pv-format';

/** The confirmation's words. Exported for the test. */
export function removalAsk(name: string): string {
  return (
    `Remove ${name}? No new order can be placed with them. Their standing orders are paused. ` +
    'Orders already open stay on Orders, and you can still write to them about those.'
  );
}

function refusalOf(e: unknown): string {
  const err = e as { response?: { data?: { message?: unknown } }; request?: unknown };
  const msg = err?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (err?.request && !err?.response) {
    return 'The vendor was not removed: the connection dropped before an answer came. Try again when you are back online.';
  }
  return 'The vendor was not removed. Try again in a moment.';
}

export function RemoveVendor({
  provider,
  onRemoved,
}: {
  provider: Provider;
  /** The vendor is gone: the sheet that holds this closes. */
  onRemoved: () => void;
}) {
  const { user, activeRole } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const canRemove = role === 'owner' || role === 'manager';
  const [asking, setAsking] = useState(false);

  if (!canRemove) return null;

  return (
    <div className="px-4 pb-6" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)', fontFamily: SANS }}>
      <h3
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-4, #665D50)',
          margin: '14px 0 6px',
        }}
      >
        Remove
      </h3>
      <button
        type="button"
        data-testid="vendor-remove"
        onClick={() => setAsking(true)}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '5px 12px',
          borderRadius: 8,
          border: '1px solid var(--alarm, #8C3A2B)',
          background: 'transparent',
          color: 'var(--alarm, #8C3A2B)',
          cursor: 'pointer',
        }}
      >
        Remove vendor
      </button>
      {/* Mounted only while asking: the sheet's other readers never pay for
          the mutation, and every ask starts with no stale refusal. */}
      {asking && (
        <RemoveVendorAsk
          provider={provider}
          onKeep={() => setAsking(false)}
          onRemoved={() => {
            setAsking(false);
            onRemoved();
          }}
        />
      )}
    </div>
  );
}

function RemoveVendorAsk({
  provider,
  onKeep,
  onRemoved,
}: {
  provider: Provider;
  onKeep: () => void;
  onRemoved: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const remove = useDeleteProvider();

  const close = () => {
    if (!remove.isPending) onKeep();
  };

  const confirm = () => {
    setProblem(null);
    remove.mutate(provider.id, {
      onSuccess: () => onRemoved(),
      onError: (e) => setProblem(refusalOf(e)),
    });
  };

  return (
    <Panel
      open
      onClose={close}
      label={removalAsk(provider.name)}
      eyebrow="Remove vendor"
      title={`Remove ${provider.name}?`}
      closeLabel="Keep them"
      // Above the vendor sheet it is opened from (both default to 100).
      zIndex={110}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={close}
            disabled={remove.isPending}
            style={{
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 8,
              border: '1px solid var(--paper-2, #EAE4D8)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Keep them
          </button>
          <button
            type="button"
            data-testid="vendor-remove-confirm"
            onClick={confirm}
            disabled={remove.isPending}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 8,
              border: '1px solid var(--alarm, #8C3A2B)',
              background: 'var(--alarm, #8C3A2B)',
              color: 'var(--paper-0, #FBF8F1)',
              cursor: remove.isPending ? 'wait' : 'pointer',
            }}
          >
            {remove.isPending ? 'Removing…' : `Remove ${provider.name}`}
          </button>
        </div>
      }
    >
      <div style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, padding: '4px 0' }}>
        <p data-testid="vendor-remove-ask" style={{ margin: 0 }}>
          {removalAsk(provider.name)}
        </p>
        {problem && (
          <p
            role="alert"
            data-testid="vendor-remove-problem"
            style={{ color: 'var(--alarm, #8C3A2B)', margin: '10px 0 0' }}
          >
            {problem}
          </p>
        )}
      </div>
    </Panel>
  );
}

export default RemoveVendor;
