/**
 * Guard: no text in apps/web/src is set below 11 px.
 *
 * The 2026-11-18 design walk measured 122 text nodes under 11 px on /orders, 66
 * on /team (13 under 9 px) and 27 on the dashboard. A floor worker reads these
 * at arm's length on a phone. The scanner (tools/typeFloor.mjs) finds Tailwind
 * `text-[Npx]`, CSS `font-size` in px or rem, and inline `fontSize`. Files that
 * still carry sites are listed with a ceiling in tools/typeFloor.allowlist.json:
 * a file may go down, never up, and an unlisted file may carry none.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM tool, shared with the codemod CLI
import { lift, readAllowlist, scan, sitesIn, violations } from '../../tools/typeFloor.mjs'

describe('type floor', () => {
  it('no file goes over its ceiling, and no unlisted file sits under 11px', () => {
    const bad = violations(scan(), readAllowlist())
    expect(
      bad,
      bad.map((b: { file: string; found: number; allowed: number }) => `${b.file}: ${b.found} sites under 11px (ceiling ${b.allowed})`).join('\n'),
    ).toEqual([])
  })

  it('sees every spelling of a small size', () => {
    expect(sitesIn('<i className="text-[10px] text-[8.5px]" />', 'a.tsx')).toHaveLength(2)
    expect(sitesIn('a { font-size: 9.5px; }', 'a.css')).toHaveLength(1)
    expect(sitesIn('a { font-size: 0.625rem; }', 'a.css')).toHaveLength(1)
    expect(sitesIn('<i style={{ fontSize: 9 }} />', 'a.tsx')).toHaveLength(1)
    expect(sitesIn("<i style={{ fontSize: '10px' }} />", 'a.tsx')).toHaveLength(1)
  })

  it('lets 11px and larger through', () => {
    expect(sitesIn('text-[11px] text-[12px] text-[1.1rem]', 'a.tsx')).toHaveLength(0)
    expect(sitesIn('a { font-size: 11px; } b { font-size: 0.6875rem; } c { font-size: 14px }', 'a.css')).toHaveLength(0)
    expect(sitesIn('<i style={{ fontSize: 12 }} />', 'a.tsx')).toHaveLength(0)
  })

  it('lifts every site to the floor and leaves the rest alone', () => {
    expect(lift('text-[9px] text-[14px]', 'a.tsx')).toBe('text-[11px] text-[14px]')
    expect(lift('a { font-size: 9.5px; } b { font-size: 0.5rem; }', 'a.css')).toBe(
      'a { font-size: 11px; } b { font-size: 0.6875rem; }',
    )
    expect(lift('{{ fontSize: 8.5 }}', 'a.tsx')).toBe('{{ fontSize: 11 }}')
  })

  it('flags a fresh violation in an unlisted file', () => {
    expect(violations({ 'pages/New.tsx': 1 }, {})).toEqual([{ file: 'pages/New.tsx', found: 1, allowed: 0 }])
    expect(violations({ 'pages/Old.tsx': 3 }, { 'pages/Old.tsx': 3 })).toEqual([])
    expect(violations({ 'pages/Old.tsx': 4 }, { 'pages/Old.tsx': 3 })).toHaveLength(1)
    expect(violations({ 'pages/Old.tsx': 2 }, { 'pages/Old.tsx': 3 })).toEqual([])
  })
})
