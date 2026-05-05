from __future__ import annotations

import os
from pathlib import Path
import signal
import shutil
import subprocess
import tempfile

from fastapi import HTTPException, status

from app.core.config import settings
from app.models.entities import MessageRole, TaskStatus
from app.providers.base import (
    CodexProvider,
    ProviderContext,
    ProviderConversationMessage,
    ProviderEvent,
    ProviderMessage,
    ProviderResult,
)


class RealCodexProvider(CodexProvider):
    name = "real-codex"

    def start_task(self, context: ProviderContext) -> ProviderResult:
        latest_user_message = self._get_latest_user_message(context)
        if latest_user_message is None:
            return ProviderResult(
                status=TaskStatus.WAITING_FOR_INPUT,
                messages=[
                    ProviderMessage(
                        role=MessageRole.ASSISTANT,
                        content="Codex is ready. Send the first coding instruction to start the task.",
                    )
                ],
                events=[
                    ProviderEvent(event_type="waiting_for_input", content="Waiting for the first user instruction."),
                ],
            )

        return self._run_codex_exec(
            context=context,
            event_prefix="Started Codex task",
        )

    def append_message(self, context: ProviderContext) -> ProviderResult:
        return self._run_codex_exec(
            context=context,
            event_prefix="Sent reply to Codex",
        )

    def continue_task(self, context: ProviderContext) -> ProviderResult:
        continuation_context = ProviderContext(
            thread_title=context.thread_title,
            messages=[
                *context.messages,
                ProviderConversationMessage(
                    role=MessageRole.USER,
                    content=(
                        "Continue from the existing context. "
                        "If you still need user input, ask one concise follow-up question. "
                        "Otherwise provide the next concrete result."
                    ),
                ),
            ],
        )
        return self._run_codex_exec(
            context=continuation_context,
            event_prefix="Continued Codex task",
        )

    def _run_codex_exec(self, context: ProviderContext, event_prefix: str) -> ProviderResult:
        codex_path = shutil.which(settings.codex_cli_path)
        if codex_path is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unable to find Codex CLI executable: {settings.codex_cli_path}",
            )

        workspace_root = Path(settings.codex_workspace_root)
        if not workspace_root.exists():
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Configured Codex workspace does not exist: {workspace_root}",
            )

        prompt = self._build_prompt(context)

        with tempfile.TemporaryDirectory(prefix="codex-control-") as temp_dir:
            output_path = Path(temp_dir) / "last-message.txt"
            command = [
                codex_path,
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                settings.codex_cli_sandbox,
                "-C",
                str(workspace_root),
                "--output-last-message",
                str(output_path),
            ]

            if settings.codex_model:
                command.extend(["-m", settings.codex_model])

            if settings.codex_cli_profile:
                command.extend(["-p", settings.codex_cli_profile])

            if settings.codex_cli_ephemeral:
                command.append("--ephemeral")

            command.append(prompt)

            completed = self._run_command(
                command,
                workspace_root=workspace_root,
            )

            if completed.returncode != 0:
                self._raise_cli_error(completed)

            if output_path.exists():
                output_text = output_path.read_text(encoding="utf-8").strip()
            else:
                output_text = completed.stdout.strip()

        if not output_text:
            output_text = "Codex completed without returning text output."

        inferred_status = self._infer_status(output_text)
        return ProviderResult(
            status=inferred_status,
            messages=[
                ProviderMessage(
                    role=MessageRole.ASSISTANT,
                    content=output_text,
                )
            ],
            events=[
                ProviderEvent(event_type="log", content=f"{event_prefix} via local Codex CLI."),
                ProviderEvent(event_type="log", content=f"Codex workspace: {workspace_root}"),
                ProviderEvent(
                    event_type="completed" if inferred_status == TaskStatus.COMPLETED else "waiting_for_input",
                    content="Codex CLI response received.",
                ),
            ],
        )

    @staticmethod
    def _run_command(command: list[str], workspace_root: Path) -> subprocess.CompletedProcess[str]:
        timeout_seconds = settings.codex_cli_timeout_seconds
        process = subprocess.Popen(
            command,
            cwd=str(workspace_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            start_new_session=os.name != "nt",
        )

        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            RealCodexProvider._terminate_process_tree(process)
            stdout, stderr = process.communicate()
            detail = (
                f"Codex CLI timed out after {timeout_seconds} seconds and was terminated. "
                "Increase CODEX_CLI_TIMEOUT_SECONDS if longer runs are expected."
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=detail,
            ) from None

        return subprocess.CompletedProcess(
            args=command,
            returncode=process.returncode,
            stdout=stdout,
            stderr=stderr,
        )

    @staticmethod
    def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return

        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                check=False,
                text=True,
            )
            return

        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    @staticmethod
    def _raise_cli_error(completed: subprocess.CompletedProcess[str]) -> None:
        detail = RealCodexProvider._build_error_detail(completed)
        status_code = RealCodexProvider._map_error_status(completed.returncode, detail)
        raise HTTPException(
            status_code=status_code,
            detail=detail,
        )

    @staticmethod
    def _build_error_detail(completed: subprocess.CompletedProcess[str]) -> str:
        raw_detail = completed.stderr.strip() or completed.stdout.strip()
        if not raw_detail:
            return "Codex CLI execution failed without diagnostic output."

        lowered = raw_detail.lower()
        if "login" in lowered and any(token in lowered for token in ("auth", "sign in", "not logged")):
            return "Codex CLI is not authenticated on the server machine. Run `codex login` and retry."

        if "sandbox" in lowered:
            return f"Codex CLI rejected the configured sandbox `{settings.codex_cli_sandbox}`. {raw_detail}"

        if "model" in lowered and "not" in lowered:
            return f"Codex CLI rejected the configured model `{settings.codex_model}`. {raw_detail}"

        if "profile" in lowered and "not" in lowered and settings.codex_cli_profile:
            return f"Codex CLI rejected the configured profile `{settings.codex_cli_profile}`. {raw_detail}"

        return raw_detail

    @staticmethod
    def _map_error_status(returncode: int, detail: str) -> int:
        lowered = detail.lower()
        if "not authenticated" in lowered or "run `codex login`" in lowered:
            return status.HTTP_503_SERVICE_UNAVAILABLE

        if any(token in lowered for token in ("sandbox", "configured model", "configured profile")):
            return status.HTTP_500_INTERNAL_SERVER_ERROR

        if returncode < 0:
            return status.HTTP_502_BAD_GATEWAY

        return status.HTTP_502_BAD_GATEWAY

    @staticmethod
    def _get_latest_user_message(context: ProviderContext) -> str | None:
        for message in reversed(context.messages):
            if message.role == MessageRole.USER:
                return message.content

        return None

    @staticmethod
    def _infer_status(output_text: str) -> TaskStatus:
        lowered = output_text.lower()
        if output_text.rstrip().endswith("?") or "need more information" in lowered or "please provide" in lowered:
            return TaskStatus.WAITING_FOR_INPUT

        return TaskStatus.COMPLETED

    @staticmethod
    def _build_prompt(context: ProviderContext) -> str:
        transcript = "\n\n".join(
            f"{message.role.value.upper()}:\n{message.content}"
            for message in context.messages
        )
        return (
            f"Thread title: {context.thread_title}\n\n"
            "You are responding inside Codex Control through a phone-based control surface. "
            "Use the full conversation context below. The most recent USER block is the active instruction and should be followed directly when possible. "
            "If more user input is required, ask one concise follow-up question. "
            "Otherwise provide the next concrete implementation result.\n\n"
            f"{transcript}"
        )
