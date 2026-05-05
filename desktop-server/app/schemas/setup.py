from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GitIdentityStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    available: bool
    name: str | None = None
    email: str | None = None
    credential_helper: str | None = None


class GitHubAuthStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    available: bool
    authenticated: bool
    hostname: str = "github.com"
    account: str | None = None
    protocol: str | None = None
    scopes: list[str] = Field(default_factory=list)
    status_text: str | None = None


class RepoLinkStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_root: str
    repo_root: str | None = None
    workspace_is_repo_root: bool = False
    is_git_repository: bool
    current_branch: str | None = None
    origin_url: str | None = None
    origin_is_github: bool = False
    remote_urls: list[str] = Field(default_factory=list)


class AppServerStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enabled: bool = True
    ready: bool = False
    listen_url: str
    pid: int | None = None
    workspace_root: str
    model: str


class OpenAIAccountStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    available: bool
    requires_openai_auth: bool | None = None
    auth_mode: str | None = None
    account_type: str | None = None
    email: str | None = None
    plan_type: str | None = None
    status_text: str | None = None


class GitHubDeviceLoginStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    flow_id: str
    status: Literal["pending", "completed", "failed", "expired"]
    verification_url: str | None = None
    user_code: str | None = None
    expires_at: datetime
    message: str | None = None


class SetupStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    checked_at: datetime
    workspace_root: str
    git_identity: GitIdentityStatus
    github: GitHubAuthStatus
    repo: RepoLinkStatus
    app_server: AppServerStatus
    openai_account: OpenAIAccountStatus
    active_github_login: GitHubDeviceLoginStatus | None = None


class GitHubDeviceLoginStartResponse(GitHubDeviceLoginStatus):
    pass


class GitHubDeviceLoginStatusResponse(GitHubDeviceLoginStatus):
    setup: SetupStatusResponse | None = None
