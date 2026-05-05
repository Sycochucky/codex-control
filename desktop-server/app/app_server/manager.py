from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import shutil
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from fastapi import HTTPException, status
import websockets

from app.core.config import settings


logger = logging.getLogger(__name__)

APP_SERVER_RPC_TIMEOUT_SECONDS = 15.0
APP_SERVER_PROCESS_STOP_TIMEOUT_SECONDS = 3.0


class CodexAppServerManager:
    def __init__(self) -> None:
        self._host = "127.0.0.1"
        self._port = 8765
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None

    @property
    def url(self) -> str:
        return f"ws://{self._host}:{self._port}"

    @property
    def ready_url(self) -> str:
        parsed = urllib_parse.urlparse(self.url)
        return urllib_parse.urlunparse(("http", parsed.netloc, "/readyz", "", "", ""))

    async def ensure_running(self) -> str:
        async with self._lock:
            if self._process and self._process.returncode is None:
                if await self._is_ready():
                    return self.url

            await self._start_process()
            return self.url

    async def get_status(self) -> dict[str, Any]:
        ready = await self._is_ready()
        return {
            "enabled": True,
            "listen_url": self.url,
            "ready": ready,
            "pid": self._process.pid if self._process and self._process.returncode is None else None,
            "workspace_root": settings.codex_workspace_root,
            "model": settings.codex_model,
        }

    async def rpc(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        await self.ensure_running()
        async with websockets.connect(self.url, max_size=None) as websocket:
            await websocket.send(
                _json_dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": "initialize",
                        "method": "initialize",
                        "params": {
                            "clientInfo": {
                                "name": "codex-control-desktop-server",
                                "version": "0.1.0",
                            },
                            "capabilities": None,
                        },
                    }
                )
            )
            await self._read_response(websocket, "initialize")
            await websocket.send(_json_dumps({"jsonrpc": "2.0", "method": "initialized", "params": {}}))

            request_id = f"{method}-1"
            await websocket.send(
                _json_dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        **({"params": params} if params is not None else {}),
                    }
                )
            )
            return _compact_inline_image_urls(await self._read_response(websocket, request_id))

    async def _start_process(self) -> None:
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

        await self._stop_process()

        command = [codex_path]

        if settings.codex_model:
            command.extend(["-m", settings.codex_model])

        if settings.codex_cli_profile:
            command.extend(["-p", settings.codex_cli_profile])

        if settings.codex_cli_sandbox:
            command.extend(["-s", settings.codex_cli_sandbox])

        command.extend(
            [
                "app-server",
                "--listen",
                self.url,
            ]
        )

        logger.info("Starting Codex App Server on %s for %s", self.url, workspace_root)

        self._process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(workspace_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._stdout_task = asyncio.create_task(self._drain_stream(self._process.stdout, "stdout"))
        self._stderr_task = asyncio.create_task(self._drain_stream(self._process.stderr, "stderr"))

        for _ in range(30):
            if self._process.returncode is not None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Codex App Server exited before becoming ready.",
                )

            if await self._is_ready():
                return

            await asyncio.sleep(0.25)

        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Timed out while starting the local Codex App Server.",
        )

    async def _stop_process(self, timeout_seconds: float = APP_SERVER_PROCESS_STOP_TIMEOUT_SECONDS) -> None:
        process = self._process
        if process is None:
            return

        if process.returncode is not None:
            self._process = None
            return

        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
        except TimeoutError:
            logger.warning("Codex App Server did not stop within %.1f seconds; killing it.", timeout_seconds)
            process.kill()
            await process.wait()
        finally:
            self._process = None

    async def _is_ready(self) -> bool:
        return await asyncio.to_thread(self._probe_ready_endpoint)

    def _probe_ready_endpoint(self) -> bool:
        request = urllib_request.Request(
            self.ready_url,
            headers={"User-Agent": "codex-control-desktop-server/0.1.0"},
        )
        try:
            with urllib_request.urlopen(request, timeout=1) as response:
                return response.status == 200
        except (TimeoutError, OSError, urllib_error.URLError, urllib_error.HTTPError):
            return False

    @staticmethod
    async def _drain_stream(stream: asyncio.StreamReader | None, stream_name: str) -> None:
        if stream is None:
            return

        while True:
            line = await stream.readline()
            if not line:
                return

            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                logger.info("Codex App Server %s: %s", stream_name, text)

    @staticmethod
    async def _read_response(
        websocket: websockets.ClientConnection,
        request_id: str,
    ) -> dict[str, Any]:
        while True:
            try:
                raw_message = await asyncio.wait_for(websocket.recv(), timeout=APP_SERVER_RPC_TIMEOUT_SECONDS)
            except TimeoutError as exc:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail=f"Codex App Server request timed out while waiting for {request_id}.",
                ) from exc
            message = json.loads(raw_message)
            if message.get("id") != request_id:
                continue

            if "error" in message:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=message["error"].get("message", "Codex App Server request failed."),
                )

            return message.get("result", {})


codex_app_server_manager = CodexAppServerManager()


def _json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload)


def _compact_inline_image_urls(value: Any) -> Any:
    if isinstance(value, list):
        return [_compact_inline_image_urls(entry) for entry in value]

    if isinstance(value, dict):
        compacted = {key: _compact_inline_image_urls(entry) for key, entry in value.items()}
        if compacted.get("type") == "image":
            url = compacted.get("url")
            if isinstance(url, str) and url.startswith("data:"):
                compacted["url"] = "[inline-image-omitted]"
        return compacted

    return value
