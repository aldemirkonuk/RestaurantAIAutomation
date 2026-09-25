import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Wordmark } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import apiClient, { getErrorMessage } from '@/services/api/client';
import { ensureFraunces } from './fonts';
import './admin-desk.css';

type Agent = { agent_name: string; version: string | null; status: string; healthy: boolean | null };
type Agents = { agents: Agent[]; observedAt: string; scope: 'platform' };
type Provider = { id: string; name: string; desc: string; status: string; configured: boolean };
type Readiness = { status: string; checkedAt: string; commit: string; bootedAt: string; checks: { database: string } };
type RemoteCheck = 'settled' | 'running' | 'absent' | 'unreadable' | 'unchanged' | 'expired' | null;
type Receipt = { id: string; agent_name: string; action: string; status: string; requested_at: string; completed_at: string | null; remote: RemoteCheck };
type AgentDetail = {
  metrics: {
    messages: { received: number | null; processed: number | null; failed: number | null; skipped: number | null; success_rate: string | null };
    timing: { avg_ms: number | null; min_ms: number | null; max_ms: number | null; p95_ms: number | null };
    health: { errors: number | null; circuit_breaker_trips: number | null };
    activity: { uptime_seconds: number | null; pause_count: number | null; restart_count: number | null };
  };
  queue_size: number | null;
  active_tasks: number | null;
  circuit_breaker: { state: string; available: boolean | null } | null;
};

/** A reading that keeps the last good value in view when a re-read fails,
 * instead of replacing it with nothing. `asOf` is the time of the last
 * SUCCESSFUL read; it does not move when a re-read errors, so the caller can
 * label the kept value as stale and say how old it is. */
type Read<T> = { value: T | null; error: string | null; asOf: string | null };
const unread = <T,>(): Read<T> => ({ value: null, error: null, asOf: null });
/** Merge a fetch outcome onto the previous reading: success replaces both
 * value and asOf; failure keeps the previous value and asOf, and only sets
 * the error, so a stale-but-present reading is never wiped by a bad re-read. */
function settle<T>(previous: Read<T>, outcome: { value: T | null; error: string | null }): Read<T> {
  if (outcome.error) return { value: previous.value, error: outcome.error, asOf: previous.asOf };
  return { value: outcome.value, error: null, asOf: new Date().toISOString() };
}
const stamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const POLL_MS = 30_000;

/** ADR 0143's one desk. It reports observations; house settings retain their own writers. */
export default function AdminDesk() {
  const { user } = useAuth();
  useEffect(() => { ensureFraunces(); }, []);
  const [revision, setRevision] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [access, setAccess] = useState<Read<{ platformOperator: boolean }>>(unread);
  const [agents, setAgents] = useState<Read<Agents>>(unread);
  const [providers, setProviders] = useState<Read<{ providers: Provider[] }>>(unread);
  const [ready, setReady] = useState<Read<Readiness>>(unread);
  const [receipts, setReceipts] = useState<Read<{ operations: Receipt[] }>>(unread);
  const [selection, setSelection] = useState<{ agent: Agent; action: 'restart' | 'stop' } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ agent: Agent } & Read<AgentDetail> | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'attention'>('all');
  const actionInFlight = useRef(false);
  // Bumped on every openDetail call and on every manual close, so a read that lands
  // after the sheet was closed (or after a different agent was opened) is discarded
  // instead of reopening it with stale counters (measured: P1).
  const detailToken = useRef(0);
  const operator = access.value?.platformOperator === true;
  // ADR 0143 §2 / ADR 0149 row 10: owners and platform operators, not managers
  // or staff. The server enforces this independently on every read
  // (health-proxy.controller.ts's OwnerOrPlatformOperatorGuard) — this only
  // decides what the browser attempts and shows.
  const canRead = user?.role === 'owner' || operator;

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setRefreshing(true);
    async function read<T>(path: string): Promise<{ value: T | null; error: string | null }> {
      try { return { value: (await apiClient.get<T>(path, { signal })).data, error: null }; }
      catch (error) { return { value: null, error: getErrorMessage(error) }; }
    }
    void (async () => {
      // A re-read's own permission check can fail (a blip, not a real revocation) while
      // the server-enforced guards on every other route still stand. Falling back to the
      // last SUCCESSFUL grant — instead of the raw failed outcome — keeps this cycle from
      // silently skipping agents/providers/receipts and leaving them stale with no sign
      // that a re-read was even attempted (measured: P2).
      const priorOperator = access.value?.platformOperator === true;
      const permission = await read<{ platformOperator: boolean }>('/health/access');
      if (signal.aborted) return;
      setAccess(previous => settle(previous, permission));
      const knownOperator = permission.error ? priorOperator : permission.value?.platformOperator === true;
      if (user?.role !== 'owner' && !knownOperator) {
        setInitialLoading(false); setRefreshing(false); return;
      }
      const [health, configuration, readiness, history] = await Promise.all([
        read<Agents>('/health/agents'), read<{ providers: Provider[] }>('/health/providers'),
        // A 503 carries a measured not-ready result; keep that evidence visible.
        apiClient.get<Readiness>('/health/ready', { signal, validateStatus: status => status === 200 || status === 503 })
          .then(response => ({ value: response.data, error: null }), error => ({ value: null, error: getErrorMessage(error) })),
        knownOperator ? read<{ operations: Receipt[] }>('/health/agent-operations') : Promise.resolve({ value: null, error: null }),
      ]);
      if (signal.aborted) return;
      setAgents(previous => settle(previous, health));
      setProviders(previous => settle(previous, configuration));
      setReady(previous => settle(previous, readiness));
      if (knownOperator) setReceipts(previous => settle(previous, history));
      setInitialLoading(false); setRefreshing(false);
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, user?.userId, user?.restaurantId, user?.role]);

  // Poll every 30s while the tab is visible; a hidden tab neither fires a
  // request nor keeps a stale reading ticking toward staleness for no reason.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') setRevision(value => value + 1); };
    const interval = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // `r` reads again, matching legacy AdminHealth.tsx's shortcut. Escape is not
  // handled here: Sheet already closes on Escape for the topmost open overlay
  // (components/mudavym/Sheet.tsx), so a second handler here would only race it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'r' && !selection && !detail) { event.preventDefault(); setRevision(value => value + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, detail]);

  async function operate() {
    if (!selection || confirmation !== selection.agent.agent_name || !operator || actionInFlight.current) return;
    actionInFlight.current = true; setSending(true); setOutcome(null);
    try {
      const response = await apiClient.post<{ status: string; receiptRecorded: boolean }>(
        `/health/agent-operations/${encodeURIComponent(selection.agent.agent_name)}/${selection.action}`,
        { requestId: crypto.randomUUID() },
      );
      setOutcome(response.data.status === 'succeeded'
        ? `${selection.action === 'restart' ? 'Restart' : 'Stop'} completed.${response.data.receiptRecorded ? '' : ' The final receipt could not be saved.'}`
        : 'The operation did not report success. Read the receipt before acting again.');
    } catch (error) {
      setOutcome(`${getErrorMessage(error)} Check the operation receipts before trying again.`);
    } finally {
      actionInFlight.current = false; setSending(false); setSelection(null); setConfirmation(''); setRevision(value => value + 1);
    }
  }

  async function openDetail(agent: Agent) {
    const token = ++detailToken.current;
    setDetail({ agent, ...unread() });
    try {
      const response = await apiClient.get<AgentDetail>(`/health/agents/${encodeURIComponent(agent.agent_name)}`);
      if (detailToken.current !== token) return; // closed, or a different agent opened, before this landed
      setDetail({ agent, value: response.data, error: null, asOf: new Date().toISOString() });
    } catch (error) {
      if (detailToken.current !== token) return;
      setDetail({ agent, value: null, error: getErrorMessage(error), asOf: null });
    }
  }

  return <main className="mudavym admin-desk" data-ground="charcoal">
    <header className="admin-desk__masthead"><Wordmark /><span className="admin-desk__eyebrow">THE OPERATIONS DESK</span></header>
    <div className="admin-desk__heading"><div><h1>The house, at work.</h1><p>The services behind Mudavym, with the last reading kept in view.</p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={initialLoading || refreshing || sending}>{refreshing ? 'Reading…' : 'Read again'}</button></div>
    {access.error && access.value && <p role="status" className="admin-desk__notice admin-desk__stale">Platform permission could not be re-verified this time. Showing the last confirmed grant below.</p>}
    {access.error && !access.value && <p role="alert" className="admin-desk__notice">Platform permission could not be verified. Operator controls are unavailable.</p>}
    {!canRead && !initialLoading ? <p role="status">This desk is available to house owners and platform operators. <Link to="/">Return to the house.</Link></p> : canRead && <>
      <nav className="admin-desk__links" aria-label="House registers"><Link to="/settings">House settings ↗</Link><Link to="/connections">Connections ↗</Link><Link to="/logs">Activity ledger ↗</Link></nav>
      {outcome && <p role="status" className="admin-desk__notice">{outcome}</p>}
      <section aria-labelledby="desk-agents"><div className="admin-desk__section-head"><h2 id="desk-agents">The agents</h2>
        <span>{agents.value ? `Read ${stamp(agents.asOf)}` : initialLoading ? 'Awaiting a reading' : 'No reading yet'}{agents.error && agents.value && <span className="admin-desk__stale"> · re-read failed, showing the last reading</span>}</span></div>
        <p>These services work across every house on Mudavym. {operator ? 'Your platform grant permits restart and stop.' : 'Health is shown here; platform operators handle restarts and stops.'} Select an agent for its counters.</p>
        {agents.error && !agents.value && <p role="alert">Agent health is unavailable. {agents.error}</p>}
        {!!agents.value?.agents.length && <div role="group" aria-label="Filter by health" className="admin-desk__filters">
          {([['all', 'All'], ['healthy', 'Healthy'], ['attention', 'Needs attention']] as const).map(([key, label]) => <button key={key} type="button" className="admin-desk__filter" aria-pressed={statusFilter === key} data-active={statusFilter === key} onClick={() => setStatusFilter(key)}>{label}</button>)}
        </div>}
        {initialLoading ? <p role="status">Reading the agent register…</p> : agents.value?.agents.length === 0 ? <p role="status">The orchestrator answered. It reports no running agents.</p> : agents.value && (() => {
          const visible = agents.value.agents.filter(agent => statusFilter === 'all' ? true : statusFilter === 'healthy' ? agent.healthy === true : agent.healthy === false);
          return visible.length === 0 ? <p role="status">No agent matches this filter.</p> : <div className="admin-desk__register">
            {visible.map(agent => <article key={agent.agent_name} className="admin-desk__row" role="button" tabIndex={0} onClick={() => void openDetail(agent)} onKeyDown={event => { if (event.key === 'Enter') void openDetail(agent); }}>
              <div><h3>{agent.agent_name.replace(/_/g, ' ')}</h3><p>Version {agent.version ?? 'not recorded'}</p></div>
              <span className="admin-desk__state" data-state={agent.healthy === true ? 'healthy' : agent.healthy === false ? 'attention' : 'unknown'}>{agent.status} · {agent.healthy === true ? 'responding' : agent.healthy === false ? 'needs attention' : 'health unknown'}</span>
              {operator && <div className="admin-desk__actions">{(['restart', 'stop'] as const).map(action => <button key={action} type="button" disabled={sending} onClick={event => { event.stopPropagation(); setSelection({ agent, action }); setConfirmation(''); }}>{action === 'restart' ? 'Restart' : 'Stop'}</button>)}</div>}
            </article>)}
          </div>;
        })()}
      </section>
      <section aria-labelledby="desk-services"><div className="admin-desk__section-head"><h2 id="desk-services">Behind the desk</h2><span>OBSERVATION & CONFIGURATION</span></div>
        <div className="admin-desk__register"><article className="admin-desk__row"><div><h3>Database</h3><p>A bounded read from the gateway to the database.</p></div><span>{initialLoading ? 'Reading…' : ready.value?.checks?.database ?? 'Unavailable'}</span></article>
          {!initialLoading && ready.error && !ready.value && <p role="alert">The database reading could not be fetched. {ready.error}</p>}
          {initialLoading ? <p>Reading provider configuration…</p> : providers.error && !providers.value ? <p role="alert">Provider configuration is unavailable. {providers.error}</p> : providers.value?.providers.filter(provider => provider.id !== 'supabase').map(provider => <article key={provider.id} className="admin-desk__row"><div><h3>{provider.name}</h3><p>{provider.desc}</p></div><span>{provider.status}</span></article>)}
        </div><p className="admin-desk__caption">A configured key is not a successful model call. This reading does not spend model credits.</p>
        {providers.error && providers.value && <p className="admin-desk__caption admin-desk__stale">Provider re-read failed, showing the last reading.</p>}
        {ready.value && <p className="admin-desk__caption">Gateway {ready.value.commit === 'unknown' ? 'revision not recorded' : ready.value.commit.slice(0, 12)} · started {stamp(ready.value.bootedAt)} · database read {stamp(ready.value.checkedAt)}{ready.error && <span className="admin-desk__stale"> · re-read failed, showing the last reading</span>}</p>}
      </section>
      {operator && <section aria-labelledby="desk-receipts"><div className="admin-desk__section-head"><h2 id="desk-receipts">Operation receipts</h2><span>LATEST 25 · PLATFORM</span></div>
        {initialLoading ? <p>Reading receipts…</p> : receipts.error && !receipts.value ? <p role="alert">Operation receipts are unavailable. {receipts.error}</p> : receipts.value?.operations.length === 0 ? <p>No platform operation has been recorded.</p> : receipts.value?.operations.map(receipt => <article key={receipt.id} className="admin-desk__row"><div><h3>{receipt.action} · {receipt.agent_name}</h3><p>{stamp(receipt.requested_at)}</p>
          {/* ADR 0149 row 42: read-repair stays, and says so plainly once the orchestrator's
              own record of the request is gone — most often because it restarted. */}
          {receipt.remote === 'absent' && <p className="admin-desk__caption admin-desk__stale">The orchestrator has no record of this request any more — most likely it restarted since. This receipt will not settle further on its own.</p>}
        </div><span>{receipt.status === 'unknown' ? 'Outcome unknown — check agent health' : receipt.status}</span></article>)}
        {receipts.error && receipts.value && <p className="admin-desk__caption admin-desk__stale">Receipt re-read failed, showing the last reading.</p>}
      </section>}
    </>}
    <footer className="admin-desk__footer"><Wordmark /><span>Every reading has a time. Every action leaves a receipt.</span></footer>
    <Sheet open={selection !== null} onClose={() => { if (!sending) setSelection(null); }} label={selection?.action === 'restart' ? 'Restart confirmation' : 'Stop confirmation'} title={selection?.action === 'restart' ? 'Restart this agent?' : 'Stop this agent?'} eyebrow="PLATFORM OPERATION" ground="charcoal">
      {selection && <div className="admin-desk__confirmation"><p>This will {selection.action} <strong>{selection.agent.agent_name}</strong> for <strong>every house on Mudavym</strong>. Work handled by this agent may be interrupted.{selection.action === 'stop' ? ' A stop lasts only until the next deploy or process restart, not a persistent disable.' : ''} Leaving before confirmation changes nothing.</p>
        <label htmlFor="agent-confirmation">Type {selection.agent.agent_name} to confirm</label><input id="agent-confirmation" autoComplete="off" value={confirmation} disabled={sending} onChange={event => setConfirmation(event.target.value)} />
        <button type="button" disabled={sending || confirmation !== selection.agent.agent_name} onClick={() => void operate()}>{sending ? 'Waiting for the result…' : `Confirm ${selection.action}`}</button>
      </div>}
    </Sheet>
    <Sheet open={detail !== null} onClose={() => { detailToken.current++; setDetail(null); }} label="Agent detail" title={detail?.agent.agent_name.replace(/_/g, ' ') ?? ''} eyebrow="COUNTERS ONLY" ground="charcoal">
      {detail && <div className="admin-desk__detail">
        {!detail.value && !detail.error && <p role="status">Reading…</p>}
        {detail.error && !detail.value && <p role="alert">This agent's counters could not be read. {detail.error}</p>}
        {detail.value && <dl>
          <dt>Messages processed</dt><dd>{detail.value.metrics.messages.processed ?? '—'}</dd>
          <dt>Messages failed</dt><dd>{detail.value.metrics.messages.failed ?? '—'}</dd>
          <dt>Success rate</dt><dd>{detail.value.metrics.messages.success_rate ?? '—'}</dd>
          <dt>Average time</dt><dd>{detail.value.metrics.timing.avg_ms != null ? `${detail.value.metrics.timing.avg_ms.toFixed(1)}ms` : '—'}</dd>
          <dt>p95 time</dt><dd>{detail.value.metrics.timing.p95_ms != null ? `${detail.value.metrics.timing.p95_ms.toFixed(1)}ms` : '—'}</dd>
          <dt>Circuit breaker</dt><dd>{detail.value.circuit_breaker?.state ?? '—'}</dd>
          <dt>Queue size</dt><dd>{detail.value.queue_size ?? '—'}</dd>
          <dt>Active tasks</dt><dd>{detail.value.active_tasks ?? '—'}</dd>
          <dt>Uptime</dt><dd>{detail.value.metrics.activity.uptime_seconds != null ? `${Math.round(detail.value.metrics.activity.uptime_seconds / 60)} min` : '—'}</dd>
          <dt>Restarts</dt><dd>{detail.value.metrics.activity.restart_count ?? '—'}</dd>
        </dl>}
        {detail.asOf && <p className="admin-desk__caption">Read {stamp(detail.asOf)}. Error text is not shown here — read the activity ledger for what a house saw.</p>}
      </div>}
    </Sheet>
  </main>;
}
