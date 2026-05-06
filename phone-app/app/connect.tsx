import { Redirect, useRouter } from "expo-router";
import { useState } from "react";

import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PrimaryButton } from "@/components/ui";
import { login } from "@/services/api";
import { useSession } from "@/services/session-context";
import { getFriendlyNetworkErrorMessage, isValidBackendUrl } from "@/utils/network";

export default function ConnectScreen() {
  const router = useRouter();
  const {
    backendUrl,
    isHydrated,
    setBackendUrl,
    sessionToken,
    setSessionToken,
    sharedToken,
    setSharedToken,
  } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isHydrated) {
    return (
      <ScreenShell
        title="Phone Access"
        subtitle="Restoring secure local session state."
      >
        <InlineNotice>Loading saved connection details.</InlineNotice>
      </ScreenShell>
    );
  }

  if (sessionToken) {
    return <Redirect href="/(tabs)/threads" />;
  }

  async function handleConnect() {
    if (!backendUrl.trim() || !isValidBackendUrl(backendUrl)) {
      setError("Enter a full backend URL starting with http:// or https://.");
      return;
    }

    if (!sharedToken.trim()) {
      setError("Enter the shared token configured on the desktop server.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const response = await login(backendUrl, sharedToken, "phone-app");
      setSessionToken(response.token);
      router.replace("/(tabs)/threads");
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Connection failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      title="Phone Access"
      subtitle="Connect the Expo app to the local desktop server with the shared token."
    >
      <LabeledInput
        label="Backend URL"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBackendUrl}
        value={backendUrl}
      />
      <LabeledInput
        label="Shared Token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSharedToken}
        secureTextEntry
        value={sharedToken}
      />
      <InlineNotice>
        Local testing can use `http://127.0.0.1:8010`, Android emulators usually need
        `http://10.0.2.2:8010`, and physical devices need your LAN IP or ADB reverse.
      </InlineNotice>
      <InlineNotice>
        Away from home, paste your HTTPS Cloudflare Tunnel or ngrok URL here. Auth still uses
        the same desktop shared token, defaulting to `codex-dev`.
      </InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <PrimaryButton
        disabled={isSubmitting || !backendUrl.trim() || !sharedToken.trim()}
        label={isSubmitting ? "Connecting..." : "Connect"}
        helperText="The app stores the backend URL and session securely on this device."
        onPress={() => {
          void handleConnect();
        }}
      />
    </ScreenShell>
  );
}
