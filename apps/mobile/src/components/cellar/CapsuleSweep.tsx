import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { color } from "@/design/tokens";

/**
 * Capsule Sweep — custody made visible. Each scanned bottle sends a foil
 * shimmer across the count row (sweepKey), and when the receipt is
 * committed the row wraps in a soft wine capsule tint (sealed).
 */
export function CapsuleSweep({
  sweepKey,
  sealed = false,
  children,
  style,
}: {
  /** Increment to fire one sweep. */
  sweepKey: number;
  /** True once the receipt is committed — the capsule stays on. */
  sealed?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const sweep = useSharedValue(-1);
  const seal = useSharedValue(sealed ? 1 : 0);

  useEffect(() => {
    if (sweepKey > 0) {
      sweep.value = -1;
      sweep.value = withTiming(1, {
        duration: 550,
        easing: Easing.bezier(0.3, 0, 0.2, 1),
      });
    }
  }, [sweepKey, sweep]);

  useEffect(() => {
    seal.value = withTiming(sealed ? 1 : 0, { duration: 450, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [sealed, seal]);

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweep.value > -1 && sweep.value < 1 ? 0.85 : 0,
    transform: [
      { translateX: interpolate(sweep.value, [-1, 1], [-160, 360]) },
      { skewX: "-18deg" },
    ],
  }));

  const sealStyle = useAnimatedStyle(() => ({
    opacity: seal.value * 0.16,
  }));

  return (
    <View style={[{ overflow: "hidden", borderRadius: 16 }, style]}>
      {children}
      {/* Foil shimmer band */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { width: 90, backgroundColor: "#FFFFFF" },
          sweepStyle,
        ]}
      />
      {/* Sealed capsule tint */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: color.wine }, sealStyle]}
      />
    </View>
  );
}
