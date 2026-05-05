from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from threading import Lock

from fastapi.encoders import jsonable_encoder
from fastapi import WebSocket


class ThreadEventBroker:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = Lock()

    async def connect(self, thread_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        with self._lock:
            self._connections[thread_id].add(websocket)

    def disconnect(self, thread_id: str, websocket: WebSocket) -> None:
        with self._lock:
            connections = self._connections.get(thread_id)
            if not connections:
                return

            connections.discard(websocket)
            if not connections:
                self._connections.pop(thread_id, None)

    def get_connections(self, thread_id: str) -> list[WebSocket]:
        with self._lock:
            return list(self._connections.get(thread_id, set()))

    async def publish(self, thread_id: str, payloads: Iterable[dict]) -> None:
        connections = self.get_connections(thread_id)
        if not connections:
            return

        for payload in payloads:
            stale_connections: list[WebSocket] = []
            for websocket in connections:
                try:
                    await websocket.send_json(jsonable_encoder(payload))
                except Exception:
                    stale_connections.append(websocket)

            for websocket in stale_connections:
                self.disconnect(thread_id, websocket)


thread_event_broker = ThreadEventBroker()
