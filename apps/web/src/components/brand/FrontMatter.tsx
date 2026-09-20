import { forwardRef } from 'react'

/**
 * The front matter behind /login's endpaper — the Easter egg the founder
 * approved on 2026-09-19 (sketch 118 `front-matter.html`, Direction 1: "Book
 * is great"). Turning the endpaper back shows what a book shows before its
 * first page: the inside cover's epigraph, and a short poem about the book
 * the house keeps.
 *
 * Every line claims only what the product does today: it reads supplier
 * invoices, keeps the count, notices price creep and low stock, drafts
 * replies but sends nothing until a person approves, and seals each approval
 * with who, when and how much. Nothing here forecasts, pays, or closes a day.
 */

/** The inside front cover: the word the product is named for. */
export function InsideCover({ className }: { className?: string }) {
  return (
    <span className={className ? `mdv-ep-cover-card ${className}` : 'mdv-ep-cover-card'}>
      <span className="mdv-ep-cover-word" lang="tr">
        müdavim
      </span>
      <span className="mdv-ep-cover-rule" aria-hidden="true" />
      <span className="mdv-ep-cover-def">
        <span className="mdv-ep-cover-pos">(n.)</span> the regular. The one the house knows by name, and keeps a place
        for.
      </span>
    </span>
  )
}

const STANZAS: { lines: { text: string; indent?: boolean }[]; closing?: boolean }[] = [
  {
    lines: [
      { text: 'Not the one on the shelf —' },
      { text: 'the one kept in the walk-in at six,' },
      { text: 'on the back of a delivery slip,' },
      { text: 'in your head at closing.' },
      { text: 'What came in the door. What is still in the cellar.' },
    ],
  },
  {
    lines: [
      { text: 'Mudavym keeps that book.' },
      { text: 'It reads the invoice, keeps the count,' },
      { text: 'notices the price that crept, the bottle running low.' },
      { text: 'It drafts the reply, and sends nothing' },
      { text: 'until a hand says yes —', indent: true },
      { text: 'and every yes is sealed: who, when, how much.' },
    ],
  },
  { lines: [{ text: 'You keep the room. We keep the book.' }], closing: true },
]

export interface FrontMatterPoemProps {
  id: string
  /** Turns the book back to the sign-in leaf. */
  onBack: () => void
}

/**
 * The front-matter page: one title, three stanzas, one way back. The title
 * takes focus when the page lands (tabIndex -1), so a screen reader starts
 * reading where the eye does.
 */
export const FrontMatterPoem = forwardRef<HTMLHeadingElement, FrontMatterPoemProps>(function FrontMatterPoem(
  { id, onBack },
  titleRef,
) {
  return (
    <section className="mdv-ep-poem" aria-labelledby={`${id}-title`}>
      <InsideCover className="mdv-ep-cover-card--inline" />
      <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="mdv-ep-poem-title">
        Every house keeps a book.
      </h2>
      {STANZAS.map((stanza, i) => (
        <p key={i} className={stanza.closing ? 'mdv-ep-stanza mdv-ep-stanza--closing' : 'mdv-ep-stanza'}>
          {stanza.lines.map((line) => (
            <span key={line.text} className={line.indent ? 'mdv-ep-line mdv-ep-line--in' : 'mdv-ep-line'}>
              {line.text}
            </span>
          ))}
        </p>
      ))}
      <p className="mdv-ep-poem-back">
        <button type="button" onClick={onBack}>
          Turn back to sign in →
        </button>
      </p>
    </section>
  )
})
