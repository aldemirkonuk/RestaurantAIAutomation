import React, { useEffect } from "react";
import { Dimensions, Pressable } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Canvas, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import { AppText } from "@/components/ui/AppText";
import { color, space } from "@/design/tokens";

interface FeedZeroProps {
  clearedCount: number;
  onDone: () => void;
}

/**
 * Feed Zero — the once-per-session reward for clearing the last decision.
 * A slow wine-toned wash rises, the serif speaks once, and the app gets out
 * of the way. Tap anywhere to dismiss early.
 */
export function FeedZero({ clearedCount, onDone }: FeedZeroProps) {
  const { width, height } = Dimensions.get("window");
  const textRise = useSharedValue(12);

  useEffect(() => {
    textRise.value = withDelay(
      150,
      withTiming(0, { duration: 700, easing: Easing.bezier(0.2, 0, 0, 1) }),
    );
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: textRise.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(350)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onDone}>
        <Canvas style={{ flex: 1 }}>
          <Rect x={0} y={0} width={width} height={height}>
            <RadialGradient
              c={vec(width / 2, height * 0.45)}
              r={height * 0.6}
              colors={["#FDF2F4F2", "#FCE7EBE6", "#FDF2F400"]}
            />
          </Rect>
        </Canvas>
      </Pressable>

      <Animated.View pointerEvents="none" style={[{ alignItems: "center", gap: space.sm }, textStyle]}>
        <AppText variant="signature" tone="wine">
          Shift clear.
        </AppText>
        <AppText variant="footnote" tone="secondary">
          {clearedCount > 0
            ? `${clearedCount} decision${clearedCount === 1 ? "" : "s"} handled`
            : "Nothing needs you right now"}
        </AppText>
      </Animated.View>
    </Animated.View>
  );
}
