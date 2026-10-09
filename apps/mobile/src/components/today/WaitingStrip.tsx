import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { color, space } from "@/design/tokens";
import { useOutbox, waitingWork, waitingWords } from "@/state/outbox";
import { useSession } from "@/state/session";

/**
 * "N waiting to send" — door work saved on this phone and not yet sent
 * (F-407). Before this, a receipt queued with no signal was invisible until
 * it failed. Shown on Today and on the receive screen; renders nothing when
 * the queue is empty.
 */
export function WaitingStrip({ style }: { style?: object }) {
  const entries = useOutbox((s) => s.entries);
  const user = useSession((s) => s.user);
  const words = waitingWords(waitingWork(entries, user));
  if (!words) return null;
  return (
    <View
      accessibilityRole="summary"
      style={[
        {
          backgroundColor: color.warningTint,
          borderRadius: 12,
          padding: space.md,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        },
        style,
      ]}
    >
      <Ionicons name="cloud-upload-outline" size={18} color={color.inkSecondary} />
      <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
        {words}
      </AppText>
    </View>
  );
}
