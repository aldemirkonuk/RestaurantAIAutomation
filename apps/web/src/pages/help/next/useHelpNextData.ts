/**
 * useHelpNextData — everything `/help` knows, and how it knows it.
 *
 * The shipping page calls nothing (help.md §4: "none — static page"). This one
 * makes exactly one request, and it is the one a person who opened /help
 * because something felt wrong needs answered first: is it me, or the service?
 *
 *   GET /api/v1/health/ready — `apps/api-gateway/src/health/readiness.controller.ts:129`,
 *   public by decision (ADR 0096), 200 `ready` / 503 `not_ready`, memoised 5s.
 *
 * Everything else is read, not fetched: the two support variables from the
 * build (`hp-support.ts` — no fallback, an unset variable is said to be unset),
 * the `/ask` flag through the same hook every gate uses, the house from the
 * auth context (consumed optionally, so the page renders outside a provider),
 * and the Ask AI bar's window event — the event IS that surface's API
 * (`components/askai/AskAiSurface.tsx`), so a button here opens the bar the
 * same way the palette does.
 *
 * States are stated. `service` is `checking` until the gateway answers, then
 * `answered` (ready or not, with what it said) or `unreachable` (with what the
 * client said). It is never an empty object.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '@/contexts/AuthContext';
import { ASK_AI_OPEN_EVENT } from '@/components/askai/events';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { useMudavymDesign } from '@/lib/mudavym/useMudavymDesign';
import {
  buildSupportMailto,
  diagnosticsBlock,
  readSupportChannels,
  type DiagnosticsContext,
  type SupportChannels,
} from './hp-support';
import { readinessFromResponse, readinessUnreachable, type ServiceState } from './hp-service';

export type CopyOutcome = 'copied' | 'unavailable' | 'failed';

export interface HelpNextData {
  house: { name: string | null; id: string | null; role: string | null };
  support: SupportChannels;
  /** `mudavym_design_ask` for this house — the `/ask` surface exists here. */
  askOn: boolean;
  service: ServiceState;
  recheck: () => void;
  /** Dispatches the Ask AI open event. Returns false when there is no window. */
  openAskAi: () => boolean;
  /** The plain-text block support will need — the same text the mail carries. */
  diagnostics: string;
  /** `mailto:` with subject and block prefilled; null unless an address is configured. */
  mailto: string | null;
  copyDiagnostics: () => Promise<CopyOutcome>;
  /** Where the person came from, when the router was told (`state.from`). */
  cameFrom: string | null;
}

const READY_TIMEOUT_MS = 8000;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function useHelpNextData(): HelpNextData {
  const auth = useContext(AuthContext);
  const location = useLocation();
  const askOn = useMudavymDesign('ask');

  const house = useMemo(() => {
    const id = auth?.activeRestaurantId ?? null;
    const name = id ? auth?.availableRestaurants?.find((b) => b.id === id)?.name ?? null : null;
    return { name, id, role: auth?.activeRole ?? auth?.user?.role ?? null };
  }, [auth?.activeRestaurantId, auth?.availableRestaurants, auth?.activeRole, auth?.user?.role]);

  // Read at call time, not module load, so a test can stub the env and so the
  // value on screen is the value this build actually carries. Read as two
  // named properties, not the whole `ImportMetaEnv` object — Vite's own env
  // typing (`vite-env.d.ts`) declares only its base fields, so passing it
  // through whole makes SupportEnv's optional VITE_* keys structurally
  // disjoint from it (house convention: publicDesign.ts:40 does the same
  // per-property cast rather than typing the whole env object).
  const support = useMemo(() => readSupportChannels({
    VITE_SUPPORT_EMAIL: import.meta.env.VITE_SUPPORT_EMAIL as string | undefined,
    VITE_SUPPORT_SLACK_URL: import.meta.env.VITE_SUPPORT_SLACK_URL as string | undefined,
  }), []);

  const cameFrom = useMemo(() => {
    const st = location.state as { from?: unknown } | null | undefined;
    return st && typeof st.from === 'string' && st.from.trim() ? st.from : null;
  }, [location.state]);

  const [service, setService] = useState<ServiceState>({ kind: 'checking' });
  const run = useRef(0);

  const recheck = useCallback(() => {
    const token = ++run.current;
    setService({ kind: 'checking' });
    const t0 = now();
    apiClient
      .get('/health/ready', { validateStatus: () => true, timeout: READY_TIMEOUT_MS })
      .then((res) => {
        if (token !== run.current) return;
        setService(readinessFromResponse(res.status, res.data, now() - t0));
      })
      .catch((err: unknown) => {
        if (token !== run.current) return;
        setService(readinessUnreachable(getErrorMessage(err), now() - t0));
      });
  }, []);

  useEffect(() => {
    recheck();
    return () => {
      run.current += 1; // a late answer must not land on an unmounted page
    };
  }, [recheck]);

  const openAskAi = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    window.dispatchEvent(new CustomEvent(ASK_AI_OPEN_EVENT));
    return true;
  }, []);

  const ctx = useMemo<DiagnosticsContext>(() => {
    const gateway: DiagnosticsContext['gateway'] =
      service.kind === 'checking'
        ? { state: 'checking' }
        : service.kind === 'unreachable'
          ? { state: 'unreachable', detail: service.error, latencyMs: service.latencyMs }
          : {
              state: service.ready ? 'ready' : 'not_ready',
              commit: service.commit,
              latencyMs: service.latencyMs,
              detail: service.ready ? null : service.reason ?? (service.database ? `database ${service.database}` : null),
            };
    return {
      houseName: house.name,
      houseId: house.id,
      role: house.role,
      cameFrom,
      gateway,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      href: typeof window !== 'undefined' ? window.location.href : null,
    };
  }, [service, house, cameFrom]);

  const diagnostics = useMemo(() => diagnosticsBlock(ctx), [ctx]);
  const mailto = useMemo(
    () => (support.email.state === 'configured' ? buildSupportMailto(support.email.address, ctx) : null),
    [support.email, ctx],
  );

  const copyDiagnostics = useCallback(async (): Promise<CopyOutcome> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return 'unavailable';
    try {
      await navigator.clipboard.writeText(diagnostics);
      return 'copied';
    } catch {
      return 'failed';
    }
  }, [diagnostics]);

  return { house, support, askOn, service, recheck, openAskAi, diagnostics, mailto, copyDiagnostics, cameFrom };
}
