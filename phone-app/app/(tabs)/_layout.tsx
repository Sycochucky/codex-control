import { Tabs } from "expo-router";

import { useTheme } from "@/services/theme-context";

export default function TabsLayout() {
  const { theme } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: "center",
        headerStyle: { backgroundColor: theme.backgroundElevated },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerTitleStyle: { color: theme.text },
        tabBarStyle: {
          backgroundColor: theme.backgroundElevated,
          borderTopColor: theme.border,
        },
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarItemStyle: {
          paddingTop: 10,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: "700",
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSubtle,
      }}
    >
      <Tabs.Screen name="threads" options={{ title: "Threads", tabBarLabel: "Threads" }} />
      <Tabs.Screen name="git" options={{ title: "Git", tabBarLabel: "Git" }} />
      <Tabs.Screen name="tools" options={{ title: "Tools", tabBarLabel: "Tools" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarLabel: "Settings" }} />
    </Tabs>
  );
}
