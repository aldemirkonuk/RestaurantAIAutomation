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
 */

import { useCallback, useMemo, useState } from 'react';
import { FilePlus2, Quote } from 'lucide-react';
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
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'stored'; name: string }
  | { kind: 'failed'; message: string };

interface Draft {
  id?: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  from?: InsightSentence;
}

const BLANK: Draft = { name: '', category: 'price_query', subject: '', body: '' };

export function TemplateSheet({ onClose }: Props) {
  const data = useComposeData();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const categories = data.sender?.categories ?? [
    'order_confirmation',
    'price_query',
    'delivery_dispute',
    'invoice_mismatch',
    'promotion_reply',
  ];

  const templates = data.templates;

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
      onClose={onClose}
      wide
      label="The house's letter templates"
      eyebrow="House letters"
      title="Templates"
    >
      <div className="grid gap-4" style={{ fontFamily: SANS }}>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2, #4F473C)' }}>
          A template is a letter this house has already written twice. Each one belongs to a vendor
          purpose and declares the fields it merges. A staff broadcast is not one of them — the
          composer writes to the vendor book, and crew messages stay on /team.
        </p>

        {save.kind === 'stored' && (
          <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--seal-deep, #14515C)' }}>
            Stored on the server as “{save.name}”. Sending still happens from the composer, never
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
            {data.templatesError} This is a failed read — the library is unknown, not empty.
          </p>
        ) : templates === null ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
            Reading the library…
          </p>
        ) : templates.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
            This house has written no template yet. That is the honest state, not an empty shelf to
            be filled with guesses: seven templates written before anyone has sent a letter are
            seven guesses about what this house wants to say.
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
                    color: 'var(--ink-3, #7C7365)',
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
                        onClick={() =>
                          setDraft({
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
                            color: 'var(--ink-3, #7C7365)',
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

        <button
          type="button"
          onClick={() => {
            setDraft({ ...BLANK });
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
          }}
        >
          <FilePlus2 {...ICON} aria-hidden />
          Write a new template
        </button>

        {/* ── start from an insight ──────────────────────────────────────── */}
        <div>
          <h3
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3, #7C7365)',
              margin: '0 0 6px',
            }}
          >
            Start from something the house noticed
          </h3>
          {data.insightsFailed ? (
            <p role="alert" style={{ margin: 0, fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)' }}>
              The engine's sentences could not be read ({data.insightsError}).
            </p>
          ) : data.insights === null ? (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>Reading…</p>
          ) : data.insights.length === 0 ? (
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
              The engine is holding no sentence for this house right now.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {data.insights.slice(0, 6).map((i) => (
                <li key={i.candidateKey}>
                  <button
                    type="button"
                    className="cmp-pick w-full text-left"
                    onClick={() => {
                      setDraft({
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
                from {draft.from.candidateKey} · computed {fmtDay(draft.from.computedAt)}
              </p>
            )}
            <label htmlFor="tpl-name" style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
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
              style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', display: 'block', marginTop: 8 }}
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
              style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', display: 'block', marginTop: 8 }}
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
              style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', display: 'block', marginTop: 8 }}
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
            <p style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
              A field written as {'{{name}}'} is declared as a merge field. The composer refuses to
              send a letter that still contains one unfilled — a raw placeholder in a vendor's inbox
              says a figure exists when none was found.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={store}
                disabled={save.kind === 'saving' || draft.body.trim().length === 0}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '6px 13px',
                  borderRadius: 8,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'var(--seal-tint, rgba(26,94,107,.10))',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: save.kind === 'saving' ? 'progress' : 'pointer',
                }}
              >
                {save.kind === 'saving' ? 'Saving…' : 'Save the template'}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
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
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

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
