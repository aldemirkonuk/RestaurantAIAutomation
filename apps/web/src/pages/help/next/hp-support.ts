/**
 * hp-support — how `/help` reads its one support channel and what it puts in
 * a message to them. Pure; tested in `hp-support.test.ts`.
 *
 * EMAIL ONLY, NO SLACK (founder, quoted in ADR 0160 §111): *"Always show who
 * to email ... Just emails, no Slack or anything for now."* The shipping
 * legacy page (`pages/Help.tsx:18-20`) also offered a Slack link and fell
 * back to `support@wineops.ai` / `https://wineops.slack.com` when the build
 * variables were unset — a domain the project does not own, rendered as
 * visible text a person would copy into their own mail client. Neither
 * mistake is repeated here: there is exactly one channel, and there is no
 * fallback. An unset `VITE_SUPPORT_EMAIL` is an UNCONFIGURED channel and the
 * page says so in a sentence; a value that is not an address is UNUSABLE and
 * the page shows what it read rather than mailing it. Both are read once, at
 * build time — the page says that too, because changing the address means a
 * redeploy, not a setting.
 *
 * ADR 0143 (2026-09-16/17, row 8) fixes the address itself: `support@mudavym.com`.
 */

export type EmailChannel =
  | { state: 'configured'; address: string }
  | { state: 'unconfigured' }
  | { state: 'unusable'; raw: string; why: string };

export interface SupportEnv {
  VITE_SUPPORT_EMAIL?: string;
}

/** One address, no display name, no comma list — a mailto target, nothing more. */
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function readEmailChannel(raw: string | undefined): EmailChannel {
  const v = (raw ?? '').trim();
  if (!v) return { state: 'unconfigured' };
  if (!EMAIL.test(v)) return { state: 'unusable', raw: v, why: 'not a single mail address' };
  return { state: 'configured', address: v };
}

/** Reads the one channel from whatever `import.meta.env` the caller hands in. */
export function readSupportChannel(env: SupportEnv): EmailChannel {
  return readEmailChannel(env.VITE_SUPPORT_EMAIL);
}

/* ── What a message to support carries ─────────────────────────────────── */

/**
 * Everything is optional and every absence is written as an absence — the
 * block never invents a house, a build or a route it was not given.
 */
export interface DiagnosticsContext {
  houseName?: string | null;
  houseId?: string | null;
  role?: string | null;
  /** The path the person was on when they opened /help, if the router said. */
  cameFrom?: string | null;
  /** The gateway's own readiness answer, when one was measured. */
  gateway?: {
    state: 'ready' | 'not_ready' | 'unreachable' | 'checking';
    commit?: string | null;
    latencyMs?: number | null;
    detail?: string | null;
  } | null;
  userAgent?: string | null;
  href?: string | null;
  at?: Date;
}

function line(label: string, value: string | null | undefined): string {
  return `${label}: ${value && value.trim() ? value.trim() : 'not recorded'}`;
}

/** The plain-text block a person can paste anywhere; also the mail body. */
export function diagnosticsBlock(ctx: DiagnosticsContext): string {
  const at = ctx.at ?? new Date();
  const g = ctx.gateway;
  const gatewayLine = !g
    ? 'not checked'
    : g.state === 'checking'
      ? 'check still in flight'
      : g.state === 'unreachable'
        ? `unreachable${g.detail ? ` — ${g.detail}` : ''}`
        : `${g.state === 'ready' ? 'ready' : 'up but not ready'}${
            g.detail ? ` — ${g.detail}` : ''
          }${typeof g.latencyMs === 'number' ? `, answered in ${Math.round(g.latencyMs)} ms` : ''}`;
  return [
    'Mudavym — what support will need',
    line('House', ctx.houseName),
    line('House id', ctx.houseId),
    line('Role', ctx.role),
    line('Came from', ctx.cameFrom),
    line('Page', ctx.href),
    `Gateway: ${gatewayLine}`,
    line('Gateway build', g && g.state !== 'unreachable' && g.state !== 'checking' ? g.commit : null),
    line('Browser', ctx.userAgent),
    `Written: ${at.toISOString()}`,
  ].join('\n');
}

/**
 * The subject line every message to support carries. Its own function, not
 * inlined into `buildSupportMailto`, so the write-to-support panel (ADR 0112
 * Panel shape, `SupportPanel.tsx`) can show the same subject before the mail
 * app opens without decoding it back out of a `mailto:` URL.
 */
export function supportSubject(houseName: string | null | undefined): string {
  const house = houseName && houseName.trim() ? houseName.trim() : 'a house';
  return `Mudavym support — ${house}`;
}

/** `mailto:` with the subject and the diagnostics block prefilled. */
export function buildSupportMailto(address: string, ctx: DiagnosticsContext): string {
  const subject = supportSubject(ctx.houseName);
  const body = `\n\n---\n${diagnosticsBlock(ctx)}\n`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
