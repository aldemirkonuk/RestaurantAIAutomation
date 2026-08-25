import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { color, font, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useSession } from "@/state/session";

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim().toLowerCase(), password);
      haptic.confirm();
    } catch (e: any) {
      setError(e?.message ?? "Sign-in failed.");
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: font.sans,
    color: color.ink,
  } as const;

  return (
    <Screen style={{ backgroundColor: color.surface }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", paddingHorizontal: space.xxl }}
      >
        <Animated.View entering={FadeInDown.duration(400)} style={{ gap: space.sm }}>
          <AppText variant="signature" tone="wine">
            WineOps
          </AppText>
          <AppText variant="display">Good evening.</AppText>
          <AppText variant="body" tone="secondary" style={{ marginBottom: space.xxl }}>
            Sign in to run tonight's cellar.
          </AppText>
        </Animated.View>

        <View style={{ gap: space.md }}>
          <View style={{ gap: space.xs }}>
            <AppText variant="caption" tone="secondary">
              Email
            </AppText>
            <TextInput
              style={inputStyle}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@restaurant.com"
              placeholderTextColor={color.inkQuaternary}
              editable={!busy}
              returnKeyType="next"
            />
          </View>
          <View style={{ gap: space.xs }}>
            <AppText variant="caption" tone="secondary">
              Password
            </AppText>
            <TextInput
              style={inputStyle}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="••••••••"
              placeholderTextColor={color.inkQuaternary}
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </View>

          {error ? (
            <AppText variant="footnote" tone="danger">
              {error}
            </AppText>
          ) : null}

          <PressableScale
            onPress={submit}
            disabled={busy}
            style={{
              marginTop: space.sm,
              backgroundColor: color.wine,
              borderRadius: radius.control,
              paddingVertical: 15,
              alignItems: "center",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color={color.onWine} />
            ) : (
              <AppText variant="bodyMedium" tone="onWine">
                Sign in
              </AppText>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
