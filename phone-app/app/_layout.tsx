import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { RuntimeDefaultsProvider } from "@/services/runtime-defaults-context";
import { SessionProvider } from "@/services/session-context";
import { ThemeProvider, useTheme } from "@/services/theme-context";

export default function RootLayout() {
  return (
    <SessionProvider>
      <ThemeProvider>
        <RuntimeDefaultsProvider>
          <RootStack />
        </RuntimeDefaultsProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}

function RootStack() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerTitleAlign: "center",
          contentStyle: { backgroundColor: theme.background },
          headerStyle: { backgroundColor: theme.backgroundElevated },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          headerTitleStyle: { color: theme.text },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ title: "Connect" }} />
        <Stack.Screen name="thread/[id]" options={{ title: "Thread Detail" }} />
        <Stack.Screen name="review/start" options={{ title: "Start Review" }} />
        <Stack.Screen name="new-thread" options={{ title: "New Thread" }} />
      </Stack>
    </>
  );
}
