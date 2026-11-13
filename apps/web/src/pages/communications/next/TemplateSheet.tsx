/**
 * TemplateSheet — the house's own letter library. (ADR 0118)
 *
 * ── WHAT THIS FILE USED TO BE, AND WHY IT IS NOT ANY MORE ──────────────────
 * Until 2026-09-04 this sheet mounted `components/documents/GmailTemplateBuilder`
 * (1,683 lines) and `SMSTemplateBuilder` behind a clarity banner, and re-skinned
 * their backdrop, card and header band through three structural selectors while
 * leaving every toolbar, palette and preview pane inside them in the legacy
 * look. The page note called that "the remaining coherence gap".
 *
 * The founder retired both, 2026-09-04: build the composer from sketch 100 and
 * retire the two legacy builders behind `mudavym_design_communications`. They
 * are untouched, and the legacy `/communications`
 * (`pages/Communications.tsx:589,598`) still mounts them exactly as it did —
 * ADR 0042's byte-for-byte promise for the flag-off page is unchanged. What
 * changed is that no rebuilt `next` page imports them any more, and
 * `CommunicationsNext.test.tsx` asserts that as a rule rather than a habit.
 *
 * ── WHAT A HOUSE TEMPLATE IS ───────────────────────────────────────────────
 * A letter you have already written twice. It has a PURPOSE (one of five vendor
 * purposes), the merge fields it declares, who last edited it, and when it was
 * last used. Those four facts are the four columns migration 20260904150000
 * adds; before it, a "template library" on this table could show none of them.
 *
 * A staff broadcast is deliberately not one of the purposes (founder,
 * 2026-09-04): the composer writes to the vendor book, and crew messages stay on
 * /team. That is stated on the surface, not just enforced by a list.
 *
 * ── START FROM AN INSIGHT, NOT FROM A BLANK PAGE ───────────────────────────
 * The library's second half is the engine's own sentences. Choosing one opens
 * the editor with that sentence already in the body, carrying its rule key —
 * which is the sketch's "in-house creation" flow and the reason the library is
 * on the same surface as the composer rather than in a settings page.
 *
 * ── THE ORDER LETTER (ADR 0313, 4a-ii) ─────────────────────────────────────
 * The sixth purpose is not in the library and not in the purpose picker: it is
 * the letter Mudavym writes when an order goes to a vendor, so its figures come
 * from the order and only the house's words around them are the house's. It has
 * its own panel below, opened on demand: the draft (block tokens only, no
 * figures), a preview over a priced and an unpriced example, publish (only what
 * was previewed), reset to Mudavym's words, and the published versions, any of
 * which can be copied back into the draft. An owner or a manager may change it;
 * everyone else reads it. Saving a draft never changes what vendors receive.
 */

import { useCallback, useMemo, useState } from 'react';
import { FilePlus2, Quote, ScrollText } from 'lucide-react';
import { Sheet } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { MONO, SANS } from './cm-format';
import {
  categoryLabel,
  fmtDay,
} from './Compose/compose-format';
import {
  errText,
  useComposeData,
  type InsightSentence,
  type LetterTemplate,
} from './Compose/useComposeData';

const ICON = { size: 13, strokeWidth: 1.75 } as const;

/**
 * Kept as an export so the page's existing call site keeps its shape. The two
 * channels the legacy builders had are gone: a house letter is email, and the
 * SMS workshop stored a row nothing could send (the raw SMS route was deleted
 * by ADR 0084 for being unguarded and untraceable).
 */
export type TemplateChannel = 'letters';

interface Props {
  onClose: () => void;
  /** A template a person left half-written (COMMS-W34), opened again as it was left. */
  held?: HeldTemplate | null;
  /** Called as the sheet leaves holding a template that is not saved. */
  onHold?: (held: HeldTemplate) => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'stored'; name: string }
  | { kind: 'failed'; message: string };

export interface Draft {
  id?: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  from?: InsightSentence;
}

const BLANK: Draft = { name: '', category: 'price_query', subject: '', body: '' };

/** The form as it was left, and as it was opened — so it reopens still unsaved. */
export interface HeldTemplate {
  draft: Draft;
  opened: Draft;
}

export function TemplateSheet({ onClose, held = null, onHold }: Props) {
  const data = useComposeData();
  const [draft, setDraft] = useState<Draft | null>(held?.draft ?? null);
  // The draft as it was opened. Typing makes it differ, and while it differs no
  // other template may be opened over it (COMMS-W28): every way in used to
  // replace the open form, wiping what had been typed without a word.
  const [opened, setOpened] = useState<Draft | null>(held?.opened ?? null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const unsaved =
    draft !== null &&
    opened !== null &&
    (draft.name !== opened.name ||
      draft.category !== opened.category ||
      draft.subject !== opened.subject ||
      draft.body !== opened.body);
  const openDraft = (d: Draft | null) => {
    setDraft(d);
    setOpened(d);
  };
  const lockedLook = unsaved ? { opacity: 0.5, cursor: 'not-allowed' } : null;
  const noLetter = draft !== null && draft.body.trim().length === 0;

  // The order letter has its own panel (ADR 0313): never a choice here, even
  // if a server ever lists it.
  const categories = (
    data.sender?.categories ?? [
      'order_confirmation',
      'price_query',
      'delivery_dispute',
      'invoice_mismatch',
      'promotion_reply',
    ]
  ).filter((c) => c !== ORDER_LETTER_KEY);

  const templates = useMemo(
    () => (data.templates ? data.templates.filter((t) => t.category !== ORDER_LETTER_KEY) : data.templates),
    [data.templates],
  );

  // COMMS-W34: Escape, a click outside or Close used to throw an unsaved
  // template away without a word. Now the page keeps it on a stub.
  const leave = () => {
    if (unsaved && draft && opened) onHold?.({ draft, opened });
    onClose();
  };

  const store = useCallback(async () => {
    if (!draft) return;
    setSave({ kind: 'saving' });
    try {
      await apiClient.post('/communications/letters/templates', {
        id: draft.id,
        name: draft.name.trim() || 'Untitled letter',
        category: draft.category,
        subject: draft.subject || undefined,
        body: draft.body,
      });
      setSave({ kind: 'stored', name: draft.name.trim() || 'Untitled letter' });
      setDraft(null);
      setOpened(null);
      data.refetchQueued();
    } catch (e) {
      // A failed save must NOT close the editor: the author's work is still in
      // it, and closing over a failure is how a page comes to claim a
      // persistence it never performed (ADR 0083).
      setSave({ kind: 'failed', message: errText(e) });
    }
  }, [draft, data]);

  const byCategory = useMemo(() => {
    const map = new Map<string, LetterTemplate[]>();
    for (const t of templates ?? []) {
      const key = t.category ?? 'uncategorised';
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [templates]);

  return (
    <Sheet
      open
      onClose={leave}
      dirty={unsaved}
      wide
      label="The house's letter templates"
      eyebrow="House letters"
      title="Templates"
    >
      <div className="grid gap-4" style={{ fontFamily: SANS }}>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2, #4F473C)' }}>
          A template is a letter the house writes again and again, kept for one vendor purpose.
          Letters to the team are sent from the Team page.
        </p>

        {save.kind === 'stored' && (
          <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--seal-deep, #14515C)' }}>
            Saved as “{save.name}”. Sending still happens from the composer, never
            from here.
          </p>
        )}
        {save.kind === 'failed' && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
            It was NOT saved ({save.message}) — nothing was stored, and your work is still open
            below.
          </p>
        )}

        {/* ── the library ────────────────────────────────────────────────── */}
        {data.templatesFailed ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
            {data.templatesError} That does not mean the house has none.
          </p>
        ) : templates === null ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
            Reading the library…
          </p>
        ) : templates.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
            No templates yet. Write one below, or start from something the house noticed.
          </p>
        ) : (
          <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
            {Array.from(byCategory, ([category, rows]) => (
              <section key={category} className="py-2">
                <h3
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4, #665D50)',
                    margin: '0 0 6px',
                  }}
                >
                  {categoryLabel(category)}
                </h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  {rows.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="cmp-pick w-full text-left"
                        disabled={unsaved}
                        onClick={() =>
                          openDraft({
                            id: t.id,
                            name: t.name,
                            category: t.category ?? 'price_query',
                            subject: t.subject ?? '',
                            body: t.body,
                          })
                        }
                        style={{
                          padding: '7px 9px',
                          borderRadius: 8,
                          border: '1px solid var(--paper-2, #EAE4D8)',
                          background: 'var(--paper-0, #FAF7F1)',
                          cursor: 'pointer',
                          ...lockedLook,
                        }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
                          {t.name}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontFamily: MONO,
                            fontSize: 9.5,
                            color: 'var(--ink-4, #665D50)',
                            marginTop: 3,
                          }}
                        >
                          fields: {t.mergeFields && t.mergeFields.length > 0
                            ? t.mergeFields.map((f) => f.key).join(', ')
                            : 'none declared'}
                          {' · '}
                          {/* NULL is unknown, never "nobody" and never "never": a
                              row written before migration 20260904150000 has no
                              author and no last-use recorded, and it never will. */}
                          last edited by {t.lastEditedBy ?? 'unknown'} {fmtDay(t.lastEditedAt)}
                          {' · '}
                          last used {t.lastUsedAt ? fmtDay(t.lastUsedAt) : 'unknown'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={unsaved}
            aria-describedby={unsaved ? 'tpl-unsaved' : undefined}
            onClick={() => {
              openDraft({ ...BLANK });
              setSave({ kind: 'idle' });
            }}
            className="inline-flex items-center gap-1.5 self-start"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
              ...lockedLook,
            }}
          >
            <FilePlus2 {...ICON} aria-hidden />
            Write a new template
          </button>
          {unsaved && (
            <span id="tpl-unsaved" data-testid="tpl-unsaved" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
              Save or discard the template below to start another.
            </span>
          )}
        </div>

        <OrderLetterPanel />

        {/* ── start from an insight ──────────────────────────────────────── */}
        <div>
          <h3
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-4, #665D50)',
              margin: '0 0 6px',
            }}
          >
            Start from something the house noticed
          </h3>
          {data.insightsFailed ? (
            <p role="alert" style={{ margin: 0, fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)' }}>
              What the house noticed could not be read ({data.insightsError}).
            </p>
          ) : data.insights === null ? (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>Reading…</p>
          ) : data.insights.length === 0 ? (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>
              Nothing the house noticed is waiting to be written about.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {data.insights.slice(0, 6).map((i) => (
                <li key={i.candidateKey}>
                  <button
                    type="button"
                    className="cmp-pick w-full text-left"
                    disabled={unsaved}
                    onClick={() => {
                      openDraft({
                        ...BLANK,
                        name: '',
                        body: i.sentence,
                        from: i,
                      });
                      setSave({ kind: 'idle' });
                    }}
                    style={{
                      padding: '6px 9px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: 'transparent',
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: 'var(--ink-1, #211C16)',
                      cursor: 'pointer',
                      ...lockedLook,
                    }}
                  >
                    <Quote {...ICON} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--seal-deep, #14515C)' }} />
                    {i.sentence}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── the editor ─────────────────────────────────────────────────── */}
        {draft && (
          <div
            className="rounded-xl p-3"
            style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            {draft.from && (
              <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 9.5, color: 'var(--seal-deep, #14515C)' }}>
                From something the house noticed · worked out {fmtDay(draft.from.computedAt)}
              </p>
            )}
            <label htmlFor="tpl-name" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
              Name
            </label>
            <input
              id="tpl-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={fieldStyle}
            />
            <label
              htmlFor="tpl-category"
              style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', display: 'block', marginTop: 8 }}
            >
              Purpose
            </label>
            <select
              id="tpl-category"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              style={fieldStyle}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
            <label
              htmlFor="tpl-subject"
              style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', display: 'block', marginTop: 8 }}
            >
              Subject
            </label>
            <input
              id="tpl-subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              style={fieldStyle}
            />
            <label
              htmlFor="tpl-body"
              style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', display: 'block', marginTop: 8 }}
            >
              The letter
            </label>
            <textarea
              id="tpl-body"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={8}
              style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.55 }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
              Write a field as {'{{name}}'}. A letter is never sent with a field left empty.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={store}
                disabled={save.kind === 'saving' || noLetter}
                aria-describedby={noLetter ? 'tpl-no-letter' : undefined}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '6px 13px',
                  borderRadius: 8,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'var(--seal-tint, rgba(26,94,107,.10))',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: save.kind === 'saving' ? 'progress' : noLetter ? 'not-allowed' : 'pointer',
                  opacity: noLetter ? 0.5 : 1,
                }}
              >
                {save.kind === 'saving' ? 'Saving…' : 'Save the template'}
              </button>
              <button
                type="button"
                onClick={() => openDraft(null)}
                style={{
                  fontSize: 12,
                  padding: '6px 13px',
                  borderRadius: 8,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  background: 'transparent',
                  color: 'var(--ink-2, #4F473C)',
                  cursor: 'pointer',
                }}
              >
                Discard
              </button>
              {noLetter && (
                <span id="tpl-no-letter" data-testid="tpl-no-letter" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                  Write the letter first.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ── the order letter ─────────────────────────────────────────────────────────

const ORDER_LETTER_KEY = 'order_request';
const ORDER_LETTER_PATH = '/communications/letters/templates/order-request';

type Locale = 'en' | 'tr';

interface Refusal {
  rule: string;
  says: string;
}

interface LetterVersion {
  id: string;
  version: number;
  locale: string;
  kind: 'publish' | 'reset';
  body: string;
  by: string | null;
  at: string | null;
}

export interface OrderLetterView {
  key: string;
  locale: Locale;
  mayEdit: boolean;
  template: {
    id: string;
    name: string;
    draft: string;
    lastEditedBy: string | null;
    lastEditedAt: string | null;
  } | null;
  published: LetterVersion | null;
  rendersFrom: 'house' | 'default';
  draftRefusals: Refusal[];
  versions: LetterVersion[];
  defaults: Record<Locale, string>;
  tokens: { key: string; required: boolean; says: string }[];
}

interface Preview {
  previewHash: string | null;
  refusals: Refusal[];
  samples: { label: string; subject: string; body: string }[];
  /** The words the preview was of, so an edit after it cannot be published. */
  of: string;
}

/** The refusals a 422 carries, if it carries any. */
function refusalsOf(e: unknown): Refusal[] {
  const data = (e as { response?: { data?: { refusals?: unknown } } })?.response?.data;
  return Array.isArray(data?.refusals) ? (data!.refusals as Refusal[]) : [];
}

const LANGUAGE: Record<string, string> = { en: 'English', tr: 'Turkish' };

const LETTER_LABEL = 'The order letter';

/**
 * The house's order letter, read on demand and never in the library. The words
 * are a DRAFT until previewed and published; what vendors receive is the
 * published version in the house's language, or Mudavym's default.
 */
export function OrderLetterPanel() {
  const [view, setView] = useState<OrderLetterView | null>(null);
  const [state, setState] = useState<
    { kind: 'closed' } | { kind: 'reading' } | { kind: 'open' } | { kind: 'failed'; message: string }
  >({ kind: 'closed' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setState((s) => (s.kind === 'open' ? s : { kind: 'reading' }));
    try {
      const res = await apiClient.get<OrderLetterView>(ORDER_LETTER_PATH);
      const v = res?.data;
      if (!v || typeof v !== 'object' || !('mayEdit' in v)) throw new Error('the order letter came back empty');
      setView(v);
      setText(v.template?.draft ?? v.defaults[v.locale]);
      setRefusals(v.draftRefusals ?? []);
      setState({ kind: 'open' });
    } catch (e) {
      setState({ kind: 'failed', message: errText(e) });
    }
  }, []);

  const saved = view ? (view.template?.draft ?? null) : null;
  const edited = view !== null && text !== (saved ?? view.defaults[view.locale]);
  const canPublish =
    !!view?.mayEdit && !!preview?.previewHash && !edited && preview.of === saved && busy === null;

  const act = useCallback(
    async (what: string, run: () => Promise<string>) => {
      setBusy(what);
      setNote(null);
      try {
        const said = await run();
        setNote({ tone: 'ok', text: said });
        await load();
      } catch (e) {
        const r = refusalsOf(e);
        if (r.length > 0) setRefusals(r);
        setNote({ tone: 'bad', text: `${errText(e)} Nothing changed for vendors.` });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const saveDraft = () =>
    act('save', async () => {
      await apiClient.post('/communications/letters/templates', {
        id: view?.template?.id,
        name: view?.template?.name ?? 'Order letter',
        category: ORDER_LETTER_KEY,
        body: text,
      });
      setPreview(null);
      setRefusals([]);
      return 'The draft is saved. Vendors still receive the published words until you preview and publish it.';
    });

  const runPreview = () =>
    act('preview', async () => {
      const { data } = await apiClient.post<Omit<Preview, 'of'>>(`${ORDER_LETTER_PATH}/preview`, {
        locale: view?.locale,
      });
      setPreview({ ...data, of: saved ?? '' });
      setRefusals(data.refusals ?? []);
      return data.previewHash
        ? 'This is the draft as a vendor would read it. Publish it to send it from now on.'
        : 'The draft cannot be published until the sentences below are changed.';
    });

  const publish = () =>
    act('publish', async () => {
      const { data } = await apiClient.post<{ version: number }>(`${ORDER_LETTER_PATH}/publish`, {
        previewHash: preview?.previewHash,
        locale: view?.locale,
      });
      setPreview(null);
      return `Published as version ${data.version}. Order letters use these words from now on.`;
    });

  const reset = () =>
    act('reset', async () => {
      const { data } = await apiClient.post<{ version: number }>(`${ORDER_LETTER_PATH}/reset`, {
        locale: view?.locale,
      });
      setConfirmReset(false);
      setPreview(null);
      return `Mudavym's words are published again (version ${data.version}) and are in the draft.`;
    });

  const restore = (v: LetterVersion) =>
    act('restore', async () => {
      await apiClient.post(`${ORDER_LETTER_PATH}/restore`, { versionId: v.id });
      setPreview(null);
      return `Version ${v.version} is in the draft. Nothing was published: preview and publish it to use it.`;
    });

  const insertToken = (key: string) => setText((t) => `${t}${t.endsWith('\n') || t === '' ? '' : '\n'}{{${key}}}`);

  const headingStyle = {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-4, #665D50)',
    margin: '0 0 6px',
  } as const;

  return (
    <section aria-label={LETTER_LABEL} data-testid="order-letter">
      <h3 style={headingStyle}>{LETTER_LABEL}</h3>
      {state.kind === 'closed' ? (
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5" style={smallButton}>
          <ScrollText {...ICON} aria-hidden />
          Open the order letter
        </button>
      ) : state.kind === 'reading' ? (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>Reading the order letter…</p>
      ) : state.kind === 'failed' || !view ? (
        <p role="alert" style={{ margin: 0, fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)' }}>
          The order letter could not be read ({state.kind === 'failed' ? state.message : 'no answer'}). That does
          not mean the house has none.{' '}
          <button type="button" onClick={load} style={linkButton}>
            Try again
          </button>
        </p>
      ) : (
        <div
          className="rounded-xl p-3 grid gap-2"
          style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
        >
          <p data-testid="order-letter-live" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2, #4F473C)' }}>
            Mudavym writes this letter when an order goes to a vendor, in {LANGUAGE[view.locale] ?? view.locale}. The
            figures come from the order; only the words around them are yours.{' '}
            {view.rendersFrom === 'house' && view.published
              ? `Vendors receive your published words, version ${view.published.version}${
                  view.published.by ? `, published by ${view.published.by}` : ''
                } ${fmtDay(view.published.at)}.`
              : view.published
                ? `Your published words are in ${LANGUAGE[view.published.locale] ?? view.published.locale}, not the house's language, so vendors receive Mudavym's words.`
                : "Vendors receive Mudavym's words: nothing of the house's has been published."}
          </p>

          {!view.mayEdit && (
            <p data-testid="order-letter-read-only" style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>
              Only an owner or a manager can change the order letter. You can read it here.
            </p>
          )}

          <label htmlFor="order-letter-body" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
            {view.template ? 'The draft' : "Mudavym's words (the house has not written its own)"}
          </label>
          <textarea
            id="order-letter-body"
            value={text}
            readOnly={!view.mayEdit}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.55, fontFamily: MONO, fontSize: 11.5 }}
          />
          {view.template && (
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-4, #665D50)' }}>
              draft last edited by {view.template.lastEditedBy ?? 'unknown'} {fmtDay(view.template.lastEditedAt)}
            </p>
          )}

          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
              Blocks Mudavym fills in. Write no figures, prices, dates or links yourself: those come from the order.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {view.tokens.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    disabled={!view.mayEdit}
                    title={t.says}
                    aria-label={`Add {{${t.key}}}: ${t.says}${t.required ? ' (required)' : ''}`}
                    onClick={() => insertToken(t.key)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      padding: '2px 7px',
                      borderRadius: 999,
                      border: `1px solid ${t.required ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
                      background: 'var(--paper-0, #FAF7F1)',
                      color: 'var(--ink-2, #4F473C)',
                      cursor: view.mayEdit ? 'pointer' : 'default',
                    }}
                  >
                    {`{{${t.key}}}`}
                    {t.required ? ' *' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {refusals.length > 0 && (
            <ul role="alert" data-testid="order-letter-refusals" style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)' }}>
              {refusals.map((r, i) => (
                <li key={`${r.rule}-${i}`}>{r.says}</li>
              ))}
            </ul>
          )}

          {note && (
            <p
              role={note.tone === 'bad' ? 'alert' : 'status'}
              style={{
                margin: 0,
                fontSize: 11.5,
                color: note.tone === 'bad' ? 'var(--alarm-deep, #8C3322)' : 'var(--seal-deep, #14515C)',
              }}
            >
              {note.text}
            </p>
          )}

          {view.mayEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={saveDraft} disabled={busy !== null || !edited || text.trim() === ''} style={smallButton}>
                {busy === 'save' ? 'Saving…' : 'Save the draft'}
              </button>
              <button
                type="button"
                onClick={runPreview}
                disabled={busy !== null || edited || !view.template}
                aria-describedby={edited || !view.template ? 'order-letter-save-first' : undefined}
                style={smallButton}
              >
                {busy === 'preview' ? 'Previewing…' : 'Preview'}
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={!canPublish}
                aria-describedby={!canPublish ? 'order-letter-preview-first' : undefined}
                style={{ ...smallButton, background: 'var(--seal-tint, rgba(26,94,107,.10))' }}
              >
                {busy === 'publish' ? 'Publishing…' : 'Publish'}
              </button>
              {view.template &&
                (confirmReset ? (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
                    This publishes Mudavym's words and replaces the draft.{' '}
                    <button type="button" onClick={reset} disabled={busy !== null} style={linkButton}>
                      Reset
                    </button>{' '}
                    <button type="button" onClick={() => setConfirmReset(false)} style={linkButton}>
                      Keep mine
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmReset(true)} disabled={busy !== null} style={smallButton}>
                    Reset to Mudavym's words
                  </button>
                ))}
              {(edited || !view.template) && (
                <span id="order-letter-save-first" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                  Save the draft to preview it.
                </span>
              )}
              {!edited && view.template && !canPublish && (
                <span id="order-letter-preview-first" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                  Only a previewed draft can be published.
                </span>
              )}
            </div>
          )}

          {preview && preview.samples.length > 0 && (
            <div data-testid="order-letter-preview" className="grid gap-2">
              {preview.samples.map((sample) => (
                <figure key={sample.label} style={{ margin: 0 }}>
                  <figcaption style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-4, #665D50)' }}>
                    {sample.label}
                  </figcaption>
                  <pre
                    style={{
                      margin: '3px 0 0',
                      padding: '7px 9px',
                      whiteSpace: 'pre-wrap',
                      fontFamily: SANS,
                      fontSize: 12,
                      lineHeight: 1.5,
                      borderRadius: 8,
                      border: '1px solid var(--paper-2, #EAE4D8)',
                      background: 'var(--paper-0, #FAF7F1)',
                    }}
                  >
                    {`Subject: ${sample.subject}\n\n${sample.body}`}
                  </pre>
                </figure>
              ))}
            </div>
          )}

          <div>
            <h4 style={{ ...headingStyle, marginTop: 4 }}>Published versions</h4>
            {view.versions.length === 0 ? (
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' }}>None yet.</p>
            ) : (
              <ul data-testid="order-letter-versions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
                {view.versions.map((v) => (
                  <li key={v.id} style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5 }}>
                      v{v.version} · {LANGUAGE[v.locale] ?? v.locale} · {v.kind === 'reset' ? "Mudavym's words" : 'published'}
                      {v.id === view.published?.id ? ' · live' : ''}
                    </span>{' '}
                    by {v.by ?? 'unknown'} {fmtDay(v.at)}
                    {view.mayEdit && (
                      <>
                        {' '}
                        <button type="button" onClick={() => restore(v)} disabled={busy !== null} style={linkButton}>
                          Copy v{v.version} into the draft
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const smallButton = {
  fontSize: 11.5,
  fontWeight: 600,
  padding: '5px 11px',
  borderRadius: 8,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
} as const;

const linkButton = {
  fontSize: 11.5,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

const fieldStyle = {
  width: '100%',
  fontSize: 12.5,
  padding: '6px 9px',
  marginTop: 3,
  borderRadius: 8,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
} as const;

export default TemplateSheet;
