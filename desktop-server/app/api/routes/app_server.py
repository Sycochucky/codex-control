import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
import websockets

from app.api.dependencies import CurrentUserDependency
from app.app_server import codex_app_server_manager
from app.websocket.auth import require_current_user_for_websocket

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

APP_SERVER_STARTUP_TIMEOUT_SECONDS = 15.0
APP_SERVER_UPSTREAM_CLOSE_TIMEOUT_SECONDS = 5.0
APP_SERVER_UPSTREAM_PING_INTERVAL_SECONDS = 20.0
APP_SERVER_UPSTREAM_PING_TIMEOUT_SECONDS = 20.0


@router.get("/status")
async def app_server_status_route(_: CurrentUserDependency) -> dict:
    return await codex_app_server_manager.get_status()


@router.websocket("/ws")
async def app_server_ws_route(websocket: WebSocket) -> None:
    try:
        require_current_user_for_websocket(websocket)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    try:
        upstream_url = await asyncio.wait_for(
            codex_app_server_manager.ensure_running(),
            timeout=APP_SERVER_STARTUP_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        logger.exception(
            "Timed out while ensuring Codex App Server was running after %.1f seconds.",
            APP_SERVER_STARTUP_TIMEOUT_SECONDS,
        )
        await _close_mobile_websocket(
            websocket,
            status.WS_1011_INTERNAL_ERROR,
            "Codex App Server startup timed out.",
        )
        return
    except Exception as exc:
        logger.exception("Failed to ensure Codex App Server was running: %s", exc)
        await _close_mobile_websocket(
            websocket,
            status.WS_1011_INTERNAL_ERROR,
            "Codex App Server startup failed.",
        )
        return

    try:
        async with websockets.connect(
            upstream_url,
            max_size=None,
            ping_interval=APP_SERVER_UPSTREAM_PING_INTERVAL_SECONDS,
            ping_timeout=APP_SERVER_UPSTREAM_PING_TIMEOUT_SECONDS,
            close_timeout=APP_SERVER_UPSTREAM_CLOSE_TIMEOUT_SECONDS,
        ) as upstream:
            client_to_upstream = asyncio.create_task(_forward_client_messages(websocket, upstream))
            upstream_to_client = asyncio.create_task(_forward_upstream_messages(websocket, upstream))

            done, pending = await asyncio.wait(
                {client_to_upstream, upstream_to_client},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.exception("Codex App Server websocket proxy failed: %s", exc)
        await _close_mobile_websocket(
            websocket,
            status.WS_1011_INTERNAL_ERROR,
            "Codex App Server websocket proxy failed.",
        )


async def _forward_client_messages(websocket: WebSocket, upstream: websockets.ClientConnection) -> None:
    try:
        while True:
            message = await websocket.receive_text()
            logger.info("Mobile -> Codex App Server: %s", _describe_jsonrpc_message(message))
            await upstream.send(message)
    finally:
        logger.info("Mobile -> Codex App Server task ended.")


async def _forward_upstream_messages(websocket: WebSocket, upstream: websockets.ClientConnection) -> None:
    try:
        async for message in upstream:
            logger.info("Codex App Server -> Mobile: %s", _describe_jsonrpc_message(message))
            await websocket.send_text(message)
    finally:
        logger.info("Codex App Server -> Mobile task ended.")


async def _close_mobile_websocket(websocket: WebSocket, code: int, reason: str) -> None:
    try:
        await websocket.close(code=code, reason=reason)
    except RuntimeError:
        logger.debug("Mobile websocket was already closed while sending close reason: %s", reason)


def _describe_jsonrpc_message(message: str) -> str:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        return f"non-json message length={len(message)}"

    if not isinstance(payload, dict):
        return f"json {type(payload).__name__} length={len(message)}"

    method = payload.get("method")
    request_id = payload.get("id")
    if method is not None and request_id is not None:
        return f"request method={method} id={request_id}"
    if method is not None:
        return f"notification method={method}"
    if request_id is not None and "error" in payload:
        error = payload.get("error")
        detail = error.get("message") if isinstance(error, dict) else error
        return f"error id={request_id} message={detail}"
    if request_id is not None:
        return f"response id={request_id}"

    return f"jsonrpc message keys={','.join(sorted(payload.keys()))}"
