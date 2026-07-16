import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import Animated, { FadeIn } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { color, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useSession } from "@/state/session";

/**
 * Biometric gate between "tokens exist" and "data visible". Devices without
 * biometrics (or after repeated failures) fall through to unlock — the phone
 * lock screen is already the barrier there; this gate is a courtesy layer.
 */
export default function LockScreen() {
  const unlock = useSession((s) => s.unlock);
  const signOut = useSession((s) => s.signOut);
  const [failed, setFailed] = useState(false);

  const tryUnlock = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        unlock();
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock WineOps",
        cancelLabel: "Not now",
      });
      if (result.success) {
        haptic.confirm();
        unlock();
      } else {
        setFailed(true);
      }
    } catch {
      unlock();
    }
  }, [unlock]);

  useEffect(() => {
    tryUnlock();
  }, [tryUnlock]);

  return (
    <Screen style={{ backgroundColor: color.surface }}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space.md, paddingHorizontal: space.xxl }}>
        <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: "center", gap: space.sm }}>
          <AppText variant="signature" tone="wine">
            WineOps
          </AppText>
          <AppText variant="body" tone="secondary" align="center">
            {failed ? "Unlock to continue." : "Unlocking…"}
          </AppText>
        </Animated.View>

        {failed ? (
          <View style={{ gap: space.md, alignItems: "center", marginTop: space.lg }}>
            <PressableScale
              onPress={tryUnlock}
              style={{
                backgroundColor: color.wine,
                borderRadius: radius.control,
                paddingVertical: 14,
                paddingHorizontal: space.xxxl,
              }}
            >
              <AppText variant="bodyMedium" tone="onWine">
                Try again
              </AppText>
            </PressableScale>
            <PressableScale onPress={() => signOut()}>
              <AppText variant="footnote" tone="tertiary">
                Sign in with password instead
              </AppText>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
