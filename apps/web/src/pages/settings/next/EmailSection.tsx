/**
 * Email sign-off — the name every vendor letter ends with.
 *
 * THE DATE THIS ROW SHOWS, AND WHY IT USED TO BE AN EM DASH
 * ---------------------------------------------------------
 * The gateway returns this row through `TemplateResponseDto`, which is
 * camelCase (`restaurant-templates.service.ts:110-121` — `updatedAt: row.updated_at`),
 * and `apiClient` has no case-converting response interceptor
 * (`services/api/client.ts:82-110`). The first pass read `row.updated_at`, which
 * is `undefined` on every real response, so the em dash fired unconditionally
 * and reported a present date as absent — a fabricated *absence*, which ADR 0020
 * forbids for the same reason it forbids a fabricated figure (audit BLOCKER 5).
 * `senderUpdatedAt()` reads both spellings and prefers the one the gateway
 * actually sends. The underlying column is genuinely maintained:
 * `communication_templates_updated_at BEFORE UPDATE`
 * (baseline_from_production.sql:12041).
 *
 * The test send is the other substance: it goes to the gateway's configured
 * manager recipients, not to the name in the field, and the row says so.
 */

import { useEffect, useState } from 'react';
import { Action, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, SANS } from './st-format';
import { PROVENANCE_UNKNOWN } from './st-format';
import { senderUpdatedAt, type SettingsNextData } from './useSettingsNextData';

export function EmailSection({ data }: { data: SettingsNextData }) {
  const { sender, saveSender, sendTestEmail, writer } = data;
  const [draft, setDraft] = useState<string | null>(null);
  const stored = sender.data?.body ?? '';
  const value = draft ?? stored;
  const dirty = value.trim() !== stored;

  useEffect(() => { setDraft(null); }, [sender.data?.id]);

  return (
    <Register remote={sender} name="the sign-off on file">
      {(row) => (
        <>
          <Row
            label="Sign-off name"
            provenance={{
              kept: 'restaurant',
              when: senderUpdatedAt(row),
              whenUnknown: row ? 'this row carries no changed-at date' : 'nothing is on file yet',
            }}
            consequence={
              <>
                Every outbound vendor email ends “Best regards, {value.trim() || <span>{EM} nobody</span>}”. The gateway
                substitutes it at send time in place of the old “[Manager Name]” placeholder — so an empty field is not a
                neutral default, it is a letter signed by nobody.
              </>
            }
          >
            <form
              onSubmit={(e) => { e.preventDefault(); void saveSender(value); }}
              style={{ display: 'flex', gap: 8, marginTop: 10, maxWidth: 420 }}
            >
              <label htmlFor="st-sender" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Sign-off name
              </label>
              <input
                id="st-sender"
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="The name vendors should see"
                className="st-focus"
                style={{ ...fieldStyle, flex: 1, fontSize: 13, padding: '7px 10px' }}
              />
              <Action type="submit" disabled={!dirty || writer.busy === 'sender'}>
                {writer.busy === 'sender' ? 'Saving…' : 'Save'}
              </Action>
            </form>
          </Row>

          <Row
            label="Test the email pipeline"
            provenance={{ kept: 'restaurant', when: null, whenUnknown: PROVENANCE_UNKNOWN.testSend }}
            consequence="Sends one message through the real pipeline to the gateway's configured manager recipients — not to the sign-off name above, and not to you unless you are one of them."
            control={
              <Action onClick={() => void sendTestEmail()} disabled={writer.busy === 'test-email'}>
                {writer.busy === 'test-email' ? 'Sending…' : 'Send a test'}
              </Action>
            }
          />

          <SaveFailure failed={writer.failed} what="Nothing was changed or sent." />
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '12px 0 0' }}>
            The date above is the template row’s own, kept by the database on every write
            (<code>communication_templates_updated_at</code>). It does not say <em>who</em> wrote it — no table behind
            this page does.
          </p>
        </>
      )}
    </Register>
  );
}

export default EmailSection;
