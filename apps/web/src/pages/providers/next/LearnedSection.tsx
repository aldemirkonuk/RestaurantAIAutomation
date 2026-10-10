/**
 * LearnedSection — what this vendor's mail has told this house.
 *
 * VEN-W14 (founder, 2026-10-01). Replaces the legacy tabbed panel that used to
 * close the vendor sheet (grey/blue Tailwind cards, a "Digital Twin" heading, an
 * Actions menu, raw JSON for a disagreement, a hard-coded "$" on every offer)
 * with one section in three plain parts, no tabs and no category chips:
 *
 *   1. What their mail has told us — facts, ordered by kind (the kind orders the
 *      list; it is never a filter). A disagreement reads "was X, now Y" with both
 *      dates, never JSON and never an attribute key.
 *   2. Offers they have sent — in the offer's own currency, or saying none was
 *      stated. Never a "$" the vendor did not write.
 *   3. Messages with them — Them / You, channel, date, excerpt; a "Find in
 *      messages" box that is plain text matching (the gateway's `ilike`, OD-99),
 *      so it is never called anything cleverer.
 *
 * States: loading; EMPTY (nothing learned yet); ERROR — a failed read renders
 * the error sentence with Try again IN ITS OWN PART, because an unreachable
 * book must never look like an empty one (ADR 0020), and one part that cannot
 * be reached never hides the parts that could (F-987). A failed Confirm or a
 * failed search says so on its own line.
 *
 * Offers and messages are for owners and managers: the gateway refuses
 * `/providers/:id/promotions` to anyone else (F-563) and gates the
 * conversation memory the same way (F-986), as MailTone is (ADR 0207). This
 * page does not ask for them for anyone else and says who they are for, so
 * staff keep the facts without a failure that Try again could never mend.
 *
 * W14b: Confirm is for owners and managers. The gateway refuses anyone else
 * with 403 (provider-intelligence.controller.ts `verifyKnowledge`); this page
 * hides the button for them with the same role read UsualCurrencySection uses.
 *
 * W14a ("wire to the agent"): the four outreach items the legacy panel offered
 * did nothing a person could see. They are NOT rendered here; a separate lane
 * wires them to a drafted message for approval.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchContradictions,
  fetchConversationMemory,
  fetchProviderKnowledge,
  fetchProviderPromotions,
  searchConversationMemory,
  verifyKnowledge,
  type ConversationMemoryEntry,
  type KnowledgeEntry,
  type Promotion,
} from '../../../services/api/provider-intelligence';
import { useAuth } from '../../../contexts/AuthContext';
import { useHouseGroupMark } from '../../../hooks/useHouseGroupMark';
import { inHouseMarks } from '../../../lib/currency';
import type { GroupMark } from '../../../lib/parseDecimal';
import { houseMessage, MONO, SANS } from './pv-format';

interface Props {
  providerId: string;
  providerName: string;
}

/** What the gateway adds to each fact for this section (service `getKnowledge`). */
type Fact = KnowledgeEntry & {
  createdAt?: string | null;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
};

/** A raw `provider_knowledge` row as the contradictions read returns it. */
interface ChangedFact {
  id: string;
  label?: string | null;
  attributes?: unknown;
  previous_value?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The kinds only ORDER the list — money and delivery first, colour last. */
const KIND_ORDER = [
  'financial',
  'pricing',
  'logistics',
  'promotion',
  'wine_portfolio',
  'people',
  'company',
  'relationship',
  'compliance',
];

// ── words ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "12 Sep", or "12 Sep 2025" outside this year; null when unreadable. A bare
 * date ("2026-10-31", an offer's end date) is a calendar day and is read as
 * one — never as UTC midnight, which west of Greenwich is the day before.
 */
function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** A stored token never reaches the screen with its underscores. */
function words(s: string): string {
  return s.replace(/_/g, ' ').trim();
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * A figure is grouped the house's way: "1.500" in a lira house, where en-US
 * printed "1,500" (F-1080, as F-992). `group` unknown keeps en-US.
 */
function primitiveWords(v: string | number | boolean, group: GroupMark | null = null): string | null {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isFinite(v) ? inHouseMarks(v.toLocaleString('en-US'), ',', group) : null;
  const t = words(v);
  return t === '' ? null : t;
}

/**
 * A stored value in plain words, or null when it cannot be said without its
 * keys. Null is the honest answer — the caller then says a plainer sentence,
 * never `{"days":45}`.
 */
function phraseValue(v: unknown, group: GroupMark | null = null): string | null {
  if (v === null || v === undefined) return null;
  if (isPrimitive(v)) return primitiveWords(v, group);
  if (Array.isArray(v)) {
    if (v.length === 0 || !v.every(isPrimitive)) return null;
    const parts = v.map((x) => primitiveWords(x, group)).filter((p): p is string => p !== null);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // The two compound shapes whose meaning does not live in the key name.
    if (isPrimitive(o.amount) && typeof o.currency === 'string' && o.currency.trim()) {
      const a = primitiveWords(o.amount, group);
      return a ? `${a} ${o.currency.trim().toUpperCase()}` : null;
    }
    if (isPrimitive(o.value) && typeof o.unit === 'string' && o.unit.trim()) {
      const a = primitiveWords(o.value, group);
      return a ? `${a} ${words(o.unit)}` : null;
    }
    const filled = Object.values(o).filter((x) => x !== null && x !== undefined && x !== '');
    if (filled.length === 1) return phraseValue(filled[0], group);
    return null;
  }
  return null;
}

/** "Payment terms: 45 days" — or the label alone when the value cannot be said. */
function factSentence(label: string, attributes: unknown, group: GroupMark | null = null): string {
  const l = words(label);
  const v = phraseValue(attributes, group);
  if (!v) return l;
  // The label already says it ("Delivers Tuesday and Friday" + [Tue, Fri]).
  const said = l.toLowerCase();
  const tokens = v.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (tokens.every((t) => said.includes(t))) return l;
  return `${l}: ${v}`;
}

/** What an offer gives, in the offer's own currency or saying none was stated. */
function offerTerms(
  p: Pick<Promotion, 'discount_value' | 'conditions'>,
  group: GroupMark | null = null,
): string | null {
  const dv = (p.discount_value ?? {}) as Record<string, unknown>;
  const cond = (p.conditions ?? {}) as Record<string, unknown>;
  const currency = typeof dv.currency === 'string' && dv.currency.trim() ? dv.currency.trim().toUpperCase() : null;
  const money = (n: unknown): string | null => {
    if (!isPrimitive(n)) return null;
    const w = primitiveWords(n, group);
    if (!w) return null;
    return currency ? `${w} ${currency}` : `${w} (currency not stated)`;
  };
  const parts: string[] = [];
  if (isPrimitive(dv.percent)) parts.push(`${primitiveWords(dv.percent, group)}% off`);
  const off = money(dv.amount);
  if (off) parts.push(`${off} off`);
  if (dv.free_shipping === true) parts.push('free delivery');
  if (isPrimitive(cond.min_qty)) parts.push(`${primitiveWords(cond.min_qty, group)} or more`);
  const atLeast = money(cond.min_amount);
  if (atLeast) parts.push(`on orders of at least ${atLeast}`);
  if (typeof cond.text === 'string' && cond.text.trim()) parts.push(cond.text.trim());
  return parts.length ? parts.join(', ') : null;
}

function who(role: ConversationMemoryEntry['role']): string {
  if (role === 'provider') return 'Them';
  if (role === 'restaurant') return 'You';
  return 'Note';
}

function excerpt(text: string, max = 160): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const serverMessage = houseMessage;

// ── styles (the sibling sections' tokens) ────────────────────────────────

const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
  margin: '14px 0 6px',
};

const PART: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-1, #211C16)',
  margin: '12px 0 4px',
};

const BODY: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
};

const META: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: 'var(--ink-4, #665D50)',
};

const ROW: React.CSSProperties = {
  borderTop: '1px solid var(--paper-2, #EAE4D8)',
  padding: '7px 0',
};

/** A sentence saying something did NOT happen: ink with a left rule, no red. */
const REFUSAL: React.CSSProperties = {
  ...BODY,
  color: 'var(--ink-1, #211C16)',
  borderLeft: '2px solid var(--ink-3, #7C7365)',
  paddingLeft: 8,
  margin: '6px 0 0',
};

const LINK_BUTTON: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--seal-deep, #14515C)',
  textDecoration: 'underline',
};

const SEAL_BUTTON: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '3px 8px',
  borderRadius: 7,
  cursor: 'pointer',
  color: 'var(--seal-deep, #14515C)',
  background: 'transparent',
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  whiteSpace: 'nowrap',
};

const FIELD: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11.5,
  padding: '3px 8px',
  borderRadius: 7,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
  color: 'var(--ink-1, #211C16)',
  flex: 1,
  minWidth: 0,
};

// ── the section ──────────────────────────────────────────────────────────

export function LearnedSection({ providerId, providerName }: Props) {
  const { activeRole, user } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const canConfirm = role === 'owner' || role === 'manager';
  // Offers and messages: the same owner/manager standing (F-563, F-986).
  const readsMail = canConfirm;
  const qc = useQueryClient();
  const group = useHouseGroupMark();

  const facts = useQuery({
    queryKey: ['vendor-learned-facts', providerId],
    queryFn: () => fetchProviderKnowledge(providerId),
  });
  const changes = useQuery({
    queryKey: ['vendor-learned-changes', providerId],
    queryFn: async () => (await fetchContradictions(providerId)) as ChangedFact[],
  });
  const offers = useQuery({
    queryKey: ['vendor-learned-offers', providerId],
    queryFn: () => fetchProviderPromotions(providerId),
    enabled: readsMail,
  });
  const messages = useQuery({
    queryKey: ['vendor-learned-messages', providerId],
    queryFn: () => fetchConversationMemory(providerId, 20),
    enabled: readsMail,
  });
  const reads = readsMail ? [facts, changes, offers, messages] : [facts, changes];

  const [confirmError, setConfirmError] = useState<{ id: string; text: string } | null>(null);
  const confirm = useMutation({
    mutationFn: (id: string) => verifyKnowledge(providerId, id),
    onSuccess: () => {
      setConfirmError(null);
      void qc.invalidateQueries({ queryKey: ['vendor-learned-facts', providerId] });
    },
    onError: (e, id) =>
      setConfirmError({ id, text: serverMessage(e, 'This was not confirmed — the house could not be reached.') }),
  });

  const [find, setFind] = useState('');
  const search = useMutation({
    mutationFn: (q: string) => searchConversationMemory(providerId, q),
  });
  const [searchedFor, setSearchedFor] = useState<string | null>(null);

  const factList = useMemo(() => {
    const graph = facts.data ?? {};
    const kinds = Object.keys(graph).sort((a, b) => {
      const ia = KIND_ORDER.indexOf(a);
      const ib = KIND_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    return kinds.flatMap((k) => (graph[k] ?? []) as Fact[]);
  }, [facts.data]);

  const changedById = useMemo(() => {
    const m = new Map<string, ChangedFact>();
    for (const c of changes.data ?? []) if (c?.id) m.set(c.id, c);
    return m;
  }, [changes.data]);

  const heading = <h3 style={LABEL}>Learned from their mail</h3>;

  if (reads.some((r) => r.isLoading)) {
    return (
      <section aria-label={`Learned from ${providerName}'s mail`}>
        {heading}
        <p role="status" style={{ ...BODY, margin: 0 }}>
          Reading what their mail has told us…
        </p>
      </section>
    );
  }

  // Each part fails on its own (F-987): a fact reads through both facts and
  // changes, so either failing is the facts part failing.
  const factsFailed = facts.isError || changes.isError;
  const unreached = (sentence: string, failed: (typeof reads)[number][]) => (
    <p role="alert" style={REFUSAL}>
      {sentence}{' '}
      <button
        type="button"
        style={LINK_BUTTON}
        onClick={() => {
          for (const r of failed) if (r.isError) void r.refetch();
        }}
      >
        Try again
      </button>
    </p>
  );

  const offerList = offers.data ?? [];
  const messageList = messages.data ?? [];

  if (
    readsMail &&
    !reads.some((r) => r.isError) &&
    factList.length === 0 &&
    offerList.length === 0 &&
    messageList.length === 0
  ) {
    return (
      <section aria-label={`Learned from ${providerName}'s mail`}>
        {heading}
        <p style={{ ...BODY, margin: 0 }}>
          Nothing learned from their mail yet. Facts, offers and messages appear here once they write to this house.
        </p>
      </section>
    );
  }

  const shownMessages: ConversationMemoryEntry[] =
    searchedFor !== null && search.data ? search.data : messageList;

  return (
    <section aria-label={`Learned from ${providerName}'s mail`}>
      {heading}

      {/* 1 — facts */}
      <h4 style={PART}>What their mail has told us</h4>
      {factsFailed ? (
        unreached('Could not reach what their mail has told us — this is not the same as nothing learned.', [
          facts,
          changes,
        ])
      ) : factList.length === 0 ? (
        <p style={{ ...BODY, margin: 0 }}>No facts from their mail yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {factList.map((f) => {
            const changed = changedById.get(f.id);
            return (
              <li key={f.id} data-testid="learned-fact" style={ROW}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ ...BODY, color: 'var(--ink-1, #211C16)' }}>
                    {changed ? changeSentence(f.label, changed, group) : factSentence(f.label, f.attributes, group)}
                  </span>
                  {f.verified ? (
                    <span style={{ ...META, color: 'var(--seal-deep, #14515C)', whiteSpace: 'nowrap' }}>
                      {f.verifiedByName ? `Confirmed · ${f.verifiedByName}` : 'Confirmed'}
                    </span>
                  ) : canConfirm ? (
                    <button
                      type="button"
                      style={SEAL_BUTTON}
                      disabled={confirm.isPending && confirm.variables === f.id}
                      onClick={() => confirm.mutate(f.id)}
                      aria-label={`Confirm: ${words(f.label)}`}
                    >
                      Confirm
                    </button>
                  ) : null}
                </div>
                <div style={META}>
                  {changed
                    ? changeDates(changed)
                    : dateLine(f.updatedAt ?? f.createdAt ?? null, f.verified)}
                </div>
                {confirmError?.id === f.id && (
                  <p role="alert" style={REFUSAL}>
                    {confirmError.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The gateway leaves a vendor's prices and money terms out for anyone
          who does not hold the house's money (F-1078); the sheet says so
          rather than letting their absence read as "none learned". */}
      {!readsMail && (
        <p style={{ ...BODY, margin: '6px 0 0' }}>Their prices and money terms are for owners and managers to see.</p>
      )}

      {/* 2 — offers */}
      <h4 style={PART}>Offers they have sent</h4>
      {!readsMail ? (
        <p style={{ ...BODY, margin: 0 }}>Their offers are for owners and managers to see.</p>
      ) : offers.isError ? (
        unreached('Could not reach their offers — this is not the same as no offers.', [offers])
      ) : offerList.length === 0 ? (
        <p style={{ ...BODY, margin: 0 }}>No offers from them yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {offerList.map((p) => {
            const terms = offerTerms(p, group);
            const until = fmtDay(p.end_date);
            const from = fmtDay(p.created_at);
            return (
              <li key={p.id} data-testid="learned-offer" style={ROW}>
                <div style={{ ...BODY, color: 'var(--ink-1, #211C16)' }}>
                  {p.name}
                  {terms ? ` — ${terms}` : ''}
                </div>
                {p.description && <div style={BODY}>{p.description}</div>}
                <div style={META}>
                  {[until ? `until ${until}` : null, from ? `from their message of ${from}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 3 — messages */}
      <h4 style={PART}>Messages with them</h4>
      {!readsMail ? (
        <p style={{ ...BODY, margin: 0 }}>Messages with them are for owners and managers to read.</p>
      ) : messages.isError ? (
        unreached('Could not reach messages with them — this is not the same as no messages.', [messages])
      ) : (
        <>
        <form
          role="search"
          style={{ display: 'flex', gap: 6, margin: '2px 0 6px' }}
          onSubmit={(e) => {
            e.preventDefault();
            const q = find.trim();
            if (!q) {
              setSearchedFor(null);
              search.reset();
              return;
            }
            setSearchedFor(q);
            search.mutate(q);
          }}
        >
          <input
            type="search"
            aria-label="Find in messages"
            placeholder="Find in messages…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            style={FIELD}
          />
          <button type="submit" style={SEAL_BUTTON} disabled={search.isPending}>
            Find
          </button>
        </form>
        {search.isError && searchedFor !== null && (
          <p role="alert" style={REFUSAL}>
            {serverMessage(search.error, 'The search could not reach their messages — this is not the same as no match.')}
          </p>
        )}
        {searchedFor !== null && search.isSuccess && (
          <p role="status" style={{ ...META, margin: '0 0 4px' }}>
            {search.data.length === 0
              ? `No message with them contains “${searchedFor}”.`
              : search.data.length === 1
                ? `1 message contains “${searchedFor}”.`
                : `${search.data.length} messages contain “${searchedFor}”.`}{' '}
            <button
              type="button"
              style={{ ...LINK_BUTTON, fontSize: 10 }}
              onClick={() => {
                setFind('');
                setSearchedFor(null);
                search.reset();
              }}
            >
              Show all
            </button>
          </p>
        )}
        {shownMessages.length === 0 ? (
          searchedFor === null && <p style={{ ...BODY, margin: 0 }}>No messages with them stored yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shownMessages.map((m) => (
              <li key={m.id} data-testid="learned-message" style={ROW}>
                <div style={META}>
                  {[who(m.role), m.channel ? words(m.channel) : null, fmtDay(m.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div style={BODY}>“{excerpt(m.message_text)}”</div>
              </li>
            ))}
          </ul>
        )}
        </>
      )}
    </section>
  );
}

function dateLine(iso: string | null, verified: boolean): string {
  const d = fmtDay(iso);
  const from = d ? `from their message of ${d}` : 'from their mail';
  return verified ? from : `${from} · not confirmed`;
}

/** "Payment terms: was 30 days, now 45 days" — or a plain sentence, never JSON. */
function changeSentence(label: string, c: ChangedFact, group: GroupMark | null = null): string {
  const l = words(c.label || label);
  const was = phraseValue(c.previous_value, group);
  const now = phraseValue(c.attributes, group);
  if (was && now) return `${l}: was ${was}, now ${now}`;
  return `${l}: their mail has said two different things`;
}

function changeDates(c: ChangedFact): string {
  const now = fmtDay(c.updated_at);
  const was = fmtDay(c.created_at);
  const tail = ' — check before you rely on it';
  if (now && was && now !== was) return `their message of ${now} says otherwise than ${was}${tail}`;
  if (now) return `their message of ${now} says otherwise than an earlier one${tail}`;
  return `a later message says otherwise than an earlier one${tail}`;
}

export default LearnedSection;
