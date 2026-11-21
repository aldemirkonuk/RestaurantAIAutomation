/**
 * A text button that saves the menu as a sheet the reader accepts (menu r104 g3):
 * 'export' is the current menu's lines, 'sample' a blank one. A failed download is said
 * beside the button, with the gateway's words when it sent any (ADR 0020).
 */
import { useState } from 'react';
import { getMenuSheet } from '../../../services/api/menus';

function words(e: unknown): string {
  const said = (e as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  if (typeof said === 'string' && said.trim() && said.trim() !== 'Internal server error') return said.trim();
  return 'The sheet could not be downloaded just now.';
}

export function MenuSheetButton({ kind, label, filename, testId }: { kind: 'export' | 'sample'; label: string; filename: string; testId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const csv = await getMenuSheet(kind);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.visibility = 'hidden';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setFailed(words(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="mdv-link cl-focus" disabled={busy} onClick={() => void go()} data-testid={testId}>
        {busy ? 'Preparing the sheet…' : label}
      </button>
      {failed ? (
        <span role="alert" className="cl-said" style={{ marginLeft: 8 }} data-testid={`${testId}-error`}>
          {failed}
        </span>
      ) : null}
    </>
  );
}
