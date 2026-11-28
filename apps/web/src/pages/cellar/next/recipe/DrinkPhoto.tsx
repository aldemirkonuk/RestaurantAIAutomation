/**
 * A drink's photo (r110 drinks-g3) on its recipe sheet, its recipe card and
 * the spec book.
 *
 * The frame holds its room from first paint: a 4/3 box, so the image arriving
 * moves nothing (CLS 0). Once the image is decoded it fades in, opacity 0 to 1
 * over 150 ms on cubic-bezier(0.16, 1, 0.3, 1). Reduced motion has no fade at
 * all; the image is simply there once decoded (ADR 0112). There is no exit
 * animation: Remove takes the image away at once.
 *
 * Owners and managers get Add photo, Replace and Remove. The photo is
 * re-encoded here, on a canvas, to WebP at most 1600 px on its long side,
 * with its EXIF orientation applied. A canvas writes no metadata, and the
 * gateway strips any that arrives anyway, so a GPS position never leaves this
 * page.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { recipesApi } from '../../../../services/api/recipes';
import { recipeKey } from './useRecipe';

export const PHOTO_LONG_SIDE = 1600;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PHOTO_NOT_SAVED = 'The photo was not saved. Nothing was changed.';
export const PHOTO_TOO_BIG = 'That photo is over 5 MB. Choose a smaller one.';
export const PHOTO_TOO_LARGE_TO_OPEN = 'That photo is too large to open here. Choose a smaller one.';
/** The gateway's cap, which applies to the re-encoded bytes (a few hundred KB for a phone photo), not the original. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Only a guard on what the browser must decode: a 6 to 15 MB camera JPEG is re-encoded, not refused. */
const MAX_DECODE_BYTES = 40 * 1024 * 1024;

class PhotoTooBig extends Error {}

/** The same picture whether its URL was signed a second ago or a minute ago: the signing token is not the image. */
const photoKey = (url: string) => url.split('?')[0];

/**
 * The held frame and its image. Never lazy, the spec book's included: the card and the book are drawn only for
 * paper (display: none on screen), and a lazy image there is never fetched, so it would print blank.
 */
export function PhotoFrame({ url, alt, testId }: { url: string | null | undefined; alt: string; testId: string }) {
  // Keyed on the stored object, not the signed URL: every read signs a new token, and a refetch must not blank a painted photo.
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className="cl-photo" data-testid={testId}>
      {url ? (
        <img
          src={url}
          alt={alt}
          decoding="async"
          loading="eager"
          data-loaded={loaded === photoKey(url) ? 'true' : 'false'}
          onLoad={() => setLoaded(photoKey(url))}
        />
      ) : null}
    </div>
  );
}

/**
 * Runs `then` once every photo under `root` is decoded (at most `ms`), so paper is not printed before its
 * pictures. A photo that fails or is slow is printed without; the wait never blocks the print.
 */
export function whenPhotosReady(root: ParentNode | null, then: () => void, ms = 8000): void {
  const imgs = root ? [...root.querySelectorAll<HTMLImageElement>('.cl-photo img')] : [];
  // No photo: paper goes at once, as it did before photos.
  if (imgs.length === 0) return then();
  const all = Promise.all(imgs.map((i) => (typeof i.decode === 'function' ? i.decode().catch(() => undefined) : undefined)));
  void Promise.race([all, new Promise<void>((res) => setTimeout(res, ms))]).then(then);
}

/** Longest side at most 1600 px, orientation applied, WebP; where the browser cannot write WebP (it hands back PNG) JPEG at 0.85. Throws PhotoTooBig over the gateway's 5 MB. */
export async function reencodePhoto(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, PHOTO_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  if (blob && blob.type !== 'image/webp') blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('not encoded');
  if (blob.size > MAX_BYTES) throw new PhotoTooBig();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Add photo / Replace / Remove, for an owner or manager. */
export function PhotoControls({ cocktailId, hasPhoto }: { cocktailId: string; hasPhoto: boolean }) {
  const { activeRestaurantId } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: recipeKey(activeRestaurantId, cocktailId) });

  const choose = async (file: File | undefined) => {
    if (!file || !activeRestaurantId) return;
    setSaid(null);
    if (file.size > MAX_DECODE_BYTES) {
      setSaid(PHOTO_TOO_LARGE_TO_OPEN);
      return;
    }
    setBusy(true);
    try {
      await recipesApi.putPhoto(activeRestaurantId, cocktailId, await reencodePhoto(file));
      await done();
    } catch (e) {
      setSaid(e instanceof PhotoTooBig ? PHOTO_TOO_BIG : PHOTO_NOT_SAVED);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!activeRestaurantId) return;
    setSaid(null);
    setBusy(true);
    try {
      await recipesApi.removePhoto(activeRestaurantId, cocktailId);
      await done();
    } catch {
      setSaid(PHOTO_NOT_SAVED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cl-photo-controls" data-testid="photo-controls">
      <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => input.current?.click()} data-testid="photo-add">
        {hasPhoto ? 'Replace photo' : 'Add photo'}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        disabled={busy}
        data-testid="photo-input"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {hasPhoto ? (
        <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={remove} data-testid="photo-remove">
          Remove photo
        </button>
      ) : null}
      {said ? (
        <span className="cl-note" role="alert" data-testid="photo-said" style={{ margin: 0 }}>
          {said}
        </span>
      ) : null}
    </div>
  );
}
