import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, space } from "@/design/tokens";

interface ScreenProps {
  children: React.ReactNode;
  /** Skip top inset when a header handles it. */
  edgeTop?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, edgeTop = true, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: color.surfaceSecondary,
          paddingTop: edgeTop ? insets.top : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: color.hairline,
        marginLeft: inset || undefined,
      }}
    />
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: color.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: color.hairline,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
