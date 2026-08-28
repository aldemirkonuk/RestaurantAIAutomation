import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { haptic } from "@/design/haptics";
import { useSession } from "@/state/session";
import { verifyTokenFromPaste } from "@/auth/deepLink";
import {
  authErrorMessage,
  routeAfterVerification,
  statusOf,
} from "@/auth/outcomes";
import {
  fetchOnboardingProgress,
  resendVerification,
  verifyEmail,
} from "@/api/auth";

/** `resend-verification` is rate-limited to 1/min server-side. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Check your email", and the button that redeems the link.
 *
 * Reached two ways, and both matter on a phone:
 *
 *  - straight after Path B registration, holding a token that is not yet
 *    usable for anything else;
 *  - from the verification mail, whose link is
 *    `${FRONTEND_URL}/verify-email?token=…` (`auth.service.ts:705`) — a web
 *    URL, so the paste box is the honest route until Universal Links exist.
 *
 * The resend cooldown is mirrored locally rather than waiting for the 429.
 * The server enforces one per minute; a button that looks live and answers
 * "too many requests" teaches people to mash it.
 *
 * Onward routing mirrors `VerifyEmail.tsx:41-43` — Get Started, unless a menu
 * has already been imported, in which case straight to the dashboard.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const user = useSession((s) => s.user);
  const status = useSession((s) => s.status);
  const refreshUser = useSession((s) => s.refreshUser);
  const signOut = useSession((s) => s.signOut);

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const autoAttempted = useRef(false);

  const linkToken = verifyTokenFromPaste(params.token ?? "");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const redeem = useCallback(
    async (candidate: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await verifyEmail(candidate);
        // verify-email returns a fresh pair; adopting it is what turns an
        // unverified session into a usable one without a second sign-in.
        if (result.accessToken) {
          await useSession
            .getState()
            .adoptTokens(result.accessToken, result.refreshToken);
        } else {
          await refreshUser();
        }
        haptic.confirm();
        const progress = await fetchOnboardingProgress().catch(() => null);
        router.replace(routeAfterVerification(progress) as never);
      } catch (e) {
        setError(
          statusOf(e) === 400 || statusOf(e) === 404
            ? "That link has expired or has already been used. Send yourself a new one."
            : authErrorMessage(e),
        );
        haptic.warn();
      } finally {
        setBusy(false);
      }
    },
    [refreshUser, router],
  );

  // A token on the URL is acted on once, without a tap: the user already
  // tapped — in their mail client.
  useEffect(() => {
    if (linkToken && !autoAttempted.current) {
      autoAttempted.current = true;
      void redeem(linkToken);
    }
  }, [linkToken, redeem]);

  const submitPasted = () => {
    const candidate = verifyTokenFromPaste(token);
    if (!candidate) {
      setError("Paste the link from your verification email.");
      return;
    }
    void redeem(candidate);
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setResendNote(null);
    setError(null);
    try {
      await resendVerification();
      setResendNote("Sent. Check your mail.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      haptic.confirm();
    } catch (e) {
      if (statusOf(e) === 429) {
        setResendNote("One a minute, please.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setError(authErrorMessage(e));
      }
      haptic.warn();
    }
  };

  return (
    <AuthShell
      title="Check your email."
      intro={
        user?.email
          ? `We sent a verification link to ${user.email}.`
          : "We sent you a verification link."
      }
    >
      <AuthField
        label="Verification link or code"
        value={token}
        onChangeText={(next) => {
          setToken(next);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://…/verify-email?token=…"
        editable={!busy}
        multiline
      />

      <AuthButton label="Verify my email" onPress={submitPasted} busy={busy} />

      {error ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
        </AuthNotice>
      ) : null}

      {resendNote ? (
        <AuthNotice tone="success">
          <AppText variant="footnote">{resendNote}</AppText>
        </AuthNotice>
      ) : null}

      {/* Resending needs a token: the endpoint is guarded, and deliberately
          allows unverified sessions (auth.controller.ts:431). Signed out,
          there is nobody to resend for. */}
      {status === "signedIn" ? (
        <AuthButton
          label={
            cooldown > 0 ? `Send again in ${cooldown}s` : "Send the link again"
          }
          onPress={resend}
          disabled={cooldown > 0 || busy}
          variant="secondary"
        />
      ) : (
        <AppText variant="footnote" tone="tertiary" align="center">
          Sign in first if you need a new link sent.
        </AppText>
      )}

      {status === "signedIn" ? (
        <AuthLink
          label="Sign out"
          onPress={() => {
            void signOut();
            router.replace("/login");
          }}
        />
      ) : (
        <AuthLink
          label="Back to sign in"
          onPress={() => router.replace("/login")}
        />
      )}
    </AuthShell>
  );
}
