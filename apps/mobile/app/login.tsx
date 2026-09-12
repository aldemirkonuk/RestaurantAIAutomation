import React, { useState } from "react";
import { View } from "react-native";
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
import { useSession } from "@/state/session";
import { emailError, normalizeEmail } from "@/auth/credentials";
import { safeRedirectTarget } from "@/auth/deepLink";
import {
  authErrorMessage,
  routeAfterSignIn,
  statusOf,
} from "@/auth/outcomes";
import { clearPendingRoute, setPendingRoute } from "@/auth/pendingRoute";
import { fetchSignInMethods, type SignInMethod } from "@/api/auth";

/**
 * Sign in.
 *
 * Three of the four features `login.md` §1a lists were missing on the phone:
 * `?redirect=` return-to, the links out to password recovery and sign-up, and
 * any account-specific sign-in information. The links mattered most — without
 * them `/forgot-password` and `/register` had no entry point at all, so a
 * mobile user who forgot a password had nowhere to go inside the app.
 *
 * **What is deliberately not here: the Google button.** `POST /auth/oauth/google`
 * wants a Google ID token, which on a device means a native sign-in SDK and a
 * new dependency. That is a real piece of work with a real native surface, and
 * shipping a button that cannot complete would be worse than not having one.
 * What is here instead is the *honest half*: `POST /auth/sign-in-methods` is
 * asked what this identity can actually use, and if the answer is a provider
 * this screen cannot drive, it says so in those words rather than failing the
 * password attempt with "wrong password".
 *
 * That call is also what `login.md` §1a gets wrong. It describes "Gmail
 * addresses are auto-routed to Google's chooser" — behaviour ADR 0024
 * deliberately deleted, because two of the ten production accounts on
 * 2026-08-26 were gmail addresses holding a real password and no linked Google
 * account (`apps/web/src/pages/Login.tsx:38-41`). Mobile implements what the
 * code does, not what the note says.
 */
export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const signIn = useSession((s) => s.signIn);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailIssue, setEmailIssue] = useState<string | null>(null);

  /** What the server says this identity can use, once we have asked. */
  const [resolved, setResolved] = useState<{
    email: string;
    usable: SignInMethod[];
    unusable: SignInMethod[];
    noMethod: boolean;
  } | null>(null);

  const redirect = safeRedirectTarget(params.redirect);

  /**
   * Ask about the identity when the field loses focus. Failure is silent on
   * purpose: an unreachable resolve tells us nothing about the account, and
   * saying anything about it would be a fabrication (ADR 0020). The password
   * field stays exactly as usable as it was.
   */
  const resolveIdentity = async () => {
    const address = normalizeEmail(email);
    if (emailError(address)) return;
    if (resolved?.email === address) return;
    try {
      const result = await fetchSignInMethods(address);
      setResolved({
        email: address,
        usable: result.methods ?? [],
        unusable: result.unavailable ?? [],
        noMethod: !!result.noSignInMethod,
      });
    } catch {
      setResolved(null);
    }
  };

  const submit = async () => {
    if (busy) return;
    const address = normalizeEmail(email);
    const issue = emailError(address);
    setEmailIssue(issue);
    if (issue) return;
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // The target is left for `useAuthRouting` rather than navigated to
      // here: both would fire on the same transition, and whichever ran second
      // would win. See `src/auth/pendingRoute.ts`.
      setPendingRoute(routeAfterSignIn(redirect));
      await signIn(address, password);
      haptic.confirm();
    } catch (e) {
      clearPendingRoute();
      // A 401 here after a resolve that found no password is a different
      // problem from a wrong password, and saying so saves a support message.
      if (statusOf(e) === 401 && resolved?.noMethod) {
        setError(
          "That account has no password set. Ask whoever invited you to re-send the invite.",
        );
      } else {
        setError(authErrorMessage(e));
      }
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  const unusable = resolved?.unusable ?? [];

  return (
    <AuthShell title="Good evening." intro="Sign in to run tonight's cellar.">
      <AuthField
        label="Email"
        value={email}
        onChangeText={(next) => {
          setEmail(next);
          setEmailIssue(null);
        }}
        onBlur={resolveIdentity}
        error={emailIssue}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@restaurant.com"
        editable={!busy}
        returnKeyType="next"
      />

      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        placeholder="••••••••"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {unusable.length > 0 ? (
        <AuthNotice tone="warning">
          <AppText variant="footnote">
            This account also signs in with{" "}
            {unusable.map((m) => m.label).join(" and ")}, which the app can't do
            yet — use your password here, or sign in on the web.
          </AppText>
        </AuthNotice>
      ) : null}

      {error ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
        </AuthNotice>
      ) : null}

      <View style={{ marginTop: space.sm }}>
        <AuthButton label="Sign in" onPress={submit} busy={busy} />
      </View>

      <AuthLink
        label="Forgot password?"
        onPress={() => router.push("/forgot-password")}
      />

      <View style={{ alignItems: "center", gap: space.xs }}>
        <AppText variant="footnote" tone="tertiary">
          No account yet?
        </AppText>
        <AuthLink
          label="Create one now"
          onPress={() =>
            router.push(
              redirect
                ? (`/register?redirect=${encodeURIComponent(redirect)}` as never)
                : "/register",
            )
          }
        />
      </View>

      <AuthLink label="Privacy" onPress={() => router.push("/privacy")} />
    </AuthShell>
  );
}
