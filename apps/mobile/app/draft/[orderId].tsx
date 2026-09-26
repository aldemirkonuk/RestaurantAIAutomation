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
import { DraftAskSeal } from "@/components/supply/DraftAskSeal";
import { holdAct, standingLines, type SendOrAsk, type SendRequest } from "@/lib/sendStanding";
import { color, font, radius, space } from "@/design/tokens";

type Draft = {
  id: string;
  content: string | null;
  provider_name: string | null;
  provider_email: string | null;
  /** A staff member's request waiting on this draft (founder, 2026-09-21). */
  send_request?: SendRequest | null;
};
function DraftEditor({
  draft,
  orderId,
  scope,
  sendOrAsk,
}: {
  draft: Draft;
  orderId: string;
  scope: RequestScope;
  /** Whether this person's hold sends or asks a manager; null = not readable. */
  sendOrAsk: SendOrAsk | null;
}) {
  const router = useRouter();
  const [content, setContent] = useState(draft.content ?? "");
  const [asked, setAsked] = useState<string | null>(null);
  const sent = useCallback(() => router.back(), [router]);
  const onAsked = useCallback((says: string) => setAsked(says), []);
  const act = holdAct(sendOrAsk);
  const request = draft.send_request ?? null;
  // The seal binds copies: a manager releasing a staff member's request holds
  // over the copies they chose.
  const cc = request?.current ? request.ccEmails : [];
  const lines = standingLines(sendOrAsk, request, { failed: sendOrAsk === null });
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
          {act === "ask"
            ? "Review the letter, then hold to ask a manager to send it. Nothing leaves the house from your hold."
            : "Review the letter and recipient, then hold to send. This action needs a connection and is never queued offline."}
        </AppText>
        {lines.map((line) => (
          <AppText key={line} variant="caption" tone="secondary">
            {line}
          </AppText>
        ))}
        {!draft.provider_email || !content.trim() ? (
          <AppText variant="caption" tone="danger">
            A letter and vendor email are required before this reply can be
            sent.
          </AppText>
        ) : act === "send" ? (
          <DraftSendSeal
            orderId={orderId}
            body={content}
            recipient={draft.provider_email}
            ccEmails={cc}
            scope={scope}
            onApproved={sent}
          />
        ) : act === "ask" ? (
          asked ? (
            <AppText variant="caption" tone="secondary">
              {asked}
            </AppText>
          ) : (
            <DraftAskSeal
              orderId={orderId}
              body={content}
              scope={scope}
              onAsked={onAsked}
            />
          )
        ) : (
          <AppText variant="caption" tone="danger">
            Nothing can be held until it is known whether your hold sends or
            asks a manager.
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
      api<{ draft: Draft | null; sendOrAsk?: SendOrAsk }>(`/procurement/orders/${orderId}/draft`, {
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
          sendOrAsk={draft.data.sendOrAsk ?? null}
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
