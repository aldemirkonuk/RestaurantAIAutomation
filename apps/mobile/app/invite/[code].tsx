import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useSession } from "@/state/session";
import { describeInviteRejection, normalizeInviteCode } from "@/auth/inviteCode";
import { authErrorMessage, statusOf } from "@/auth/outcomes";
import { acceptInvite, fetchInvitePreview, type InvitePreview } from "@/api/auth";

/**
 * The invite landing screen — preview first, commit second.
 *
 * `invite-landing.md` §1a asks for four things and each is a distinct state
 * below: preview the invite before committing, a signed-out pair of ways in
 * that both return here, a one-tap accept for a session that already exists,
 * and a dead-end card for a code that cannot be used.
 *
 * The subtlety worth naming is **"already a member counts as success."** The
 * gateway's `acceptInviteAsExistingUser` may answer that you are already on
 * the team; rendering that as an error would tell a member of the restaurant
 * they are not one. It is treated as the same outcome as a fresh accept.
 */
export default function InviteLandingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSession((s) => s.status);
  const refreshUser = useSession((s) => s.refreshUser);

  const code = normalizeInviteCode(params.code ?? "");

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInvitePreview(code)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((e) => {
        if (!cancelled) setError(authErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptInvite(code);
      await refreshUser();
      setAccepted(true);
      haptic.confirm();
    } catch (e) {
      // 409 is "you are already on this team", which is not a failure —
      // the user is exactly where the invite was trying to put them.
      if (statusOf(e) === 409) {
        setAccepted(true);
        haptic.confirm();
      } else {
        setError(authErrorMessage(e));
        haptic.warn();
      }
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <AuthShell title="Checking that invite…">
        <View style={{ paddingVertical: space.xxl }}>
          <ActivityIndicator />
        </View>
      </AuthShell>
    );
  }

  if (accepted) {
    const where = preview?.valid ? (preview.restaurant ?? "the team") : "the team";
    return (
      <AuthShell title="You're in.">
        <AuthNotice tone="success">
          <AppText variant="footnote">{where} is on your account now.</AppText>
        </AuthNotice>
        <AuthButton label="Open WineOps" onPress={() => router.replace("/")} />
      </AuthShell>
    );
  }

  if (!preview || preview.valid === false) {
    return (
      <AuthShell title="That invite won't work.">
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error ??
              describeInviteRejection(
                preview && preview.valid === false ? preview.reason : undefined,
              )}
          </AppText>
        </AuthNotice>
        <AuthButton label="Back to sign in" onPress={() => router.replace("/login")} />
      </AuthShell>
    );
  }

  const where = preview.restaurant ?? preview.organization ?? "a restaurant";
  const intro = [
    preview.inviter ? `${preview.inviter} invited you` : "You've been invited",
    `to ${where}`,
    preview.city ? `in ${preview.city}` : null,
    preview.role ? `as ${preview.role}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (status === "signedIn") {
    return (
      <AuthShell title="Add this restaurant?" intro={`${intro}.`}>
        {error ? (
          <AuthNotice tone="danger">
            <AppText variant="footnote" tone="danger">
              {error}
            </AppText>
          </AuthNotice>
        ) : null}
        <AuthButton label={`Add ${where}`} onPress={accept} busy={accepting} />
        <AuthLink label="Not now" onPress={() => router.replace("/")} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="You've been invited." intro={`${intro}.`}>
      <AppText variant="footnote" tone="tertiary">
        Code {code}
      </AppText>
      <AuthButton
        label="Create an account to accept"
        onPress={() => router.push(`/register?invite=${code}` as never)}
      />
      <AuthButton
        label="I already have an account"
        variant="secondary"
        onPress={() =>
          router.push(
            `/login?redirect=${encodeURIComponent(`/invite/${code}`)}` as never,
          )
        }
      />
    </AuthShell>
  );
}
