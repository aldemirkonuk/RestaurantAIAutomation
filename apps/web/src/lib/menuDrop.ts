import { isPhoto, pagesProblem, photosToPages } from './menuPhotos'
import { isScannable, isTabular, validateSelection } from './uploadAccept'

/**
 * What the first-menu drop zone does with what was dropped (r105, onboarding
 * g4). It used to read only the first file, send it raw (a phone photo over
 * the 15 MB body came back as a generic error) and, for a PDF, open the file
 * panel and drop the file. Now every dropped file is looked at:
 * - all photos: each is redrawn as a JPEG that fits and they go up as one menu;
 * - anything else (a PDF, a sheet), or a mix: the file reader takes them all;
 * - nothing usable: the refusal says why, in words.
 */
export type DroppedMenu =
  | { kind: 'pages'; pages: string[] }
  | { kind: 'files'; files: File[] }
  | { kind: 'refused'; words: string }

export async function readDroppedMenu(dropped: File[]): Promise<DroppedMenu> {
  // A photo is redrawn smaller below, so its raw weight is no reason to turn
  // it away; a PDF or a sheet is sent as it is and keeps the size limit.
  const photos = validateSelection(dropped.filter(isPhoto), {
    maxBytes: Number.POSITIVE_INFINITY,
    kindLabel: 'a photo',
  })
  const others = validateSelection(dropped.filter((f) => !isPhoto(f)), {
    accept: (f) => isScannable(f) || isTabular(f),
    kindLabel: 'a photo, PDF, or spreadsheet',
  })
  const accepted = [...photos.accepted, ...others.accepted]
  const errors = [...photos.errors, ...others.errors]
  if (accepted.length === 0)
    return { kind: 'refused', words: errors.join(' ') || 'Drop a photo, a PDF or a spreadsheet of the menu.' }
  if (others.accepted.length > 0) return { kind: 'files', files: [...dropped.filter((f) => accepted.includes(f))] }
  try {
    const pages = await photosToPages(accepted)
    const problem = pagesProblem(pages)
    if (problem) return { kind: 'refused', words: problem }
    return { kind: 'pages', pages }
  } catch (cause) {
    return { kind: 'refused', words: cause instanceof Error ? cause.message : 'We could not read those photos.' }
  }
}
