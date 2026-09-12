import React, { useState } from "react";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { haptic } from "@/design/haptics";
import { emailError, normalizeEmail } from "@/auth/credentials";
import {
  ENUMERATION_SAFE_SENT_MESSAGE,
  forgotPasswordOutcome,
  statusOf,
} from "@/auth/outcomes";
import { requestPasswordReset } from "@/api/auth";

/**
 * Ask for a reset link.
 *
 * The whole screen is two features (`forgot-password.md` §1a) and one rule:
 * **the answer must not depend on whether the account exists.** The gateway
 * takes that seriously — `requestPasswordReset` returns the same sentence
 * either way — and a client that renders a 404 differently from a 200 gives
 * the enumeration straight back. `forgotPasswordOutcome` is where that rule
 * lives, and it is the reason this component branches on an outcome rather
 * than on a status code.
 *
 * The link the mail carries points at the web app
 * (`${FRONTEND_URL}/reset-password?token=…`, `auth.service.ts:1596`), so the
 * success card hands off to `/reset-password`, where the token can be pasted.
 * See the blocker note in `deepLink.ts` for why the phone cannot simply catch
 * that link today.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    "sent" | "rateLimited" | "serverError" | null
  >(null);

  const submit = async () => {
    if (busy) return;
    const address = normalizeEmail(email);
    const problem = emailError(address);
    setIssue(problem);
    if (problem) return;

    setBusy(true);
    setOutcome(null);
    try {
      await requestPasswordReset(address);
      setOutcome("sent");
      haptic.confirm();
    } catch (e) {
      const next = forgotPasswordOutcome(statusOf(e));
      setOutcome(next);
      if (next === "sent") haptic.confirm();
      else haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  if (outcome === "sent") {
    return (
      <AuthShell title="Check your mail.">
        <AuthNotice tone="success">
          <AppText variant="footnote">{ENUMERATION_SAFE_SENT_MESSAGE}</AppText>
        </AuthNotice>
        <AppText variant="footnote" tone="tertiary">
          The link opens the web dashboard. If you'd rather finish here, copy
          the link or the code out of the mail and paste it on the next screen.
        </AppText>
        <AuthButton
          label="I have the code"
          onPress={() => router.replace("/reset-password")}
        />
        <AuthLink label="Back to sign in" onPress={() => router.replace("/login")} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password."
      intro="Enter the address you sign in with and we'll send a link."
    >
      <AuthField
        label="Email"
        value={email}
        onChangeText={(next) => {
          setEmail(next);
          setIssue(null);
        }}
        error={issue}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@restaurant.com"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {outcome === "rateLimited" ? (
        <AuthNotice tone="warning">
          <AppText variant="footnote">
            That's a few requests in a short time. Wait a minute, then try again.
          </AppText>
        </AuthNotice>
      ) : null}

      {outcome === "serverError" ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            We couldn't send that just now. Check your connection and try again
            — nothing has been sent yet.
          </AppText>
        </AuthNotice>
      ) : null}

      <AuthButton label="Send reset link" onPress={submit} busy={busy} />
      <AuthLink label="Back to sign in" onPress={() => router.replace("/login")} />
      <AuthLink
        label="I already have a reset code"
        onPress={() => router.push("/reset-password")}
      />
    </AuthShell>
  );
}
