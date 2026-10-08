/**
 * WhoIsWriting — Trusted senders and Strangers, with their two acts.
 *
 * Moved here from `/promotions` by the founder (ADR 0160 §113, Open item 3,
 * 2026-09-18, via `AskUserQuestion`): *"they move to /communications, and the
 * hold-to-trust and add-vendor acts go with them; /promotions holds offers
 * only."* Sketch 113 direction A drew both registers (frame 2a) and both acts
 * (frame 4c); direction B drew the hand-off ("Senders and strangers are mail,
 * not money"). What is drawn here is A's registers, in this page's own idiom.
 *
 * Honesty rules, the page's own (ADR 0020 / 0051):
 *  - a failed read says so in words and never renders as an empty register;
 *  - a count is an em dash until its read answers, and a full server window is
 *    a floor (`≥100`), not a total;
 *  - a trust write is READ BACK before it is called saved — the gateway's
 *    `setTrust` swallows a failed upsert and still answers 200
 *    (`sender-reputation.service.ts:56-83`), so the 200 alone proves nothing;
 *  - "Add as a vendor" is not "trusted", and says so.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import type { ProspectDto, SenderReputationDto } from '../../../hooks/queries/usePromotionsQueries';
import { MONO, SANS, failedReadWords, fmtAsOf, managesHouse, readAgainFailed } from './cm-format';
import { AddVendorPanel, BTN_PRIMARY, BTN_QUIET, TrustPanel } from './SenderActs';
import {
  fmtCount,
  fmtDay,
  readFailure,
  readFailureSentence,
  senderState,
  strangerChips,
  whoIsWritingSummary,
  writeFailureSentence,
} from './senders-format';
import {
  SENDERS_SERVER_WINDOWS,
  usePromoteStranger,
  usePutAwayStranger,
  useRestoreStranger,
  useSenderRegister,
  useSetSenderTrust,
  useStrangers,
} from './useSendersDeskData';

const H3: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
  margin: '0 0 6px',
};
const LEDE: CSSProperties = { fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '0 0 10px', maxWidth: '62ch' };
const HONEST: CSSProperties = { fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '10px 0 0', maxWidth: '62ch' };
const ALERT: CSSProperties = { fontFamily: SANS, fontSize: 12, color: 'var(--alarm-deep, #8C3322)', margin: '8px 0 0' };
const ROW: CSSProperties = { borderBottom: '1px solid var(--paper-2, #EAE4D8)', padding: '9px 0' };
const CHIP: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '1px 6px',
  borderRadius: 4,
  border: '1px solid var(--paper-2, #EAE4D8)',
  color: 'var(--ink-4, #665D50)',
};

function Failed({ children }: { children: ReactNode }) {
  return (
    <p role="alert" style={{ ...ALERT, margin: 0, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}>
      {children}
    </p>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)', margin: 0 }}>{children}</p>;
}

/**
 * COMMS-W33 (founder: "A: keep, say when"): a read that answered once and then
 * failed keeps its rows on screen and says when they are from. A refusal
 * (expired session, a role that changed) is not a blip — that one still says why.
 */
function staleRead(q: { isError: boolean; error: unknown; data?: readonly unknown[] }): boolean {
  if (!q.isError || q.data === undefined) return false;
  const f = readFailure(q.error);
  return !f.expired && !f.forbidden;
}

function Stale({ q, what, children }: { q: { error: unknown; dataUpdatedAt: number; data?: readonly unknown[] }; what?: string; children?: ReactNode }) {
  return (
    <p role="status" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
      {readAgainFailed(failedReadWords(q.error), q.dataUpdatedAt, (q.data?.length ?? 0) === 0, what)}
      {children}
    </p>
  );
}

function useHouse() {
  const { availableRestaurants, activeRestaurantId, activeRole, user } = useAuth();
  const houseName = availableRestaurants.find((b) => b.id === activeRestaurantId)?.name ?? null;
  const nameById = useMemo(() => new Map(availableRestaurants.map((b) => [b.id, b.name] as const)), [availableRestaurants]);
  return {
    houseName,
    nameById,
    activeRestaurantId,
    houseCount: availableRestaurants.length,
    manages: managesHouse(activeRole, user?.role),
  };
}

/* ── Trusted senders ─────────────────────────────────────────────────── */

function TrustedSenders({
  senders,
  houseName,
  manages,
}: {
  senders: ReturnType<typeof useSenderRegister>;
  houseName: string | null;
  manages: boolean;
}) {
  const setTrust = useSetSenderTrust();
  const [trusting, setTrusting] = useState<SenderReputationDto | null>(null);
  const [untrustFailure, setUntrustFailure] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = senders;
  const stale = staleRead(senders);

  /** Write, then read the register back. The 200 alone is not proof (see file header). */
  const writeAndConfirm = async (s: SenderReputationDto, trusted: boolean) => {
    await setTrust.mutateAsync({ domain: s.domain, trusted, providerId: s.provider_id ?? undefined });
    const fresh = await refetch();
    if (fresh.isError) throw new Error('it could not be read back to confirm');
    const row = fresh.data?.find((r) => r.domain === s.domain);
    const nowTrusted = !!row && row.trusted && !row.suspended;
    if (nowTrusted !== trusted) throw new Error(`${s.domain} did not read back as ${trusted ? 'trusted' : 'not trusted'}`);
  };

  const untrust = async (s: SenderReputationDto) => {
    setUntrustFailure(null);
    try {
      await writeAndConfirm(s, false);
    } catch (err) {
      setUntrustFailure(writeFailureSentence(`Untrusting ${s.domain}`, readFailure(err)));
    }
  };

  return (
    <div>
      <h3 style={H3}>Trusted senders</h3>
      <p style={LEDE}>
        {/* COMMS-W32: what trust does, in the house's words (`inbound-responder.service.ts`: a trusted domain lifts
            only the "sender unverified" hold on answering by itself). */}
        When mail cannot prove it came from the vendor, Mudavym waits for a person before answering it. Trusting a sender
        lifts that one hold for their future mail — nothing else. Each row counts their completed orders, the mail of
        theirs that tried to give Mudavym instructions, and the mail that looked like spam.
      </p>
      {!manages ? (
        // COMMS-W31: the gateway answers this register for an owner or manager only, so a staff member is not asked
        // to read a refusal as a failure.
        <Quiet>Only an owner or manager sees which senders are trusted.</Quiet>
      ) : isLoading ? (
        <Quiet>Reading the trusted senders…</Quiet>
      ) : isError && !stale ? (
        <Failed>{readFailureSentence('the trusted senders', readFailure(error))}</Failed>
      ) : stale && data?.length === 0 ? (
        <Stale q={senders} what="the trusted senders" />
      ) : !data || data.length === 0 ? (
        <Quiet>No senders yet. A vendor appears here once they email the house.</Quiet>
      ) : (
        <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
          {data.map((s) => {
            const st = senderState(s);
            return (
              <div key={s.id} style={{ ...ROW, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  {/* COMMS-W30: a long domain or address wraps instead of pushing the page sideways. */}
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>{s.domain}</span>
                  <span
                    data-tone={st.tone}
                    style={{
                      display: 'block',
                      fontFamily: SANS,
                      fontSize: 11.5,
                      color:
                        st.tone === 'suspended'
                          ? 'var(--alarm-deep, #8C3322)'
                          : st.tone === 'trusted'
                            ? 'var(--seal-deep, #14515C)'
                            : 'var(--ink-4, #665D50)',
                    }}
                  >
                    {st.word} · updated {fmtDay(s.updated_at)}
                  </span>
                  <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: 'var(--ink-2, #4F473C)', marginTop: 2 }} title="Completed orders · mail that tried to give Mudavym instructions · mail that looked like spam — as Mudavym counted them, not a judgement of the vendor">
                    {fmtCount(s.completed_orders)} orders · {fmtCount(s.injection_signals)} with hidden instructions · {fmtCount(s.spam_signals)} spam
                  </span>
                </div>
                {st.tone === 'trusted' ? (
                  <button type="button" style={BTN_QUIET} disabled={setTrust.isPending} onClick={() => untrust(s)}>
                    Untrust
                  </button>
                ) : (
                  <button type="button" style={BTN_PRIMARY} aria-label={`Trust ${s.domain}`} onClick={() => setTrusting(s)}>
                    Trust…
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {manages && stale && (data?.length ?? 0) > 0 && <Stale q={senders} what="the trusted senders" />}
      {untrustFailure && <p role="alert" style={ALERT}>{untrustFailure}</p>}
      <p style={HONEST}>
        The counts are what Mudavym saw in their mail, not a judgement of the vendor. Trust is suspended on its own if their
        mail tries to give Mudavym instructions or keeps looking like spam; trusting them again lifts the suspension.
      </p>
      <TrustPanel
        key={trusting?.id ?? 'none'}
        sender={trusting}
        houseName={houseName}
        onClose={() => setTrusting(null)}
        onTrust={(s) => writeAndConfirm(s, true)}
      />
    </div>
  );
}

/* ── Strangers ───────────────────────────────────────────────────────── */

const UNDO_MS = 8000;

function Strangers({
  houseName,
  nameById,
  activeRestaurantId,
  houseCount,
  strangers,
  allHouses,
  setAllHouses,
  manages,
}: {
  houseName: string | null;
  nameById: Map<string, string>;
  activeRestaurantId: string | null;
  houseCount: number;
  manages: boolean;
  strangers: ReturnType<typeof useStrangers>;
  allHouses: boolean;
  setAllHouses: (v: boolean) => void;
}) {
  const promote = usePromoteStranger();
  const putAway = usePutAwayStranger();
  const restore = useRestoreStranger();
  const [adding, setAdding] = useState<ProspectDto | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [actFailure, setActFailure] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const { data, isLoading, isError, error, refetch } = strangers;
  const stale = staleRead(strangers);
  const retry = (
    <>
      {' '}
      <button type="button" style={BTN_QUIET} onClick={() => refetch()}>
        Retry
      </button>
    </>
  );
  const busy = promote.isPending || putAway.isPending || restore.isPending;

  const onPutAway = async (p: ProspectDto) => {
    setActFailure(null);
    const name = p.sender_name || p.domain;
    try {
      const r = await putAway.mutateAsync(p.id);
      if (r?.dismissed === false) throw new Error('it was not put away');
      setUndo({ id: p.id, name });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo((u) => (u?.id === p.id ? null : u)), UNDO_MS);
    } catch (err) {
      setActFailure(writeFailureSentence(`Putting ${name} away`, readFailure(err)));
    }
  };
  const onUndo = async () => {
    if (!undo) return;
    setActFailure(null);
    try {
      await restore.mutateAsync(undo.id);
      setUndo(null);
    } catch (err) {
      setActFailure(writeFailureSentence(`Bringing ${undo.name} back`, readFailure(err)));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={H3}>Strangers</h3>
        {houseCount > 1 && (
          <span role="group" aria-label="Whose strangers" style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" aria-pressed={!allHouses} style={{ ...BTN_QUIET, fontWeight: allHouses ? 500 : 700, padding: '2px 8px' }} onClick={() => setAllHouses(false)}>
              this house
            </button>
            <button type="button" aria-pressed={allHouses} style={{ ...BTN_QUIET, fontWeight: allHouses ? 700 : 500, padding: '2px 8px' }} onClick={() => setAllHouses(true)}>
              all {houseCount} houses
            </button>
          </span>
        )}
      </div>
      <p style={LEDE}>
        Mail from senders who are not one of your vendors. Mudavym kept it because it carried an attachment or read like an
        offer. Nothing here is trusted, and Mudavym never answers it on its own.
      </p>
      {undo && (
        <p role="status" style={{ ...LEDE, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{undo.name} — put away</span>
          <button type="button" style={BTN_QUIET} disabled={restore.isPending} onClick={onUndo}>
            Undo
          </button>
        </p>
      )}
      {isLoading ? (
        <Quiet>Reading the strangers…</Quiet>
      ) : isError && !stale ? (
        <Failed>
          {readFailureSentence('the strangers', readFailure(error))}
          {retry}
        </Failed>
      ) : stale && data?.length === 0 ? (
        <Stale q={strangers} what="the strangers">{retry}</Stale>
      ) : !data || data.length === 0 ? (
        // COMMS-W32: "active and listening" claimed a health nothing on this page measures.
        <Quiet>No strangers waiting. Mail from vendors you have not added yet lands here.</Quiet>
      ) : (
        <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
          {data.map((p) => {
            const elsewhere = !!p.restaurant_id && !!activeRestaurantId && p.restaurant_id !== activeRestaurantId;
            const name = p.sender_name || p.domain;
            return (
              <div key={p.id} style={ROW}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>{name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)', overflowWrap: 'anywhere', minWidth: 0 }}>
                    {p.sender_email ? `<${p.sender_email}>` : p.domain} · {fmtDay(p.last_seen_at ?? p.first_seen_at)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '5px 0' }}>
                  {elsewhere && <span style={CHIP}>{nameById.get(p.restaurant_id ?? '') ?? 'another house'}</span>}
                  {strangerChips(p).map((c) => (
                    <span key={c} style={CHIP}>{c}</span>
                  ))}
                </div>
                {p.subject && <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '0 0 6px' }}>{p.subject}</p>}
                {elsewhere ? (
                  <Quiet>Belongs to another house — switch to it to add or put it away.</Quiet>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* COMMS-W31: adding a vendor is an owner's or manager's; staff learned that only after filling the ask. */}
                    <button
                      type="button"
                      style={manages ? BTN_PRIMARY : { ...BTN_PRIMARY, opacity: 0.5, cursor: 'not-allowed' }}
                      disabled={busy || !manages}
                      aria-label={`Add ${name} as a vendor`}
                      aria-describedby={manages ? undefined : `add-why-${p.id}`}
                      onClick={() => setAdding(p)}
                    >
                      Add as a vendor…
                    </button>
                    <button type="button" style={BTN_QUIET} disabled={busy} aria-label={`Put ${name} away`} onClick={() => onPutAway(p)}>
                      Put away
                    </button>
                    {!manages && (
                      <span id={`add-why-${p.id}`} style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>
                        Only an owner or manager can add a vendor.
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {stale && (data?.length ?? 0) > 0 && <Stale q={strangers} what="the strangers">{retry}</Stale>}
      {actFailure && <p role="alert" style={ALERT}>{actFailure}</p>}
      <p style={HONEST}>
        “Add as a vendor” makes them a vendor of this house; it trusts nothing. Mudavym grades their offers only once an
        invoice from them has been accepted — until then their offers read “cannot be graded”.
      </p>
      <AddVendorPanel
        key={adding?.id ?? 'none'}
        prospect={adding}
        houseName={houseName}
        onClose={() => setAdding(null)}
        onAdd={(p) => promote.mutateAsync(p.id)}
      />
    </div>
  );
}

/* ── the section ─────────────────────────────────────────────────────── */

export default function WhoIsWriting() {
  const { houseName, nameById, activeRestaurantId, houseCount, manages } = useHouse();
  // Folded to its one-line summary; `?senders=open` keeps it open across a
  // reload, `?senders=all` open with every house's strangers (COMMS-W35,
  // founder: "A: page + queue back") — a refresh or a shared link keeps the
  // scope. Hide drops both, so the folded line always counts this house.
  const [params, setParams] = useSearchParams();
  const shown = params.get('senders');
  const open = shown === 'open' || shown === 'all';
  const allHouses = shown === 'all';
  const setAllHouses = (all: boolean) => {
    params.set('senders', all ? 'all' : 'open');
    setParams(params, { replace: true });
  };
  const toggle = () => {
    if (open) params.delete('senders');
    else params.set('senders', 'open');
    setParams(params, { replace: true });
  };
  const senders = useSenderRegister(manages);
  const strangers = useStrangers(houseCount > 1 && allHouses);
  const sendersStale = manages && staleRead(senders);
  const strangersStale = staleRead(strangers);
  const staleAts = [sendersStale && senders.dataUpdatedAt, strangersStale && strangers.dataUpdatedAt].filter(
    (t): t is number => typeof t === 'number' && t > 0,
  );
  const staleAt = staleAts.length ? Math.min(...staleAts) : 0;

  return (
    <section aria-label="Who is writing" style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: open ? 14 : 0 }}>
        <h2 style={{ ...H3, fontSize: 11, margin: 0 }}>Who is writing</h2>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-2, #4F473C)' }} data-testid="who-summary">
          {whoIsWritingSummary(
            senders.isError && !sendersStale ? undefined : senders.data,
            strangers.isError && !strangersStale ? undefined : strangers.data,
            SENDERS_SERVER_WINDOWS.PROSPECTS,
          )}
          {staleAt > 0 && ` · as it was ${fmtAsOf(staleAt)}`}
        </span>
        <button type="button" style={BTN_QUIET} aria-expanded={open} onClick={toggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
      <div className="grid gap-8 lg:grid-cols-2">
        <TrustedSenders senders={senders} houseName={houseName} manages={manages} />
        <Strangers
          houseName={houseName}
          nameById={nameById}
          activeRestaurantId={activeRestaurantId}
          houseCount={houseCount}
          strangers={strangers}
          allHouses={allHouses}
          setAllHouses={setAllHouses}
          manages={manages}
        />
      </div>
      )}
    </section>
  );
}
