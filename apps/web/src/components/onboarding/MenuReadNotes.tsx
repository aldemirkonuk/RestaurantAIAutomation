import type { MenuReadNote } from '../../services/api/menus'

const FIELD_WORDS: Record<string, string> = {
  bottle_price: 'bottle price',
  by_glass_price: 'glass price',
}

/** One note in the house's words: which line, what was left out, and why. A workbook's note names its sheet. */
export function menuReadNoteText(n: MenuReadNote): string {
  const text = lineNoteText(n)
  if (!n.sheet) return text
  return text.startsWith('Line ') ? `Sheet "${n.sheet}", line ${text.slice(5)}` : `Sheet "${n.sheet}": ${text}`
}

function lineNoteText(n: MenuReadNote): string {
  const field = FIELD_WORDS[n.field ?? ''] ?? (n.field ?? 'value').replace(/_/g, ' ')
  const raw = n.raw ? `"${n.raw}"` : ''
  switch (n.reason) {
    case 'two_readings':
      return `Line ${n.row}: the ${field} ${raw} reads two ways, so it was left blank. Write 1250, 1.250,00 or 1,250.00.`
    case 'negative':
      return `Line ${n.row}: the ${field} ${raw} is below zero, so it was left blank.`
    case 'too_large':
      return `Line ${n.row}: the ${field} ${raw} is more than a price can be (99,999,999.99), so it was left blank.`
    case 'too_precise':
      return `Line ${n.row}: the ${field} ${raw} has more than two decimal places, so it was left blank, not rounded.`
    case 'no_number':
      return `Line ${n.row}: the ${field} ${raw} has no number, so it was left blank.`
    case 'unreadable':
      return `Line ${n.row}: the ${field} ${raw} could not be read as a price, so it was left blank.`
    case 'cell_error':
      return `Line ${n.row}: the ${field} is a spreadsheet error (${n.raw ?? 'error'}), so it was left blank.`
    case 'same_file':
      return n.raw === 'active'
        ? 'This file is the same one the current menu was read from. A second copy of that menu was kept; the house keeps its current menu until you choose another.'
        : 'This file is the same as a menu already kept. A second copy of that menu was kept.'
    case 'same_file_unchecked':
      return 'Whether this file was read before could not be checked, so it was read as new.'
    case 'no_name':
      return `Line ${n.row} has no name, so it was not read.`
    case 'no_name_column':
      return 'No column was read as the name (Name, Wine, Ad, Şarap), so no line was read.'
    case 'price_column_not_read':
      return `The column ${raw} was not read: name it Bottle price / Şişe fiyatı or Glass price / Kadeh fiyatı.`
    case 'price_column_read_as_bottle':
      // r28 G8: the bare price column is read, as each line's one price.
      return `The column ${raw} was read as each line's price: a drink's bottle price, a dish's price. If it holds glass prices, name it Glass price / Kadeh fiyatı and read the file again.`
    default:
      return `Line ${n.row} was not read whole.`
  }
}

const SHOWN = 8

/** What a file read left out, as a short list under the result. Nothing when it left nothing out. */
export function MenuReadNotes({ notes, className }: { notes?: MenuReadNote[]; className?: string }) {
  if (!notes?.length) return null
  const rest = notes.length - SHOWN
  return (
    <div className={className} data-testid="menu-read-notes">
      <p>Left out or left blank:</p>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
        {notes.slice(0, SHOWN).map((n, i) => (
          <li key={i}>{menuReadNoteText(n)}</li>
        ))}
        {rest > 0 ? <li>and {rest} more.</li> : null}
      </ul>
    </div>
  )
}
