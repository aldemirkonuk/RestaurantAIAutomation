import React from "react";
import { Text, TextProps, TextStyle } from "react-native";
import { color, type } from "@/design/tokens";

type Variant = keyof typeof type;
type Tone = "primary" | "secondary" | "tertiary" | "wine" | "onWine" | "success" | "warning" | "danger";

const toneColor: Record<Tone, string> = {
  primary: color.ink,
  secondary: color.inkSecondary,
  tertiary: color.inkTertiary,
  wine: color.wine,
  onWine: color.onWine,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
};

interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  align?: TextStyle["textAlign"];
}

export function AppText({
  variant = "body",
  tone = "primary",
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[type[variant], { color: toneColor[tone], textAlign: align }, style]}
    />
  );
}
