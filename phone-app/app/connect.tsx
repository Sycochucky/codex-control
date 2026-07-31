import { Redirect, useRouter } from "expo-router";
import { useState } from "react";

import { ScreenShell } from "@/components/screen-shell";
import { InlineNotice, LabeledInput, PrimaryButton } from "@/components/ui";
import { withAppServerClient } from "@/services/app-server";
import { createConnectedSessionToken, useSession } from "@/services/session-context";
import { getFriendlyNetworkErrorMessage, isValidAppServerEndpoint } from "@/utils/network";

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
        title="Codex Remote"
        subtitle="Restoring saved remote-control connection."
      >
        <InlineNotice>Loading saved connection details.</InlineNotice>
      </ScreenShell>
    );
  }

  if (sessionToken) {
    return <Redirect href="/(tabs)/threads" />;
  }

  async function handleConnect() {
    if (!backendUrl.trim() || !isValidAppServerEndpoint(backendUrl)) {
      setError("Enter a full Codex App Server endpoint starting with ws://, wss://, http://, or https://.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await withAppServerClient(backendUrl, sharedToken, async (client) => {
        await client.listThreads({ limit: 1, useStateDbOnly: true });
      });
      setSessionToken(createConnectedSessionToken());
      router.replace("/(tabs)/threads");
    } catch (error) {
      setError(getFriendlyNetworkErrorMessage(error, "Connection failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      title="Codex Remote"
      subtitle="Connect directly to the official Codex App Server or remote-control endpoint."
    >
      <LabeledInput
        label="Codex App Server URL"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBackendUrl}
        value={backendUrl}
      />
      <LabeledInput
        label="Bearer Token (Optional)"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSharedToken}
        secureTextEntry
        value={sharedToken}
      />
      <InlineNotice>
        Start Codex with `codex remote-control` or `codex app-server --listen ws://127.0.0.1:8765`,
        then enter the reachable `ws://` or `wss://` endpoint here.
      </InlineNotice>
      <InlineNotice>
        For non-loopback listeners, use the official Codex websocket auth token. No desktop bridge
        service or shared development token is used by this remote-control path.
      </InlineNotice>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <PrimaryButton
        disabled={isSubmitting || !backendUrl.trim()}
        label={isSubmitting ? "Connecting..." : "Connect"}
        helperText="The app stores the endpoint and optional bearer token securely on this device."
        onPress={() => {
          void handleConnect();
        }}
      />
    </ScreenShell>
  );
}
