import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, AppState, View } from "react-native";
import { api, type RequestScope } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { draftReplyApproval } from "@/lib/draftReplyApproval";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";

export function DraftSendSeal({
  orderId,
  body,
  recipient,
  scope: reviewScope,
  onApproved,
}: {
  orderId: string;
  body: string;
  recipient: string;
  scope: RequestScope;
  onApproved: () => void;
}) {
  const [phase, setPhase] = useState("idle");
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (active) setScreenReader(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReader,
    );
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  const [error, setError] = useState<string>();
  const control = useMemo(() => {
    return draftReplyApproval({
      orderId, body, recipient, scope: reviewScope, request: api,
      onApproved: async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["orders"] }), queryClient.invalidateQueries({ queryKey: ["mobile", "feed"] })]);
        onApproved();
      },
      state: (next, message) => {
        setPhase(next);
        setError(message);
      },
    });
  }, [
    orderId,
    body,
    recipient,
    reviewScope.userId,
    reviewScope.restaurantId,
    onApproved,
  ]);
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
      "Send this draft?",
      `Send the displayed letter to ${recipient}?`,
      [
        { text: "Cancel", style: "cancel", onPress: control.cancel },
        {
          text: "Send draft",
          onPress: () => {
            confirmed = true;
            void control.confirm();
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (!confirmed) control.cancel();
        },
      },
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <PressableScale
        onPressIn={() => {
          if (!screenReader) control.begin();
        }}
        onPressOut={() => {
          if (!screenReader) control.cancel();
        }}
        onPress={screenReader ? accessibleApproval : undefined}
        accessibilityLabel="Hold to send draft"
        accessibilityHint="Hold until sent. With a screen reader, activate to review and confirm."
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
              ? "Sending…"
              : phase === "approved"
                ? "Sent"
                : "Hold to send draft"}
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
