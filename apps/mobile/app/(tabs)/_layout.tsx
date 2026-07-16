import React from "react";
import { Tabs } from "expo-router";
import { TabBar } from "@/components/nav/TabBar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, lazy: true }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="cellar" />
      <Tabs.Screen name="supply" />
      <Tabs.Screen name="team" />
      <Tabs.Screen name="insights" />
    </Tabs>
  );
}
