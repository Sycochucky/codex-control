import { Redirect } from "expo-router";

import { useSession } from "@/services/session-context";

export default function IndexScreen() {
  const { isHydrated, sessionToken } = useSession();

  if (!isHydrated) {
    return null;
  }

  return <Redirect href={sessionToken ? "/(tabs)/threads" : "/connect"} />;
}
