from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    database_url: str
    shared_token: str
    provider_name: str
    session_ttl_hours: int
    max_sessions_per_label: int
    codex_model: str
    codex_cli_path: str
    gh_cli_path: str
    codex_cli_profile: str | None
    codex_cli_sandbox: str
    codex_cli_ephemeral: bool
    codex_cli_timeout_seconds: int
    codex_workspace_root: str


def get_settings() -> Settings:
    base_dir = Path(__file__).resolve().parents[2]
    data_dir = base_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    database_path = data_dir / "codex_control.db"

    codex_cli_ephemeral = os.getenv("CODEX_CLI_EPHEMERAL", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    return Settings(
        database_url=f"sqlite:///{database_path}",
        shared_token=os.getenv("CODEX_CONTROL_SHARED_TOKEN", "codex-dev"),
        provider_name=os.getenv("CODEX_PROVIDER", "mock-codex"),
        session_ttl_hours=int(os.getenv("CODEX_SESSION_TTL_HOURS", "24")),
        max_sessions_per_label=int(os.getenv("CODEX_MAX_SESSIONS_PER_LABEL", "3")),
        codex_model=os.getenv("CODEX_MODEL", "gpt-5.4"),
        codex_cli_path=os.getenv("CODEX_CLI_PATH", "codex"),
        gh_cli_path=os.getenv("GH_CLI_PATH", "gh"),
        codex_cli_profile=os.getenv("CODEX_CLI_PROFILE"),
        codex_cli_sandbox=os.getenv("CODEX_CLI_SANDBOX", "workspace-write"),
        codex_cli_ephemeral=codex_cli_ephemeral,
        codex_cli_timeout_seconds=int(os.getenv("CODEX_CLI_TIMEOUT_SECONDS", "300")),
        codex_workspace_root=os.getenv("CODEX_WORKSPACE_ROOT", str(base_dir.parent)),
    )


settings = get_settings()
