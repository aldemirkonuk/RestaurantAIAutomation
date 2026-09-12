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
 */

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
  color: 'var(--ink-2, #4A4238)',
};

/**
 * The chip reads BOTH facts, and `stated` wins.
 *
 * A row carrying the column's `main_line` default has `reach: 'landline'` and
 * `phoneTypeStated: false`. Showing it as "Not textable" would be a verdict on
 * a question nobody answered — true about what we would do, false about what we
 * know. "Not stated" is the honest headline, and the server's own sentence
 * below it carries the rest.
 */
function ReachChip({
  reach,
  stated,
}: {
  reach: string | undefined;
  stated: boolean | undefined;
}) {
  const tone =
    stated === false
      ? { bg: 'var(--warn-bg, #FBF0DA)', fg: 'var(--warn-ink, #7A5A17)', text: 'Not stated' }
      : reach === 'mobile'
        ? { bg: 'var(--ok-bg, #E6F2E9)', fg: 'var(--ok-ink, #1F5B34)', text: 'Textable' }
        : reach === 'landline'
          ? { bg: 'var(--paper-2, #EAE4D8)', fg: 'var(--ink-3, #7C7365)', text: 'Not textable' }
          : { bg: 'var(--warn-bg, #FBF0DA)', fg: 'var(--warn-ink, #7A5A17)', text: 'Not stated' };
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        background: tone.bg,
        color: tone.fg,
        padding: '2px 6px',
        borderRadius: 3,
      }}
    >
      {tone.text}
    </span>
  );
}

export function ContactsSection({ providerId, providerName }: Props) {
  const { contacts, loading, error, saving, saveError, setPhoneType, reload } =
    useProviderContacts(providerId);

  return (
    <section>
      <h3 style={LABEL}>Numbers on file</h3>

      {loading && <p style={BODY}>Reading {providerName}’s contacts…</p>}

      {/* A FAILED READ IS NOT AN EMPTY BOOK. */}
      {!loading && error && (
        <p style={{ ...BODY, color: 'var(--warn-ink, #7A5A17)' }}>
          This vendor’s contacts could not be read, so nothing is shown — that is
          not the same as this vendor having none. {error}{' '}
          <button
            type="button"
            onClick={reload}
            style={{ ...BODY, textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
          >
            Try again
          </button>
        </p>
      )}

      {!loading && !error && contacts && contacts.length === 0 && (
        <p style={BODY}>
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
                <ReachChip reach={c.reach} stated={c.phoneTypeStated} />
              </div>

              {/* The server's own sentence. Never re-worded here. */}
              {c.reachSays && (
                <p style={{ ...BODY, fontSize: 11.5, marginTop: 2 }}>{c.reachSays}</p>
              )}

              {c.phone && (
                <label
                  style={{ ...BODY, fontSize: 11.5, display: 'block', marginTop: 4 }}
                >
                  <span style={{ marginRight: 6 }}>Type of line</span>
                  <select
                    aria-label={`Type of line for ${c.name}`}
                    disabled={saving === c.id}
                    value={c.phoneTypeStated ? (c.phoneType ?? '') : ''}
                    onChange={(e) => {
                      if (e.target.value) void setPhoneType(c.id, e.target.value);
                    }}
                    style={{ ...BODY, fontSize: 11.5, padding: '2px 4px' }}
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

      {saveError && (
        <p style={{ ...BODY, color: 'var(--warn-ink, #7A5A17)', marginTop: 6 }}>
          That was not saved, so the book still holds what it held: {saveError}
        </p>
      )}
    </section>
  );
}

export default ContactsSection;
