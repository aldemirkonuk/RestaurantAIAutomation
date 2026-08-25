import React from "react";
import { Pressable, PressableProps, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { pressScale, spring, timing } from "@/design/motion";
import { haptic } from "@/design/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends PressableProps {
  style?: StyleProp<ViewStyle>;
  /** Play the selection tick on press. Default true. */
  hapticTick?: boolean;
  children?: React.ReactNode;
}

/**
 * The app's one press affordance: a barely-there scale-down on touch and a
 * spring settle on release. Every tappable surface uses this so the whole
 * app shares a single physical feel.
 */
export function PressableScale({
  style,
  hapticTick = true,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withTiming(pressScale, timing.fast);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring.settle);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (hapticTick) haptic.tick();
        onPress?.(e);
      }}
    />
  );
}
