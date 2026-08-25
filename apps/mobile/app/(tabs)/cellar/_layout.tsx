import React from "react";
import { Stack } from "expo-router";
import { color } from "@/design/tokens";

export default function CellarLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.surfaceSecondary },
      }}
    />
  );
}
