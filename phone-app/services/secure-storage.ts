import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export async function getStoredValue(key: string) {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }

  return SecureStore.getItemAsync(key);
}

export async function setStoredValue(key: string, value: string | null) {
  if (Platform.OS === "web") {
    if (value === null) {
      globalThis.localStorage?.removeItem(key);
      return;
    }

    globalThis.localStorage?.setItem(key, value);
    return;
  }

  if (value === null) {
    await SecureStore.deleteItemAsync(key);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}
