/**
 * TemplateSheet — the founder's modal-clarity ask, answered in copy: when a
 * template builder opens, a banner says exactly what is going on and what
 * cannot happen from here, before anything else.
 *
 * The builders are the existing, battle-tested components, rendered AS THEY
 * ARE: they position themselves as full-screen overlays (fixed inset-0
 * z-[200]), so wrapping them in a positioned frame double-overlays and clips
 * (communications-audit.md, BLOCKER 4). The clarity banner is therefore its
 * own fixed bar, stacked above the builder's overlay, and the builder keeps
 * the whole screen.
 *
 * ── P1: Save now saves ──────────────────────────────────────────────────────
 * The banner used to read "Saving stores it for later", and `onSave` was
 * `onClose` — a function that ignores its argument. Neither builder writes
 * anything (`GmailTemplateBuilder.handleSaveTemplate` makes no network call;
 * `SMSTemplateBuilder` says `// Simulate save delay`), so pressing Save showed
 * a success state and discarded the work. Legacy has the same no-op and does
 * NOT claim otherwise, which made this a regression the rebuild introduced.
 *
 * `onSave` now posts to `POST /restaurants/:rid/templates` through
 * `useTemplates().createTemplate`, and this banner reports the OUTCOME —
 * saving, stored, or the failure in words — because a page may not confirm a
 * write it has not had accepted (ADR 0051 clause 3).
 *
 * WHAT IS STORED, EXACTLY. The server's shape is narrow and the DTO is
 * `whitelist: true, forbidNonWhitelisted: true` (main.ts:52-56), so posting the
 * builder's own object would 400 on every field it does not model. The table
 * (`communication_templates`) holds `name`, `subject`, `body`, `type` and
 * nothing else — no panels column, no thumbnail, no category, no usage count.
 * So the sheet maps deliberately:
 *
 *   SMS    body = the message text, verbatim and lossless.
 *   email  body = the panel structure as JSON, so the author's work is kept
 *          rather than discarded. It is NOT re-opened into the builder — no
 *          such round trip exists — and the banner does not pretend otherwise.
 *
 * The only gateway reader of this table filters `type='sender_identity'`
 * (procurement.service.ts:2697-2703), so an 'email'/'sms' row cannot reach the
 * outbound send path.
 *
 * ── Second pass: the OUTER SURFACE wears the wave, the builders do not ─────
 * ADR 0112 makes every overlay over a rebuilt page look like the page under it.
 * These two builders are the one exception, and it is a deliberate, bounded
 * one: they are 1700+ and 900+ line legacy components with their own toolbars,
 * palettes and preview panes, and re-skinning their INTERNALS is a rebuild, not
 * a modal pass. What this sheet re-skins is the three layers it can reach
 * structurally without touching them — their backdrop, their card and their
 * header band (`.cm-builder-skin > div`, `> div > div`, `> div > div >
 * :first-child`, matching GmailTemplateBuilder.tsx:852-863 and
 * SMSTemplateBuilder.tsx:423-434). Everything inside the card is still the
 * legacy look, and the page note says so.
 *
 * The selectors are structural, not class-string matches, because a Tailwind
 * class string is not a contract — `AnimatePresence` and `Suspense` render no
 * DOM node, so `> div` is the builder's own overlay root and stays so.
 *
 * The wrapper deliberately does NOT carry `.mudavym`: it already sits inside
 * the page's root, and a SECOND bare `.mudavym` node re-declares the light
 * token column on itself, which is precisely the charcoal bug PageGate's header
 * documents. The charcoal rule therefore reads the ANCESTOR
 * (`.mudavym[data-ground="charcoal"] .cm-builder-skin`), never this element.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useTemplates } from '../../../hooks/useTemplates';
import { MONO, SANS, SERIF } from './cm-format';

const GmailTemplateBuilder = lazy(() =>
  import('../../../components/documents/GmailTemplateBuilder').then((m) => ({
    default: m.GmailTemplateBuilder,
  })),
);
const SMSTemplateBuilder = lazy(() =>
  import('../../../components/documents/SMSTemplateBuilder').then((m) => ({
    default: m.SMSTemplateBuilder,
  })),
);

export type TemplateChannel = 'gmail' | 'sms';

interface Props {
  channel: TemplateChannel;
  onClose: () => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'stored'; name: string }
  | { kind: 'failed'; message: string };

/** What the server actually accepts. Anything else is rejected wholesale. */
interface TemplatePayload {
  name: string;
  subject?: string;
  body: string;
  type: string;
}

function emailPayload(t: any): TemplatePayload {
  return {
    name: String(t?.name ?? '').trim() || 'Untitled template',
    subject: t?.subject ? String(t.subject) : undefined,
    // The panel structure, kept rather than thrown away. `body` is the only
    // free-text column this table has.
    body: JSON.stringify({ description: t?.description ?? '', panels: t?.panels ?? [] }),
    type: 'email',
  };
}

function smsPayload(t: any): TemplatePayload {
  return {
    name: String(t?.name ?? '').trim() || 'Untitled template',
    body: String(t?.message ?? ''),
    type: 'sms',
  };
}

export function TemplateSheet({ channel, onClose }: Props) {
  const { createTemplate } = useTemplates();
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = useCallback(
    async (template: unknown) => {
      const payload = channel === 'gmail' ? emailPayload(template) : smsPayload(template);
      setSave({ kind: 'saving' });
      try {
        await createTemplate(payload as never);
        setSave({ kind: 'stored', name: payload.name });
      } catch (e) {
        // A failed save must NOT close the sheet: the author's work is still in
        // the builder behind this banner, and closing over a failure is how the
        // page came to claim a persistence it never performed.
        setSave({
          kind: 'failed',
          message: e instanceof Error ? e.message : 'unknown error',
        });
        // Rethrow so the builder's own success state never fires on a rejection.
        throw e;
      }
    },
    [channel, createTemplate],
  );

  const detail =
    save.kind === 'saving'
      ? 'Saving to the server…'
      : save.kind === 'stored'
        ? `Stored on the server as “${save.name}”. Sending always happens from a conversation.`
        : save.kind === 'failed'
          ? `It could not be saved (${save.message}) — nothing was stored. Your work is still open below.`
          : 'Saving stores the name, subject and message on the server for this restaurant; sending always happens from a conversation.';

  return (
    <>
      <style>{`
        /* the builder's own full-screen backdrop */
        .cm-builder-skin > div {
          background: rgba(23,19,15,.28) !important;
          backdrop-filter: none !important;
        }
        .dark .cm-builder-skin > div,
        .mudavym[data-ground="charcoal"] .cm-builder-skin > div {
          background: rgba(0,0,0,.5) !important;
        }
        /* its card */
        .cm-builder-skin > div > div {
          background: var(--paper-0) !important;
          border: 1px solid var(--paper-2) !important;
          border-radius: 14px !important;
          box-shadow: 0 24px 60px -30px rgba(0,0,0,.5) !important;
        }
        /* its header band — the blue/teal gradient becomes the one seal.
           background-image, not background-color: a Tailwind gradient paints
           an image, and setting only the colour leaves the gradient on top. */
        .cm-builder-skin > div > div > div:first-child {
          background-image: none !important;
          background-color: var(--seal) !important;
        }
      `}</style>

      {/* what's going on — above the builder's own z-[200] overlay */}
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[220] px-5 py-2.5"
        style={{
          height: 52,
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          background: 'var(--paper-0, #FAF7F1)',
          borderBottom: '1px solid var(--paper-2, #EAE4D8)',
          fontFamily: SANS,
          boxShadow: '0 6px 24px rgba(23,19,15,.12)',
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--seal-deep, #14515C)',
          }}
        >
          Template workshop · {channel === 'gmail' ? 'email' : 'SMS'}
        </span>
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            marginLeft: 10,
          }}
        >
          You are editing a new template. Nothing is sent from here.
        </span>
        <span
          style={{
            fontSize: 11.5,
            color:
              save.kind === 'failed' ? 'var(--alarm-deep, #8C3322)' : 'var(--ink-3, #7C7365)',
            marginLeft: 10,
          }}
        >
          {detail}
        </span>
      </div>

      {/* The builders are fixed inset-0 overlays; a transformed full-screen-
          minus-banner container becomes their containing block, so the whole
          overlay (backdrop, card, header) lives BELOW the banner instead of
          being clipped by it (Opus correctness review, DEFECT 7). */}
      <div
        className="cm-builder-skin"
        style={{
          position: 'fixed',
          top: 52,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 210,
          transform: 'translateZ(0)',
        }}
      >
        <Suspense fallback={null}>
          {channel === 'gmail' ? (
            <GmailTemplateBuilder onClose={onClose} onSave={handleSave} />
          ) : (
            <SMSTemplateBuilder onClose={onClose} onSave={handleSave} />
          )}
        </Suspense>
      </div>
    </>
  );
}
