import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, space } from "@/design/tokens";
import {
  entryName,
  entryOrderId,
  useOutbox,
  waitingHere,
  waitingWork,
  waitingWords,
  withdrawWords,
  type OutboxEntry,
} from "@/state/outbox";
import { useSession } from "@/state/session";

/**
 * "N waiting to send" — door work saved on this phone and not yet sent
 * (F-407). Before this, a receipt queued with no signal was invisible until
 * it failed. Shown on Today and on the receive screen; renders nothing when
 * the queue is empty.
 *
 * Tapped, it lists what waits in this house by order and wine (F-1408): a
 * row opens its order, and Withdraw takes back an entry that has not started
 * sending (F-1407), so a wrong count can be counted again.
 */
export function WaitingStrip({ style }: { style?: object }) {
  const router = useRouter();
  const entries = useOutbox((s) => s.entries);
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);
  const words = waitingWords(waitingWork(entries, user));
  if (!words) return null;
  const here = waitingHere(entries, user);

  const confirmWithdraw = (e: OutboxEntry) =>
    Alert.alert(`Withdraw ${entryName(e)}?`, withdrawWords(e), [
      { text: "Keep it", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: () => {
          const refused = useOutbox.getState().withdraw(e.id);
          if (refused) Alert.alert("Not withdrawn", refused);
        },
      },
    ]);

  return (
    <View
      accessibilityRole="summary"
      style={[
        {
          backgroundColor: color.warningTint,
          borderRadius: 12,
          padding: space.md,
          gap: space.sm,
        },
        style,
      ]}
    >
      <PressableScale
        onPress={() => setOpen((o) => !o)}
        disabled={here.length === 0}
        accessibilityLabel={open ? "Hide what is waiting" : "Show what is waiting"}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={color.inkSecondary} />
        <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
          {words}
        </AppText>
        {here.length > 0 ? (
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={color.inkTertiary}
          />
        ) : null}
      </PressableScale>
      {open
        ? here.map((e) => {
            const orderId = entryOrderId(e);
            return (
              <View
                key={e.id}
                style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
              >
                <PressableScale
                  onPress={() =>
                    orderId
                      ? router.push({ pathname: "/supply/[id]", params: { id: orderId } })
                      : undefined
                  }
                  disabled={!orderId}
                  accessibilityLabel={`Open the order for ${entryName(e)}`}
                  style={{ flex: 1 }}
                >
                  <AppText variant="caption" tone="secondary" numberOfLines={2}>
                    {entryName(e)}
                  </AppText>
                </PressableScale>
                {e.status !== "inflight" ? (
                  <PressableScale
                    onPress={() => confirmWithdraw(e)}
                    accessibilityLabel={`Withdraw ${entryName(e)}`}
                    style={{ paddingHorizontal: space.sm }}
                  >
                    <AppText variant="caption" tone="danger">
                      Withdraw
                    </AppText>
                  </PressableScale>
                ) : (
                  <AppText variant="caption" tone="tertiary">
                    Sending
                  </AppText>
                )}
              </View>
            );
          })
        : null}
    </View>
  );
}
