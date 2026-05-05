from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import os
import re
import shlex
import shutil
import subprocess
import threading
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.app_server import codex_app_server_manager
from app.core.config import settings
from app.models.entities import utc_now
from app.schemas.setup import (
    AppServerStatus,
    GitHubAuthStatus,
    GitHubDeviceLoginStartResponse,
    GitHubDeviceLoginStatus,
    GitHubDeviceLoginStatusResponse,
    GitIdentityStatus,
    OpenAIAccountStatus,
    RepoLinkStatus,
    SetupStatusResponse,
)

LOGIN_FLOW_TTL_MINUTES = 15
FLOW_RETENTION_MINUTES = 60
MAX_FINISHED_FLOWS = 10
COMMAND_TIMEOUT_SECONDS = 10
DEVICE_CODE_RE = re.compile(r"\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b")
DEVICE_URL_RE = re.compile(r"https://github\.com/login/device(?:/\S*)?", re.IGNORECASE)
GITHUB_REMOTE_RE = re.compile(r"(?:github\.com[:/]|git@github\.com[:/])", re.IGNORECASE)


def _ensure_workspace_root() -> Path:
    workspace_root = Path(settings.codex_workspace_root)
    if not workspace_root.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Configured Codex workspace does not exist: {workspace_root}",
        )

    return workspace_root


def _run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    timeout_seconds: int = COMMAND_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to find executable: {command[0]}",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Command timed out: {shlex.join(command)}",
        ) from exc


def _command_text(result: subprocess.CompletedProcess[str]) -> str:
    combined = "\n".join(part for part in (result.stdout, result.stderr) if part)
    return combined.strip()


def _read_git_config_value(key: str, *, cwd: Path | None = None) -> str | None:
    command = ["git"]
    if cwd is not None:
        command.extend(["-C", str(cwd)])
    command.extend(["config", "--get", key])

    result = _run_command(command, cwd=cwd)
    if result.returncode != 0:
        return None

    value = result.stdout.strip()
    return value or None


def _read_git_remote_urls(workspace_root: Path) -> list[str]:
    result = _run_command(["git", "-C", str(workspace_root), "remote", "-v"], cwd=workspace_root)
    if result.returncode != 0:
        return []

    urls: list[str] = []
    for raw_line in result.stdout.splitlines():
        parts = raw_line.split()
        if len(parts) >= 2:
            urls.append(parts[1])

    unique_urls: list[str] = []
    for url in urls:
        if url not in unique_urls:
            unique_urls.append(url)

    return unique_urls


def _read_git_branch(workspace_root: Path) -> str | None:
    result = _run_command(["git", "-C", str(workspace_root), "rev-parse", "--abbrev-ref", "HEAD"], cwd=workspace_root)
    if result.returncode != 0:
        return None

    branch = result.stdout.strip()
    if not branch or branch == "HEAD":
        return None

    return branch


def _read_origin_url(workspace_root: Path) -> str | None:
    result = _run_command(["git", "-C", str(workspace_root), "remote", "get-url", "origin"], cwd=workspace_root)
    if result.returncode != 0:
        return None

    origin = result.stdout.strip()
    return origin or None


def _is_github_remote(url: str | None) -> bool:
    if not url:
        return False

    return bool(GITHUB_REMOTE_RE.search(url))


def _read_git_repo_root(workspace_root: Path) -> Path | None:
    result = _run_command(["git", "-C", str(workspace_root), "rev-parse", "--show-toplevel"], cwd=workspace_root)
    if result.returncode != 0:
        return None

    repo_root = result.stdout.strip()
    return Path(repo_root) if repo_root else None


def _workspace_matches_repo_root(workspace_root: Path, repo_root: Path | None) -> bool:
    if repo_root is None:
        return False

    return workspace_root.resolve() == repo_root.resolve()


def _parse_gh_auth_status(text: str) -> GitHubAuthStatus:
    authenticated = "logged in to github.com" in text.lower()

    account_match = re.search(
        r"Logged in to github\.com (?:account|as) ([^(]+)",
        text,
        re.IGNORECASE,
    )
    protocol_match = re.search(r"Git operations protocol:\s*(\S+)", text, re.IGNORECASE)
    scopes_match = re.search(r"Token scopes:\s*'([^']+)'", text, re.IGNORECASE)

    scopes = []
    if scopes_match:
        scopes = [scope.strip() for scope in scopes_match.group(1).split(",") if scope.strip()]

    status_text = text or None
    return GitHubAuthStatus(
        available=True,
        authenticated=authenticated,
        account=account_match.group(1).strip() if account_match else None,
        protocol=protocol_match.group(1).strip() if protocol_match else None,
        scopes=scopes,
        status_text=status_text,
    )


def _collect_github_auth_status() -> GitHubAuthStatus:
    gh_path = shutil.which(settings.gh_cli_path)
    if gh_path is None:
        return GitHubAuthStatus(
            available=False,
            authenticated=False,
            status_text=f"Unable to find GitHub CLI executable: {settings.gh_cli_path}",
        )

    result = _run_command([gh_path, "auth", "status", "--hostname", "github.com"], timeout_seconds=12)
    text = _command_text(result)
    if result.returncode != 0 and not text:
        text = "GitHub CLI authentication status is unavailable."

    return _parse_gh_auth_status(text)


def _collect_repo_status(workspace_root: Path) -> RepoLinkStatus:
    result = _run_command(["git", "-C", str(workspace_root), "rev-parse", "--is-inside-work-tree"], cwd=workspace_root)
    is_git_repository = result.returncode == 0 and result.stdout.strip().lower() == "true"
    repo_root = _read_git_repo_root(workspace_root) if is_git_repository else None
    git_root = repo_root or workspace_root
    current_branch = _read_git_branch(git_root) if is_git_repository else None
    origin_url = _read_origin_url(git_root) if is_git_repository else None
    remote_urls = _read_git_remote_urls(git_root) if is_git_repository else []

    return RepoLinkStatus(
        workspace_root=str(workspace_root),
        repo_root=str(repo_root) if repo_root else None,
        workspace_is_repo_root=_workspace_matches_repo_root(workspace_root, repo_root),
        is_git_repository=is_git_repository,
        current_branch=current_branch,
        origin_url=origin_url,
        origin_is_github=_is_github_remote(origin_url),
        remote_urls=remote_urls,
    )


async def _collect_app_server_snapshot() -> tuple[AppServerStatus, OpenAIAccountStatus]:
    status_payload = await codex_app_server_manager.get_status()
    app_server_status = AppServerStatus(
        enabled=bool(status_payload.get("enabled", True)),
        ready=bool(status_payload.get("ready", False)),
        listen_url=str(status_payload.get("listen_url", "")),
        pid=status_payload.get("pid"),
        workspace_root=str(status_payload.get("workspace_root", settings.codex_workspace_root)),
        model=str(status_payload.get("model", settings.codex_model)),
    )

    openai_account = OpenAIAccountStatus(
        available=False,
        requires_openai_auth=None,
        status_text="Codex App Server is not ready yet.",
    )

    if not app_server_status.ready:
        return app_server_status, openai_account

    try:
        account_response = await codex_app_server_manager.rpc("account/read", {"refreshToken": True})
    except HTTPException as exc:
        openai_account.status_text = exc.detail if isinstance(exc.detail, str) else "Unable to read Codex App Server account state."
        return app_server_status, openai_account
    except Exception:
        openai_account.status_text = "Unable to read Codex App Server account state."
        return app_server_status, openai_account

    account = account_response.get("account") if isinstance(account_response, dict) else None
    requires_openai_auth = account_response.get("requiresOpenaiAuth") if isinstance(account_response, dict) else None
    openai_account.available = isinstance(account_response, dict)
    openai_account.requires_openai_auth = requires_openai_auth
    if account:
        openai_account.status_text = "OpenAI account linked."
    elif requires_openai_auth:
        openai_account.status_text = "OpenAI account linking required."
    else:
        openai_account.status_text = "OpenAI account state unavailable."

    if isinstance(account, dict):
        account_type = account.get("type")
        openai_account.auth_mode = account_type
        openai_account.account_type = account_type
        if account_type == "chatgpt":
            openai_account.email = account.get("email")
            openai_account.plan_type = account.get("planType")

    return app_server_status, openai_account


async def collect_setup_status() -> SetupStatusResponse:
    workspace_root = _ensure_workspace_root()
    repo_status = _collect_repo_status(workspace_root)
    git_config_root = Path(repo_status.repo_root) if repo_status.repo_root else None
    git_identity = GitIdentityStatus(
        available=True,
        name=_read_git_config_value("user.name", cwd=git_config_root) or _read_git_config_value("user.name"),
        email=_read_git_config_value("user.email", cwd=git_config_root) or _read_git_config_value("user.email"),
        credential_helper=_read_git_config_value("credential.helper", cwd=git_config_root) or _read_git_config_value("credential.helper"),
    )
    github_auth = _collect_github_auth_status()
    app_server_status, openai_account = await _collect_app_server_snapshot()

    return SetupStatusResponse(
        checked_at=utc_now(),
        workspace_root=str(workspace_root),
        git_identity=git_identity,
        github=github_auth,
        repo=repo_status,
        app_server=app_server_status,
        openai_account=openai_account,
        active_github_login=github_device_login_manager.current_status(),
    )


@dataclass
class GitHubDeviceLoginFlow:
    flow_id: str
    process: subprocess.Popen[str]
    started_at: datetime
    expires_at: datetime
    verification_url: str | None = None
    user_code: str | None = None
    status: str = "pending"
    message: str | None = None
    exit_code: int | None = None
    finished_at: datetime | None = None
    _initial_payload_ready: threading.Event = field(default_factory=threading.Event, repr=False)

    def as_status(self) -> GitHubDeviceLoginStatus:
        return GitHubDeviceLoginStatus(
            flow_id=self.flow_id,
            status=self.status,
            verification_url=self.verification_url,
            user_code=self.user_code,
            expires_at=self.expires_at,
            message=self.message,
        )


class GitHubDeviceLoginManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._flows: dict[str, GitHubDeviceLoginFlow] = {}

    def current_status(self) -> GitHubDeviceLoginStatus | None:
        with self._lock:
            self._purge_finished_locked()
            flow = self._get_pending_flow_locked()
            if flow is None:
                return None

            self._refresh_flow_locked(flow)
            if flow.status == "pending" and utc_now() >= flow.expires_at:
                self._expire_flow_locked(flow)
                return None

            return flow.as_status() if flow.status == "pending" else None

    def start_flow(self) -> GitHubDeviceLoginStatus:
        gh_path = shutil.which(settings.gh_cli_path)
        if gh_path is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unable to find GitHub CLI executable: {settings.gh_cli_path}",
            )

        workspace_root = _ensure_workspace_root()

        with self._lock:
            self._purge_finished_locked()
            if self._get_pending_flow_locked() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A GitHub device login is already in progress.",
                )

            flow = GitHubDeviceLoginFlow(
                flow_id=str(uuid4()),
                process=subprocess.Popen(
                    [
                        gh_path,
                        "auth",
                        "login",
                        "--device",
                        "--git-protocol",
                        "https",
                        "--hostname",
                        "github.com",
                    ],
                    cwd=str(workspace_root),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    bufsize=1,
                ),
                started_at=utc_now(),
                expires_at=utc_now() + timedelta(minutes=LOGIN_FLOW_TTL_MINUTES),
            )
            self._flows[flow.flow_id] = flow

        self._start_monitor_thread(flow)
        if not flow._initial_payload_ready.wait(timeout=12):
            self.cancel_flow(flow.flow_id, reason="GitHub CLI did not emit a device code in time.")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="GitHub CLI did not emit a device code in time.",
            )

        with self._lock:
            stored_flow = self._flows.get(flow.flow_id)
            if stored_flow is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="GitHub login flow ended before it could be returned.",
                )

            return stored_flow.as_status()

    def get_flow(self, flow_id: str) -> GitHubDeviceLoginStatus:
        with self._lock:
            flow = self._require_flow_locked(flow_id)
            self._refresh_flow_locked(flow)
            if flow.status == "pending" and utc_now() >= flow.expires_at:
                self._expire_flow_locked(flow)

            return flow.as_status()

    def cancel_flow(self, flow_id: str, *, reason: str | None = None) -> None:
        with self._lock:
            flow = self._require_flow_locked(flow_id)
            self._terminate_process(flow)
            if flow.status == "pending":
                flow.status = "expired"
            flow.message = reason or flow.message
            flow.finished_at = utc_now()
            self._trim_finished_locked()

    def _start_monitor_thread(self, flow: GitHubDeviceLoginFlow) -> None:
        thread = threading.Thread(target=self._monitor_flow, args=(flow.flow_id,), daemon=True)
        thread.start()

    def _monitor_flow(self, flow_id: str) -> None:
        flow = self._lookup_flow(flow_id)
        if flow is None:
            return

        stdout = flow.process.stdout
        if stdout is None:
            with self._lock:
                flow.status = "failed"
                flow.message = "GitHub CLI login process did not provide output."
                flow.finished_at = utc_now()
                self._trim_finished_locked()
            return

        try:
            while True:
                with self._lock:
                    if flow.status == "pending" and utc_now() >= flow.expires_at:
                        self._expire_flow_locked(flow)
                        return

                line = stdout.readline()
                if not line:
                    break

                self._ingest_output_line(flow, line)

            flow.exit_code = flow.process.wait()
        except Exception as exc:
            with self._lock:
                if flow.status == "pending":
                    flow.status = "failed"
                    flow.message = f"GitHub CLI login monitoring failed: {exc}"
                    flow.finished_at = utc_now()
                    self._trim_finished_locked()
            return

        with self._lock:
            if flow.status == "expired":
                self._trim_finished_locked()
                return

            if flow.exit_code == 0:
                try:
                    authenticated = _collect_github_auth_status().authenticated
                except Exception:
                    authenticated = False

                flow.status = "completed" if authenticated else "failed"
                flow.message = (
                    "GitHub device login completed."
                    if authenticated
                    else "GitHub CLI exited successfully, but authentication could not be confirmed."
                )
            else:
                flow.status = "failed"
                flow.message = f"GitHub CLI login exited with code {flow.exit_code}."

            flow.finished_at = utc_now()
            self._trim_finished_locked()

    def _ingest_output_line(self, flow: GitHubDeviceLoginFlow, line: str) -> None:
        text = line.strip()
        if not text:
            return

        with self._lock:
            if flow.status != "pending":
                return

            url_match = DEVICE_URL_RE.search(text)
            code_match = DEVICE_CODE_RE.search(text)

            if url_match and flow.verification_url is None:
                flow.verification_url = url_match.group(0)

            if code_match and flow.user_code is None:
                flow.user_code = code_match.group(0)

            if flow.message is None:
                flow.message = text

            if flow.verification_url and flow.user_code:
                flow._initial_payload_ready.set()

    def _lookup_flow(self, flow_id: str) -> GitHubDeviceLoginFlow | None:
        with self._lock:
            return self._flows.get(flow_id)

    def _get_pending_flow_locked(self) -> GitHubDeviceLoginFlow | None:
        for flow in reversed(list(self._flows.values())):
            if flow.status == "pending":
                return flow

        return None

    def _refresh_flow_locked(self, flow: GitHubDeviceLoginFlow) -> None:
        if flow.status != "pending":
            return

        if flow.process.poll() is None:
            return

        flow.exit_code = flow.process.returncode
        if flow.exit_code == 0:
            try:
                authenticated = _collect_github_auth_status().authenticated
            except Exception:
                authenticated = False

            flow.status = "completed" if authenticated else "failed"
            flow.message = (
                "GitHub device login completed."
                if authenticated
                else "GitHub CLI exited successfully, but authentication could not be confirmed."
            )
        else:
            flow.status = "failed"
            flow.message = f"GitHub CLI login exited with code {flow.exit_code}."

        flow.finished_at = utc_now()
        self._trim_finished_locked()

    def _expire_flow_locked(self, flow: GitHubDeviceLoginFlow) -> None:
        if flow.status != "pending":
            return

        self._terminate_process(flow)
        flow.status = "expired"
        flow.message = "GitHub device login expired."
        flow.finished_at = utc_now()
        self._trim_finished_locked()

    def _terminate_process(self, flow: GitHubDeviceLoginFlow) -> None:
        if flow.process.poll() is not None:
            return

        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(flow.process.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                check=False,
            )
            return

        try:
            flow.process.terminate()
        except ProcessLookupError:
            pass

    def _require_flow_locked(self, flow_id: str) -> GitHubDeviceLoginFlow:
        flow = self._flows.get(flow_id)
        if flow is not None:
            return flow

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="GitHub device login flow not found.",
        )

    def _purge_finished_locked(self) -> None:
        cutoff = utc_now() - timedelta(minutes=FLOW_RETENTION_MINUTES)
        for flow_id, flow in list(self._flows.items()):
            if flow.status == "pending":
                continue

            if flow.finished_at is None:
                flow.finished_at = utc_now()

            if flow.finished_at < cutoff:
                self._flows.pop(flow_id, None)

        self._trim_finished_locked()

    def _trim_finished_locked(self) -> None:
        finished = [flow for flow in self._flows.values() if flow.status != "pending"]
        if len(finished) <= MAX_FINISHED_FLOWS:
            return

        finished.sort(key=lambda flow: flow.finished_at or flow.started_at)
        for flow in finished[:-MAX_FINISHED_FLOWS]:
            self._flows.pop(flow.flow_id, None)


github_device_login_manager = GitHubDeviceLoginManager()


async def start_github_device_login() -> GitHubDeviceLoginStartResponse:
    flow = github_device_login_manager.start_flow()
    return GitHubDeviceLoginStartResponse(**flow.model_dump())


async def get_github_device_login_status(flow_id: str) -> GitHubDeviceLoginStatusResponse:
    flow_status = github_device_login_manager.get_flow(flow_id)
    setup_status = await collect_setup_status() if flow_status.status == "completed" else None
    return GitHubDeviceLoginStatusResponse(
        **flow_status.model_dump(),
        setup=setup_status,
    )
