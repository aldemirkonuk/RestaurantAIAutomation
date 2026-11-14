/**
 * The words under "Loading..." while AuthProvider reads the stored session
 * (#1292, 2026-11-13). Before this, a slow boot read showed "Loading..."
 * alone and looked frozen. Null while there is nothing to add: the first five
 * seconds of an ordinary read, every moment after `loading` ends, and while
 * the read is waiting to ask again (a 429, a 5xx, a dropped connection),
 * because SessionWaitScreen then replaces the loader and says why, that the
 * person is still signed in, and offers Try now (#1092).
 */
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { SESSION_READ_SLOW_AFTER_MS, SESSION_READ_SLOW_NOTE } from "../lib/sessionWait";

export function useSessionWaitNote(): string | null {
  const { loading, sessionWait } = useAuth();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SESSION_READ_SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  if (!loading || sessionWait) return null;
  return slow ? SESSION_READ_SLOW_NOTE : null;
}
