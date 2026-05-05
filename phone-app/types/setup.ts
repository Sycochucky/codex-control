import type { AppServerAccount } from "@/types/app-server";
import type { SessionRestoreState } from "@/utils/session-restore";

export type SetupSessionStatus = {
  backendUrl: string;
  restoreState: SessionRestoreState;
  tokenPresent: boolean;
};

export type SetupAppServerStatus = {
  enabled: boolean;
  ready: boolean;
  listenUrl: string | null;
  workspaceRoot: string | null;
  model: string | null;
  pid: number | null;
};

export type SetupGitStatus = {
  workspaceRoot: string | null;
  repoRoot: string | null;
  workspaceIsRepoRoot: boolean;
  isRepository: boolean;
  userName: string | null;
  userEmail: string | null;
  credentialHelper: string | null;
  branch: string | null;
  originUrl: string | null;
  remoteUrls: string[];
  isGithubRemote: boolean;
};

export type SetupGithubStatus = {
  available: boolean;
  authenticated: boolean;
  hostname: string;
  activeAccount: string | null;
  gitProtocol: string | null;
  scopes: string[];
  rawStatus: string | null;
};

export type SetupOpenAIStatus = {
  available: boolean;
  requiresOpenaiAuth: boolean | null;
  authMode: string | null;
  account: AppServerAccount | null;
  statusText: string | null;
};

export type SetupSnapshot = {
  checkedAt: string;
  workspaceRoot: string;
  session: SetupSessionStatus;
  appServer: SetupAppServerStatus;
  git: SetupGitStatus;
  github: SetupGithubStatus;
  openai: SetupOpenAIStatus;
};

export type GithubDeviceLoginPhase = "idle" | "pending" | "completed" | "failed" | "expired";

export type GithubDeviceLoginState = {
  flowId: string | null;
  status: GithubDeviceLoginPhase;
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: string | null;
  message: string | null;
};

export type SetupGitIdentityDto = {
  available: boolean;
  name: string | null;
  email: string | null;
  credential_helper: string | null;
};

export type SetupGithubDto = {
  available: boolean;
  authenticated: boolean;
  hostname: string;
  account: string | null;
  protocol: string | null;
  scopes: string[];
  status_text: string | null;
};

export type SetupRepoDto = {
  workspace_root: string;
  repo_root: string | null;
  workspace_is_repo_root: boolean;
  is_git_repository: boolean;
  current_branch: string | null;
  origin_url: string | null;
  origin_is_github: boolean;
  remote_urls: string[];
};

export type SetupAppServerDto = {
  enabled: boolean;
  ready: boolean;
  listen_url: string;
  pid: number | null;
  workspace_root: string;
  model: string;
};

export type SetupOpenAIAccountDto = {
  available: boolean;
  requires_openai_auth: boolean | null;
  auth_mode: string | null;
  account_type: string | null;
  email: string | null;
  plan_type: string | null;
  status_text: string | null;
};

export type GithubDeviceLoginDto = {
  flow_id: string;
  status: Exclude<GithubDeviceLoginPhase, "idle">;
  verification_url: string | null;
  user_code: string | null;
  expires_at: string;
  message: string | null;
};

export type SetupStatusResponse = {
  checked_at: string;
  workspace_root: string;
  git_identity: SetupGitIdentityDto;
  github: SetupGithubDto;
  repo: SetupRepoDto;
  app_server: SetupAppServerDto;
  openai_account: SetupOpenAIAccountDto;
  active_github_login: GithubDeviceLoginDto | null;
};

export type GithubDeviceLoginStartResponse = GithubDeviceLoginDto;

export type GithubDeviceLoginPollResponse = GithubDeviceLoginDto & {
  setup: SetupStatusResponse | null;
};
