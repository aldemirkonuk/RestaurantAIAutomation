import React from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { Card, Screen } from "@/components/ui/Screen";
import { AuthLink } from "@/components/auth/AuthShell";
import { color, space } from "@/design/tokens";
import { useSession } from "@/state/session";

/**
 * Privacy notice — the phone's, not the browser's.
 *
 * `apps/web/src/pages/Privacy.tsx` opens by saying it is "written to match what
 * the code actually does rather than boilerplate", and it is: it describes
 * cookies, `localStorage` and what leaves *the browser*. None of those exist
 * here. Session tokens live in the iOS Keychain / Android Keystore through
 * `expo-secure-store` (`src/state/session.ts:5-6`), the offline cache lives in
 * MMKV (`src/lib/mmkv.ts`), and the phone registers a push token the browser
 * never has (`src/lib/push.ts:56`). Web's analytics section is also wrong for
 * the phone in the *user's favour*: `trackGuidance`
 * (`src/guidance/analytics.ts:15-21`) writes to the console in development and
 * does nothing in a release build, so mobile ships no telemetry at all.
 *
 * So this is a rewrite against the mobile code, not a port of the web copy.
 * Shipping the browser's notice on a device would have been faster and would
 * have been a false statement about where a user's session is stored — which
 * is the one thing a privacy notice may not be.
 *
 * Every claim below has a file behind it. If any of them changes, this screen
 * changes with it.
 */

interface Item {
  title: string;
  body: string;
}

const SECTIONS: Item[] = [
  {
    title: "Your session",
    body: "Sign-in tokens are held in the device keychain (iOS Keychain, Android Keystore), not in app storage a backup could copy. Signing out deletes them from the device. There are no cookies and no tracking identifiers of any kind.",
  },
  {
    title: "The lock screen",
    body: "Face ID or a fingerprint is checked by the operating system, which answers yes or no. WineOps never sees the biometric itself and cannot store it.",
  },
  {
    title: "Working offline",
    body: "So the app is usable in a cellar with no signal, recent screens are cached on the device and actions you take offline are queued until it reconnects. That cache holds your restaurant's own data — stock, orders, deliveries — and is cleared when you sign out.",
  },
  {
    title: "Notifications",
    body: "Turning on push registers a device token with WineOps so alerts can reach this phone. It identifies the device, not you, and unregistering in Settings removes it. Notification content is your own operational data — low stock, an order status.",
  },
  {
    title: "The camera",
    body: "The camera is used only where you open it: photographing a delivery document or a wine list. Photos go to WineOps to be read, and nowhere else. The app has no access to your photo library unless you pick from it.",
  },
  {
    title: "Product analytics",
    body: "This app sends no interaction telemetry at all. The guidance events it records are written to the developer console during development and discarded in a release build — nothing about how you use the app leaves the device.",
  },
  {
    title: "Signing in with Google",
    body: "If your account uses Google, WineOps receives your email address, name and profile picture to identify you. We never receive your Google password, and this grants no access to Gmail or Drive.",
  },
  {
    title: "Sharing with partners",
    body: "Sharing with logistics and POS partners is off by default and stays off until you turn it on and confirm which partner. We do not sell your data and do not share it with advertisers.",
  },
];

export default function PrivacyScreen() {
  const router = useRouter();
  const status = useSession((s) => s.status);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.xl,
          paddingTop: space.xxl,
          paddingBottom: space.huge,
          gap: space.md,
        }}
      >
        <View style={{ gap: space.xs, marginBottom: space.sm }}>
          <AppText variant="signature" tone="wine">
            WineOps
          </AppText>
          <AppText variant="display">Privacy &amp; data</AppText>
          <AppText variant="footnote" tone="tertiary">
            What this app stores on your phone, what leaves it, and what you
            control.
          </AppText>
        </View>

        {SECTIONS.map((section) => (
          <Card key={section.title} style={{ gap: space.xs }}>
            <AppText variant="headline">{section.title}</AppText>
            <AppText variant="footnote" tone="secondary">
              {section.body}
            </AppText>
          </Card>
        ))}

        <Card style={{ gap: space.xs, backgroundColor: color.surfaceTertiary }}>
          <AppText variant="headline">Your controls</AppText>
          <AppText variant="footnote" tone="secondary">
            Notification channels, service permissions and push registration all
            live in Settings. Unlinking a sign-in provider or deleting your
            account is on the web dashboard under your profile.
          </AppText>
          {status === "signedIn" ? (
            <AuthLink
              label="Open Settings"
              align="left"
              onPress={() => router.push("/settings")}
            />
          ) : null}
        </Card>

        <AuthLink label="Back" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
