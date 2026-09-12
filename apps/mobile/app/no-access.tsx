import React from "react";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { useSession } from "@/state/session";

/**
 * A signed-in session that belongs to no restaurant.
 *
 * `no-access.md` §9 records that on web **nothing routes here** — the route
 * exists, and neither `ProtectedRoute` nor `AuthContext` sends anyone to it.
 * Porting an orphan would just add a second orphan, so this one has a caller:
 * `app/(tabs)/index.tsx` sends a session with no `restaurantId` here instead
 * of rendering a dashboard with nothing behind it.
 *
 * That is a deliberate small divergence from web and it is flagged as such in
 * the parity document rather than smuggled in. The alternative — a Today tab
 * that loads forever because every query is keyed on a restaurant that does
 * not exist — is what the phone does today, and it is worse.
 */
export default function NoAccessScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);

  return (
    <AuthShell
      title="No restaurant yet."
      intro="Your account is fine — it just isn't attached to a restaurant."
    >
      <AuthNotice tone="warning">
        <AppText variant="footnote">
          Signed in as {user?.email ?? "this account"}.
        </AppText>
        <AppText variant="footnote">
          An owner or manager has to send you an invite link. Open it on this
          phone, or type the code on the join screen.
        </AppText>
      </AuthNotice>

      <AuthButton
        label="I have an invite code"
        onPress={() => router.push("/register?type=join" as never)}
      />

      <AuthLink
        label="Sign out"
        onPress={() => {
          void signOut();
          router.replace("/login");
        }}
      />
    </AuthShell>
  );
}
