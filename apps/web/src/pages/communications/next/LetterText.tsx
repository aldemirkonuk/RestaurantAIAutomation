/**
 * A letter's words in a Mail thread (r41 mail audit, gap 3): the letter's own
 * words, and the earlier letters it quotes folded behind one button that says
 * how many lines it holds. The quoted text is drawn only once opened, so a
 * long thread no longer lays out every earlier letter again under each reply.
 * The rule for where the cut falls is in quoted-history.ts.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { quotedToggleWords, splitQuotedHistory } from './quoted-history';

const WORDS: CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const TOGGLE: CSSProperties = {
  justifySelf: 'start',
  background: 'none',
  border: 'none',
  padding: '2px 0',
  font: 'inherit',
  fontSize: 11.5,
  color: 'var(--ink-3, #7C7365)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
};

export function LetterText({ text }: { text: string }) {
  const split = useMemo(() => splitQuotedHistory(text), [text]);
  const [open, setOpen] = useState(false);
  if (split.quoted === null) {
    return <p style={WORDS}>{text}</p>;
  }
  return (
    <>
      <p style={WORDS}>{split.said}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={TOGGLE}>
        {quotedToggleWords(open, split.quotedLines)}
      </button>
      {open && (
        <p data-testid="letter-quoted" style={{ ...WORDS, color: 'var(--ink-3, #7C7365)' }}>
          {split.quoted}
        </p>
      )}
    </>
  );
}
