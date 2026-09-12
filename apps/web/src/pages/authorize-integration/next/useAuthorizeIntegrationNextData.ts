/**
 * The four reads behind the consent page, each with a stated state.
 *
 *   catalogue   GET  /integrations/oauth/catalog          — what exists, what it asks for
 *   standing    GET  /integrations/oauth/connections      — whether this person already holds it
 *   retention   GET  /communications/retention/disclosure — only once the entry says it mirrors mail
 *   hand-off    POST /integrations/oauth/:id/authorize    — the provider URL, then a full navigation
 *
 * Nothing here is placeholdered: a read is `loading`, `unreadable` (with what
 * the gateway said) or `ready`. A retention read that is not needed says so
 * rather than pretending to be empty — a grant that reads nothing has no
 * retention rule to describe.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type IntegrationConnection,
  type IntegrationId,
  type RetentionDisclosure,
} from '../../../services/api/integrations';
import { readFailure, verdictFor, type CatalogRead, type ReadFailure, type Verdict } from './ai-format';

export type StandingRead =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: ReadFailure }
  | { state: 'ready'; rows: IntegrationConnection[] };

export type RetentionRead =
  | { state: 'not-needed' }
  | { state: 'loading' }
  | { state: 'unreadable'; failure: ReadFailure }
  | { state: 'ready'; value: RetentionDisclosure };

export type Handoff =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'failed'; failure: ReadFailure };

export interface AuthorizeIntegrationNextData {
  catalog: CatalogRead;
  /** What the page draws, decided from the catalogue and the route's id alone. */
  verdict: Verdict;
  standing: StandingRead;
  retention: RetentionRead;
  handoff: Handoff;
  /** POST the authorize call and leave for the provider. */
  allow: (id: IntegrationId, returnPath: string) => Promise<void>;
  /** Re-run the catalogue and standing reads after a failure. */
  reload: () => void;
}

/** Full navigation, not react-router: the destination is the provider. */
function leaveFor(url: string): void {
  window.location.assign(url);
}

export function useAuthorizeIntegrationNextData(
  integrationId: string | undefined,
): AuthorizeIntegrationNextData {
  const [catalog, setCatalog] = useState<CatalogRead>({ state: 'loading' });
  const [standing, setStanding] = useState<StandingRead>({ state: 'loading' });
  const [retention, setRetention] = useState<RetentionRead>({ state: 'not-needed' });
  const [handoff, setHandoff] = useState<Handoff>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog({ state: 'loading' });
    setStanding({ state: 'loading' });
    integrationsApi
      .getCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog({ state: 'ready', entries, readAt: new Date() });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCatalog({
            state: 'unreadable',
            failure: readFailure(e, 'The integration catalogue could not be read.'),
          });
        }
      });
    integrationsApi
      .getConnections()
      .then((rows) => {
        if (!cancelled) setStanding({ state: 'ready', rows });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStanding({
            state: 'unreadable',
            failure: readFailure(e, 'Your existing grants could not be read.'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /**
   * The SERVER says whether a grant mirrors mail (`entry.mirrorsMail`), and
   * only then is the per-house retention figure owed. `?? false` for a gateway
   * that predates the field: on such a deployment there is no retention rule
   * to describe, so "not needed" is the true answer for it.
   */
  const verdict = verdictFor(integrationId, catalog);
  const entry: IntegrationCatalogEntry | null =
    verdict.kind === 'ready' || verdict.kind === 'unavailable' ? verdict.entry : null;
  const mirrorsMail = entry?.mirrorsMail ?? false;

  useEffect(() => {
    if (!mirrorsMail) {
      setRetention({ state: 'not-needed' });
      return;
    }
    let cancelled = false;
    setRetention({ state: 'loading' });
    integrationsApi
      .getRetentionDisclosure()
      .then((value) => {
        if (!cancelled) setRetention({ state: 'ready', value });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRetention({
            state: 'unreadable',
            failure: readFailure(e, 'The retention figure could not be read.'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mirrorsMail, attempt]);

  const allow = useCallback(async (id: IntegrationId, returnPath: string) => {
    setHandoff({ state: 'starting' });
    try {
      const url = await integrationsApi.authorize(id, returnPath);
      leaveFor(url);
    } catch (e: unknown) {
      setHandoff({
        state: 'failed',
        failure: readFailure(e, 'The authorization could not be started.'),
      });
    }
  }, []);

  const reload = useCallback(() => {
    setHandoff({ state: 'idle' });
    setAttempt((n) => n + 1);
  }, []);

  return { catalog, verdict, standing, retention, handoff, allow, reload };
}
