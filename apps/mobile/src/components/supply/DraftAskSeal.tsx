import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, AppState, View } from "react-native";
import { api, type RequestScope } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { draftSendRequest } from "@/lib/draftSendRequest";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, radius, space } from "@/design/tokens";

/**
 * A staff member's hold on the phone: ask a manager to send this letter
 * (founder, 2026-09-21: "Staff ask, manager sends"). The same hold gesture as
 * `DraftSendSeal`, but nothing is minted and nothing leaves the house — the
 * exact words shown become the version and the owners and managers are told.
 */
export function DraftAskSeal({
  orderId,
  body,
  ccEmails,
  scope: reviewScope,
  onAsked,
}: {
  orderId: string;
  body: string;
  ccEmails?: string[];
  scope: RequestScope;
  onAsked: (says: string) => void;
}) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState<string>();
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (active) setScreenReader(value);
    });
    const listener = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  const control = useMemo(
    () =>
      draftSendRequest({
        orderId,
        body,
        ccEmails,
        scope: reviewScope,
        request: api,
        onAsked: async (says) => {
          await queryClient.invalidateQueries({ queryKey: ["draft"] });
          onAsked(says);
        },
        state: (next, message) => {
          setPhase(next);
          setError(message);
        },
      }),
    [orderId, body, ccEmails, reviewScope.userId, reviewScope.restaurantId, onAsked],
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") control.cancel();
    });
    return () => {
      control.cancel();
      listener.remove();
    };
  }, [control]);
  const accessibleAsk = () => {
    control.begin(false);
    let confirmed = false;
    Alert.alert(
      "Ask a manager?",
      "Ask a manager to send the displayed letter? Nothing is sent until they do.",
      [
        { text: "Cancel", style: "cancel", onPress: control.cancel },
        {
          text: "Ask",
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
        onPress={screenReader ? accessibleAsk : undefined}
        accessibilityLabel="Hold to ask a manager to send it"
        accessibilityHint="Hold until asked. With a screen reader, activate to review and confirm."
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
              ? "Asking…"
              : phase === "approved"
                ? "Asked"
                : "Hold to ask a manager to send it"}
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
