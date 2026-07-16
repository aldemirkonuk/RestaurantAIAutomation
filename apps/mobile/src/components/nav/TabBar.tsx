import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { PressableScale } from "@/components/ui/PressableScale";
import { AppText } from "@/components/ui/AppText";
import { color, space } from "@/design/tokens";
import { spring } from "@/design/motion";
import { useFeed } from "@/api/queries";

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_META: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: "Today", icon: "today-outline", iconActive: "today" },
  cellar: { label: "Cellar", icon: "wine-outline", iconActive: "wine" },
  supply: { label: "Supply", icon: "cube-outline", iconActive: "cube" },
  team: { label: "Team", icon: "people-outline", iconActive: "people" },
  insights: { label: "Insights", icon: "stats-chart-outline", iconActive: "stats-chart" },
};

function TabItem({
  routeName,
  focused,
  onPress,
  badge,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const meta = TAB_META[routeName];
  const lift = useSharedValue(focused ? 1 : 0);

  React.useEffect(() => {
    lift.value = withSpring(focused ? 1 : 0, spring.settle);
  }, [focused, lift]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -1.5 * lift.value }],
  }));

  if (!meta) return null;

  return (
    <PressableScale
      onPress={onPress}
      style={{ flex: 1, alignItems: "center", paddingVertical: space.sm }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
    >
      <Animated.View style={iconStyle}>
        <Ionicons
          name={focused ? meta.iconActive : meta.icon}
          size={23}
          color={focused ? color.wine : color.inkQuaternary}
        />
        {badge && badge > 0 ? (
          <View
            style={{
              position: "absolute",
              top: -3,
              right: -10,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: color.wine,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4,
            }}
          >
            <AppText variant="caption" tone="onWine" style={{ fontSize: 10, lineHeight: 12 }}>
              {badge > 99 ? "99+" : badge}
            </AppText>
          </View>
        ) : null}
      </Animated.View>
      <AppText
        variant="caption"
        style={{
          marginTop: 3,
          fontSize: 10.5,
          color: focused ? color.wine : color.inkQuaternary,
        }}
      >
        {meta.label}
      </AppText>
    </PressableScale>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { data: feed } = useFeed();
  const pending = feed?.counts.total ?? 0;

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: color.surface,
        borderTopWidth: 1,
        borderTopColor: color.hairline,
        paddingBottom: Math.max(insets.bottom, space.sm),
        paddingTop: 2,
      }}
    >
      {state.routes.map((route, index) => (
        <TabItem
          key={route.key}
          routeName={route.name}
          focused={state.index === index}
          badge={route.name === "index" ? pending : undefined}
          onPress={() => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (state.index !== index && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          }}
        />
      ))}
    </View>
  );
}
