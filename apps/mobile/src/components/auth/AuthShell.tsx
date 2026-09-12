/**
 * The chrome every screen you can reach without a session shares.
 *
 * Web has `components/brand/AuthShell.tsx` doing the same job for the same
 * eight routes; this is its counterpart, not a port — the phone needs keyboard
 * avoidance and a scroll container that web does not, and it must not need the
 * tab bar, which does not exist out here.
 */

import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { color, font, radius, space } from "@/design/tokens";

export function AuthShell({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Screen style={{ backgroundColor: color.surface }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: space.xxl,
            paddingVertical: space.xxxl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            entering={FadeInDown.duration(350)}
            style={{ gap: space.sm, marginBottom: space.xl }}
          >
            <AppText variant="signature" tone="wine">
              WineOps
            </AppText>
            <AppText variant="display">{title}</AppText>
            {intro ? (
              <AppText variant="body" tone="secondary">
                {intro}
              </AppText>
            ) : null}
          </Animated.View>

          <View style={{ gap: space.md }}>{children}</View>

          {footer ? (
            <View style={{ marginTop: space.xxl, gap: space.md }}>{footer}</View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const inputStyle = {
  backgroundColor: color.surface,
  borderWidth: 1,
  borderRadius: radius.control,
  paddingHorizontal: space.lg,
  paddingVertical: 14,
  fontSize: 15,
  fontFamily: font.sans,
  color: color.ink,
} as const;

export function AuthField({
  label,
  error,
  hint,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <TextInput
        {...rest}
        style={[
          inputStyle,
          { borderColor: error ? color.danger : color.hairline },
          rest.style,
        ]}
        placeholderTextColor={color.inkQuaternary}
      />
      {error ? (
        <AppText variant="footnote" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="footnote" tone="tertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function AuthButton({
  label,
  onPress,
  busy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";
  const inert = busy || disabled;
  return (
    <PressableScale
      onPress={onPress}
      disabled={inert}
      style={{
        backgroundColor: primary ? color.wine : color.fill,
        borderRadius: radius.control,
        paddingVertical: 15,
        alignItems: "center",
        opacity: inert ? 0.6 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={primary ? color.onWine : color.inkSecondary} />
      ) : (
        <AppText variant="bodyMedium" tone={primary ? "onWine" : "primary"}>
          {label}
        </AppText>
      )}
    </PressableScale>
  );
}

/** A tappable line of text — "Forgot password?", "Create one now". */
export function AuthLink({
  label,
  onPress,
  align = "center",
}: {
  label: string;
  onPress: () => void;
  align?: "left" | "center";
}) {
  return (
    <PressableScale onPress={onPress} style={{ paddingVertical: space.xs }}>
      <AppText
        variant="footnote"
        tone="wine"
        align={align === "center" ? "center" : "left"}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

/** The banner an auth screen shows when a whole submit failed. */
export function AuthNotice({
  tone,
  children,
}: {
  tone: "danger" | "success" | "warning";
  children: React.ReactNode;
}) {
  const background =
    tone === "danger"
      ? color.dangerTint
      : tone === "success"
        ? color.successTint
        : color.warningTint;
  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: radius.control,
        padding: space.lg,
        gap: space.xs,
      }}
    >
      {children}
    </View>
  );
}
