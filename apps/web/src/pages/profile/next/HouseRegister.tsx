/**
 * Register III — the house you belong to.
 *
 * The one data-loss path on the shipping page lives here. Its restaurant
 * loader falls back to the auth store's cached branch name and city on failure
 * (Profile.tsx:143-146); the form then shows the cache, and Save PATCHes it
 * back over whatever the server actually holds. This build has no fallback: an
 * unread record leaves the fields empty, disabled, and unsaveable, and says so
 * in words.
 *
 * Permission-denied is a rendered state, not a hidden section. A staff member
 * sees the register and one sentence saying who may edit it — hiding it would
 * report absence as health.
 *
 * That sentence is careful about WHOSE choice the hiding is. The write really
 * is manager/owner (`organizations.service.ts:178-187` → `:186`), but the read
 * is not: `getLocation` (`:123-153`) checks organisation membership only. So
 * not fetching the record for staff is this page's decision, and the copy says
 * that instead of crediting the server with a check it does not make. Gap G8.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EM, SANS, isForbidden, roleLabel } from './pf-format';
import { Btn, Card, ConnectionRow, Field, Note, Register, RetryLink, StatusLine } from './pf-ui';
import type { ProfileNextData } from './useProfileNextData';

export function HouseRegister({ data }: { data: ProfileNextData }) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [cityDraft, setCityDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const loc = data.location;
  const readable = data.locationState === 'ok' && loc !== null;
  const name = nameDraft ?? loc?.name ?? '';
  const city = cityDraft ?? loc?.city ?? '';

  const save = async () => {
    if (name.trim().length < 2) {
      setMsg({ tone: 'error', text: 'A restaurant name needs at least two characters.' });
      return;
    }
    setMsg(null);
    setSaving(true);
    try {
      await data.saveRestaurant(name, city);
      setNameDraft(null);
      setCityDraft(null);
      setMsg({ tone: 'done', text: 'Restaurant record updated.' });
    } catch (e) {
      setMsg({
        tone: 'error',
        text: isForbidden(e)
          ? 'The server refused: only managers and owners of this location may change it.'
          : `Not saved — ${String((e as Error).message)}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const switchTo = async (id: string) => {
    setSwitching(id);
    try {
      await data.switchRestaurant(id);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <Register
      eyebrow="Register III"
      title="The house"
      lead={<Note>The location you are working in, and every location you belong to.</Note>}
    >
      {data.isManagerOrOwner ? (
        <Card
          title="Restaurant record"
          lead="The name and city everywhere else in the product reads."
        >
          {data.locationState === 'loading' && <Note>Reading the restaurant record…</Note>}
          {data.locationState === 'error' && (
            <StatusLine tone="error">
              The restaurant record could not be read ({data.locationError}). These fields are left
              empty on purpose — the cached branch name would have looked like an answer, and
              saving it would overwrite the real one.{' '}
              <RetryLink onClick={data.refetchLocation} />
            </StatusLine>
          )}
          <div style={{ marginTop: 10 }}>
            <Field
              id="pf-restaurant-name"
              label="Restaurant name"
              value={name}
              onChange={setNameDraft}
              disabled={!readable}
              placeholder={readable ? undefined : EM}
            />
            <Field
              id="pf-restaurant-city"
              label="City"
              value={city}
              onChange={setCityDraft}
              disabled={!readable}
              placeholder={readable ? undefined : EM}
            />
            <Btn emphasis="seal" onClick={() => void save()} disabled={!readable || saving}>
              {saving ? 'Saving…' : 'Save restaurant'}
            </Btn>
          </div>
          {msg && <StatusLine tone={msg.tone}>{msg.text}</StatusLine>}
        </Card>
      ) : (
        <ConnectionRow
          title="Restaurant record"
          subtitle="The name and city everywhere else in the product reads."
          state="unknown"
          reason={`Managers and owners edit this, and the server does refuse the change for anyone else. Your role here is ${roleLabel(data.role)}, so this page does not fetch the record — that part is this page's choice, not a server rule: the read is open to any member of the organisation.`}
        />
      )}

      <Card
        title="Memberships"
        lead="Restaurants you belong to. Switching changes what every other page shows."
      >
        {data.memberships.length === 0 ? (
          <Note>No memberships yet — nothing has been shared with this account.</Note>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.memberships.map((r) => {
              const active = r.id === data.activeRestaurantId;
              return (
                <li
                  key={r.id}
                  className="pf-row"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 12px',
                    marginBottom: 6,
                    borderRadius: 10,
                    border: `1px solid ${active ? 'var(--seal-ring)' : 'var(--paper-2)'}`,
                    background: active ? 'var(--seal-tint)' : 'var(--paper-0)',
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                      {r.name}
                    </span>
                    <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
                      {r.city || EM}
                      {active ? ` · ${roleLabel(data.role)}` : ''}
                      {r.chain_name ? ` · ${r.chain_name}` : ''}
                    </span>
                  </span>
                  {active ? (
                    <span style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep)' }}>
                      Active
                    </span>
                  ) : (
                    <Btn onClick={() => void switchTo(r.id)} disabled={switching === r.id}>
                      {switching === r.id ? 'Switching…' : 'Switch'}
                    </Btn>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p style={{ margin: '10px 0 0', fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Invitations and roles live in{' '}
          <Link to="/settings?tab=team" style={{ color: 'var(--seal-deep)' }}>
            Settings → Team
          </Link>
          .
        </p>
      </Card>
    </Register>
  );
}

export default HouseRegister;
