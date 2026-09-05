/**
 * Register IV — what may act as you.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE REGISTER IT REPLACES
 * ----------------------------------------------------------
 * With `mudavym_design_connections` on, the model-context DECLARATION register
 * leaves this page for `/connections` (the founder's call of 2026-09-04:
 * "Move the registers and collapse the four tabs"). Every control it carried —
 * declare, probe, set a credential, revoke — is gated at the gateway by
 * `assertCanManageRestaurant` (`mcp-connections.controller.ts:150`, `:174`,
 * `:188`, `:203`), so all four are manager actions and belong on the
 * manager-only surface.
 *
 * Exactly one thing in that register was NOT a manager action:
 * `PUT /mcp-connections/:id/consent` (`:218-235`) takes the caller's own id
 * from the token, accepts no user id in any shape, and runs no role check.
 * `/connections` is manager-and-owner only, so if that control had moved with
 * the rest, a staff member would have lost the only place they could stop a
 * server acting in their name — and gained nowhere to do it. Absence of a
 * control is not the same as a refusal, and it would have read as consent.
 *
 * So the register splits along the line ADR 0114 §2 already drew: the house
 * declares (that moved), each person consents (this stayed). This is also the
 * "reciprocal obligation" `profile.md` §13a names — one list, two owners
 * marked, revoke where the owner is.
 *
 * MEASURED, NOT ASSUMED
 * ---------------------
 * `/profile`'s model-context register never had a consent control at all
 * before this pass — the wire has carried `consent` since ADR 0114 and this
 * page did not model it. So this is not a copy of something that moved; it is
 * a hole that the move made visible and closes.
 *
 * HONESTY
 * -------
 *   - A gateway that does not send `consent` leaves it undefined, and the row
 *     says the register did not report it. It is never defaulted to `false`,
 *     which would print "you have not agreed" about a question never asked.
 *   - A revoked server is still listed, marked revoked: a consent that once
 *     existed must not become indistinguishable from one that never did.
 *   - An unread register says so and offers a retry; it never renders as an
 *     empty list.
 */

import { useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { EM, MONO, SANS, fmtDay } from './pf-format';
import { Btn, ConnectionRow, Note, Register, RetryLink, StatusLine } from './pf-ui';
import type { McpServerVM, ProfileNextData } from './useProfileNextData';

/** How many people, in words a row can carry. */
function others(liveCount: number, mine: boolean): string {
  const rest = Math.max(0, liveCount - (mine ? 1 : 0));
  if (rest === 0) return 'Nobody else here has agreed.';
  if (rest === 1) return 'One other person here has agreed.';
  return `${rest} other people here have agreed.`;
}

export function ConsentRegister({ data }: { data: ProfileNextData }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  const servers = data.mcpServers;
  const set = async (s: McpServerVM, given: boolean) => {
    setMsg(null);
    setBusy(s.id);
    try {
      await data.setMcpConsent(s.id, given);
      setMsg({
        tone: 'done',
        text: given
          ? `${s.name} may now act in your name. Nobody else's agreement changed, and the house's attachment was untouched.`
          : `${s.name} will no longer act in your name. The house keeps the attachment, and everyone else keeps their own agreement.`,
      });
    } catch (e) {
      setMsg({
        tone: 'error',
        text: `Nothing changed — ${String((e as Error).message)}`,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Register
      eyebrow="Register IV"
      icon={<ShieldQuestion size={13} aria-hidden />}
      title="What may act as you"
      lead={
        <Note>
          The house declares which model-context servers it attaches; you decide,
          one by one, whether any of them may act in <em>your</em> name. Nothing
          here is a manager&rsquo;s to give or take away — withdrawing touches
          neither the house&rsquo;s attachment nor anybody else&rsquo;s agreement.
        </Note>
      }
    >
      {data.mcpState === 'loading' && <Note>Reading what the house has declared…</Note>}

      {data.mcpState === 'error' && (
        <StatusLine tone="error">
          The register could not be read ({data.mcpError}). This is an unread
          register, not an empty one — no server below is being claimed either
          way, and nothing is being said about what you have agreed to.{' '}
          <RetryLink onClick={data.refetchMcp} />
        </StatusLine>
      )}

      {data.mcpState === 'idle' && (
        <Note>No restaurant is active on this session, so there is no register to address.</Note>
      )}

      {data.mcpState === 'ok' && servers.length === 0 && (
        <Note>
          This house has declared no model-context server, so there is nothing
          for you to agree to. That is the register reporting nothing, not the
          register failing to answer.
        </Note>
      )}

      {servers.map((s) => {
        const c = s.consent;
        const revoked = s.status === 'revoked';
        return (
          <ConnectionRow
            key={s.id}
            title={s.name}
            subtitle={
              <span style={{ fontFamily: MONO, fontSize: 11.5, wordBreak: 'break-all' }}>
                {s.url}
              </span>
            }
            state={c === undefined ? 'unknown' : c.given ? 'connected' : 'available'}
            reason={
              c === undefined
                ? 'The register did not report whether you have agreed, so nothing is claimed either way. It is not a "no".'
                : revoked
                  ? `Revoked ${fmtDay(s.revokedAt)} by the house. It can act for nobody, whatever anyone agreed to.`
                  : c.given
                    ? `You agreed ${fmtDay(c.at)}. ${others(c.liveCount, true)}`
                    : `You have not agreed, so it will not run a tool for you. ${others(c.liveCount, false)}`
            }
            controls={
              c !== undefined && !revoked ? (
                <Btn
                  emphasis={c.given ? 'quiet' : 'seal'}
                  onClick={() => void set(s, !c.given)}
                  disabled={busy === s.id}
                >
                  {busy === s.id
                    ? c.given
                      ? 'Withdrawing…'
                      : 'Agreeing…'
                    : c.given
                      ? 'Withdraw my agreement'
                      : 'Agree'}
                </Btn>
              ) : undefined
            }
          />
        );
      })}

      {msg && <StatusLine tone={msg.tone}>{msg.text}</StatusLine>}

      <p style={{ margin: '10px 0 0', fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
        {data.isManagerOrOwner ? (
          <>
            Declaring a server, giving it a credential, checking it and revoking
            it are the house&rsquo;s acts, and they are on{' '}
            <a href="/connections#servers" style={{ color: 'var(--seal-deep)' }}>
              Connections
            </a>
            .
          </>
        ) : (
          <>
            Only managers and owners declare or revoke a server; the gateway
            refuses those writes for every other role. What is above is yours,
            and it is the whole of your say in it.
          </>
        )}{' '}
        {data.mcpRuntime
          ? data.mcpRuntime.invocation.reason
          : `${EM} — this deployment did not report whether a tool may be called at all, so nothing is claimed about it.`}
      </p>
    </Register>
  );
}

export default ConsentRegister;
