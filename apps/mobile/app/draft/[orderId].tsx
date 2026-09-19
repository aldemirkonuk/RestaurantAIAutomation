import React, { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, type RequestScope } from "@/api/client";
import { useSession } from "@/state/session";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { DraftSendSeal } from "@/components/supply/DraftSendSeal";
import { color, font, radius, space } from "@/design/tokens";

type Draft = {
  id: string;
  content: string | null;
  provider_name: string | null;
  provider_email: string | null;
};
function DraftEditor({
  draft,
  orderId,
  scope,
}: {
  draft: Draft;
  orderId: string;
  scope: RequestScope;
}) {
  const router = useRouter();
  const [content, setContent] = useState(draft.content ?? "");
  const sent = useCallback(() => router.back(), [router]);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: color.surfaceSecondary }}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="bodyMedium">
          {draft.provider_name ?? "Vendor"}
        </AppText>
        <AppText variant="caption" tone="tertiary">
          To: {draft.provider_email ?? "No address on file"}
        </AppText>
        <TextInput
          multiline
          value={content}
          onChangeText={setContent}
          accessibilityLabel="Draft reply"
          style={{
            minHeight: 240,
            padding: space.lg,
            borderRadius: radius.card,
            backgroundColor: color.surface,
            fontSize: 15,
            lineHeight: 22,
            fontFamily: font.sans,
            color: color.ink,
            textAlignVertical: "top",
          }}
        />
        <AppText variant="caption" tone="tertiary">
          Review the letter and recipient, then hold to send. This action needs
          a connection and is never queued offline.
        </AppText>
        {draft.provider_email && content.trim() ? (
          <DraftSendSeal
            orderId={orderId}
            body={content}
            recipient={draft.provider_email}
            scope={scope}
            onApproved={sent}
          />
        ) : (
          <AppText variant="caption" tone="danger">
            A letter and vendor email are required before this reply can be
            sent.
          </AppText>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function DraftReviewScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const session = useSession();
  const scope = {
    userId: session.user?.id ?? "",
    restaurantId: session.user?.restaurantId ?? "",
  };
  const draft = useQuery({
    queryKey: ["draft", orderId, scope.restaurantId, scope.userId],
    queryFn: () =>
      api<{ draft: Draft | null }>(`/procurement/orders/${orderId}/draft`, {
        scope,
      }),
    enabled: !!orderId && !!scope.restaurantId && session.status === "signedIn",
  });
  return (
    <>
      <Stack.Screen
        options={{
          presentation: "modal",
          headerShown: true,
          title: "Review vendor reply",
        }}
      />
      {draft.data?.draft ? (
        <DraftEditor
          key={`${scope.restaurantId}:${scope.userId}:${draft.data.draft.id}`}
          draft={draft.data.draft}
          orderId={orderId}
          scope={scope}
        />
      ) : (
        <View style={{ padding: space.lg, gap: space.md }}>
          <AppText>
            {draft.isError
              ? "The draft could not be read. Nothing was sent."
              : draft.isPending
                ? "Reading the draft…"
                : "No draft is waiting on this order."}
          </AppText>
          {draft.isError ? (
            <PressableScale onPress={() => void draft.refetch()}>
              <AppText tone="wine">Try again</AppText>
            </PressableScale>
          ) : null}
        </View>
      )}
    </>
  );
}
