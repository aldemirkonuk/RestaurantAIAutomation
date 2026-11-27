/**
 * The house's file drop zone (r58, N-14): a 180 px ruled box instead of the
 * browser's "Choose File / No file chosen". Four states:
 *
 *   idle      a dashed 1.5 px hairline, a page-turn icon, "Drop a menu, a
 *             photo, or a PDF" and a "Choose a file" link
 *   dragging  a file is held over the box: the seal edge, a tint, and the
 *             box breathes (scale 1.01, 1.6 s)
 *   held      the file's thumbnail, name and size; "Change" and "Clear"
 *   reading   the thumbnail settles to a reading state with a three-dot pulse
 *
 * On a touch device the camera is the first thing offered: a full-width 56 px
 * primary button, and photos taken add to the pages already held.
 *
 * The box holds files and tells its host; it reads nothing and decides
 * nothing. The real `<input type="file">` stays in the tree (visually hidden,
 * still labelled), so assistive technology and the browser's own picker work
 * exactly as before.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyArt } from './emptyArt';
import { formatBytes } from '../../lib/uploadAccept';
import './drop-zone.css';

export interface DropZoneProps {
  files: File[];
  /** `replace` for a picked or dropped set; `add` for a photo taken beside the others. */
  onFiles: (files: File[], mode: 'replace' | 'add') => void;
  onClear?: () => void;
  /** The host is reading what is held. */
  reading?: boolean;
  /**
   * Where the read stands. `sending` shows the upload bar (`sent`, 0 to 1);
   * `kept` is the file held by the server, which is reading it: the only stage
   * with the dots, because the gateway reports only reading, done or failed.
   * `reading` (the default) is a host that has no stages.
   */
  stage?: 'sending' | 'kept' | 'reading';
  sent?: number;
  accept: string;
  multiple?: boolean;
  /** The accessible name of the file input. */
  inputLabel: string;
  prompt?: string;
  hint?: string;
  disabled?: boolean;
}

/** Is the primary pointer a finger? Read once and followed. */
export function useCoarsePointer(): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
  const [coarse, setCoarse] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(pointer: coarse)');
    const on = () => setCoarse(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

function Thumb({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') {
      setSrc(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL?.(url);
  }, [file]);
  return src ? (
    <img className="mdv-drop__thumb" src={src} alt="" />
  ) : (
    <span className="mdv-drop__thumb mdv-drop__thumb--doc" aria-hidden>
      {(file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}
    </span>
  );
}

export function DropZone({
  files,
  onFiles,
  onClear,
  reading = false,
  stage = 'reading',
  sent = 0,
  accept,
  multiple = false,
  inputLabel,
  prompt = 'Drop a menu, a photo, or a PDF',
  hint,
  disabled = false,
}: DropZoneProps) {
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const coarse = useCoarsePointer();

  const held = files.length > 0;
  const state = reading && held ? 'reading' : held ? 'held' : dragging ? 'dragging' : 'idle';
  const first = files[0];
  const size = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files]);

  const openPicker = () => {
    if (!disabled) pickRef.current?.click();
  };

  return (
    <div className="mdv-dropwrap">
      {coarse && !held ? (
        <button
          type="button"
          className="mdv-btn mdv-btn--seal mdv-drop__camera"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
        >
          Take a photo of the menu
        </button>
      ) : null}
      <input
        ref={pickRef}
        type="file"
        className="mdv-drop__input"
        multiple={multiple}
        accept={accept}
        aria-label={inputLabel}
        disabled={disabled}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          onFiles(picked, 'replace');
        }}
      />
      <input
        ref={addRef}
        type="file"
        className="mdv-drop__input"
        multiple
        accept={accept}
        aria-label={`${inputLabel}: add pages`}
        disabled={disabled}
        tabIndex={-1}
        onChange={(e) => {
          const added = Array.from(e.target.files ?? []);
          if (added.length) onFiles(added, 'add');
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        className="mdv-drop__input"
        accept="image/*"
        capture="environment"
        aria-label={`${inputLabel}: take a photo`}
        disabled={disabled}
        tabIndex={-1}
        onChange={(e) => {
          const taken = Array.from(e.target.files ?? []);
          if (taken.length) onFiles(taken, 'add');
          e.target.value = '';
        }}
      />
      <div
        className="mdv-drop"
        data-state={state}
        data-disabled={disabled ? 'true' : undefined}
        role="group"
        aria-label="Menu file"
        onDragEnter={(e) => {
          e.preventDefault();
          if (disabled) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (disabled) return;
          const dropped = Array.from(e.dataTransfer?.files ?? []);
          if (dropped.length) onFiles(multiple ? dropped : dropped.slice(0, 1), 'replace');
        }}
      >
        {held && first ? (
          <div className="mdv-drop__held">
            <Thumb file={first} />
            <div className="mdv-drop__what">
              <span className="mdv-drop__name">
                {files.length > 1 ? `${files.length} pages` : first.name}
              </span>
              {reading ? (
                <span className="mdv-drop__reading" role="status">
                  <span className="mdv-drop__stage" key={stage} data-stage={stage}>
                    {stage === 'sending' ? (
                      <>
                        Sending
                        <span className="mdv-drop__bar" aria-hidden>
                          <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, sent))})` }} />
                        </span>
                      </>
                    ) : (
                      <>
                        {stage === 'kept' ? 'Kept, reading' : 'Reading'}
                        <span className="mdv-drop__dots" aria-hidden>
                          <i />
                          <i />
                          <i />
                        </span>
                      </>
                    )}
                  </span>
                </span>
              ) : (
                <span className="mdv-drop__size">{formatBytes(size)}</span>
              )}
            </div>
            {!reading ? (
              <div className="mdv-drop__acts">
                {multiple && coarse ? (
                  <button
                    type="button"
                    className="mdv-btn mdv-drop__next"
                    disabled={disabled}
                    onClick={() => cameraRef.current?.click()}
                  >
                    Take the next page
                  </button>
                ) : null}
                {multiple && !coarse ? (
                  <button
                    type="button"
                    className="mdv-link"
                    onClick={() => addRef.current?.click()}
                    disabled={disabled}
                  >
                    Add pages
                  </button>
                ) : null}
                <button type="button" className="mdv-link" onClick={openPicker} disabled={disabled}>
                  Change
                </button>
                {onClear ? (
                  <button type="button" className="mdv-link" onClick={onClear} disabled={disabled}>
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="mdv-drop__idle"
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPicker();
              }
            }}
          >
            <EmptyArt name="menu" size={56} />
            <span className="mdv-drop__prompt">{dragging ? 'Let go to keep it' : prompt}</span>
            <span className="mdv-drop__hint">{hint ?? 'or choose a file'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default DropZone;
