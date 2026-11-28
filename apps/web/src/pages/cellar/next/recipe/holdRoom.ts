/**
 * The room a drink's panel holds, opened from a link, while its list and its
 * recipe are still being read: the screen's height less the shell's header. A
 * page this tall already has what sits under the panel (the other books, the
 * signature) below the fold, so it is not dragged down the screen when the
 * reads land. Opened by a click, the panel holds nothing: the person's own act
 * is not a layout shift.
 */
export const SHEET_HOLD_ROOM = 'calc(100vh - 56px)';
