import React from "react";
import { Stack } from "expo-router";
import { color } from "@/design/tokens";

export default function SupplyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.surfaceSecondary },
      }}
    />
  );
}
