/**
 * The vendor's numbers, and whether a text can reach any of them.
 *
 * ADR 0121 P0 item 2. Three states are shown, never two: a number recorded as a
 * mobile, a number recorded as something else, and a number NOBODY HAS
 * DESCRIBED. The third is the one this section exists for — `phone_type`
 * carries `DEFAULT 'main_line'`, so a row nobody answered looks exactly like a
 * row somebody answered "main line", and the gateway reports that as
 * `phoneTypeStated: false` rather than pretending to know.
 *
 * The verdict is the server's (`providers/phone-reachability.ts`); this file
 * renders `reachSays` verbatim and owns no vocabulary of its own.
 *
 * ── The ground (ADR 0138), 2026-09-17 ─────────────────────────────────────
 * This section renders inside `TwinSheet`, whose `Sheet` is a `.mudavym` root
 * and therefore Warm Charcoal. Its first cut painted four colours that exist
 * nowhere in the token file (`--warn-bg`, `--warn-ink`, `--ok-bg`, `--ok-ink`),
 * so their PAPER fallbacks rendered on charcoal: light pills on a dark sheet,
 * and the two sentences that matter most — "could not be read" and "was not
 * saved" — in `#7A5A17` on `#1D1813`, 2.77:1, under WCAG AA. Every colour below
 * is a house token (`styles/mudavym.css`), in the same three chip tones
 * `/connections` draws (`.cx-chip.is-on / is-off / is-warn`), and a refusal is
 * ink with a rule at its left rather than a colour: the house has no red
 * (ADR 0042).
 */

import { ink, useReducedMotion } from '../../../lib/mudavym/motion';
import type { ProviderContact } from '../../../services/api/providers';
import { useProviderContacts, PHONE_TYPE_CHOICES } from './useProviderContacts';
import { MONO, SANS } from './pv-format';

interface Props {
  providerId: string;
  providerName: string;
}

const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  margin: '14px 0 6px',
};

const BODY: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
};

/**
 * A sentence saying something did NOT happen. Ink, never a colour, with the
 * same left rule `/connections` puts on a refused write (`.cx-ctl-alert`), so a
 * failed read and a failed save read as the same kind of fact.
 */
const REFUSAL: React.CSSProperties = {
  ...BODY,
  color: 'var(--ink-1, #211C16)',
  borderLeft: '2px solid var(--ink-3, #7C7365)',
  paddingLeft: 8,
  margin: '6px 0 0',
};

/** The field shape `TermsSection` uses, so two editors on one sheet match. */
const FIELD: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11.5,
  padding: '3px 8px',
  borderRadius: 7,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
  color: 'var(--ink-1, #211C16)',
};

type Tone = 'on' | 'off' | 'warn';

const TONE: Record<Tone, React.CSSProperties> = {
  on: {
    color: 'var(--seal-deep, #14515C)',
    background: 'var(--seal-tint, rgba(26,94,107,.10))',
    boxShadow: 'inset 0 0 0 1px var(--seal-ring, rgba(26,94,107,.32))',
  },
  off: {
    color: 'var(--ink-3, #7C7365)',
    background: 'transparent',
    boxShadow: 'inset 0 0 0 1px var(--paper-2, #EAE4D8)',
  },
  warn: {
    color: 'var(--ink-1, #211C16)',
    background: 'var(--paper-2, #EAE4D8)',
    boxShadow: 'inset 0 0 0 1px var(--ink-4, #665D50)',
  },
};

/**
 * The chip reads BOTH facts, and `stated` wins.
 *
 * A row carrying the column's `main_line` default has `reach: 'landline'` and
 * `phoneTypeStated: false`. Showing it as "Not textable" would be a verdict on
 * a question nobody answered — true about what we would do, false about what we
 * know. "Not stated" is the honest headline, and the server's own sentence
 * below it carries the rest.
 *
 * The fill changes on `ink` (160ms, the house curve) — the token
 * `lib/mudavym/motion.ts` names for chip fills — because the one moment it
 * changes is the moment a manager's answer lands, and a colour that snaps
 * reads as a flicker rather than as the server agreeing. Reduced motion: no
 * transition at all.
 */
function ReachChip({
  reach,
  stated,
  reduced,
}: {
  reach: string | undefined;
  stated: boolean | undefined;
  reduced: boolean;
}) {
  const [tone, text]: [Tone, string] =
    stated === false
      ? ['warn', 'Not stated']
      : reach === 'mobile'
        ? ['on', 'Textable']
        : reach === 'landline'
          ? ['off', 'Not textable']
          : ['warn', 'Not stated'];
  return (
    <span
      data-tone={tone}
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.11em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        padding: '3px 7px',
        borderRadius: 3,
        transition: reduced
          ? 'none'
          : `color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}, box-shadow ${ink.ms}ms ${ink.easing}`,
        ...TONE[tone],
      }}
    >
      {text}
    </span>
  );
}

export interface ContactsListProps {
  providerName: string;
  contacts: ProviderContact[] | null;
  loading: boolean;
  error: string | null;
  saving: string | null;
  saveError: string | null;
  onSetPhoneType: (contactId: string, phoneType: string) => void;
  onReload: () => void;
}

/**
 * What the section draws, given what the hook read. Separate from the hook so
 * the drawing can be rendered on its real ground without a network — which is
 * how the charcoal render above was checked — and so no state here is local.
 */
export function ContactsList({
  providerName,
  contacts,
  loading,
  error,
  saving,
  saveError,
  onSetPhoneType,
  onReload,
}: ContactsListProps) {
  const reduced = useReducedMotion();
  const savingName = saving ? contacts?.find((c) => c.id === saving)?.name ?? null : null;

  return (
    <section>
      <h3 style={LABEL}>Numbers on file</h3>

      {loading && (
        <p role="status" style={{ ...BODY, margin: 0 }}>
          Reading {providerName}’s contacts…
        </p>
      )}

      {/* A FAILED READ IS NOT AN EMPTY BOOK. */}
      {!loading && error && (
        <p role="alert" style={REFUSAL}>
          This vendor’s contacts could not be read, so nothing is shown — that is
          not the same as this vendor having none. {error}{' '}
          <button
            type="button"
            onClick={onReload}
            style={{
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--seal-deep, #14515C)',
              textDecoration: 'underline',
            }}
          >
            Try again
          </button>
        </p>
      )}

      {!loading && !error && contacts && contacts.length === 0 && (
        <p style={{ ...BODY, margin: 0 }}>
          No contacts are recorded for {providerName}. A text needs a number that
          somebody has said is a mobile.
        </p>
      )}

      {!loading && !error && contacts && contacts.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {contacts.map((c) => (
            <li
              key={c.id}
              style={{ padding: '8px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span style={{ ...BODY, color: 'var(--ink-1, #211C16)' }}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ''}
                </span>
                <ReachChip reach={c.reach} stated={c.phoneTypeStated} reduced={reduced} />
              </div>

              {/* The server's own sentence. Never re-worded here. */}
              {c.reachSays && (
                <p style={{ ...BODY, fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '2px 0 0' }}>
                  {c.reachSays}
                </p>
              )}

              {c.phone && (
                <label
                  style={{
                    ...BODY,
                    fontSize: 11.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: '0.11em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-3, #7C7365)',
                    }}
                  >
                    Type of line
                  </span>
                  <select
                    aria-label={`Type of line for ${c.name}`}
                    disabled={saving === c.id}
                    value={c.phoneTypeStated ? (c.phoneType ?? '') : ''}
                    onChange={(e) => {
                      if (e.target.value) onSetPhoneType(c.id, e.target.value);
                    }}
                    style={{
                      ...FIELD,
                      opacity: saving === c.id ? 0.55 : 1,
                      cursor: saving === c.id ? 'progress' : 'pointer',
                    }}
                  >
                    {/* The empty option is the honest starting state for a row
                        nobody has answered — including one carrying the
                        column's own `main_line` default. */}
                    <option value="">Nobody has said</option>
                    {PHONE_TYPE_CHOICES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The write is in flight: said, not only dimmed. */}
      {saving && (
        <p role="status" style={{ ...BODY, fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '6px 0 0' }}>
          Saving the type of line{savingName ? ` for ${savingName}` : ''}…
        </p>
      )}

      {saveError && (
        <p role="alert" style={REFUSAL}>
          That was not saved, so the book still holds what it held: {saveError}
        </p>
      )}
    </section>
  );
}

export function ContactsSection({ providerId, providerName }: Props) {
  const { contacts, loading, error, saving, saveError, setPhoneType, reload } =
    useProviderContacts(providerId);

  return (
    <ContactsList
      providerName={providerName}
      contacts={contacts}
      loading={loading}
      error={error}
      saving={saving}
      saveError={saveError}
      onSetPhoneType={(id, type) => void setPhoneType(id, type)}
      onReload={reload}
    />
  );
}

export default ContactsSection;
