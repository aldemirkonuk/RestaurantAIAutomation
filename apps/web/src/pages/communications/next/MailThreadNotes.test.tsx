/**
 * r110 mail-gap g5: the rules under a thread's notes. Where a note sits among
 * the letters, what its label says, the fade it takes, and how a poll of the
 * newest page keeps the notes its held letters sit between. Drawn for real in
 * MailThread.notes.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { MAIL_MOTION_CSS } from './mail-motion';
import { mergeThreadHead } from './mail-merge';
import { noteLabel, withNotes } from './MailThreadNotes';
import type { MailMessage, MailThreadNote, MailThreadPage } from './mail-format';

const note = (id: string, at: string, over: Partial<MailThreadNote> = {}): MailThreadNote => ({
  id, body: `note ${id}`, createdAt: at, writtenBy: { id: 'u-ayse', name: 'Ayşe' }, mine: false, ...over,
});
const inbound = { id: 'in1', direction: 'inbound', sentAt: null } as unknown as MailMessage;
const page = { key: 'gm:t1', subject: null, person: null, order: null } as unknown as MailThreadPage;

describe('the rules under it', () => {
  it('the fade is opacity over 180 ms on the house curve, and none under reduced motion', () => {
    expect(MAIL_MOTION_CSS).toContain('.mail-note-in { animation: mail-fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both }');
    const reduced = MAIL_MOTION_CSS.slice(MAIL_MOTION_CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.mail-note-in[^}]*animation: none !important/);
  });

  it('a note at a letter\'s own time goes after it; a fold is timed by its first letter', () => {
    const rows = [{ t: '2026-11-27T09:00:00Z' }, { t: '2026-11-27T11:00:00Z' }];
    const out = withNotes(rows, (r) => r.t, [note('late', '2026-11-27T23:00:00Z'), note('same', '2026-11-27T11:00:00Z'), note('early', '2026-11-27T08:00:00Z')]);
    expect(out.map((i) => (i.kind === 'note' ? i.n.id : i.r.t))).toEqual(['early', '2026-11-27T09:00:00Z', '2026-11-27T11:00:00Z', 'same', 'late']);
    expect(noteLabel(note('x', '2026-11-27T08:00:00Z', { writtenBy: { id: 'u', name: '  ' } }))).toBe('Note from someone in the house · not sent');
  });

  it('a poll of the newest page keeps the held notes its letters still sit between', () => {
    const at = (h: number) => `2026-11-27T${String(h).padStart(2, '0')}:00:00Z`;
    const l = (id: string, h: number) => ({ ...inbound, id, receivedAt: at(h), createdAt: at(h) });
    const held = { pages: [{ ...page, messages: [l('a', 8), l('b', 10)], before: null, notes: [note('old', at(9)), note('gone', at(11))] }], pageParams: [null] } as never;
    const fresh = { ...page, messages: [l('b', 10), l('c', 12)], before: 'cursor', notes: [note('new', at(13))] } as unknown as MailThreadPage;
    const merged = mergeThreadHead(held, fresh)!;
    // "old" sits before the fresh page's oldest letter and stays; "gone" was in the fresh window and is not there.
    expect(merged.pages[0]!.notes!.map((n) => n.id)).toEqual(['old', 'new']);
    const whole = mergeThreadHead(held, { ...fresh, before: null })!;
    expect(whole.pages[0]!.notes!.map((n) => n.id)).toEqual(['new']);
  });
});
