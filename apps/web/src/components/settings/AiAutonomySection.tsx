import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { settingsApi, FeatureFlags } from '../../services/api/settings';
import { getErrorMessage } from '../../services/api/client';
import { cn } from '../../lib/utils';

/**
 * The product's autonomy dial.
 *
 * `enable_ai_autonomous_send` decides whether an AI-written reply reaches a
 * vendor with nobody having read it. It has been read by real code since it
 * shipped (inbound-responder.service.ts:382/497/1102) and had no control
 * anywhere in the product — the person accountable for it could not see it,
 * let alone change it. This section is that control, and it states the
 * consequence rather than the feature name.
 *
 * Two deliberate asymmetries:
 *  - turning it ON takes a second, explicit confirmation; turning it OFF is
 *    immediate. Autonomy should be harder to grant than to revoke.
 *  - every write is confirmed by the server before the switch settles. A save
 *    that fails reverts the switch and says so (ADR 0020) — a dial that looks
 *    ON while the server holds OFF is worse than no dial.
 */

type FlagKey = keyof FeatureFlags;

function Switch({
  checked,
  onClick,
  disabled,
  testId,
  label,
  tone = 'wine',
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  label: string;
  tone?: 'wine' | 'amber';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full shrink-0 transition-colors duration-200',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        checked
          ? tone === 'amber'
            ? 'bg-amber-500 focus:ring-amber-500'
            : 'bg-wine-500 focus:ring-wine-500'
          : 'bg-gray-200 focus:ring-gray-400',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function AiAutonomySection() {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<FlagKey | null>(null);
  const [confirmingAutonomy, setConfirmingAutonomy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFlags(await settingsApi.getFeatureFlags());
    } catch (e) {
      // Rendering the switches at their defaults here would be a fabrication:
      // "off" would be indistinguishable from "we could not find out".
      setFlags(null);
      setLoadError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const write = useCallback(
    async (key: FlagKey, value: boolean) => {
      setSavingKey(key);
      setSaveError(null);
      const previous = flags;
      setFlags((f) => (f ? { ...f, [key]: value } : f));
      try {
        const updated = await settingsApi.updateFeatureFlags({ [key]: value });
        setFlags(updated);
        toast.success(
          key === 'enable_ai_autonomous_send'
            ? value
              ? 'Autonomous sending is ON. AI replies will go out without your approval.'
              : 'Autonomous sending is OFF. Every AI reply waits for your approval.'
            : value
              ? 'AI will read and answer vendor email.'
              : 'AI will no longer read or answer vendor email.',
        );
      } catch (e) {
        setFlags(previous);
        const message = getErrorMessage(e);
        setSaveError(message);
        toast.error(`Nothing was changed — ${message}`);
      } finally {
        setSavingKey(null);
      }
    },
    [flags],
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5 text-sm text-gray-500">
        Loading AI settings…
      </div>
    );
  }

  if (loadError || !flags) {
    return (
      <div
        role="alert"
        className="bg-white rounded-2xl border border-red-200 shadow-sm px-6 py-5"
      >
        <p className="text-sm text-red-700">
          Couldn&apos;t load your AI settings — {loadError ?? 'unknown error'}.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          These switches are not shown because we don&apos;t know their real values.
        </p>
        <button
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  const autonomyOn = flags.enable_ai_autonomous_send;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-3.5 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-800">AI autonomy</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          How much the AI is allowed to do with your vendors on its own.
        </p>
      </div>

      {saveError && (
        <div role="alert" className="px-6 py-3 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-700">
            Couldn&apos;t save that change — {saveError}. The switch was put back.
          </p>
        </div>
      )}

      {/* ── The dial ──────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'px-6 py-4 border-b border-gray-50',
          autonomyOn && 'bg-amber-50/60',
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
              autonomyOn ? 'bg-amber-100 text-amber-600' : 'bg-gray-50 text-gray-300',
            )}
          >
            <Send className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-800">Send AI replies without my approval</p>
              {autonomyOn && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500 text-white">
                  On
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              AI email will send to vendors without your approval. Replies it writes go
              out on their own, and you find out afterwards.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-gray-500 list-disc pl-4">
              <li>You get a 2-minute window to cancel each one before it leaves.</li>
              <li>
                A reply still waits for you when a guardrail trips — commitment language,
                a price above target, a quantity or budget change, an unverified sender,
                or unclear terms.
              </li>
              <li>
                When a vendor accepts your terms, the order is moved to approved at the
                vendor&apos;s price without you tapping anything.
              </li>
              <li>Off is the default. Leave it off and every reply waits for you.</li>
            </ul>
          </div>
          <Switch
            testId="autonomy-autonomous-send"
            label="Send AI replies without my approval"
            tone="amber"
            checked={autonomyOn}
            disabled={savingKey === 'enable_ai_autonomous_send'}
            onClick={() => {
              if (autonomyOn) {
                setConfirmingAutonomy(false);
                void write('enable_ai_autonomous_send', false);
              } else {
                setConfirmingAutonomy(true);
              }
            }}
          />
        </div>

        {confirmingAutonomy && !autonomyOn && (
          <div className="mt-3 ml-12 rounded-xl border border-amber-200 bg-white px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-700">
                  Turn this on and the AI will email your vendors in your name without
                  anyone reading the message first. You can cancel each send for 2
                  minutes; after that it is gone.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="autonomy-confirm"
                    disabled={savingKey === 'enable_ai_autonomous_send'}
                    onClick={() => {
                      setConfirmingAutonomy(false);
                      void write('enable_ai_autonomous_send', true);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                  >
                    Yes, send without my approval
                  </button>
                  <button
                    type="button"
                    data-testid="autonomy-cancel"
                    onClick={() => setConfirmingAutonomy(false)}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    Keep approving each one
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── The upstream switch ───────────────────────────────────────────── */}
      <div className="px-6 py-4 flex items-start gap-4">
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
            flags.enable_ai_negotiation ? 'bg-wine-50 text-wine-500' : 'bg-gray-50 text-gray-300',
          )}
        >
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">Let AI handle vendor email</p>
          <p className="text-xs text-gray-500 mt-1">
            AI reads vendor replies, works out what they mean, and drafts your answer.
            Turn it off and it stops reading and answering vendor email entirely —
            including everything above.
          </p>
        </div>
        <Switch
          testId="autonomy-ai-negotiation"
          label="Let AI handle vendor email"
          checked={flags.enable_ai_negotiation}
          disabled={savingKey === 'enable_ai_negotiation'}
          onClick={() =>
            void write('enable_ai_negotiation', !flags.enable_ai_negotiation)
          }
        />
      </div>
    </div>
  );
}
