import React, { useEffect } from "react";
import { ViewStyle, StyleProp } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { spring } from "@/design/motion";

/**
 * Bin Breath — the place settles. When a count commits or a bottle finds its
 * bin, the card inhales (a soft lift and swell) and exhales back to rest:
 * "the bottle lives here now." Fire it by incrementing breatheKey.
 */
export function BinBreath({
  breatheKey,
  children,
  style,
}: {
  breatheKey: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const swell = useSharedValue(0);

  useEffect(() => {
    if (breatheKey > 0) {
      swell.value = withSequence(
        withTiming(1, { duration: 260, easing: Easing.bezier(0.3, 0, 0.4, 1) }),
        withSpring(0, spring.sediment),
      );
    }
  }, [breatheKey, swell]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + swell.value * 0.02 }, { translateY: -2 * swell.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
