/**
 * Files for a letter, g6b step 3 (DD-r109-8 part 3, r110): the composer's
 * picker for an owner or a manager.
 *
 * The gateway route is POST /communications/letters/files (#2362). It takes
 * at most 3 files and 5 MB per call, and the seal (#2369) and the queue cap
 * the letter at 3 files and 5 MB in all. Each pick here is its own upload, so
 * the caps that matter are the LETTER's: what is already attached plus what
 * was just chosen. They are checked here, in words, before anything is read
 * or sent; a refused pick uploads nothing.
 *
 * Who sees it is the parent's call (ComposeSheet): the gateway's own reading
 * of the person, `sendOrAsk.basis` owner or manager. A staff member's request
 * carries the words only (the gateway refuses files on an ask), so staff are
 * never shown this.
 *
 * Remove drops a file's id from the letter. There is no delete route; a file
 * uploaded and never queued is an orphan the bucket keeps (the sweep is filed,
 * not built).
 *
 * Motion: none. The list appears and goes without any animation, so reduced
 * motion has nothing to turn off (MOTIONS.md, ADR 0112).
 */
import { useRef, useState } from 'react';
import { apiClient } from '../../../../services/api/client';
import { MONO, SANS } from './compose-format';
import { errText } from './useComposeData';

/** One stored file, as POST /communications/letters/files returns it. */
export interface LetterFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
}

export const MAX_LETTER_FILES = 3;
/** 5 MB as the gateway counts it (OUTBOUND_ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024). */
export const MAX_LETTER_BYTES = 5 * 1024 * 1024;

const MIME = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

export function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Why a pick is refused before any upload, or null when it fits. */
export function refusePick(attached: readonly { size: number }[], picked: readonly { size: number }[]): string | null {
  const count = attached.length + picked.length;
  if (count > MAX_LETTER_FILES) {
    const has = attached.length;
    return (
      `A letter can carry ${MAX_LETTER_FILES} files at most. ` +
      `This one has ${has}, so the ${picked.length} you chose ${picked.length === 1 ? 'was' : 'were'} not added. Nothing was uploaded.`
    );
  }
  const total = [...attached, ...picked].reduce((n, f) => n + f.size, 0);
  if (total > MAX_LETTER_BYTES) {
    return (
      `The files together would be ${megabytes(total)} MB, over the 5 MB a letter can carry. ` +
      'Nothing was uploaded.'
    );
  }
  return null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.onerror = () => reject(new Error(`the file ${file.name} could not be read on this device`));
    reader.readAsDataURL(file);
  });
}

export function MailFilePicker({
  files,
  onChange,
  onBusy,
  disabled,
}: {
  files: LetterFile[];
  onChange: (next: LetterFile[]) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const total = files.reduce((n, f) => n + f.size, 0);

  const pick = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    const why = refusePick(files, picked);
    if (why) {
      setRefused(why);
      return;
    }
    setRefused(null);
    setBusy(true);
    onBusy(true);
    try {
      const body = {
        files: await Promise.all(
          picked.map(async (f) => ({
            name: f.name,
            contentType: MIME.test(f.type) ? f.type : 'application/octet-stream',
            contentBase64: await readBase64(f),
          })),
        ),
      };
      const { data } = await apiClient.post<LetterFile[]>('/communications/letters/files', body);
      onChange([...files, ...(Array.isArray(data) ? data : [])]);
    } catch (e) {
      setRefused(`Nothing was attached: ${errText(e)}`);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <div data-testid="letter-files" style={{ fontFamily: SANS }}>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="letter-files-input"
        aria-label="Files for this letter"
        onChange={(e) => void pick(e.target.files)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="letter-files-attach"
          disabled={disabled || busy || files.length >= MAX_LETTER_FILES}
          onClick={() => input.current?.click()}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 8,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'transparent',
            color: 'var(--ink-1, #211C16)',
            fontSize: 13,
            cursor: disabled || busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Uploading…' : 'Attach files'}
        </button>
        <span data-testid="letter-files-total" style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
          {files.length} of {MAX_LETTER_FILES} files · {megabytes(total)} MB of 5 MB
        </span>
      </div>
      {refused && (
        <p role="alert" data-testid="letter-files-refused" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--alarm, #9B3A2A)' }}>
          {refused}
        </p>
      )}
      {files.length > 0 && (
        <ul data-testid="letter-files-list" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {files.map((f) => (
            <li
              key={f.id}
              data-file-id={f.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13, color: 'var(--ink-2, #3B342B)' }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>{megabytes(f.size)} MB</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                disabled={disabled || busy}
                onClick={() => onChange(files.filter((x) => x.id !== f.id))}
                style={{ minHeight: 44, minWidth: 44, border: 0, background: 'transparent', color: 'var(--ink-3, #4F4639)', fontSize: 12, cursor: 'pointer' }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
