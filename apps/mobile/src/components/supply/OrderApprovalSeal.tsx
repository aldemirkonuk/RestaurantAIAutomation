import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, AppState, View } from "react-native";
import { api, type RequestScope } from "@/api/client";
import { useSession } from "@/state/session";
import { queryClient } from "@/lib/queryClient";
import { heldApproval } from "@/lib/heldApproval";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";

export function OrderApprovalSeal({
  orderId,
  onApproved,
}: {
  orderId: string;
  onApproved: () => void;
}) {
  const [phase, setPhase] = useState("idle");
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (active) setScreenReader(value); });
    const listener = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => { active = false; listener.remove(); };
  }, []);
  const [error, setError] = useState<string>();
  const control = useMemo(() => {
    let scope: RequestScope;
    return heldApproval({
      issue: async () => {
        const session = useSession.getState();
        if (
          session.status !== "signedIn" ||
          !session.user?.id ||
          !session.user.restaurantId
        )
          throw new Error("Unlock this branch before approving.");
        scope = {
          userId: session.user.id,
          restaurantId: session.user.restaurantId,
        };
        const result = await api<{ challenge: string }>(
          `/procurement/orders/${orderId}/seal-challenge`,
          { method: "POST", scope },
        );
        return result.challenge;
      },
      approve: async (challenge) => {
        await api(`/procurement/orders/${orderId}/approve`, {
          method: "POST",
          scope,
          sealChallenge: challenge,
        });
        await queryClient.invalidateQueries({ queryKey: ["orders"] });
        onApproved();
      },
      state: (next, message) => {
        setPhase(next);
        setError(message);
      },
    });
  }, [orderId, onApproved]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") control.cancel();
    });
    return () => {
      control.cancel();
      listener.remove();
    };
  }, [control]);
  const accessibleApproval = () => {
    control.begin(false);
    let confirmed = false;
    Alert.alert(
      "Approve this order?",
      "Confirm the vendor, quantity and amount shown on this order.",
      [
        { text: "Cancel", style: "cancel", onPress: control.cancel },
        {
          text: "Approve order",
          onPress: () => {
            confirmed = true;
            void control.confirm();
          },
        },
      ],
      { cancelable: true, onDismiss: () => { if (!confirmed) control.cancel(); } },
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <PressableScale
        onPressIn={() => { if (!screenReader) control.begin(); }}
        onPressOut={() => { if (!screenReader) control.cancel(); }}
        onPress={screenReader ? accessibleApproval : undefined}
        accessibilityLabel="Hold to approve order"
        accessibilityHint="Hold until approved. With a screen reader, activate to review and confirm."
        disabled={phase === "sending" || phase === "approved"}
        style={{
          backgroundColor: color.wine,
          borderRadius: radius.control,
          paddingVertical: 13,
          alignItems: "center",
        }}
      >
        <AppText variant="bodyMedium" tone="onWine">
          {phase === "holding"
            ? "Keep holding…"
            : phase === "sending"
              ? "Approving…"
              : phase === "approved"
                ? "Approved"
                : "Hold to approve order"}
        </AppText>
      </PressableScale>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
