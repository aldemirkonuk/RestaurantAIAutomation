import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ShellSkeleton } from './ShellSkeleton';

const css = readFileSync(resolve(__dirname, 'house-page-loader.css'), 'utf8');
const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

describe('ShellSkeleton', () => {
  it('is a sidebar and a title bar, hidden from assistive tech', () => {
    render(<ShellSkeleton />);
    const el = screen.getByTestId('shell-skeleton');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.mdv-shellskel__side')).toBeTruthy();
    expect(el.querySelector('.mdv-shellskel__title')).toBeTruthy();
  });

  it('its fade is switched off under prefers-reduced-motion', () => {
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.mdv-shellskel\s*\{\s*animation:\s*none/);
  });

  it('animates opacity only', () => {
    const kf = css.slice(css.indexOf('@keyframes mdv-shell-in'));
    expect(kf.slice(0, kf.indexOf('@media'))).not.toMatch(/width|height|top|left|margin|padding/);
  });
});

describe('index.html boot frame', () => {
  it('paints a frame beside #root, hidden once #root has content, before any script, with a reduced-motion off switch', () => {
    // #root stays exactly empty (the SEO build fills it); the frame follows it
    // and shows only while it is empty.
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/#root:not\(:empty\) \+ #boot-shell \{ display: none/);
    expect(html).toMatch(/prefers-reduced-motion: reduce\) \{ #boot-shell \{ animation: none/);
  });
  it('has a charcoal variant so a dark house never flashes paper', () => {
    expect(html).toMatch(/data-mudavym-ground="charcoal"\] #boot-shell \{ background: #15130f/);
  });
});

describe('index.html boot frame matches the route', () => {
  // The frame script is an inline <script id="boot-frame"> in the head. Run it
  // against a fake document/location, the way the browser would before paint.
  const script = /<script id="boot-frame">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const frameFor = (pathname: string): string | null => {
    const attrs: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
    new Function('document', 'location', script)(doc, { pathname });
    return attrs['data-boot-frame'] ?? null;
  };

  it('has the frame script', () => {
    expect(script.length).toBeGreaterThan(0);
  });
  it.each(['/login', '/register', '/get-started', '/verify-email', '/forgot-password', '/reset-password', '/invite/abc123', '/no-access', '/register/', '/login?next=%2Fhouse'.split('?')[0]])(
    '%s gets the auth frame (no sidebar)',
    (p) => {
      expect(frameFor(p)).toBe('auth');
    },
  );
  it.each(['/', '/house', '/house/menu', '/reports', '/inventory', '/logins-report', '/registered', '/get-started-guide'])(
    '%s keeps the signed-in sidebar frame',
    (p) => {
      expect(frameFor(p)).toBeNull();
    },
  );
  it('the auth frame hides the sidebar column and centres the title bar', () => {
    expect(html).toMatch(/html\[data-boot-frame="auth"\] #boot-shell \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(html).toMatch(/html\[data-boot-frame="auth"\] #boot-shell \.s \{ display: none/);
    expect(html).toMatch(/html\[data-boot-frame="auth"\] #boot-shell \.t \{[^}]*margin: [^;}]*auto/);
  });
});
