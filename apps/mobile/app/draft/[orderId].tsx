import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { color, font, radius, space } from "@/design/tokens";
import { GRACE_MS } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { feedKey, pulseKey } from "@/api/queries";
import { queryClient } from "@/lib/queryClient";
import { useOutbox } from "@/state/outbox";
import { useFeedLocal } from "@/state/feedLocal";
import type { FeedResponse } from "@/api/types";

/**
 * Review the AI-drafted vendor reply. Edits ride along as modifiedContent.
 * Send runs the same grace window as the feed: 8 seconds of Undo before the
 * email actually leaves, with the drain line making the countdown visible.
 */
export default function DraftReviewScreen() {
  const router = useRouter();
  const { orderId, feedItemId } = useLocalSearchParams<{
    orderId: string;
    feedItemId?: string;
  }>();

  const feed = queryClient.getQueryData<FeedResponse>([...feedKey]);
  const item = feed?.items.find(
    (i) => i.id === feedItemId || (i.kind === "draft_approval" && i.orderId === orderId),
  );

  const [content, setContent] = useState(item?.draftContent ?? "");
  const [edited, setEdited] = useState(false);
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceX = useSharedValue(1);

  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    [],
  );

  const send = () => {
    if (!orderId || holdingId) return;
    const entryId = useOutbox.getState().enqueue({
      path: `/procurement/orders/${orderId}/approve-draft`,
      body: edited && content.trim() ? { modifiedContent: content.trim() } : {},
      label: item?.providerName ? `Reply sent to ${item.providerName}` : "Vendor reply sent",
      graceMs: GRACE_MS,
      invalidate: [[...feedKey], [...pulseKey], ["orders", "pending"]],
      feedItemId: item?.id,
    });
    if (item) useFeedLocal.getState().hide(item.id, entryId);
    setHoldingId(entryId);
    haptic.tick();
    graceX.value = 1;
    graceX.value = withTiming(0, { duration: GRACE_MS, easing: Easing.linear });
    graceTimer.current = setTimeout(() => {
      haptic.commit();
      useFeedLocal.getState().markCleared();
      router.back();
    }, GRACE_MS);
  };

  const undo = () => {
    if (!holdingId) return;
    if (graceTimer.current) clearTimeout(graceTimer.current);
    if (useOutbox.getState().undo(holdingId)) {
      if (item) useFeedLocal.getState().unhide(item.id);
      setHoldingId(null);
      graceX.value = withTiming(1, { duration: 180 });
      haptic.tick();
    }
  };

  const graceLineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: graceX.value }],
  }));

  return (
    <>
      <Stack.Screen
        options={{
          presentation: "modal",
          headerShown: true,
          title: item?.providerName ? `Reply to ${item.providerName}` : "Vendor reply",
          headerStyle: { backgroundColor: color.surface },
          headerTitleStyle: { fontFamily: font.sansSemiBold, fontSize: 17, color: color.ink },
          headerLeft: () => (
            <PressableScale onPress={() => router.back()} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={color.inkSecondary} />
            </PressableScale>
          ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: color.surfaceSecondary }}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          {item?.meta?.orderNumber ? (
            <AppText variant="caption" tone="tertiary">
              {String(item.meta.orderNumber)}
            </AppText>
          ) : null}

          <View
            style={{
              backgroundColor: color.surface,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: color.hairline,
              overflow: "hidden",
            }}
          >
            <TextInput
              multiline
              value={content}
              onChangeText={(t) => {
                setContent(t);
                setEdited(true);
              }}
              editable={!holdingId}
              style={{
                minHeight: 220,
                padding: space.lg,
                fontSize: 15,
                lineHeight: 22,
                fontFamily: font.sans,
                color: color.ink,
                textAlignVertical: "top",
              }}
              placeholder="The AI draft appears here. Edit freely before sending."
              placeholderTextColor={color.inkQuaternary}
            />
            {holdingId ? (
              <Animated.View
                style={[
                  { height: 2, backgroundColor: color.wine, transformOrigin: "left" },
                  graceLineStyle,
                ]}
              />
            ) : null}
          </View>

          <AppText variant="caption" tone="tertiary">
            {edited
              ? "Sends your edited version and files it in the vendor thread."
              : "Sends exactly as drafted and files it in the vendor thread."}
          </AppText>
        </ScrollView>

        <View
          style={{
            padding: space.lg,
            paddingBottom: space.xxl,
            backgroundColor: color.surface,
            borderTopWidth: 1,
            borderTopColor: color.hairline,
          }}
        >
          {!holdingId ? (
            <PressableScale
              onPress={send}
              disabled={!content.trim()}
              style={{
                backgroundColor: color.wine,
                borderRadius: radius.control,
                paddingVertical: 15,
                alignItems: "center",
                opacity: content.trim() ? 1 : 0.5,
              }}
            >
              <AppText variant="bodyMedium" tone="onWine">
                {edited ? "Send edited reply" : "Send reply"}
              </AppText>
            </PressableScale>
          ) : (
            <PressableScale
              onPress={undo}
              style={{
                backgroundColor: color.wineTint,
                borderWidth: 1,
                borderColor: color.wineTintStrong,
                borderRadius: radius.control,
                paddingVertical: 15,
                alignItems: "center",
              }}
            >
              <AppText variant="bodyMedium" tone="wine">
                Undo — sending…
              </AppText>
            </PressableScale>
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
