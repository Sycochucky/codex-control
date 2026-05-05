export function getStartupRoute(input: {
  isHydrated: boolean;
  sessionToken: string | null;
}) {
  if (!input.isHydrated) {
    return null;
  }

  return input.sessionToken ? "/(tabs)/threads" : "/connect";
}
