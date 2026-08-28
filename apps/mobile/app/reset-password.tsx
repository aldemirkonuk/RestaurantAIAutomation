import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import {
  confirmationError,
  passwordError,
  passwordStrength,
  resetTokenError,
} from "@/auth/credentials";
import { resetTokenFromPaste } from "@/auth/deepLink";
import { authErrorMessage } from "@/auth/outcomes";
import { resetPassword } from "@/api/auth";

/**
 * Set a new password from the emailed link.
 *
 * `reset-password.md` calls this **"cold URL only"** on web — there is no
 * in-app navigation to it, the link arrives by mail. On a phone that is not
 * quite true and cannot be: the mail's link is
 * `${FRONTEND_URL}/reset-password?token=…`, a *web* URL, and intercepting it
 * needs Universal Links — an `associatedDomains` entry here **and** an
 * `apple-app-site-association` file served from the web origin. The second
 * half is outside `apps/mobile`, so it is a recorded blocker.
 *
 * So this screen takes the token two ways: from `?token=` when the app is
 * opened by a `wineops://` link, and from a paste box otherwise. The paste box
 * accepts the whole URL or the bare token, because nobody should have to know
 * which part of a link mattered.
 *
 * The shape check before submit is not pedantry: reset tokens are single-use
 * server-side, so a truncated paste that reaches the server burns the token
 * and costs the user a whole new email.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState("");
  const [tokenIssue, setTokenIssue] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordIssue, setPasswordIssue] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [confirmIssue, setConfirmIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A token that arrived on the URL is not shown as a field to edit — it is
  // just used. Only a hand-pasted one needs a box.
  const linkToken = resetTokenFromPaste(params.token ?? "");
  useEffect(() => {
    if (linkToken) setToken(linkToken);
  }, [linkToken]);

  const submit = async () => {
    if (busy) return;
    const candidate = resetTokenFromPaste(token) ?? token.trim();
    const problems = {
      token: resetTokenError(candidate),
      password: passwordError(password),
      confirmation: confirmationError(password, confirmation),
    };
    setTokenIssue(problems.token);
    setPasswordIssue(problems.password);
    setConfirmIssue(problems.confirmation);
    if (problems.token || problems.password || problems.confirmation) return;

    setBusy(true);
    setError(null);
    try {
      await resetPassword(candidate, password);
      setDone(true);
      haptic.confirm();
    } catch (e) {
      setError(authErrorMessage(e));
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Password changed.">
        <AuthNotice tone="success">
          <AppText variant="footnote">
            You can sign in with the new password now.
          </AppText>
        </AuthNotice>
        <AuthButton label="Sign in" onPress={() => router.replace("/login")} />
      </AuthShell>
    );
  }

  const strength = password ? passwordStrength(password) : null;

  return (
    <AuthShell
      title="Choose a new password."
      intro={
        linkToken
          ? "We've read the code from your link."
          : "Paste the link from your reset email, or just the code inside it."
      }
    >
      {!linkToken ? (
        <AuthField
          label="Reset code or link"
          value={token}
          onChangeText={(next) => {
            setToken(next);
            setTokenIssue(null);
          }}
          error={tokenIssue}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…/reset-password?token=…"
          editable={!busy}
          multiline
        />
      ) : null}

      <AuthField
        label="New password"
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setPasswordIssue(null);
        }}
        error={passwordIssue}
        hint={
          strength
            ? strength === "strong"
              ? "Strong."
              : strength === "fair"
                ? "Fine. Longer would be better."
                : "At least 8 characters."
            : "At least 8 characters."
        }
        secureTextEntry
        autoComplete="new-password"
        placeholder="••••••••"
        editable={!busy}
      />

      <AuthField
        label="Again"
        value={confirmation}
        onChangeText={(next) => {
          setConfirmation(next);
          setConfirmIssue(null);
        }}
        error={confirmIssue}
        secureTextEntry
        autoComplete="new-password"
        placeholder="••••••••"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {error ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
          {/* reset-password.md §1a: an invalid link must offer a new one. */}
          <AuthLink
            label="Request a new link"
            align="left"
            onPress={() => router.replace("/forgot-password")}
          />
        </AuthNotice>
      ) : null}

      <AuthButton
        label="Set password"
        onPress={submit}
        busy={busy}
        variant="primary"
      />
      <AuthLink
        label="Back to sign in"
        onPress={() => router.replace("/login")}
      />
      <AppText
        variant="footnote"
        tone="tertiary"
        align="center"
        style={{ marginTop: space.xs }}
      >
        Reset codes can only be used once.
      </AppText>
    </AuthShell>
  );
}
