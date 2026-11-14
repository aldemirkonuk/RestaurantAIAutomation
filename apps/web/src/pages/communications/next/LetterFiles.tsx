/**
 * The files a letter carried (r28 mail gap 13): a vendor's price list, an
 * invoice, a photo of a delivery note. Each is named with its kind and size,
 * and "Open" asks the gateway for a five-minute address
 * (GET /mail/attachments/:id/link) and opens it in a new tab. A file removed
 * under the retention rule keeps its name and says so, with nothing to open.
 *
 * The new tab is opened in the click itself, before the address is known, so
 * a browser's pop-up blocker allows it; it is pointed at the file once the
 * gateway answers, or closed if it does not. When the browser blocks it
 * anyway, the address is shown as a link to click.
 */

import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { apiClient } from '../../../services/api/client';
import { fmtWhen } from './cm-format';
import { fileKindWords, fileOpenFailWords, fileSizeWords, type MailAttachment } from './mail-format';

const QUIET = { fontSize: 11, color: 'var(--ink-4, #665D50)' } as const;

interface Link {
  url: string;
  filename: string;
}

function FileRow({ f }: { f: MailAttachment }) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Link | null>(null);
  const facts = [fileKindWords(f.mimeType), fileSizeWords(f.sizeBytes)].filter(Boolean).join(', ');

  const open = async () => {
    setFailed(null);
    setBlocked(null);
    setOpening(true);
    const tab = window.open('', '_blank');
    try {
      const { data } = await apiClient.get<Link>(`/mail/attachments/${encodeURIComponent(f.id)}/link`);
      if (tab) {
        tab.opener = null;
        tab.location.href = data.url;
      } else {
        setBlocked({ url: data.url, filename: data.filename });
      }
    } catch (err) {
      tab?.close();
      setFailed(fileOpenFailWords(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <li data-testid="letter-file" className="grid gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        <Paperclip size={12} strokeWidth={1.75} aria-hidden style={{ alignSelf: 'center' }} />
        <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{f.filename}</span>
        {facts && <span style={QUIET}>{facts}</span>}
        {f.removedAt ? (
          <span data-testid="letter-file-removed" style={QUIET}>
            The file was removed under the retention rule, {fmtWhen(f.removedAt)}; its name is kept.
          </span>
        ) : (
          <button
            type="button"
            data-testid="letter-file-open"
            onClick={() => void open()}
            disabled={opening}
            aria-label={`Open ${f.filename}`}
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            {opening ? 'Opening…' : 'Open'}
          </button>
        )}
      </span>
      {failed && (
        <span role="alert" data-testid="letter-file-failed" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)' }}>
          {failed}
        </span>
      )}
      {blocked && (
        <span data-testid="letter-file-blocked" style={QUIET}>
          The browser did not open a new tab.{' '}
          <a href={blocked.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}>
            Open {blocked.filename}
          </a>{' '}
          (this link works for five minutes).
        </span>
      )}
    </li>
  );
}

export function LetterFiles({ files }: { files: readonly MailAttachment[] | undefined }) {
  if (!files || files.length === 0) return null;
  return (
    <ul data-testid="letter-files" aria-label="Files with this letter" className="grid gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {files.map((f) => (
        <FileRow key={f.id} f={f} />
      ))}
    </ul>
  );
}
