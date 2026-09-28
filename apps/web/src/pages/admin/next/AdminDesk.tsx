import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Wordmark } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import apiClient, { getErrorMessage } from '@/services/api/client';
import './admin-desk.css';

type Agent = { agent_name: string; version: string | null; status: string; healthy: boolean | null };
type Agents = { agents: Agent[]; observedAt: string; scope: 'platform' };
type Provider = { id: string; name: string; desc: string; status: string; configured: boolean };
type Readiness = { status: string; checkedAt: string; commit: string; bootedAt: string; checks: { database: string } };
type Receipt = { id: string; agent_name: string; action: string; status: string; requested_at: string; completed_at: string | null };
type Read<T> = { value: T | null; error: string | null };
const unread = <T,>(): Read<T> => ({ value: null, error: null });
const stamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';

/** ADR 0143's one desk. It reports observations; house settings retain their own writers. */
export default function AdminDesk() {
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<Read<{ platformOperator: boolean }>>(unread);
  const [agents, setAgents] = useState<Read<Agents>>(unread);
  const [providers, setProviders] = useState<Read<{ providers: Provider[] }>>(unread);
  const [ready, setReady] = useState<Read<Readiness>>(unread);
  const [receipts, setReceipts] = useState<Read<{ operations: Receipt[] }>>(unread);
  const [selection, setSelection] = useState<{ agent: Agent; action: 'restart' | 'stop' } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const operator = access.value?.platformOperator === true;
  const canRead = user?.role === 'owner' || user?.role === 'manager' || operator;

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);
    setAccess(unread());
    async function read<T>(path: string): Promise<Read<T>> {
      try { return { value: (await apiClient.get<T>(path, { signal })).data, error: null }; }
      catch (error) { return { value: null, error: getErrorMessage(error) }; }
    }
    void (async () => {
      const permission = await read<{ platformOperator: boolean }>('/health/access');
      if (signal.aborted) return;
      setAccess(permission);
      if (user?.role !== 'owner' && user?.role !== 'manager' && permission.value?.platformOperator !== true) {
        setLoading(false); return;
      }
      const [health, configuration, readiness, history] = await Promise.all([
        read<Agents>('/health/agents'), read<{ providers: Provider[] }>('/health/providers'),
        // A 503 carries a measured not-ready result; keep that evidence visible.
        apiClient.get<Readiness>('/health/ready', { signal, validateStatus: status => status === 200 || status === 503 })
          .then(response => ({ value: response.data, error: null }), error => ({ value: null, error: getErrorMessage(error) })),
        permission.value?.platformOperator ? read<{ operations: Receipt[] }>('/health/agent-operations') : Promise.resolve(unread<{ operations: Receipt[] }>()),
      ]);
      if (signal.aborted) return;
      setAgents(health); setProviders(configuration); setReady(readiness); setReceipts(history); setLoading(false);
    })();
    return () => controller.abort();
  }, [revision, user?.userId, user?.restaurantId, user?.role]);

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

  return <main className="mudavym admin-desk" data-ground="charcoal">
    <header className="admin-desk__masthead"><Wordmark /><span className="admin-desk__eyebrow">THE OPERATIONS DESK</span></header>
    <div className="admin-desk__heading"><div><h1>The house, at work.</h1><p>The services behind Mudavym, with the last reading kept in view.</p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading || sending}>{loading ? 'Reading…' : 'Read again'}</button></div>
    {access.error && <p role="alert" className="admin-desk__notice">Platform permission could not be verified. Operator controls are unavailable.</p>}
    {!canRead && !loading ? <p role="status">This desk is available to house owners, managers and platform operators. <Link to="/">Return to the house.</Link></p> : canRead && <>
      <nav className="admin-desk__links" aria-label="House registers"><Link to="/settings">House settings ↗</Link><Link to="/connections">Connections ↗</Link><Link to="/logs">Activity ledger ↗</Link></nav>
      {outcome && <p role="status" className="admin-desk__notice">{outcome}</p>}
      <section aria-labelledby="desk-agents"><div className="admin-desk__section-head"><h2 id="desk-agents">The agents</h2><span>{agents.value ? `Read ${stamp(agents.value.observedAt)}` : 'Awaiting a reading'}</span></div>
        <p>These services work across every house on Mudavym. {operator ? 'Your platform grant permits restart and stop.' : 'Health is shown here; platform operators handle restarts and stops.'}</p>
        {loading ? <p role="status">Reading the agent register…</p> : agents.error ? <p role="alert">Agent health is unavailable. {agents.error}</p> : agents.value?.agents.length === 0 ? <p role="status">The orchestrator answered. It reports no running agents.</p> : <div className="admin-desk__register">
          {agents.value?.agents.map(agent => <article key={agent.agent_name} className="admin-desk__row"><div><h3>{agent.agent_name.replace(/_/g, ' ')}</h3><p>Version {agent.version ?? 'not recorded'}</p></div>
            <span className="admin-desk__state" data-state={agent.healthy === true ? 'healthy' : agent.healthy === false ? 'attention' : 'unknown'}>{agent.status} · {agent.healthy === true ? 'responding' : agent.healthy === false ? 'needs attention' : 'health unknown'}</span>
            {operator && <div className="admin-desk__actions">{(['restart', 'stop'] as const).map(action => <button key={action} type="button" disabled={sending} onClick={() => { setSelection({ agent, action }); setConfirmation(''); }}>{action === 'restart' ? 'Restart' : 'Stop'}</button>)}</div>}
          </article>)}
        </div>}
      </section>
      <section aria-labelledby="desk-services"><div className="admin-desk__section-head"><h2 id="desk-services">Behind the desk</h2><span>OBSERVATION & CONFIGURATION</span></div>
        <div className="admin-desk__register"><article className="admin-desk__row"><div><h3>Database</h3><p>A bounded read from the gateway to the database.</p></div><span>{loading ? 'Reading…' : ready.value?.checks?.database ?? 'Unavailable'}</span></article>
          {!loading && ready.error && <p role="alert">The database reading could not be fetched. {ready.error}</p>}
          {loading ? <p>Reading provider configuration…</p> : providers.error ? <p role="alert">Provider configuration is unavailable. {providers.error}</p> : providers.value?.providers.filter(provider => provider.id !== 'supabase').map(provider => <article key={provider.id} className="admin-desk__row"><div><h3>{provider.name}</h3><p>{provider.desc}</p></div><span>{provider.status}</span></article>)}
        </div><p className="admin-desk__caption">A configured key is not a successful model call. This reading does not spend model credits.</p>
        {ready.value && <p className="admin-desk__caption">Gateway {ready.value.commit === 'unknown' ? 'revision not recorded' : ready.value.commit.slice(0, 12)} · started {stamp(ready.value.bootedAt)} · database read {stamp(ready.value.checkedAt)}</p>}
      </section>
      {operator && <section aria-labelledby="desk-receipts"><div className="admin-desk__section-head"><h2 id="desk-receipts">Operation receipts</h2><span>LATEST 25 · PLATFORM</span></div>
        {loading ? <p>Reading receipts…</p> : receipts.error ? <p role="alert">Operation receipts are unavailable. {receipts.error}</p> : receipts.value?.operations.length === 0 ? <p>No platform operation has been recorded.</p> : receipts.value?.operations.map(receipt => <article key={receipt.id} className="admin-desk__row"><div><h3>{receipt.action} · {receipt.agent_name}</h3><p>{stamp(receipt.requested_at)}</p></div><span>{receipt.status === 'unknown' ? 'Outcome unknown — check agent health' : receipt.status}</span></article>)}
      </section>}
    </>}
    <footer className="admin-desk__footer"><Wordmark /><span>Every reading has a time. Every action leaves a receipt.</span></footer>
    <Sheet open={selection !== null} onClose={() => { if (!sending) setSelection(null); }} label="Confirm restarting or stopping this agent for every house on Mudavym. Leaving before confirmation changes nothing." title={selection?.action === 'restart' ? 'Restart this agent?' : 'Stop this agent?'} eyebrow="PLATFORM OPERATION" ground="charcoal">
      {selection && <div className="admin-desk__confirmation"><p>This will {selection.action} <strong>{selection.agent.agent_name}</strong> for <strong>every house on Mudavym</strong>. Work handled by this agent may be interrupted.</p>
        <label htmlFor="agent-confirmation">Type {selection.agent.agent_name} to confirm</label><input id="agent-confirmation" autoComplete="off" value={confirmation} disabled={sending} onChange={event => setConfirmation(event.target.value)} />
        <button type="button" disabled={sending || confirmation !== selection.agent.agent_name} onClick={() => void operate()}>{sending ? 'Waiting for the result…' : `Confirm ${selection.action}`}</button>
      </div>}
    </Sheet>
  </main>;
}
