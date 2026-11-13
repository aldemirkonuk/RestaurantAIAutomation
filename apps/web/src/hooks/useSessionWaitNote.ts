/**
 * The words under "Loading..." while AuthProvider reads the stored session
 * (r22, 2026-11-13). Before this, a boot read that waited out a rate limit
 * or a dropped connection showed "Loading..." alone for up to a minute, so it
 * looked frozen. Null while there is nothing to add: the first five seconds
 * of an ordinary read, and every moment after `loading` ends.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  SESSION_READ_SLOW_AFTER_MS,
  sessionWaitNote,
} from "../lib/sessionReadRetry";

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
  if (!loading) return null;
  return sessionWaitNote(sessionWait, slow);
}
