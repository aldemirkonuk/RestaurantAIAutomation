/**
 * The modifier keys this device prints: ⌘ and ⇧ on a Mac (and an iPhone or
 * iPad with a keyboard), Ctrl and Shift everywhere else. One reader, so the
 * header's chord, the shortcut sheet and the palette's Ask row never disagree
 * (F-1355). The keyboard handlers accept meta OR ctrl either way; this is only
 * what the page tells the person to press.
 */
export interface PlatformKeys {
  mod: string;
  shift: string;
}

export function platformKeys(): PlatformKeys {
  if (typeof navigator === 'undefined') return { mod: 'Ctrl', shift: 'Shift' };
  const p = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(p) ? { mod: '⌘', shift: '⇧' } : { mod: 'Ctrl', shift: 'Shift' };
}
